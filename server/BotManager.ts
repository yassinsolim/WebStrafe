import { Vector3 } from 'three';
import { BotController } from '../src/combat/BotController';
import type { CombatArena } from '../src/combat/CombatArena';
import { loadHeadlessMap, type HeadlessMap } from './mapCollision';

export type BotModel = 'terrorist' | 'counterterrorist';

export interface BotTarget {
  feet: Vector3;
  alive: boolean;
}

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
  private readonly botsByMap = new Map<string, Bot[]>();
  private nextBotSeq = 0;

  constructor(
    private readonly arena: CombatArena,
    private readonly botsPerMap: number,
  ) {}

  /** Ensures collision for a map is loading/loaded so bots can populate it. */
  requestMap(mapId: string): void {
    if (this.worlds.has(mapId) || this.loading.has(mapId)) {
      return;
    }
    this.loading.add(mapId);
    void loadHeadlessMap(mapId).then((map) => {
      this.loading.delete(mapId);
      if (map) {
        this.worlds.set(mapId, map);
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
   * (humans and other bots) per map; each bot chases the nearest living one.
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
        const targetFeet = nearestLivingTarget(bot.controller.getFeet(), targets);
        bot.controller.tick(dt, world.world, { targetFeet });
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
    const world = this.findWorldForBot(id);
    return world ? toTuple(world.spawn.position) : undefined;
  }

  /** Repositions a bot's controller after the arena respawns it. */
  onRespawn(id: string, position: [number, number, number]): void {
    const bot = this.findBot(id);
    const world = this.findWorldForBot(id);
    if (bot && world) {
      bot.controller.respawn(new Vector3(position[0], position[1], position[2]), world.spawn.yawDeg);
    }
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
      const spawn = world.spawn.position.clone();
      // Fan bots out slightly so they don't stack on the exact spawn point.
      spawn.x += (i - this.botsPerMap / 2) * 2;
      const controller = new BotController(spawn, world.spawn.yawDeg);
      this.arena.addPlayer(id, mapId, 'knife');
      this.arena.setPosition(id, toTuple(spawn), mapId);
      bots.push({ id, mapId, name, model, controller });
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

  private findWorldForBot(id: string): HeadlessMap | null {
    const mapId = this.mapOf(id);
    return mapId ? this.worlds.get(mapId) ?? null : null;
  }
}

function toTuple(v: Vector3): [number, number, number] {
  return [v.x, v.y, v.z];
}

function nearestLivingTarget(from: Vector3, targets: BotTarget[]): Vector3 | null {
  let best: Vector3 | null = null;
  let bestDist = Infinity;
  for (const t of targets) {
    if (!t.alive) {
      continue;
    }
    const d = (t.feet.x - from.x) ** 2 + (t.feet.z - from.z) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = t.feet;
    }
  }
  return best;
}
