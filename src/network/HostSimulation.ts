import { Vector3 } from 'three';
import { BotController } from '../combat/BotController';
import {
  BotTargetMemory,
  isBotWithinTargetView,
  type BotTargetCandidate,
} from '../combat/BotPerception';
import { computeBotSpawnCandidate, groundBotSpawn } from '../combat/BotSpawn';
import { CombatArena, type FireOutcome } from '../combat/CombatArena';
import { shouldResetCombatEntry } from '../combat/CombatEntryPolicy';
import type { KnifeAttack } from '../combat/knives';
import { REMOTE_SHOT_VISUAL_DISTANCE } from '../combat/ShotPresentation';
import { getWeapon, type WeaponId } from '../combat/weapons';
import { RESPAWN_DELAY_MS } from '../combat/CombatState';
import { SourceClock } from '../netcode/SourceClock';
import type { CollisionWorld } from '../world/CollisionWorld';
import type { PlayerModel } from './types';
import type { DeathEvent, HealthEvent, HitEvent, RespawnEvent, ShotEvent } from './MultiplayerTransport';

export interface HostSpawn {
  position: Vector3;
  yawDeg: number;
}

export interface HostHuman {
  id: string;
  name: string;
  model: PlayerModel;
  position: [number, number, number];
  combatReady: boolean;
  yaw?: number;
  pitch?: number;
  velocity?: [number, number, number];
  /** sample time in this human's own clock (their Date.now at the tick) */
  t?: number;
  /** weapon the player has out, so a new host doesn't reset everyone to the knife */
  weapon?: string;
  /** set while the player is dead: ms until their respawn is due */
  deadForMs?: number;
}

export interface HostFireLag {
  /** per-target source-clock times the shooter had on screen */
  targetTimes?: Record<string, number>;
  /** shooter's own clock time at the shot */
  shooterTimeMs?: number;
  /**
   * When the swing happened in the host's clock, if the caller knows it (the
   * host's own attacks). Remote swings are mapped from `shooterTimeMs`.
   */
  attackTimeMs?: number;
  /** weapon the shooter had out when they fired (p4 fire messages carry it) */
  weapon?: string;
  /** rounds the shooter's client had before the shot (p5 fires may carry it) */
  clientAmmo?: number;
}

export interface HostBotRow {
  id: string;
  name: string;
  model: PlayerModel;
  position: [number, number, number];
  velocity: [number, number, number];
  yaw: number;
  pitch: number;
  health: number;
  alive: boolean;
}

/** Sinks for events the host produces; the transport both broadcasts and dispatches them locally. */
export interface HostEmitter {
  hit(event: HitEvent): void;
  death(event: DeathEvent): void;
  health(event: HealthEvent): void;
  respawn(event: RespawnEvent): void;
  shot(event: ShotEvent): void;
}

const MAP_ID = 'host';
const BOT_NAMES = ['Ada', 'Byte', 'Cypher', 'Delta', 'Echo', 'Flux', 'Ghost', 'Hex'];

/** Absolute backstop: a bot this far below its seed is gone no matter what. */
const BOT_FALL_LIMIT = 600;
interface Bot {
  id: string;
  name: string;
  model: PlayerModel;
  controller: BotController;
  targetMemory: BotTargetMemory;
  /** Grounded seed position this bot returns to on death or after falling. */
  spawn: Vector3;
  yawDeg: number;
}

/**
 * Client-side authoritative simulation run by the elected host in Supabase mode.
 * Reuses the exact combat/bot logic that the dedicated server used
 * ({@link CombatArena}, {@link BotController}) against the host's already-loaded
 * {@link CollisionWorld}. Produces bot rows for the snapshot and combat events
 * for the transport to broadcast.
 */
export class HostSimulation {
  private readonly arena = new CombatArena();
  private readonly bots: Bot[] = [];
  private readonly humanPositions = new Map<string, Vector3>();
  private readonly humanCombatReady = new Map<string, boolean>();
  private readonly humanHasEnteredCombat = new Set<string>();
  private readonly humanPausedAtMs = new Map<string, number>();
  private readonly humanLastCombatAtMs = new Map<string, number>();
  private readonly humanViews = new Map<string, { yaw: number; pitch: number }>();
  /** latest weapon each human reported in their state */
  private readonly humanWeapons = new Map<string, WeaponId>();
  /** maps each remote human's clock onto host time, for knife cooldowns */
  private readonly humanClocks = new Map<string, SourceClock>();
  private shotSequence = 1;

  constructor(
    private readonly world: CollisionWorld,
    private readonly spawn: HostSpawn,
    botCount: number,
    private readonly emit: HostEmitter,
  ) {
    for (let i = 0; i < botCount; i += 1) {
      const id = `bot:${i}`;
      const model: PlayerModel = i % 2 === 0 ? 'terrorist' : 'counterterrorist';
      const name = `${BOT_NAMES[i % BOT_NAMES.length]} (bot)`;

      // Match the dedicated authority's visible forward staging, then seat the
      // candidate on this host's copy of the same collision geometry.
      const candidate = computeBotSpawnCandidate(
        spawn.position,
        spawn.yawDeg,
        i,
        botCount,
      );
      const seed = groundBotSpawn(this.world, candidate);
      // Face roughly back toward the player spawn.
      const yawDeg =
        (Math.atan2(-(spawn.position.x - seed.x), -(spawn.position.z - seed.z)) * 180) / Math.PI;

      const controller = new BotController(seed, yawDeg);
      this.arena.addPlayer(id, MAP_ID, 'deagle');
      this.arena.setPosition(id, tuple(seed), MAP_ID);
      this.arena.protectSpawn(id, Date.now());
      this.bots.push({
        id,
        name,
        model,
        controller,
        targetMemory: new BotTargetMemory(),
        spawn: seed.clone(),
        yawDeg,
      });
    }
  }

  /** Registers/updates the human roster in the arena from the latest snapshot. */
  syncHumans(humans: HostHuman[]): void {
    const present = new Set<string>();
    for (const h of humans) {
      const now = Date.now();
      present.add(h.id);
      const isNew = !this.humanPositions.has(h.id);
      const wasReady = this.humanCombatReady.get(h.id) ?? false;
      if (isNew) {
        this.arena.addPlayer(h.id, MAP_ID, isWeaponId(h.weapon) ? h.weapon : 'knife');
        // a player who died under the previous host stays dead until their
        // respawn is due, and this host then sends the respawn they're waiting on
        if (h.deadForMs !== undefined) {
          this.arena.markDead(h.id, now + Math.min(h.deadForMs, RESPAWN_DELAY_MS));
        }
        this.humanLastCombatAtMs.set(h.id, now);
        if (!h.combatReady) {
          this.humanPausedAtMs.set(h.id, now);
        }
      }
      if (isWeaponId(h.weapon)) {
        this.humanWeapons.set(h.id, h.weapon);
      }
      if (!isNew && isWeaponId(h.weapon) && this.arena.getActiveWeapon(h.id) !== h.weapon) {
        this.arena.equip(h.id, h.weapon, now);
      }
      this.arena.setPosition(h.id, h.position, MAP_ID, h.t ?? now, h.velocity, h.yaw);
      this.humanPositions.set(h.id, new Vector3(h.position[0], h.position[1], h.position[2]));
      this.humanCombatReady.set(h.id, h.combatReady);
      if (Number.isFinite(h.yaw) && Number.isFinite(h.pitch)) {
        this.humanViews.set(h.id, { yaw: h.yaw as number, pitch: h.pitch as number });
      } else {
        this.humanViews.delete(h.id);
      }

      if (isNew || wasReady !== h.combatReady) {
        this.resetBotEngagement();
        if (h.combatReady) {
          const cleanEntry = !isNew && shouldResetCombatEntry({
            alive: this.arena.isAlive(h.id),
            pausedAtMs: this.humanPausedAtMs.get(h.id) ?? null,
            lastCombatAtMs: this.humanLastCombatAtMs.get(h.id) ?? now,
            nowMs: now,
          });
          if (cleanEntry) {
            const respawn = this.arena.resetPlayer(h.id, now, h.position);
            this.emit.health({ playerId: h.id, health: 100, alive: true });
            if (respawn) this.emit.respawn(respawn);
          } else if (!this.humanHasEnteredCombat.has(h.id)) {
            this.arena.protectSpawn(h.id, now);
          }
          this.humanHasEnteredCombat.add(h.id);
          this.humanPausedAtMs.delete(h.id);
        } else if (!isNew || wasReady) {
          this.humanPausedAtMs.set(h.id, now);
        }
      }
    }
    for (const id of [...this.humanPositions.keys()]) {
      if (!present.has(id)) {
        this.arena.removePlayer(id);
        this.humanPositions.delete(id);
        this.humanCombatReady.delete(id);
        this.humanHasEnteredCombat.delete(id);
        this.humanPausedAtMs.delete(id);
        this.humanLastCombatAtMs.delete(id);
        this.humanViews.delete(id);
        this.humanWeapons.delete(id);
        this.humanClocks.delete(id);
        this.resetBotEngagement();
      }
    }
  }

  /** Records a movement sample the moment it arrives (between host steps). */
  recordHumanSample(
    id: string,
    position: [number, number, number],
    t: number,
    velocity?: [number, number, number],
    yaw?: number,
  ): void {
    if (!this.humanPositions.has(id)) return;
    this.arena.setPosition(id, position, MAP_ID, t, velocity, yaw);
    this.humanPositions.get(id)?.set(position[0], position[1], position[2]);
    let clock = this.humanClocks.get(id);
    if (!clock) {
      clock = new SourceClock();
      this.humanClocks.set(id, clock);
    }
    clock.observe(t, Date.now());
  }

  private resetBotEngagement(): void {
    for (const bot of this.bots) {
      bot.targetMemory.clear();
      bot.controller.resetEngagement();
    }
  }

  applyEquip(id: string, weaponId: string): void {
    if (weaponId === 'awp' || weaponId === 'deagle' || weaponId === 'knife') {
      this.arena.equip(id, weaponId, Date.now());
    }
  }

  applyReload(id: string): void {
    this.arena.reload(id, Date.now());
  }

  /**
   * Resolves a fire from a human (or the host itself) and emits the outcome.
   * `melee` marks a knife swing; a knife fire without it is a primary slash,
   * which keeps peers that predate the field working.
   */
  applyFire(
    shooterId: string,
    origin: [number, number, number],
    dir: [number, number, number],
    observedAtMs?: number,
    lag?: HostFireLag,
    melee?: KnifeAttack,
  ): void {
    if (this.humanCombatReady.has(shooterId) && !this.humanCombatReady.get(shooterId)) {
      return;
    }
    if (melee !== undefined) {
      this.applyMelee(shooterId, melee, origin, dir, observedAtMs, lag);
      return;
    }
    // only a swing flagged melee is a knife attack. a gun shot right after a
    // handoff can beat the shooter's state to this host, so trust the weapon on
    // the shot (or the last one they reported) over the arena's stale view
    const held = isWeaponId(lag?.weapon) ? lag.weapon : this.humanWeapons.get(shooterId);
    if (held && held !== 'knife' && this.arena.getActiveWeapon(shooterId) !== held) {
      this.arena.equip(shooterId, held);
    }
    if (this.arena.getActiveWeapon(shooterId) === 'knife') {
      // bots, and peers that predate the melee field, still slash
      this.applyMelee(shooterId, 'primary', origin, dir, observedAtMs, lag);
      return;
    }
    const now = Date.now();
    const weaponId = this.arena.getActiveWeapon(shooterId);
    const direction = new Vector3(dir[0], dir[1], dir[2]);
    const worldImpact =
      weaponId && weaponId !== 'knife' && direction.lengthSq() > 1e-8
        ? this.world.raycastGeometry(
            new Vector3(origin[0], origin[1], origin[2]),
            direction.clone().normalize(),
            getWeapon(weaponId).range,
          )
        : null;
    const outcome = this.arena.handleFire(
      shooterId,
      origin,
      dir,
      now,
      worldImpact?.distance,
      observedAtMs,
      lag && { ...lag, clientAmmo: Number.isFinite(lag.clientAmmo) ? lag.clientAmmo : undefined },
    );
    if (outcome.fired && this.humanPositions.has(shooterId)) {
      this.humanLastCombatAtMs.set(shooterId, now);
    }
    if (outcome.hit && this.humanPositions.has(outcome.hit.targetId)) {
      this.humanLastCombatAtMs.set(outcome.hit.targetId, now);
    }
    if (outcome.fired && weaponId && weaponId !== 'knife') {
      const bot = this.bots.find((candidate) => candidate.id === shooterId);
      bot?.controller.onShotFired();
      const shot: ShotEvent = {
        sequence: this.shotSequence++,
        result: outcome.death ? 'kill' : outcome.hit ? 'hit' : 'miss',
        playerId: shooterId,
        targetId: outcome.hit?.targetId,
        origin,
        dir,
        weaponId,
      };
      if (outcome.impactDistance !== undefined) {
        const endpoint = new Vector3(origin[0], origin[1], origin[2])
          .addScaledVector(direction.normalize(), outcome.impactDistance);
        shot.endpoint = tuple(endpoint);
        shot.impactNormal = [-direction.x, -direction.y, -direction.z];
      } else if (worldImpact) {
        shot.endpoint = tuple(worldImpact.point);
        shot.impactNormal = tuple(worldImpact.normal);
      } else if (direction.lengthSq() > 1e-8) {
        direction.normalize();
        const endpoint = new Vector3(origin[0], origin[1], origin[2])
          .addScaledVector(direction, REMOTE_SHOT_VISUAL_DISTANCE);
        shot.endpoint = tuple(endpoint);
        shot.impactNormal = [-direction.x, -direction.y, -direction.z];
      }
      this.emit.shot(shot);
    }
    this.emitOutcome(outcome);
  }

  /**
   * Knife swing against the host's collision world: walls between the eye and
   * the contact point block it. Hits also go out as a 'shot' with weaponId
   * 'knife' so victims get the incoming-damage cue and clients can draw blood
   * at the confirmed contact point.
   */
  private applyMelee(
    shooterId: string,
    kind: KnifeAttack,
    origin: [number, number, number],
    dir: [number, number, number],
    observedAtMs?: number,
    lag?: HostFireLag,
  ): void {
    const now = Date.now();
    const outcome = this.arena.handleMelee(shooterId, kind, origin, dir, now, {
      observedAtMs,
      targetTimes: lag?.targetTimes,
      shooterTimeMs: lag?.shooterTimeMs,
      attackTimeMs: this.attackTimeFor(shooterId, lag),
      isBlocked: (from, to) => this.world.segmentIntersectsGeometry(from, to),
    });
    if (outcome.fired && this.humanPositions.has(shooterId)) {
      this.humanLastCombatAtMs.set(shooterId, now);
    }
    if (outcome.hit && this.humanPositions.has(outcome.hit.targetId)) {
      this.humanLastCombatAtMs.set(outcome.hit.targetId, now);
    }
    this.emitMeleeShot(shooterId, origin, dir, outcome);
    this.emitOutcome(outcome);
  }

  private emitMeleeShot(
    shooterId: string,
    origin: [number, number, number],
    dir: [number, number, number],
    outcome: FireOutcome,
  ): void {
    if (!outcome.hit || !outcome.impactPoint) {
      return;
    }
    const direction = new Vector3(dir[0], dir[1], dir[2]);
    if (direction.lengthSq() > 1e-8) direction.normalize();
    this.emit.shot({
      sequence: this.shotSequence++,
      result: outcome.death ? 'kill' : 'hit',
      playerId: shooterId,
      targetId: outcome.hit.targetId,
      origin,
      dir,
      weaponId: 'knife',
      endpoint: outcome.impactPoint,
      impactNormal: [-direction.x, -direction.y, -direction.z],
    });
  }

  /** host-clock swing time: given directly, or a remote stamp mapped through its clock */
  private attackTimeFor(shooterId: string, lag?: HostFireLag): number | undefined {
    const direct = lag?.attackTimeMs;
    if (typeof direct === 'number' && Number.isFinite(direct)) {
      return direct;
    }
    const stamp = lag?.shooterTimeMs;
    const clock = this.humanClocks.get(shooterId);
    if (clock?.hasOffset() && typeof stamp === 'number' && Number.isFinite(stamp)) {
      return clock.toLocal(stamp);
    }
    return undefined;
  }

  /** Advances bots (movement + combat) and returns the current bot rows. */
  tick(dtMs: number): HostBotRow[] {
    const now = Date.now();
    const dt = dtMs / 1000;

    const targets = this.livingHumanPositions(now);
    for (const bot of this.bots) {
      if (!this.arena.isAlive(bot.id)) {
        this.arena.setPosition(bot.id, tuple(bot.controller.getFeet()), MAP_ID, now);
        continue;
      }
      // If a bot has genuinely fallen off the map (plummeting, not surfing),
      // reset it to its seed instead of letting it drop forever. A real surf
      // descent keeps lots of horizontal speed, so it never trips hasFallenOff.
      if (bot.controller.hasFallenOff() || bot.controller.getFeet().y < bot.spawn.y - BOT_FALL_LIMIT) {
        bot.controller.respawn(bot.spawn, bot.yawDeg);
        bot.targetMemory.clear();
        this.arena.setPosition(bot.id, tuple(bot.spawn), MAP_ID, now);
        continue;
      }
      const eye = bot.controller.getCameraPosition();
      const perception = bot.targetMemory.observe({
        observer: eye,
        yawRad: bot.controller.getYawRad(),
        candidates: targets,
        hasLineOfSight: (targetFeet) =>
          !this.world.segmentIntersectsGeometry(
            eye,
            targetFeet.clone().add(new Vector3(0, 1.2, 0)),
          ),
        canAcquire: (candidate) =>
          isBotWithinTargetView(candidate, bot.controller.getFeet()),
      });
      bot.controller.tick(dt, this.world, perception);
      this.arena.setPosition(
        bot.id,
        tuple(bot.controller.getFeet()),
        MAP_ID,
        now,
        tuple(bot.controller.getVelocity()),
        bot.controller.getYawRad(),
      );

      if (bot.controller.wantsToFire()) {
        const aim = bot.controller.getAimTarget();
        const eye = bot.controller.getCameraPosition();
        if (aim && !this.world.segmentIntersectsGeometry(eye, aim)) {
          const fwd = bot.controller.getForwardVector();
          this.applyFire(bot.id, tuple(eye), [fwd.x, fwd.y, fwd.z]);
        }
      }
      if ((this.arena.getAmmo(bot.id) ?? 1) <= 0) {
        this.arena.reload(bot.id, now);
      }
    }

    this.arena.tickWeapons(now);
    for (const ev of this.arena.tickRespawns(now, (id) => this.spawnFor(id))) {
      this.onRespawn(ev.playerId, ev.position);
    }

    return this.bots.map((bot) => ({
      id: bot.id,
      name: bot.name,
      model: bot.model,
      position: tuple(bot.controller.getFeet()),
      velocity: tuple(bot.controller.getVelocity()),
      yaw: bot.controller.getYawRad(),
      pitch: bot.controller.getPitchRad(),
      health: this.arena.getHealth(bot.id) ?? 100,
      alive: this.arena.isAlive(bot.id),
    }));
  }

  dispose(): void {
    for (const bot of this.bots) {
      this.arena.removePlayer(bot.id);
    }
    for (const id of this.humanPositions.keys()) {
      this.arena.removePlayer(id);
    }
    this.bots.length = 0;
    this.humanPositions.clear();
    this.humanCombatReady.clear();
    this.humanViews.clear();
    this.humanClocks.clear();
  }

  private emitOutcome(outcome: FireOutcome): void {
    if (outcome.hit) {
      this.emit.hit(outcome.hit);
      const victim = outcome.hit.targetId;
      this.emit.health({
        playerId: victim,
        health: this.arena.getHealth(victim) ?? 0,
        alive: this.arena.isAlive(victim),
      });
    }
    if (outcome.death) {
      this.emit.death(outcome.death);
    }
  }

  private onRespawn(id: string, position: [number, number, number]): void {
    const bot = this.bots.find((b) => b.id === id);
    if (bot) {
      bot.controller.respawn(new Vector3(position[0], position[1], position[2]), bot.yawDeg);
      bot.targetMemory.clear();
    } else {
      this.resetBotEngagement();
    }
    this.emit.respawn({ playerId: id, position });
    this.emit.health({ playerId: id, health: this.arena.getHealth(id) ?? 100, alive: true });
  }

  private spawnFor(id: string): [number, number, number] {
    const bot = this.bots.find((b) => b.id === id);
    if (bot) {
      return tuple(bot.spawn);
    }
    return tuple(this.spawn.position);
  }

  private livingHumanPositions(nowMs: number): BotTargetCandidate[] {
    const out: BotTargetCandidate[] = [];
    for (const [id, pos] of this.humanPositions) {
      if (
        this.humanCombatReady.get(id)
        && this.arena.isAlive(id)
        && !this.arena.isSpawnProtected(id, nowMs)
      ) {
        const view = this.humanViews.get(id);
        out.push({
          id,
          feet: pos,
          alive: true,
          viewYawRad: view?.yaw,
          viewPitchRad: view?.pitch,
        });
      }
    }
    return out;
  }
}

function tuple(v: Vector3): [number, number, number] {
  return [v.x, v.y, v.z];
}

function isWeaponId(value: unknown): value is WeaponId {
  return value === 'awp' || value === 'deagle' || value === 'knife';
}
