import { readFileSync } from 'node:fs';
import { expect } from 'vitest';

/**
 * Assert a built artifact's source contains none of the listed
 * substrings. Used to verify that a tsup bundle's `noExternal` actually
 * inlined every reference to a dep that won't resolve in the target
 * runtime (e.g. the SW worker bundle, which ships as a single file
 * dropped into the consumer's public dir).
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
