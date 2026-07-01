import type { WeaponDef } from './weapons';

export type Hitbox = 'body' | 'head';

export interface DamageQuery {
  weapon: WeaponDef;
  hitbox: Hitbox;
  /** Distance from shooter to target in world units. */
  distance: number;
}

/**
 * Linear range falloff multiplier in [minMultiplier, 1].
 * Returns 1 when the weapon has no falloff.
 */
export function falloffMultiplier(weapon: WeaponDef, distance: number): number {
  const f = weapon.falloff;
  if (!f) {
    return 1;
  }
  if (distance <= f.start) {
    return 1;
  }
  if (distance >= f.end) {
    return f.minMultiplier;
  }
  const span = f.end - f.start;
  const t = span <= 0 ? 1 : (distance - f.start) / span;
  return 1 - t * (1 - f.minMultiplier);
}

/**
 * Damage a single shot deals, accounting for hitbox, headshot multiplier,
 * effective range, and range falloff. Out-of-range shots deal 0.
 * Result is clamped to be non-negative and rounded to an integer.
 */
export function computeDamage(query: DamageQuery): number {
  const { weapon, hitbox, distance } = query;
  if (distance < 0 || distance > weapon.range) {
    return 0;
  }
  let dmg = weapon.damage;
  if (hitbox === 'head') {
    dmg *= weapon.headshotMultiplier;
  }
  dmg *= falloffMultiplier(weapon, distance);
  return Math.max(0, Math.round(dmg));
}
