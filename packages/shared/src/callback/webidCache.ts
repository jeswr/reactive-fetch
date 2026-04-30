// localStorage-backed memory of WebIDs the user has previously signed in with,
// so the popup can show a "pick your identity" list on return visits. Each
// entry stores the name + photoUrl harvested from the WebID profile document
// at fetch time, so the list renders offline / before the profile reloads.

const STORAGE_KEY = 'reactive-fetch:known-webids';
const MAX_ENTRIES = 16;

export interface CachedWebId {
  webId: string;
  name?: string;
  photoUrl?: string;
  lastUsedAt: number;
}

export function getCachedWebIds(): CachedWebId[] {
  const raw = readStorage();
  if (!raw) return [];
  return raw.slice().sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

export function rememberWebId(entry: Omit<CachedWebId, 'lastUsedAt'> & { lastUsedAt?: number }): void {
  const existing = readStorage() ?? [];
  const filtered = existing.filter((e) => e.webId !== entry.webId);
  const merged: CachedWebId = {
    webId: entry.webId,
    ...(entry.name !== undefined && { name: entry.name }),
    ...(entry.photoUrl !== undefined && { photoUrl: entry.photoUrl }),
    lastUsedAt: entry.lastUsedAt ?? Date.now(),
  };
  const next = [merged, ...filtered].slice(0, MAX_ENTRIES);
  writeStorage(next);
}

export function forgetWebId(webId: string): void {
  const existing = readStorage();
  if (!existing) return;
  const next = existing.filter((e) => e.webId !== webId);
  writeStorage(next);
}

export function __resetWebIdCacheForTests(): void {
  try {
    getStorage()?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore — storage not available in this environment */
  }
}

// Prefer `window.localStorage` over `globalThis.localStorage`. Some test
// environments (fake-indexeddb/auto in particular) install a non-functional
// `localStorage` shim on `globalThis` that shadows the real one; reading
// from `window` directly sidesteps it in the browser and in jsdom, and the
// `typeof window` guard keeps the module SSR-importable.
function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    /* some browsers throw on localStorage access in private-mode / iframes */
  }
  return null;
}

function readStorage(): CachedWebId[] | null {
  try {
    const raw = getStorage()?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(isCachedWebId);
  } catch {
    return null;
  }
}

function writeStorage(entries: CachedWebId[]): void {
  try {
    getStorage()?.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* quota exceeded / disabled / SSR — silently drop */
  }
}

function isCachedWebId(value: unknown): value is CachedWebId {
  if (!value || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  if (typeof e['webId'] !== 'string') return false;
  if (typeof e['lastUsedAt'] !== 'number') return false;
  if (e['name'] !== undefined && typeof e['name'] !== 'string') return false;
  if (e['photoUrl'] !== undefined && typeof e['photoUrl'] !== 'string') return false;
  return true;
}
