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
    range: 8192,
    fireIntervalMs: 1500,
    magazine: 10,
    reloadMs: 3700,
  },
  deagle: {
    id: 'deagle',
    name: 'Desert Eagle',
    slot: 'secondary',
    damage: 63,
    headshotMultiplier: 2,
    range: 4096,
    fireIntervalMs: 225,
    magazine: 7,
    reloadMs: 2200,
    falloff: { start: 512, end: 3072, minMultiplier: 0.55 },
  },
  knife: {
    id: 'knife',
    name: 'Knife',
    slot: 'melee',
    damage: 55,
    headshotMultiplier: 1.6,
    range: 96,
    fireIntervalMs: 400,
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
