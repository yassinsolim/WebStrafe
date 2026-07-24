import { Vector3 } from 'three';
import { BotController } from '../src/combat/BotController';
import {
  BotTargetMemory,
  isBotWithinTargetView,
  type BotTargetCandidate,
} from '../src/combat/BotPerception';
import type { CombatArena } from '../src/combat/CombatArena';
import { computeBotSpawnCandidate, groundBotSpawn } from '../src/combat/BotSpawn';
import { getWeapon } from '../src/combat/weapons';
import { loadHeadlessMap, type HeadlessMap } from './mapCollision';

export { computeBotSpawnCandidate } from '../src/combat/BotSpawn';

export type BotModel = 'terrorist' | 'counterterrorist';

export interface BotTarget extends BotTargetCandidate {}

export interface BotSnapshotRow {
  id: string;
  name: string;
  model: BotModel;
  position: [number, number, number];
  velocity: [number, number, number];
  yaw: number;
  pitch: number;
  health: number;
  alive: boolean;
}

export interface BotFireEvent {
  id: string;
  mapId: string;
  origin: [number, number, number];
  dir: [number, number, number];
  worldImpact?: BotWorldImpact;
}

export interface BotWorldImpact {
  point: [number, number, number];
  normal: [number, number, number];
  distance: number;
}

const BOT_NAMES = [
  'Ada', 'Byte', 'Cypher', 'Delta', 'Echo', 'Flux', 'Ghost', 'Hex',
  'Iris', 'Jolt', 'Kilo', 'Lynx', 'Mako', 'Nova', 'Onyx', 'Pyro',
];

interface Bot {
  id: string;
  mapId: string;
  name: string;
  model: BotModel;
  controller: BotController;
  targetMemory: BotTargetMemory;
  /** Grounded seed this bot returns to on death or after falling off the map. */
  spawn: Vector3;
  yawDeg: number;
}

/**
 * Owns server-side bots per map. Bots run the real {@link BotController}
 * (MovementController + AI) against the map's headless {@link CollisionWorld},
 * are registered in the {@link CombatArena} so players can damage them, and are
 * surfaced as extra rows in the snapshot. Movement only — offense arrives later.
 */
export class BotManager {
  private readonly worlds = new Map<string, HeadlessMap>();
  private readonly loading = new Set<string>();
  private readonly failed = new Set<string>();
  private readonly botsByMap = new Map<string, Bot[]>();
  private nextBotSeq = 0;

  constructor(
    private readonly arena: CombatArena,
    private readonly botsPerMap: number,
  ) {}

  /** Ensures collision for a map is loading/loaded so bots can populate it. */
  requestMap(mapId: string): void {
    if (this.worlds.has(mapId) || this.loading.has(mapId) || this.failed.has(mapId)) {
      return;
    }
    this.loading.add(mapId);
    void loadHeadlessMap(mapId).then((map) => {
      this.loading.delete(mapId);
      if (map) {
        this.worlds.set(mapId, map);
      } else {
        // Remember the failure so we don't re-enter the load every tick.
        this.failed.add(mapId);
      }
    });
  }

  /** Removes all bots on maps that no longer have any humans. */
  pruneEmptyMaps(mapsWithHumans: Set<string>): void {
    for (const [mapId, bots] of this.botsByMap) {
      if (mapsWithHumans.has(mapId)) {
        continue;
      }
      for (const bot of bots) {
        this.arena.removePlayer(bot.id);
      }
      this.botsByMap.delete(mapId);
    }
  }

  /**
   * Advances every bot one fixed step. `targetsByMap` provides candidate targets
   * (the living humans) per map; each bot chases the nearest one.
   */
  tick(dt: number, targetsByMap: Map<string, BotTarget[]>): void {
    for (const [mapId, world] of this.worlds) {
      if (!targetsByMap.has(mapId)) {
        continue;
      }
      this.ensureBots(mapId);
      const bots = this.botsByMap.get(mapId) ?? [];
      const targets = targetsByMap.get(mapId) ?? [];
      for (const bot of bots) {
        if (!this.arena.isAlive(bot.id)) {
          // Dead bots hold still until the respawn tick repositions them.
          this.arena.setPosition(bot.id, toTuple(bot.controller.getFeet()), mapId);
          continue;
        }
        // Reset a bot that has genuinely fallen off the map (plummeting, not
        // surfing) back to its seed so it rejoins the fight instead of dropping
        // into the void forever.
        if (bot.controller.hasFallenOff()) {
          bot.controller.respawn(bot.spawn, bot.yawDeg);
          bot.targetMemory.clear();
          this.arena.setPosition(bot.id, toTuple(bot.spawn), mapId);
          continue;
        }
        const eye = bot.controller.getCameraPosition();
        const perception = bot.targetMemory.observe({
          observer: eye,
          yawRad: bot.controller.getYawRad(),
          candidates: targets,
          hasLineOfSight: (targetFeet) =>
            !world.world.segmentIntersectsGeometry(
              eye,
              targetFeet.clone().add(new Vector3(0, 1.2, 0)),
            ),
          canAcquire: (candidate) =>
            isBotWithinTargetView(candidate, bot.controller.getFeet()),
        });
        bot.controller.tick(dt, world.world, perception);
        this.arena.setPosition(bot.id, toTuple(bot.controller.getFeet()), mapId);
      }
    }
  }

  /** Snapshot rows for a map's bots (empty if none/not loaded). */
  snapshotRows(mapId: string): BotSnapshotRow[] {
    const bots = this.botsByMap.get(mapId);
    if (!bots) {
      return [];
    }
    return bots.map((bot) => ({
      id: bot.id,
      name: bot.name,
      model: bot.model,
      position: toTuple(bot.controller.getFeet()),
      velocity: toTuple(bot.controller.getVelocity()),
      yaw: bot.controller.getYawRad(),
      pitch: bot.controller.getPitchRad(),
      health: this.arena.getHealth(bot.id) ?? 100,
      alive: this.arena.isAlive(bot.id),
    }));
  }

  /** True if the id belongs to a managed bot. */
  isBot(id: string): boolean {
    return id.startsWith('bot:');
  }

  /**
   * Bots that want to fire this tick AND have a clear line of sight to their
   * target (server-side occlusion via the map collision — bots can't wall-hack).
   * The caller runs each event through the authoritative arena.
   */
  collectFireEvents(): BotFireEvent[] {
    const events: BotFireEvent[] = [];
    for (const [mapId, bots] of this.botsByMap) {
      const world = this.worlds.get(mapId);
      if (!world) {
        continue;
      }
      for (const bot of bots) {
        if (!this.arena.isAlive(bot.id) || !bot.controller.wantsToFire()) {
          continue;
        }
        const aim = bot.controller.getAimTarget();
        if (!aim) {
          continue;
        }
        const eye = bot.controller.getCameraPosition();
        // Exact BVH raycast: a wall between the bot's eye and its target blocks
        // the shot (bots can't wall-hack).
        if (world.world.segmentIntersectsGeometry(eye, aim)) {
          continue;
        }
        const fwd = bot.controller.getForwardVector();
        const weaponId = this.arena.getActiveWeapon(bot.id);
        const worldImpact = weaponId && weaponId !== 'knife'
          ? world.world.raycastGeometry(eye, fwd, getWeapon(weaponId).range)
          : null;
        events.push({
          id: bot.id,
          mapId,
          origin: [eye.x, eye.y, eye.z],
          dir: [fwd.x, fwd.y, fwd.z],
          worldImpact: worldImpact
            ? {
                point: toTuple(worldImpact.point),
                normal: toTuple(worldImpact.normal),
                distance: worldImpact.distance,
              }
            : undefined,
        });
      }
    }
    return events;
  }

  /** Reloads any living bot that has run dry. */
  maintainAmmo(nowMs: number): void {
    for (const bots of this.botsByMap.values()) {
      for (const bot of bots) {
        if (this.arena.isAlive(bot.id) && (this.arena.getAmmo(bot.id) ?? 1) <= 0) {
          this.arena.reload(bot.id, nowMs);
        }
      }
    }
  }

  /** Map a bot belongs to, or null. */
  mapOf(id: string): string | null {
    for (const [mapId, bots] of this.botsByMap) {
      if (bots.some((b) => b.id === id)) {
        return mapId;
      }
    }
    return null;
  }

  /** Spawn position for arena respawns; undefined for non-bots. */
  spawnFor(id: string): [number, number, number] | undefined {
    const bot = this.findBot(id);
    return bot ? toTuple(bot.spawn) : undefined;
  }

  /** Repositions a bot's controller after the arena respawns it. */
  onRespawn(id: string, position: [number, number, number]): void {
    const bot = this.findBot(id);
    if (bot) {
      bot.controller.respawn(new Vector3(position[0], position[1], position[2]), bot.yawDeg);
      bot.targetMemory.clear();
    }
  }

  /** Clears stale last-seen and reaction state when a human leaves or re-enters play. */
  resetTargeting(mapId: string): void {
    for (const bot of this.botsByMap.get(mapId) ?? []) {
      bot.targetMemory.clear();
      bot.controller.resetEngagement();
    }
  }

  /** Applies recoil-settle timing only after the arena accepts the bot shot. */
  onShotFired(id: string): void {
    this.findBot(id)?.controller.onShotFired();
  }

  private ensureBots(mapId: string): void {
    if (this.botsByMap.has(mapId)) {
      return;
    }
    const world = this.worlds.get(mapId);
    if (!world) {
      return;
    }
    const bots: Bot[] = [];
    for (let i = 0; i < this.botsPerMap; i += 1) {
      const id = `bot:${this.nextBotSeq++}`;
      const model: BotModel = i % 2 === 0 ? 'terrorist' : 'counterterrorist';
      const name = `${BOT_NAMES[i % BOT_NAMES.length]} (bot)`;
      const candidate = computeBotSpawnCandidate(
        world.spawn.position,
        world.spawn.yawDeg,
        i,
        this.botsPerMap,
      );
      const spawn = groundBotSpawn(world.world, candidate);
      const yawDeg =
        (Math.atan2(
          -(world.spawn.position.x - spawn.x),
          -(world.spawn.position.z - spawn.z),
        ) * 180) / Math.PI;
      const controller = new BotController(spawn, yawDeg);
      this.arena.addPlayer(id, mapId, 'deagle');
      this.arena.setPosition(id, toTuple(spawn), mapId);
      this.arena.protectSpawn(id, Date.now());
      bots.push({
        id,
        mapId,
        name,
        model,
        controller,
        targetMemory: new BotTargetMemory(),
        spawn: spawn.clone(),
        yawDeg,
      });
    }
    this.botsByMap.set(mapId, bots);
  }

  private findBot(id: string): Bot | null {
    for (const bots of this.botsByMap.values()) {
      const found = bots.find((b) => b.id === id);
      if (found) {
        return found;
      }
    }
    return null;
  }
}

function toTuple(v: Vector3): [number, number, number] {
  return [v.x, v.y, v.z];
}
