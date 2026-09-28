import type { PlayerModel } from '../network/types';
import { defaultLook, sanitizeLook, type CharacterLook } from './look';

export const LOOK_STORAGE_KEY = 'webstrafe:character:v1';
/** saved custom presets the player can name */
export const MAX_SAVED_LOOKS = 6;
const MAX_SAVED_NAME = 24;

export interface SavedLook {
  name: string;
  look: CharacterLook;
}

interface StoredCharacter {
  v: 1;
  /** missing until the player saves a look, the team default shows until then */
  look?: CharacterLook;
  saved: SavedLook[];
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function read(store: StorageLike | null): StoredCharacter {
  let parsed: unknown = null;
  try {
    const raw = store?.getItem(LOOK_STORAGE_KEY);
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  const src = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
  return {
    v: 1,
    look: src.look && typeof src.look === 'object' ? sanitizeLook(src.look) : undefined,
    saved: sanitizeSaved(src.saved),
  };
}

function write(store: StorageLike | null, data: StoredCharacter): void {
  try {
    store?.setItem(LOOK_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // private mode or a full quota: the look still works for this session
  }
}

function sanitizeSaved(value: unknown): SavedLook[] {
  if (!Array.isArray(value)) return [];
  const out: SavedLook[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const name = typeof e.name === 'string' ? e.name.trim().slice(0, MAX_SAVED_NAME) : '';
    if (!name) continue;
    out.push({ name, look: sanitizeLook(e.look) });
    if (out.length >= MAX_SAVED_LOOKS) break;
  }
  return out;
}

/** the player's look, or the team default when nothing (valid) is stored */
export function loadLook(team: PlayerModel = 'terrorist', store: StorageLike | null = storage()): CharacterLook {
  const stored = read(store).look;
  return stored ? sanitizeLook(stored, defaultLook(team)) : defaultLook(team);
}

/** whether the player ever saved a look (the menu uses team defaults until then) */
export function hasStoredLook(store: StorageLike | null = storage()): boolean {
  return read(store).look !== undefined;
}

export function saveLook(look: CharacterLook, store: StorageLike | null = storage()): void {
  const data = read(store);
  write(store, { ...data, look: sanitizeLook(look) });
}

export function loadSavedLooks(store: StorageLike | null = storage()): SavedLook[] {
  return read(store).saved;
}

/** saves (or overwrites by name) a custom preset; the oldest drops off past the cap */
export function saveNamedLook(name: string, look: CharacterLook, store: StorageLike | null = storage()): SavedLook[] {
  const clean = name.trim().slice(0, MAX_SAVED_NAME);
  const data = read(store);
  if (!clean) return data.saved;
  const saved = data.saved.filter((entry) => entry.name !== clean);
  saved.push({ name: clean, look: sanitizeLook(look) });
  while (saved.length > MAX_SAVED_LOOKS) saved.shift();
  write(store, { ...data, saved });
  return saved;
}

export function deleteNamedLook(name: string, store: StorageLike | null = storage()): SavedLook[] {
  const data = read(store);
  const saved = data.saved.filter((entry) => entry.name !== name);
  write(store, { ...data, saved });
  return saved;
}
