import { Vector3 } from 'three';
import {
  applyDamage,
  applyFlatDamage,
  createPlayerCombat,
  isRespawnDue,
  respawn,
  type PlayerCombat,
} from './CombatState';
import { resolveHit, type TargetCapsule } from './HitResolver';
import { KnifeController } from './KnifeController';
import {
  isBackstab,
  KNIFE_RANGE_M,
  KNIFE_SWEEP_RADIUS_M,
  knifeDamage,
  type KnifeAttack,
} from './knives';
import { resolveMeleeHit, type SegmentBlocked } from './MeleeResolver';
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
/** knives reach ~1.5 m, so a claimed eye may drift far less than a gun's */
export const MAX_MELEE_ORIGIN_DEVIATION = 1;
/**
 * How far before its arrival a swing may be timestamped. The client's mapped
 * send time removes network jitter from the cooldown check; the bound keeps a
 * client from banking attacks (claims never run ahead of arrival time).
 */
export const MELEE_ATTACK_TIME_SLACK_MS = 150;
export const MAX_LAG_COMPENSATION_MS = 400;
const POSITION_HISTORY_RETENTION_MS = MAX_LAG_COMPENSATION_MS * 2;
/** allowed lead of a requested rewind time past the newest sample (clock noise) */
const MAX_REWIND_LEAD_MS = 50;

interface PositionSample {
  /** sample time in this player's authority clock */
  atMs: number;
  feet: Vector3;
  velocity?: Vector3;
  /** body yaw (camera yaw convention), when the sender reported one */
  yaw?: number;
}

export interface HitEvent {
  shooterId: string;
  targetId: string;
  weaponId: WeaponId;
  damage: number;
  hitbox: 'body' | 'head';
  killed: boolean;
  /** knife attack that produced this hit */
  melee?: KnifeAttack;
  /** knife hit from behind (90 / 180 damage) */
  backstab?: boolean;
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

export interface MeleeOptions extends LagCompensationInput {
  /** legacy single rewind timestamp, same meaning as in handleFire */
  observedAtMs?: number;
  /**
   * When the swing happened, in this arena's clock (the client's send time
   * mapped through its SourceClock). Clamped to
   * [now - MELEE_ATTACK_TIME_SLACK_MS, now]; defaults to now.
   */
  attackTimeMs?: number;
  /** world occlusion between the eye and the contact point, when the authority has collision */
  isBlocked?: SegmentBlocked;
  /** distance along the aim to the first wall, when only a ray result is known */
  blockingDistance?: number;
}

export interface FireOutcome {
  fired: boolean;
  /** Exact distance along the accepted shot ray when it struck a player. */
  impactDistance?: number;
  /** where an accepted knife swing connected (knife hits only) */
  impactPoint?: [number, number, number];
  /** knife attack kind for accepted swings */
  melee?: KnifeAttack;
  hit?: HitEvent;
  death?: DeathEvent;
}

export interface RespawnEvent {
  playerId: string;
  position: [number, number, number];
}

export interface CombatArenaOptions {
  /** post-spawn invulnerability, ms (defaults to {@link SPAWN_PROTECTION_MS}) */
  spawnProtectionMs?: number;
}

interface ArenaPlayer {
  id: string;
  mapId: string;
  combat: PlayerCombat;
  weapon: WeaponController;
  knife: KnifeController;
  /** Authoritative feet position in world units. */
  feet: Vector3;
  /** latest reported body yaw */
  yaw: number;
  positionHistory: PositionSample[];
  eyeHeight: number;
  /** Damage is ignored until this time (spawn protection). 0 = unprotected. */
  spawnProtectedUntilMs: number;
}

interface RewoundTarget {
  capsule: TargetCapsule;
  yaw: number;
}

/**
 * Server-authoritative combat coordinator. Holds every player's health and
 * weapon state and resolves fire requests using the shooter's aim ray against
 * the *server's* authoritative capsule positions — so the claimed target and
 * hitbox cannot be forged by the client (closes the main cheat from the design
 * review). Pure and framework-free; `server/index.ts` is a thin adapter.
 *
 * Knife swings go through {@link handleMelee}: a forgiving swept test against
 * the same rewound capsules, CS damage (follow-ups, backstabs from the rewound
 * victim yaw) and CS cooldowns that depend on whether the swing connected.
 *
 * Note: gun shots only see walls through `blockingDistance`; knife swings take
 * an `isBlocked` segment test where the authority has map collision.
 */
export class CombatArena {
  private readonly players = new Map<string, ArenaPlayer>();
  private readonly spawnProtectionMs: number;

  constructor(options: CombatArenaOptions = {}) {
    const protection = options.spawnProtectionMs;
    this.spawnProtectionMs = typeof protection === 'number' && Number.isFinite(protection) && protection >= 0
      ? protection
      : SPAWN_PROTECTION_MS;
  }

  addPlayer(id: string, mapId: string, initialWeapon: WeaponId = 'knife', eyeHeight = 1.6): void {
    this.players.set(id, {
      id,
      mapId,
      combat: createPlayerCombat(),
      weapon: new WeaponController(initialWeapon),
      knife: new KnifeController(),
      feet: new Vector3(),
      yaw: 0,
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
    if (p) p.spawnProtectedUntilMs = nowMs + this.spawnProtectionMs;
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
    p.knife.reset();
    p.spawnProtectedUntilMs = nowMs + this.spawnProtectionMs;
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
   * `yaw` is the body yaw used for knife backstabs.
   */
  setPosition(
    id: string,
    feet: [number, number, number],
    mapId?: string,
    nowMs = Date.now(),
    velocity?: [number, number, number],
    yaw?: number,
  ): void {
    const p = this.players.get(id);
    if (!p) return;
    p.feet.set(feet[0], feet[1], feet[2]);
    if (mapId !== undefined) p.mapId = mapId;
    const hasYaw = typeof yaw === 'number' && Number.isFinite(yaw);
    if (hasYaw) p.yaw = yaw;
    if (!Number.isFinite(nowMs)) return;

    const sample: PositionSample = {
      atMs: nowMs,
      feet: p.feet.clone(),
      velocity: velocity ? new Vector3(velocity[0], velocity[1], velocity[2]) : undefined,
      yaw: hasYaw ? yaw : undefined,
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
   * authoritative positions, applies damage, and reports events. A knife held
   * by the shooter resolves as a primary slash (clients that predate the melee
   * field keep working).
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
    const shooter = this.players.get(shooterId);
    if (!shooter || !shooter.combat.alive) {
      return { fired: false };
    }
    if (shooter.weapon.getActive() === 'knife') {
      return this.handleMelee(shooterId, 'primary', origin, dir, nowMs, {
        observedAtMs,
        targetTimes: lag?.targetTimes,
        shooterTimeMs: lag?.shooterTimeMs,
        blockingDistance,
      });
    }

    const fireResult = shooter.weapon.tryFire(nowMs);
    if (!fireResult.fired) {
      return { fired: false };
    }
    const weapon = fireResult.weapon;

    // Anti-teleport: reject implausible origins but still count the shot as
    // fired (so the animation/ammo stay consistent) — it just can't hit.
    const originVec = new Vector3(origin[0], origin[1], origin[2]);
    if (this.originDeviation(shooter, originVec, lag?.shooterTimeMs) > MAX_ORIGIN_DEVIATION) {
      return { fired: true };
    }

    const targets = this.rewoundTargets(shooter, nowMs, observedAtMs, lag?.targetTimes)
      .map((target) => target.capsule);

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
   * Resolves a knife swing. The shooter must hold the knife and be off the CS
   * cooldown for `kind`; the swing sweeps against the rewound capsules, picks
   * the nearest target in front, applies 40/25/65 (90/180 from behind) and
   * reports hits and deaths with weaponId 'knife'. A rejected origin still
   * spends the swing, like a gun shot.
   */
  handleMelee(
    shooterId: string,
    kind: KnifeAttack,
    origin: [number, number, number],
    dir: [number, number, number],
    nowMs: number,
    options: MeleeOptions = {},
  ): FireOutcome {
    const shooter = this.players.get(shooterId);
    if (!shooter || !shooter.combat.alive || shooter.weapon.getActive() !== 'knife') {
      return { fired: false };
    }
    const requested = options.attackTimeMs;
    const attackAt = typeof requested === 'number' && Number.isFinite(requested)
      ? Math.min(nowMs, Math.max(nowMs - MELEE_ATTACK_TIME_SLACK_MS, requested))
      : nowMs;
    if (!shooter.knife.canAttack(kind, attackAt)) {
      return { fired: false };
    }
    const followUp = kind === 'primary' && shooter.knife.isFollowUp(attackAt);

    const originVec = new Vector3(origin[0], origin[1], origin[2]);
    const dirVec = new Vector3(dir[0], dir[1], dir[2]);
    if (
      dirVec.lengthSq() < 1e-8
      || this.originDeviation(shooter, originVec, options.shooterTimeMs) > MAX_MELEE_ORIGIN_DEVIATION
    ) {
      shooter.knife.commit(kind, attackAt, false);
      return { fired: true, melee: kind };
    }
    dirVec.normalize();

    const rewound = this.rewoundTargets(shooter, nowMs, options.observedAtMs, options.targetTimes);
    const range = KNIFE_RANGE_M[kind];
    const wallDistance = options.blockingDistance;
    const hasWallDistance = wallDistance !== undefined && Number.isFinite(wallDistance);
    const hit = resolveMeleeHit(
      { origin: originVec, direction: dirVec, range, radius: KNIFE_SWEEP_RADIUS_M },
      rewound.map((target) => ({
        id: target.capsule.id,
        feet: target.capsule.feet,
        height: target.capsule.height,
        radius: target.capsule.radius,
      })),
      (from, to) => {
        if (hasWallDistance && to.clone().sub(from).dot(dirVec) > Math.max(0, wallDistance)) {
          return true;
        }
        return options.isBlocked?.(from, to) ?? false;
      },
    );
    shooter.knife.commit(kind, attackAt, hit !== null);
    if (!hit) {
      return { fired: true, melee: kind };
    }

    const target = this.players.get(hit.targetId);
    const victim = rewound.find((candidate) => candidate.capsule.id === hit.targetId);
    if (!target || !victim) {
      return { fired: true, melee: kind };
    }
    const attackerFeet: [number, number, number] = [
      originVec.x,
      originVec.y - shooter.eyeHeight,
      originVec.z,
    ];
    const victimFeet = victim.capsule.feet;
    const backstab = isBackstab(attackerFeet, [victimFeet.x, victimFeet.y, victimFeet.z], victim.yaw);
    const result = applyFlatDamage(target.combat, knifeDamage(kind, backstab, followUp), nowMs);
    const outcome: FireOutcome = {
      fired: true,
      melee: kind,
      impactDistance: hit.distance,
      impactPoint: [hit.point.x, hit.point.y, hit.point.z],
      hit: {
        shooterId,
        targetId: hit.targetId,
        weaponId: 'knife',
        damage: result.applied,
        hitbox: 'body',
        killed: result.killed,
        melee: kind,
        backstab,
      },
    };
    if (result.killed) {
      outcome.death = {
        victimId: hit.targetId,
        killerId: shooterId,
        weaponId: 'knife',
        headshot: false,
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
        p.knife.reset();
        p.spawnProtectedUntilMs = nowMs + this.spawnProtectionMs;
        const pos = spawnFor?.(p.id) ?? [p.feet.x, p.feet.y, p.feet.z];
        p.feet.set(pos[0], pos[1], pos[2]);
        p.positionHistory = [];
        events.push({ playerId: p.id, position: pos });
      }
    }
    return events;
  }

  /** gap between a claimed eye and the authoritative (or shot-time projected) eye */
  private originDeviation(shooter: ArenaPlayer, originVec: Vector3, shooterTimeMs?: number): number {
    const eye = shooter.feet.clone().add(new Vector3(0, shooter.eyeHeight, 0));
    // fast surfers outrun the latest sample; project it to the shot time
    // before judging the origin, or legit shots get dropped as teleports
    const projected = projectTo(shooter.positionHistory, shooterTimeMs);
    const projectedEye = projected?.add(new Vector3(0, shooter.eyeHeight, 0));
    return Math.min(
      originVec.distanceTo(eye),
      projectedEye ? originVec.distanceTo(projectedEye) : Infinity,
    );
  }

  /**
   * Capsules for every other alive, unprotected player on the shooter's map.
   * Each target is rewound to the pose the shooter had on screen: per-target
   * times when the client sent them, else the single legacy timestamp.
   */
  private rewoundTargets(
    shooter: ArenaPlayer,
    nowMs: number,
    observedAtMs: number | undefined,
    targetTimes: Readonly<Record<string, number>> | undefined,
  ): RewoundTarget[] {
    const legacyRewindAt = (
      observedAtMs !== undefined
      && Number.isFinite(observedAtMs)
      && observedAtMs <= nowMs
      && nowMs - observedAtMs <= MAX_LAG_COMPENSATION_MS
    )
      ? observedAtMs
      : null;
    const targets: RewoundTarget[] = [];
    for (const other of this.players.values()) {
      if (other.id === shooter.id) continue;
      if (other.mapId !== shooter.mapId) continue;
      if (!other.combat.alive) continue;
      if (other.spawnProtectedUntilMs > nowMs) continue;
      const requested = targetTimes?.[other.id];
      const perTarget = typeof requested === 'number' && Number.isFinite(requested);
      const targetFeet = perTarget
        ? rewindTo(other.positionHistory, requested) ?? other.feet
        : legacyRewindAt !== null
          ? stepRewind(other.positionHistory, legacyRewindAt) ?? other.feet
          : other.feet;
      const rewindAt = perTarget ? requested : legacyRewindAt;
      targets.push({
        capsule: {
          id: other.id,
          feet: targetFeet.clone(),
          height: PLAYER_CAPSULE_HEIGHT,
          radius: PLAYER_CAPSULE_RADIUS,
        },
        yaw: rewindAt !== null ? yawAt(other.positionHistory, rewindAt) ?? other.yaw : other.yaw,
      });
    }
    return targets;
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

/**
 * Body yaw at `atMs`, shortest-arc blended between the samples around it and
 * clamped to the same rewind window as positions. Null without yaw samples.
 */
function yawAt(history: readonly PositionSample[], atMs: number): number | null {
  const withYaw = history.filter((sample) => sample.yaw !== undefined);
  const newest = withYaw.at(-1);
  if (!newest) return null;
  const t = Math.max(newest.atMs - MAX_LAG_COMPENSATION_MS, Math.min(newest.atMs, atMs));
  if (t >= newest.atMs) return newest.yaw!;
  let hi = withYaw.length - 1;
  while (hi > 0 && withYaw[hi - 1].atMs > t) hi -= 1;
  if (hi === 0) return withYaw[0].yaw!;
  const a = withYaw[hi - 1];
  const b = withYaw[hi];
  const u = (t - a.atMs) / Math.max(1e-6, b.atMs - a.atMs);
  let delta = (b.yaw! - a.yaw!) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return a.yaw! + delta * u;
}

/** Newest sample pushed forward (or back) along its velocity to `atMs`. */
function projectTo(history: readonly PositionSample[], atMs: number | undefined): Vector3 | null {
  const newest = history.at(-1);
  if (!newest?.velocity || atMs === undefined || !Number.isFinite(atMs)) return null;
  const dt = Math.max(-MAX_LAG_COMPENSATION_MS, Math.min(MAX_LAG_COMPENSATION_MS, atMs - newest.atMs)) / 1000;
  return newest.feet.clone().addScaledVector(newest.velocity, dt);
}
