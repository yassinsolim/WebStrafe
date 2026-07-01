import type { Hitbox } from './damage';
import { computeDamage } from './damage';
import type { WeaponDef, WeaponId } from './weapons';

export const MAX_HEALTH = 100;
export const RESPAWN_DELAY_MS = 3000;

export interface PlayerCombat {
  health: number;
  alive: boolean;
  lastFireAtMs: Partial<Record<WeaponId, number>>;
  respawnAtMs: number | null;
}

export interface ApplyDamageResult {
  applied: number;
  killed: boolean;
  health: number;
}

export function createPlayerCombat(): PlayerCombat {
  return {
    health: MAX_HEALTH,
    alive: true,
    lastFireAtMs: {},
    respawnAtMs: null,
  };
}

/**
 * Whether a weapon may fire given its cooldown. Server-side gate that also
 * catches clients firing faster than the weapon allows.
 */
export function canFire(state: PlayerCombat, weapon: WeaponDef, nowMs: number): boolean {
  if (!state.alive) {
    return false;
  }
  const last = state.lastFireAtMs[weapon.id];
  if (last === undefined) {
    return true;
  }
  return nowMs - last >= weapon.fireIntervalMs;
}

/** Records a successful fire; call only after {@link canFire} passes. */
export function registerFire(state: PlayerCombat, weapon: WeaponDef, nowMs: number): void {
  state.lastFireAtMs[weapon.id] = nowMs;
}

/**
 * Applies damage from one shot to a target, mutating its state. Damage on a
 * dead target is ignored. Crossing 0 health kills the target and schedules a
 * respawn.
 */
export function applyDamage(
  target: PlayerCombat,
  weapon: WeaponDef,
  hitbox: Hitbox,
  distance: number,
  nowMs: number,
): ApplyDamageResult {
  if (!target.alive) {
    return { applied: 0, killed: false, health: target.health };
  }
  const raw = computeDamage({ weapon, hitbox, distance });
  const before = target.health;
  const health = Math.max(0, before - raw);
  target.health = health;
  const applied = before - health;
  if (health <= 0 && target.alive) {
    target.alive = false;
    target.respawnAtMs = nowMs + RESPAWN_DELAY_MS;
    return { applied, killed: true, health };
  }
  return { applied, killed: false, health };
}

/** True once a dead player's respawn timer has elapsed. */
export function isRespawnDue(state: PlayerCombat, nowMs: number): boolean {
  return !state.alive && state.respawnAtMs !== null && nowMs >= state.respawnAtMs;
}

/** Resets a player to full health and clears the respawn timer. */
export function respawn(state: PlayerCombat): void {
  state.health = MAX_HEALTH;
  state.alive = true;
  state.respawnAtMs = null;
}
