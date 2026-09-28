import { DEFAULT_KNIFE_ID, isKnifeId, type KnifeId } from '../../combat/knives';
import {
  clampKnifeWear,
  DEFAULT_KNIFE_FINISH_ID,
  isKnifeFinishId,
  type KnifeFinishSelection,
  normalizePatternSeed,
  resolveKnifeFinish,
} from './catalog';

export type { KnifeFinishSelection } from './catalog';

/** the local player's knife: which model and which finish on it */
export interface KnifeLoadoutSelection extends KnifeFinishSelection {
  knifeId: KnifeId;
}

export const KNIFE_SELECTION_KEY = 'webstrafe:knife-loadout:v2';
/** the old key only stored the knife id ('legacy' meant the removed authored knife) */
export const LEGACY_KNIFE_STYLE_KEY = 'webstrafe:knife-style:v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function defaultKnifeSelection(): KnifeLoadoutSelection {
  return { knifeId: DEFAULT_KNIFE_ID, finishId: DEFAULT_KNIFE_FINISH_ID, wear: 0, seed: 0 };
}

/**
 * turns anything (stored json, url params) into a valid selection: unknown
 * knives and finishes fall back to the defaults, finish family ids resolve to
 * their first variant, wear is clamped into the finish's float range and the
 * seed rounded into 0..999
 */
export function sanitizeKnifeSelection(raw: unknown): KnifeLoadoutSelection {
  const out = defaultKnifeSelection();
  if (!raw || typeof raw !== 'object') return out;
  const obj = raw as Record<string, unknown>;
  if (isKnifeId(obj.knifeId)) out.knifeId = obj.knifeId;
  if (isKnifeFinishId(obj.finishId)) out.finishId = resolveKnifeFinish(obj.finishId).id;
  const wear = typeof obj.wear === 'number' ? obj.wear : Number.NaN;
  out.wear = clampKnifeWear(out.finishId, wear);
  out.seed = normalizePatternSeed(obj.seed);
  return out;
}

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** stored selection, migrating the old knife-only key the first time */
export function loadKnifeSelection(storage: StorageLike | null = defaultStorage()): KnifeLoadoutSelection {
  if (!storage) return defaultKnifeSelection();
  try {
    const raw = storage.getItem(KNIFE_SELECTION_KEY);
    if (raw) return sanitizeKnifeSelection(JSON.parse(raw));
  } catch {
    // corrupt json, fall through to the old key and the defaults
  }
  try {
    const legacy = storage.getItem(LEGACY_KNIFE_STYLE_KEY);
    const migrated = defaultKnifeSelection();
    if (isKnifeId(legacy)) migrated.knifeId = legacy;
    if (legacy !== null) saveKnifeSelection(migrated, storage);
    return migrated;
  } catch {
    return defaultKnifeSelection();
  }
}

export function saveKnifeSelection(selection: KnifeLoadoutSelection, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  const clean = sanitizeKnifeSelection(selection);
  try {
    storage.setItem(KNIFE_SELECTION_KEY, JSON.stringify(clean));
    // older builds still read the knife from the v1 key
    storage.setItem(LEGACY_KNIFE_STYLE_KEY, clean.knifeId);
  } catch {
    // storage blocked, the choice just won't persist
  }
}
