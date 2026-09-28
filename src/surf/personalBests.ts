import type { RunSplit } from './RunTimer';

/** local personal best per map, including unranked runs, plus its ghost */
export interface PersonalBest {
  ticks: number;
  splits: RunSplit[];
  /** encoded ghost (see ghost.ts), dropped first if storage is full */
  ghost: string | null;
  at: number;
  ranked: boolean;
}

const KEY_PREFIX = 'webstrafe.surf.pb.v1.';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadPersonalBest(mapId: string): PersonalBest | null {
  const raw = storage()?.getItem(KEY_PREFIX + mapId);
  if (!raw) return null;
  try {
    const pb = JSON.parse(raw) as Partial<PersonalBest>;
    if (typeof pb.ticks !== 'number' || !Number.isFinite(pb.ticks) || pb.ticks <= 0) return null;
    return {
      ticks: pb.ticks,
      splits: Array.isArray(pb.splits)
        ? pb.splits.filter((s) => typeof s?.stage === 'number' && typeof s?.ticks === 'number')
        : [],
      ghost: typeof pb.ghost === 'string' ? pb.ghost : null,
      at: typeof pb.at === 'number' ? pb.at : 0,
      ranked: pb.ranked !== false,
    };
  } catch {
    return null;
  }
}

/** saves when faster than the stored pb, returns true if it was a new pb */
export function savePersonalBestIfFaster(mapId: string, next: PersonalBest): boolean {
  const store = storage();
  if (!store) return false;
  const current = loadPersonalBest(mapId);
  if (current && current.ticks <= next.ticks) return false;
  try {
    store.setItem(KEY_PREFIX + mapId, JSON.stringify(next));
  } catch {
    // quota: keep the time, lose the ghost
    try {
      store.setItem(KEY_PREFIX + mapId, JSON.stringify({ ...next, ghost: null }));
    } catch {
      return false;
    }
  }
  return true;
}
