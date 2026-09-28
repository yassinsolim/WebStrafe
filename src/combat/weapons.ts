import { FIREARM_TIMINGS } from './FirearmTiming';
import { KNIFE_DAMAGE, KNIFE_RANGE_M, KNIFE_TIMING_MS } from './knives';

export type WeaponId = 'awp' | 'deagle' | 'knife';

export type WeaponSlot = 'primary' | 'secondary' | 'melee';

export interface RangeFalloff {
  /** Distance (world units) at/under which damage is unchanged. */
  start: number;
  /** Distance at/over which damage is at its minimum multiplier. */
  end: number;
  /** Damage multiplier applied at or beyond `end` (0..1). */
  minMultiplier: number;
}

export interface WeaponDef {
  id: WeaponId;
  name: string;
  slot: WeaponSlot;
  /** Base damage to the body at point-blank range. */
  damage: number;
  /** Multiplier applied on top of body damage for a head hit. */
  headshotMultiplier: number;
  /** Max effective range in world units. Beyond this, shots deal no damage. */
  range: number;
  /** Minimum time between shots in milliseconds. */
  fireIntervalMs: number;
  /** Rounds before a reload is required. 0 marks a melee weapon. */
  magazine: number;
  /** Reload duration in milliseconds. */
  reloadMs: number;
  /** Optional linear damage falloff over distance. */
  falloff?: RangeFalloff;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  awp: {
    id: 'awp',
    name: 'AWP',
    slot: 'primary',
    damage: 115,
    headshotMultiplier: 1.5,
    range: Infinity,
    fireIntervalMs: FIREARM_TIMINGS.awp.fireIntervalMs,
    magazine: 10,
    reloadMs: FIREARM_TIMINGS.awp.reloadMs,
  },
  deagle: {
    id: 'deagle',
    name: 'Deagle',
    slot: 'secondary',
    damage: 63,
    headshotMultiplier: 2,
    range: 4096,
    fireIntervalMs: FIREARM_TIMINGS.deagle.fireIntervalMs,
    magazine: 7,
    reloadMs: FIREARM_TIMINGS.deagle.reloadMs,
    falloff: { start: 512, end: 3072, minMultiplier: 0.55 },
  },
  // knife hits resolve through CombatArena.handleMelee with the knives.ts
  // table; these mirror a front slash so older callers read sane numbers
  knife: {
    id: 'knife',
    name: 'Knife',
    slot: 'melee',
    damage: KNIFE_DAMAGE.primary,
    // cs:go and cs2 knives ignore hitgroups
    headshotMultiplier: 1,
    range: KNIFE_RANGE_M.primary,
    fireIntervalMs: KNIFE_TIMING_MS.primaryInterval,
    magazine: 0,
    reloadMs: 0,
  },
};

export function getWeapon(id: WeaponId): WeaponDef {
  return WEAPONS[id];
}

export function isMelee(def: WeaponDef): boolean {
  return def.slot === 'melee' || def.magazine === 0;
}
