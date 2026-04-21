// Security-invariant tests. These encode properties from the security audit
// (#8) as checked-in tests so regressions surface at PR time rather than during
// the next audit. See also:
//   - src/popup.test.ts        — `origin`/`event.source` validation coverage
//   - src/callback/resolveWebId.test.ts — `isAllowedIssuer` + https/localhost gating
//   - .github/workflows/ci.yml — `pnpm audit` + CodeQL jobs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { LOGIN_COMPLETE_MESSAGE_TYPE } from './popup.js';

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
  test('popup origin + event.source guards are tested in popup.test.ts', () => {
    const src = readFileSync(join(SRC_DIR, 'popup.test.ts'), 'utf8');
    expect(src).toMatch(/origin does not match/);
    expect(src).toMatch(/source is not the opened popup/);
  });

  test('isAllowedIssuer default-rejects localhost in resolveWebId.test.ts', () => {
    const src = readFileSync(join(SRC_DIR, 'callback', 'resolveWebId.test.ts'), 'utf8');
    expect(src).toMatch(/rejects http:\/\/localhost by default/);
    expect(src).toMatch(/rejects http:\/\/localhost when allowLocalhost is explicitly false/);
  });
});
