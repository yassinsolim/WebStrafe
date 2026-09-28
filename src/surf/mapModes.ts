import type { MapMeta, MapTrigger } from '../world/types';

export type MapMode = 'surf' | 'combat';

/**
 * what a map is for, from meta.json `modes`, falling back to the id prefix for
 * older maps: surf_ and bhop_ are timed, anything else is a combat map.
 */
export function mapModes(meta: Pick<MapMeta, 'id'> & { modes?: unknown }): MapMode[] {
  if (Array.isArray(meta.modes)) {
    const modes = meta.modes.filter((m): m is MapMode => m === 'surf' || m === 'combat');
    if (modes.length > 0) return modes;
  }
  return /^(surf|bhop)_/.test(meta.id) ? ['surf'] : ['combat'];
}

export interface PvpRule {
  /** where a player starts */
  defaultOn: boolean;
  /** false when the map forces the mode */
  toggleable: boolean;
}

/**
 * timed maps start peaceful and let each player opt in, pure combat maps are
 * always pvp (that's the point of them).
 */
export function pvpRuleFor(modes: readonly MapMode[]): PvpRule {
  return modes.includes('surf') ? { defaultOn: false, toggleable: true } : { defaultOn: true, toggleable: false };
}

/** host bots only make sense where people fight */
export function botsFor(modes: readonly MapMode[]): number {
  return modes.includes('combat') ? 1 : 0;
}

/** checkpoint stage labels in order, one per label, like the server's map rules */
export function checkpointStages(triggers: readonly MapTrigger[] | undefined): number[] {
  const stages = new Set<number>();
  for (const t of triggers ?? []) {
    if (t.type === 'checkpoint' && typeof t.stage === 'number') stages.add(t.stage);
  }
  return [...stages].sort((a, b) => a - b);
}

export function hasTimedZones(triggers: readonly MapTrigger[] | undefined): boolean {
  return !!triggers?.some((t) => t.type === 'start') && !!triggers?.some((t) => t.type === 'finish');
}
