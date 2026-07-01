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
 * Maximum allowed gap between a client-reported fire `origin` and the shooter's
 * authoritative eye position. Guards against "teleport-shoot" spoofing while
 * tolerating latency/interpolation.
 */
export const MAX_ORIGIN_DEVIATION = 3;

export interface HitEvent {
  shooterId: string;
  targetId: string;
  weaponId: WeaponId;
  damage: number;
  hitbox: 'body' | 'head';
}

export interface DeathEvent {
  victimId: string;
  killerId: string;
  weaponId: WeaponId;
}

export interface FireOutcome {
  fired: boolean;
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
  eyeHeight: number;
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
      eyeHeight,
    });
  }

  removePlayer(id: string): void {
    this.players.delete(id);
  }

  has(id: string): boolean {
    return this.players.has(id);
  }

  setPosition(id: string, feet: [number, number, number], mapId?: string): void {
    const p = this.players.get(id);
    if (!p) return;
    p.feet.set(feet[0], feet[1], feet[2]);
    if (mapId !== undefined) p.mapId = mapId;
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

    // Build capsules for every other alive player on the same map.
    const targets: TargetCapsule[] = [];
    for (const other of this.players.values()) {
      if (other.id === shooterId) continue;
      if (other.mapId !== shooter.mapId) continue;
      if (!other.combat.alive) continue;
      targets.push({
        id: other.id,
        feet: other.feet.clone(),
        height: PLAYER_CAPSULE_HEIGHT,
        radius: PLAYER_CAPSULE_RADIUS,
      });
    }

    const dirVec = new Vector3(dir[0], dir[1], dir[2]);
    const hit = resolveHit(originVec, dirVec, weapon.range, targets);
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
      hit: {
        shooterId,
        targetId: hit.targetId,
        weaponId: weapon.id,
        damage: result.applied,
        hitbox: hit.hitbox,
      },
    };
    if (result.killed) {
      outcome.death = { victimId: hit.targetId, killerId: shooterId, weaponId: weapon.id };
    }
    return outcome;
  }

  /**
   * Respawns any dead players whose timer has elapsed. Returns respawn events
   * (position = the spawn provided by `spawnFor`, or the player's last feet).
   */
  tickRespawns(nowMs: number, spawnFor?: (id: string) => [number, number, number]): RespawnEvent[] {
    const events: RespawnEvent[] = [];
    for (const p of this.players.values()) {
      if (isRespawnDue(p.combat, nowMs)) {
        respawn(p.combat);
        const pos = spawnFor?.(p.id) ?? [p.feet.x, p.feet.y, p.feet.z];
        p.feet.set(pos[0], pos[1], pos[2]);
        events.push({ playerId: p.id, position: pos });
      }
    }
    return events;
  }
}
