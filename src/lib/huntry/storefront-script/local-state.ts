import { EggFlags } from "./types";

// Per-player egg flags persisted in localStorage, namespaced by store and
// event (legacy: huntry-frontend-map.js loadSkippedEggIds & co). Storage can
// be missing or throw (private windows, blocked site data), so every access is
// guarded and the flags just fall back to in-memory for the page's lifetime.
export type FlagName = keyof EggFlags;

const key = (storeHash: string, eventId: number, flag: FlagName) => `huntry:${storeHash}:${eventId}:${flag}`;

function getStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadFlag(storeHash: string, eventId: number, flag: FlagName): Set<string> {
  try {
    const raw = getStorage()?.getItem(key(storeHash, eventId, flag));
    const parsed: unknown = raw ? JSON.parse(raw) : [];

    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export function persistFlag(storeHash: string, eventId: number, flag: FlagName, ids: ReadonlySet<string>): void {
  try {
    getStorage()?.setItem(key(storeHash, eventId, flag), JSON.stringify([...ids]));
  } catch {
    // Quota or blocked storage: the in-memory set still applies this session.
  }
}

export function loadEggFlags(storeHash: string, eventId: number): EggFlags {
  return {
    skipped: loadFlag(storeHash, eventId, "skipped"),
    dismissed: loadFlag(storeHash, eventId, "dismissed"),
    claimedDismissed: loadFlag(storeHash, eventId, "claimedDismissed"),
    mine: loadFlag(storeHash, eventId, "mine"),
  };
}
