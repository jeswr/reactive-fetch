import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'vitest';

// Built-artifact regression guards. Three published packages (core, prompt,
// sw) carry near-identical dist-smoke tests asserting (a) shared classes
// stay in a single tsup chunk shared by both entry points (so `instanceof`
// is preserved across `…` and `…/callback` imports in the same realm), and
// (b) the published bundle never references the private
// `@jeswr/solid-reactive-fetch-shared` package or other unpublished deps.
// Shared here so a fix to the regex / chunk shape only has to land once.

/**
 * Assert that two tsup entries (root + a subpath entry) both import shared
 * internals from the SAME chunk file. The contract enforced here:
 *
 *  - root entry has `import … from './chunk-XXX.js'`
 *  - subpath entry has `import … from '../chunk-XXX.js'`
 *  - the chunk filenames match exactly
 *  - the chunk file actually exists in `distDir`
 *
 * If splitting is disabled or the entries inline different copies of the
 * shared module, `instanceof` checks across the two entries fail at
 * runtime — this regression sneaked into the codebase once already (see
 * the f769d27 commit history).
 */
export function expectSharedChunkAcrossEntries(opts: {
  distDir: string;
  /** Absolute path to the root entry (e.g. `dist/index.js`). */
  rootEntry: string;
  /** Absolute path to the subpath entry (e.g. `dist/callback/index.js`). */
  subpathEntry: string;
}): string {
  const rootSrc = readFileSync(opts.rootEntry, 'utf8');
  const subSrc = readFileSync(opts.subpathEntry, 'utf8');

  const rootChunk = rootSrc.match(/from\s+['"]\.\/(chunk-[^'"\s]+\.js)['"]/);
  const subChunk = subSrc.match(/from\s+['"]\.\.\/(chunk-[^'"\s]+\.js)['"]/);

  expect(rootChunk, 'root entry must import a shared chunk').not.toBeNull();
  expect(subChunk, 'subpath entry must import a shared chunk').not.toBeNull();
  // The `?? ''` only fires when noUncheckedIndexedAccess inferred `undefined`
  // — `expect(...).not.toBeNull()` above already proved both matches exist.
  const chunkName = rootChunk?.[1] ?? '';
  expect(subChunk?.[1]).toBe(chunkName);
  expect(readdirSync(opts.distDir)).toContain(chunkName);
  return chunkName;
}

/**
 * Dynamically import the root entry and the shared chunk and assert that
 * each named export is the exact same constructor reference. This is the
 * runtime complement to `expectSharedChunkAcrossEntries` — it catches the
 * case where two chunks happen to be referenced but contain independent
 * copies of the same class definition.
 */
export async function expectClassIdentityAcrossChunks(opts: {
  distDir: string;
  rootEntry: string;
  /** Path used to discover the chunk filename via `..` reference. */
  subpathEntry: string;
  /** Names of exported classes/functions whose identity must match. */
  classNames: readonly string[];
}): Promise<void> {
  const root: Record<string, unknown> = await import(opts.rootEntry);
  const subSrc = readFileSync(opts.subpathEntry, 'utf8');
  const chunkName = subSrc.match(/from\s+['"]\.\.\/(chunk-[^'"\s]+\.js)['"]/)?.[1];
  expect(chunkName, 'subpath entry must reference a chunk file').toBeTruthy();

  const chunk: Record<string, unknown> = await import(resolve(opts.distDir, chunkName!));
  for (const name of opts.classNames) {
    expect(typeof root[name], `root.${name} should be a function/class`).toBe('function');
    expect(chunk[name], `${name} must be the same constructor across root and chunk`).toBe(
      root[name],
    );
  }
}

/**
 * Assert a built artifact's source contains none of the listed substrings.
 * Used to verify that `noExternal` + `dts.resolve` actually inlined every
 * reference to private/unpublished packages. Searching by substring rather
 * than parsing imports is intentional — a string literal mention would
 * still leak in error messages or comments.
 */
export function expectNoReferences(filePath: string, references: readonly string[]): void {
  const src = readFileSync(filePath, 'utf8');
  for (const ref of references) {
    expect(
      src.includes(ref),
      `expected ${filePath} to not reference "${ref}"`,
    ).toBe(false);
  }
}
