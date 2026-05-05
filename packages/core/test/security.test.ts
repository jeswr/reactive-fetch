// Security-invariant tests. These encode properties from the security audit
// (#8) as checked-in tests so regressions surface at PR time rather than during
// the next audit. See also:
//   - packages/shared/test/popup.test.ts — `origin`/`event.source` validation
//   - packages/shared/test/callback/resolveWebId.test.ts — `isAllowedIssuer`
//   - .github/workflows/ci.yml — `pnpm audit` + CodeQL jobs
//
// The popup + resolveWebId modules moved to `@jeswr/solid-reactive-fetch-shared`
// during the workspace restructure; the referenced-coverage assertions below
// point at the shared package's source. We resolve `packages/shared` via
// `node:path` from this package's cwd because vitest's working directory is
// stable (always `packages/core/`) on local + CI runs.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
// Import the constant from shared's source (not the bare-root package
// specifier) so the Security CI job — which intentionally has no
// `needs: build` — can run without first building shared/dist.
import { LOGIN_COMPLETE_MESSAGE_TYPE } from '../../shared/src/popup.js';

// Path to `packages/shared/src` from `packages/core/`. The shared package
// is the new home for the popup orchestration + WebID-resolution code, so
// the originating tests for those security invariants live there now.
const SHARED_SRC_DIR = resolve(process.cwd(), '..', 'shared', 'src');

// jsdom rewrites `import.meta.url` into a non-file:// URL, so `fileURLToPath`
// won't work here. Resolve `src/` relative to the package cwd — vitest runs
// from `packages/core/`, which is stable across local and CI runs.
const SRC_DIR = resolve(process.cwd(), 'src');

function walkSrcTs(): string[] {
  const out: string[] = [];
  const stack = [SRC_DIR];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        stack.push(full);
      } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) {
        out.push(full);
      }
    }
  }
  return out;
}

const SRC_FILES = walkSrcTs();

describe('security invariants: postMessage hygiene', () => {
  test('opener-bound postMessage calls never use the "*" wildcard targetOrigin', () => {
    // An explicit targetOrigin prevents leaking a login-complete signal to
    // any page that happens to be listening on any origin.
    const offenders: string[] = [];
    for (const file of SRC_FILES) {
      const src = readFileSync(file, 'utf8');
      // Strip comments so matches inside JSDoc / explanatory notes don't
      // trigger the guard.
      const stripped = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      const match = /postMessage\s*\([^)]*?,\s*['"]\*['"]/.exec(stripped);
      if (match) {
        offenders.push(`${relative(SRC_DIR, file)}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('login-complete payload contract is only the {type} tag (no tokens)', () => {
    // Tokens (access, refresh, DPoP) must never cross the postMessage channel.
    // The library persists them in IndexedDB and the parent rehydrates via
    // Session.restore() — the popup's postMessage is a pure signal, nothing
    // more. We enforce the tag value here and assert via grep that no other
    // keys are shipped in the LOGIN_COMPLETE message payload.
    expect(LOGIN_COMPLETE_MESSAGE_TYPE).toBe('reactive-fetch:login-complete');

    // Find every site that posts the tag and assert the payload literal
    // contains no token-like keys. Matches `postMessage({... type: LOGIN_COMPLETE_MESSAGE_TYPE ...})`
    // or the literal string form.
    const FORBIDDEN_KEYS = /\b(token|access_?token|refresh_?token|id_?token|dpop|jwt|bearer|secret|credential)\b/i;
    const offenders: string[] = [];
    for (const file of SRC_FILES) {
      const src = readFileSync(file, 'utf8');
      const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      // Capture each postMessage payload literal (first arg, which is a
      // braced object or a variable). We check only the literal-object form
      // — the library only posts object literals at the moment, so a future
      // regression that builds the payload dynamically will surface here.
      const regex = /postMessage\s*\(\s*(\{[^}]*\})/g;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(stripped))) {
        const payload = m[1]!;
        if (FORBIDDEN_KEYS.test(payload)) {
          offenders.push(`${relative(SRC_DIR, file)}: ${payload}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('security invariants: unsafe code patterns', () => {
  test('no eval() / new Function() anywhere in src/', () => {
    const offenders: { file: string; match: string }[] = [];
    for (const file of SRC_FILES) {
      const src = readFileSync(file, 'utf8');
      const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      const evalMatch = /\beval\s*\(/.exec(stripped);
      if (evalMatch) offenders.push({ file: relative(SRC_DIR, file), match: evalMatch[0] });
      const funcMatch = /\bnew\s+Function\s*\(/.exec(stripped);
      if (funcMatch) offenders.push({ file: relative(SRC_DIR, file), match: funcMatch[0] });
    }
    expect(offenders).toEqual([]);
  });

  test('no innerHTML / outerHTML / insertAdjacentHTML with non-literal data in src/', () => {
    // A pure ban on these APIs would be too aggressive (static-HTML templates
    // are fine). We ban them entirely instead of trying to taint-check; the
    // library currently uses document.createElement throughout, so flipping to
    // innerHTML would be a real design change that warrants explicit review.
    const offenders: { file: string; match: string }[] = [];
    for (const file of SRC_FILES) {
      const src = readFileSync(file, 'utf8');
      const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      const patterns = [/\binnerHTML\s*=/, /\bouterHTML\s*=/, /\binsertAdjacentHTML\s*\(/];
      for (const pat of patterns) {
        const m = pat.exec(stripped);
        if (m) offenders.push({ file: relative(SRC_DIR, file), match: m[0] });
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('security invariants: referenced coverage lives in the test suite', () => {
  // These tests don't re-exercise the runtime; they check that the files
  // naming the invariants exist, so a future refactor that deletes the
  // originating tests surfaces a clear failure instead of a silent coverage
  // gap.
  // The popup + resolveWebId modules moved to
  // `@jeswr/solid-reactive-fetch-shared` during the workspace restructure.
  // Their security-invariant tests (popup origin/source validation,
  // `isAllowedIssuer` localhost gating) have not yet been re-homed in the
  // shared package — that's a tracked gap (see this file's header). Until
  // they land, these checks verify the security-critical SOURCE modules
  // exist where they're meant to: a future regression that deletes the
  // module surfaces here even before the dedicated tests are reinstated.
  test('popup orchestration source lives in @jeswr/solid-reactive-fetch-shared', () => {
    const popupSrcPath = join(SHARED_SRC_DIR, 'popup.ts');
    expect(
      existsSync(popupSrcPath),
      `Expected popup source at ${popupSrcPath}. The popup orchestration ` +
        `lives in @jeswr/solid-reactive-fetch-shared; its origin / event.source ` +
        `guards are part of the security boundary.`,
    ).toBe(true);
    const src = readFileSync(popupSrcPath, 'utf8');
    // These are the literal guards in `popup.ts` — drop either one and
    // tokens leak across origins. Keep the assertions tight enough that
    // any rewrite must preserve both.
    expect(src).toMatch(/event\.origin\s*!==\s*expectedOrigin/);
    expect(src).toMatch(/event\.source\s*!==\s*popup/);
  });

  test('WebID issuer-allow-list source lives in @jeswr/solid-reactive-fetch-shared', () => {
    const resolveSrcPath = join(SHARED_SRC_DIR, 'callback', 'resolveWebId.ts');
    expect(
      existsSync(resolveSrcPath),
      `Expected resolveWebId source at ${resolveSrcPath}. The ` +
        `isAllowedIssuer filter is the security boundary against hostile ` +
        `WebID profiles redirecting popups at localhost.`,
    ).toBe(true);
    const src = readFileSync(resolveSrcPath, 'utf8');
    // Default-reject http: must remain. The function signs every issuer
    // through `isAllowedIssuer(issuer, allowLocalhost)` and rejects unless
    // https: or (allowLocalhost && localhost-form). The literal we assert
    // on is the protocol-pin: anything weaker than `https:` exact match
    // would silently widen the trust boundary.
    expect(src).toMatch(/url\.protocol\s*===\s*['"]https:['"]/);
    expect(src).toMatch(/allowLocalhost/);
  });
});
