import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  __resetWebIdCacheForTests,
  forgetWebId,
  getCachedWebIds,
  rememberWebId,
} from './webidCache.js';

const WEBID_A = 'https://alice.example/profile#me';
const WEBID_B = 'https://bob.example/profile#me';
const WEBID_C = 'https://carol.example/profile#me';

beforeEach(() => {
  __resetWebIdCacheForTests();
});

afterEach(() => {
  __resetWebIdCacheForTests();
});

describe('webidCache: add / retrieve', () => {
  test('rememberWebId persists the entry so getCachedWebIds returns it', () => {
    rememberWebId({ webId: WEBID_A, name: 'Alice', photoUrl: 'https://a.example/p.jpg' });
    const entries = getCachedWebIds();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.webId).toBe(WEBID_A);
    expect(entries[0]?.name).toBe('Alice');
    expect(entries[0]?.photoUrl).toBe('https://a.example/p.jpg');
    expect(typeof entries[0]?.lastUsedAt).toBe('number');
  });

  test('getCachedWebIds returns an empty array when the cache is empty', () => {
    expect(getCachedWebIds()).toEqual([]);
  });

  test('rememberWebId updates name + photoUrl for an existing entry and refreshes lastUsedAt', () => {
    rememberWebId({ webId: WEBID_A, name: 'Alice', lastUsedAt: 1000 });
    rememberWebId({ webId: WEBID_A, name: 'Alice (renamed)', photoUrl: 'https://new.example/p.jpg' });

    const entries = getCachedWebIds();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe('Alice (renamed)');
    expect(entries[0]?.photoUrl).toBe('https://new.example/p.jpg');
    expect(entries[0]?.lastUsedAt).toBeGreaterThan(1000);
  });

  test('omitting name/photoUrl when updating keeps the record shape clean', () => {
    rememberWebId({ webId: WEBID_A });
    const entry = getCachedWebIds()[0];
    expect(entry).toBeDefined();
    expect(Object.hasOwn(entry as object, 'name')).toBe(false);
    expect(Object.hasOwn(entry as object, 'photoUrl')).toBe(false);
  });
});

describe('webidCache: ordering', () => {
  test('getCachedWebIds returns entries ordered by lastUsedAt descending', () => {
    rememberWebId({ webId: WEBID_A, lastUsedAt: 1000 });
    rememberWebId({ webId: WEBID_B, lastUsedAt: 3000 });
    rememberWebId({ webId: WEBID_C, lastUsedAt: 2000 });

    const entries = getCachedWebIds();
    expect(entries.map((e) => e.webId)).toEqual([WEBID_B, WEBID_C, WEBID_A]);
  });

  test('rememberWebId moves an existing entry to the most-recent position', () => {
    rememberWebId({ webId: WEBID_A, lastUsedAt: 1000 });
    rememberWebId({ webId: WEBID_B, lastUsedAt: 2000 });
    rememberWebId({ webId: WEBID_A }); // default = Date.now(), which is > 2000

    const entries = getCachedWebIds();
    expect(entries.map((e) => e.webId)).toEqual([WEBID_A, WEBID_B]);
  });
});

describe('webidCache: forget', () => {
  test('forgetWebId removes just the requested entry, leaving others untouched', () => {
    rememberWebId({ webId: WEBID_A, lastUsedAt: 1000 });
    rememberWebId({ webId: WEBID_B, lastUsedAt: 2000 });
    rememberWebId({ webId: WEBID_C, lastUsedAt: 3000 });

    forgetWebId(WEBID_B);

    const entries = getCachedWebIds();
    expect(entries.map((e) => e.webId)).toEqual([WEBID_C, WEBID_A]);
  });

  test('forgetWebId is a no-op when the WebID is not in the cache', () => {
    rememberWebId({ webId: WEBID_A });
    forgetWebId('https://unknown.example/profile#me');

    const entries = getCachedWebIds();
    expect(entries.map((e) => e.webId)).toEqual([WEBID_A]);
  });

  test('forgetWebId on an empty cache does not throw', () => {
    expect(() => forgetWebId(WEBID_A)).not.toThrow();
  });
});

describe('webidCache: resilience', () => {
  test('corrupted JSON in storage is discarded without throwing', () => {
    globalThis.localStorage.setItem('reactive-fetch:known-webids', '{not json');
    expect(getCachedWebIds()).toEqual([]);
  });

  test('a non-array payload is discarded without throwing', () => {
    globalThis.localStorage.setItem('reactive-fetch:known-webids', '{"webId":"x"}');
    expect(getCachedWebIds()).toEqual([]);
  });

  test('entries with wrong-typed fields are filtered out', () => {
    globalThis.localStorage.setItem(
      'reactive-fetch:known-webids',
      JSON.stringify([
        { webId: WEBID_A, lastUsedAt: 1000 },
        { webId: 42, lastUsedAt: 2000 },
        { webId: WEBID_B, lastUsedAt: 'not a number' },
        { webId: WEBID_C, lastUsedAt: 3000, name: 123 },
        'not an object',
      ]),
    );
    const entries = getCachedWebIds();
    expect(entries.map((e) => e.webId)).toEqual([WEBID_A]);
  });
});
