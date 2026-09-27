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
import { interpolateSamples } from '../netcode/InterpolationBuffer';

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
export const MAX_LAG_COMPENSATION_MS = 400;
const POSITION_HISTORY_RETENTION_MS = MAX_LAG_COMPENSATION_MS * 2;
/** allowed lead of a requested rewind time past the newest sample (clock noise) */
const MAX_REWIND_LEAD_MS = 50;

interface PositionSample {
  /** sample time in this player's authority clock */
  atMs: number;
  feet: Vector3;
  velocity?: Vector3;
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

export interface LagCompensationInput {
  /** per-target times (in each target's history clock) the shooter was rendering */
  targetTimes?: Readonly<Record<string, number>>;
  /** shooter's own sample-clock time at the shot, for the origin check */
  shooterTimeMs?: number;
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
    // history restarts from the next real sample, which may use another clock
    p.positionHistory = [];
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

  /**
   * Records a position. `nowMs` is the sample time in whichever clock this
   * player's samples are stamped with (server time, or the sending peer's clock
   * in Supabase mode); lag compensation reads history back in that same clock.
   */
  setPosition(
    id: string,
    feet: [number, number, number],
    mapId?: string,
    nowMs = Date.now(),
    velocity?: [number, number, number],
  ): void {
    const p = this.players.get(id);
    if (!p) return;
    p.feet.set(feet[0], feet[1], feet[2]);
    if (mapId !== undefined) p.mapId = mapId;
    if (!Number.isFinite(nowMs)) return;

    const sample: PositionSample = {
      atMs: nowMs,
      feet: p.feet.clone(),
      velocity: velocity ? new Vector3(velocity[0], velocity[1], velocity[2]) : undefined,
    };
    const previous = p.positionHistory.at(-1);
    // clock domain changed (new host, reconnect): old samples are meaningless now
    if (previous && nowMs < previous.atMs - 1000) {
      p.positionHistory.length = 0;
    }
    const last = p.positionHistory.at(-1);
    if (last && last.atMs === nowMs) {
      p.positionHistory[p.positionHistory.length - 1] = sample;
    } else if (!last || last.atMs < nowMs) {
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
    lag?: LagCompensationInput,
  ): FireOutcome {
    const targetTimes = lag?.targetTimes;
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
    // fast surfers outrun the latest sample; project it to the shot time
    // before judging the origin, or legit shots get dropped as teleports
    const projected = projectTo(shooter.positionHistory, lag?.shooterTimeMs);
    const projectedEye = projected?.add(new Vector3(0, shooter.eyeHeight, 0));
    const deviation = Math.min(
      originVec.distanceTo(eye),
      projectedEye ? originVec.distanceTo(projectedEye) : Infinity,
    );
    if (deviation > MAX_ORIGIN_DEVIATION) {
      return { fired: true };
    }

    // Build capsules for every other alive player on the same map. Players
    // inside their spawn-protection window can't be hit (shots pass through).
    // Each target is rewound to the pose the shooter had on screen: per-target
    // times when the client sent them, else the single legacy timestamp.
    const legacyRewindAt = (
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
      const requested = targetTimes?.[other.id];
      const targetFeet = typeof requested === 'number' && Number.isFinite(requested)
        ? rewindTo(other.positionHistory, requested) ?? other.feet
        : legacyRewindAt !== null
          ? stepRewind(other.positionHistory, legacyRewindAt) ?? other.feet
          : other.feet;
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
        p.positionHistory = [];
        events.push({ playerId: p.id, position: pos });
      }
    }
    return events;
  }
}

/**
 * Pose at `atMs` rebuilt the same way clients render it (Hermite with the
 * sampled velocities), clamped to the rewind window behind the newest sample.
 */
function rewindTo(history: readonly PositionSample[], atMs: number): Vector3 | null {
  const newest = history.at(-1);
  if (!newest) return null;
  if (atMs > newest.atMs + MAX_REWIND_LEAD_MS) return null;
  const t = Math.max(newest.atMs - MAX_LAG_COMPENSATION_MS, Math.min(newest.atMs, atMs));
  if (t >= newest.atMs) return newest.feet;
  let hi = history.length - 1;
  while (hi > 0 && history[hi - 1].atMs > t) hi -= 1;
  if (hi === 0) return history[0].feet;
  const a = history[hi - 1];
  const b = history[hi];
  const zero: [number, number, number] = [0, 0, 0];
  const hasVelocity = a.velocity !== undefined && b.velocity !== undefined;
  const sampled = interpolateSamples(
    {
      t: a.atMs,
      position: [a.feet.x, a.feet.y, a.feet.z],
      velocity: hasVelocity ? [a.velocity!.x, a.velocity!.y, a.velocity!.z] : zero,
      yaw: 0,
      pitch: 0,
    },
    {
      t: b.atMs,
      position: [b.feet.x, b.feet.y, b.feet.z],
      velocity: hasVelocity ? [b.velocity!.x, b.velocity!.y, b.velocity!.z] : zero,
      yaw: 0,
      pitch: 0,
    },
    t,
  );
  if (!hasVelocity) {
    // no velocities: plain lerp (hermite with zero tangents would ease in/out)
    const u = (t - a.atMs) / Math.max(1e-6, b.atMs - a.atMs);
    return a.feet.clone().lerp(b.feet, u);
  }
  return new Vector3(sampled.position[0], sampled.position[1], sampled.position[2]);
}

/** Legacy behaviour: newest sample at or before `atMs`. */
function stepRewind(history: readonly PositionSample[], atMs: number): Vector3 | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].atMs <= atMs) return history[index].feet;
  }
  return null;
}

/** Newest sample pushed forward (or back) along its velocity to `atMs`. */
function projectTo(history: readonly PositionSample[], atMs: number | undefined): Vector3 | null {
  const newest = history.at(-1);
  if (!newest?.velocity || atMs === undefined || !Number.isFinite(atMs)) return null;
  const dt = Math.max(-MAX_LAG_COMPENSATION_MS, Math.min(MAX_LAG_COMPENSATION_MS, atMs - newest.atMs)) / 1000;
  return newest.feet.clone().addScaledVector(newest.velocity, dt);
}
