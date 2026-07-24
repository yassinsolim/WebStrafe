import { Vector3 } from 'three';
import {
  applyDamage,
  createPlayerCombat,
  isRespawnDue,
  respawn,
  type PlayerCombat,
} from './CombatState';
import { resolveHit, type TargetCapsule } from './HitResolver';
import { WeaponController } from './WeaponController';
import { type WeaponId } from './weapons';

/** Default player capsule (mirrors MovementController.capsule). */
export const PLAYER_CAPSULE_HEIGHT = 1.76;
export const PLAYER_CAPSULE_RADIUS = 0.34;

/**
 * Brief post-(re)spawn invulnerability. Stops the "die the instant you spawn"
 * problem where bots re-acquire and drop you before you can even move.
 */
export const SPAWN_PROTECTION_MS = 3500;

/**
 * Maximum allowed gap between a client-reported fire `origin` and the shooter's
 * authoritative eye position. Guards against "teleport-shoot" spoofing while
 * tolerating latency/interpolation.
 */
export const MAX_ORIGIN_DEVIATION = 3;
export const MAX_LAG_COMPENSATION_MS = 250;
const POSITION_HISTORY_RETENTION_MS = MAX_LAG_COMPENSATION_MS * 2;

interface PositionSample {
  atMs: number;
  feet: Vector3;
}

export interface HitEvent {
  shooterId: string;
  targetId: string;
  weaponId: WeaponId;
  damage: number;
  hitbox: 'body' | 'head';
  killed: boolean;
}

export interface DeathEvent {
  victimId: string;
  killerId: string;
  weaponId: WeaponId;
  headshot: boolean;
}

export interface FireOutcome {
  fired: boolean;
  /** Exact distance along the accepted shot ray when it struck a player. */
  impactDistance?: number;
  hit?: HitEvent;
  death?: DeathEvent;
}

export interface RespawnEvent {
  playerId: string;
  position: [number, number, number];
}

interface ArenaPlayer {
  id: string;
  mapId: string;
  combat: PlayerCombat;
  weapon: WeaponController;
  /** Authoritative feet position in world units. */
  feet: Vector3;
  positionHistory: PositionSample[];
  eyeHeight: number;
  /** Damage is ignored until this time (spawn protection). 0 = unprotected. */
  spawnProtectedUntilMs: number;
}

/**
 * Server-authoritative combat coordinator. Holds every player's health and
 * weapon state and resolves fire requests using the shooter's aim ray against
 * the *server's* authoritative capsule positions — so the claimed target and
 * hitbox cannot be forged by the client (closes the main cheat from the design
 * review). Pure and framework-free; `server/index.ts` is a thin adapter.
 *
 * Note: without server-side map geometry, wall occlusion is not checked here —
 * that residual is accepted and documented in docs/COMBAT_DESIGN.md.
 */
export class CombatArena {
  private readonly players = new Map<string, ArenaPlayer>();

  addPlayer(id: string, mapId: string, initialWeapon: WeaponId = 'knife', eyeHeight = 1.6): void {
    this.players.set(id, {
      id,
      mapId,
      combat: createPlayerCombat(),
      weapon: new WeaponController(initialWeapon),
      feet: new Vector3(),
      positionHistory: [],
      eyeHeight,
      spawnProtectedUntilMs: 0,
    });
  }

  removePlayer(id: string): void {
    this.players.delete(id);
  }

  has(id: string): boolean {
    return this.players.has(id);
  }

  /** Grants brief post-spawn invulnerability (see {@link SPAWN_PROTECTION_MS}). */
  protectSpawn(id: string, nowMs: number): void {
    const p = this.players.get(id);
    if (p) p.spawnProtectedUntilMs = nowMs + SPAWN_PROTECTION_MS;
  }

  /**
   * Authoritatively starts a clean life while preserving the selected weapon.
   * Both health and all magazines are reset, and spawn protection is renewed.
   */
  resetPlayer(
    id: string,
    nowMs: number,
    position?: [number, number, number],
  ): RespawnEvent | null {
    const p = this.players.get(id);
    if (!p) return null;
    p.combat = createPlayerCombat();
    p.weapon.reset();
    p.spawnProtectedUntilMs = nowMs + SPAWN_PROTECTION_MS;
    if (position) {
      p.feet.set(position[0], position[1], position[2]);
    }
    p.positionHistory = [{ atMs: nowMs, feet: p.feet.clone() }];
    return {
      playerId: id,
      position: position ?? [p.feet.x, p.feet.y, p.feet.z],
    };
  }

  /** True while the player is within their post-spawn invulnerability window. */
  isSpawnProtected(id: string, nowMs: number): boolean {
    const p = this.players.get(id);
    return !!p && p.spawnProtectedUntilMs > nowMs;
  }

  setPosition(
    id: string,
    feet: [number, number, number],
    mapId?: string,
    nowMs = Date.now(),
  ): void {
    const p = this.players.get(id);
    if (!p) return;
    p.feet.set(feet[0], feet[1], feet[2]);
    if (mapId !== undefined) p.mapId = mapId;
    if (!Number.isFinite(nowMs)) return;

    const sample = { atMs: nowMs, feet: p.feet.clone() };
    const previous = p.positionHistory.at(-1);
    if (previous && previous.atMs === nowMs) {
      p.positionHistory[p.positionHistory.length - 1] = sample;
    } else if (!previous || previous.atMs < nowMs) {
      p.positionHistory.push(sample);
    }
    const cutoff = nowMs - POSITION_HISTORY_RETENTION_MS;
    while (p.positionHistory.length > 1 && p.positionHistory[1].atMs < cutoff) {
      p.positionHistory.shift();
    }
  }

  equip(id: string, weaponId: WeaponId): void {
    this.players.get(id)?.weapon.equip(weaponId);
  }

  reload(id: string, nowMs: number): boolean {
    return this.players.get(id)?.weapon.reload(nowMs) ?? false;
  }

  getHealth(id: string): number | null {
    return this.players.get(id)?.combat.health ?? null;
  }

  isAlive(id: string): boolean {
    return this.players.get(id)?.combat.alive ?? false;
  }

  getAmmo(id: string): number | null {
    const p = this.players.get(id);
    return p ? p.weapon.getAmmo() : null;
  }

  getActiveWeapon(id: string): WeaponId | null {
    return this.players.get(id)?.weapon.getActive() ?? null;
  }

  /**
   * Processes a fire request from `shooterId` aiming along `dir` from `origin`.
   * Server-authoritative: consumes ammo/cooldown, re-derives the hit from
   * authoritative positions, applies damage, and reports events.
   */
  handleFire(
    shooterId: string,
    origin: [number, number, number],
    dir: [number, number, number],
    nowMs: number,
    blockingDistance?: number,
    observedAtMs?: number,
  ): FireOutcome {
    const shooter = this.players.get(shooterId);
    if (!shooter || !shooter.combat.alive) {
      return { fired: false };
    }

    const fireResult = shooter.weapon.tryFire(nowMs);
    if (!fireResult.fired) {
      return { fired: false };
    }
    const weapon = fireResult.weapon;

    // Anti-teleport: reject implausible origins but still count the shot as
    // fired (so the animation/ammo stay consistent) — it just can't hit.
    const eye = shooter.feet.clone().add(new Vector3(0, shooter.eyeHeight, 0));
    const originVec = new Vector3(origin[0], origin[1], origin[2]);
    if (originVec.distanceTo(eye) > MAX_ORIGIN_DEVIATION) {
      return { fired: true };
    }

    // Build capsules for every other alive player on the same map. Players
    // inside their spawn-protection window can't be hit (shots pass through).
    const rewindAt = (
      observedAtMs !== undefined
      && Number.isFinite(observedAtMs)
      && observedAtMs <= nowMs
      && nowMs - observedAtMs <= MAX_LAG_COMPENSATION_MS
    )
      ? observedAtMs
      : null;
    const targets: TargetCapsule[] = [];
    for (const other of this.players.values()) {
      if (other.id === shooterId) continue;
      if (other.mapId !== shooter.mapId) continue;
      if (!other.combat.alive) continue;
      if (other.spawnProtectedUntilMs > nowMs) continue;
      let targetFeet = other.feet;
      if (rewindAt !== null) {
        for (let index = other.positionHistory.length - 1; index >= 0; index -= 1) {
          const sample = other.positionHistory[index];
          if (sample.atMs <= rewindAt) {
            targetFeet = sample.feet;
            break;
          }
        }
      }
      targets.push({
        id: other.id,
        feet: targetFeet.clone(),
        height: PLAYER_CAPSULE_HEIGHT,
        radius: PLAYER_CAPSULE_RADIUS,
      });
    }

    const dirVec = new Vector3(dir[0], dir[1], dir[2]);
    const acceptedRange =
      blockingDistance !== undefined && Number.isFinite(blockingDistance)
        ? Math.min(weapon.range, Math.max(0, blockingDistance))
        : weapon.range;
    const hit = resolveHit(originVec, dirVec, acceptedRange, targets);
    if (!hit) {
      return { fired: true };
    }

    const target = this.players.get(hit.targetId);
    if (!target) {
      return { fired: true };
    }

    const result = applyDamage(target.combat, weapon, hit.hitbox, hit.distance, nowMs);
    const outcome: FireOutcome = {
      fired: true,
      impactDistance: hit.distance,
      hit: {
        shooterId,
        targetId: hit.targetId,
        weaponId: weapon.id,
        damage: result.applied,
        hitbox: hit.hitbox,
        killed: result.killed,
      },
    };
    if (result.killed) {
      outcome.death = {
        victimId: hit.targetId,
        killerId: shooterId,
        weaponId: weapon.id,
        headshot: hit.hitbox === 'head',
      };
    }
    return outcome;
  }

  /**
   * Respawns any dead players whose timer has elapsed. Returns respawn events
   * (position = the spawn provided by `spawnFor`, or the player's last feet).
   */
  tickRespawns(nowMs: number, spawnFor?: (id: string) => [number, number, number] | undefined): RespawnEvent[] {
    const events: RespawnEvent[] = [];
    for (const p of this.players.values()) {
      if (isRespawnDue(p.combat, nowMs)) {
        respawn(p.combat);
        p.weapon.reset();
        p.spawnProtectedUntilMs = nowMs + SPAWN_PROTECTION_MS;
        const pos = spawnFor?.(p.id) ?? [p.feet.x, p.feet.y, p.feet.z];
        p.feet.set(pos[0], pos[1], pos[2]);
        p.positionHistory = [{ atMs: nowMs, feet: p.feet.clone() }];
        events.push({ playerId: p.id, position: pos });
      }
    }
    return events;
  }
}
