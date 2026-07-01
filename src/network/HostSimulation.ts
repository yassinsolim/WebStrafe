import { Vector3 } from 'three';
import { BotController } from '../combat/BotController';
import { CombatArena } from '../combat/CombatArena';
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
  shot(event: ShotEvent, weaponId: string): void;
}

const MAP_ID = 'host';
const BOT_NAMES = ['Ada', 'Byte', 'Cypher', 'Delta', 'Echo', 'Flux', 'Ghost', 'Hex'];

interface Bot {
  id: string;
  name: string;
  model: PlayerModel;
  controller: BotController;
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
      const pos = spawn.position.clone();
      pos.x += (i - botCount / 2) * 2;
      const controller = new BotController(pos, spawn.yawDeg);
      this.arena.addPlayer(id, MAP_ID, 'deagle');
      this.arena.setPosition(id, tuple(pos), MAP_ID);
      this.bots.push({ id, name, model, controller });
    }
  }

  /** Registers/updates the human roster in the arena from the latest snapshot. */
  syncHumans(humans: HostHuman[]): void {
    const present = new Set<string>();
    for (const h of humans) {
      present.add(h.id);
      if (!this.humanPositions.has(h.id)) {
        this.arena.addPlayer(h.id, MAP_ID, 'knife');
      }
      this.arena.setPosition(h.id, h.position, MAP_ID);
      this.humanPositions.set(h.id, new Vector3(h.position[0], h.position[1], h.position[2]));
    }
    for (const id of [...this.humanPositions.keys()]) {
      if (!present.has(id)) {
        this.arena.removePlayer(id);
        this.humanPositions.delete(id);
      }
    }
  }

  applyEquip(id: string, weaponId: string): void {
    if (weaponId === 'awp' || weaponId === 'deagle' || weaponId === 'knife') {
      this.arena.equip(id, weaponId);
    }
  }

  applyReload(id: string): void {
    this.arena.reload(id, Date.now());
  }

  /** Resolves a fire from a human (or the host itself) and emits the outcome. */
  applyFire(shooterId: string, origin: [number, number, number], dir: [number, number, number]): void {
    const now = Date.now();
    const outcome = this.arena.handleFire(shooterId, origin, dir, now);
    if (outcome.fired) {
      const weaponId = this.arena.getActiveWeapon(shooterId);
      if (weaponId && weaponId !== 'knife') {
        this.emit.shot({ playerId: shooterId, origin, dir, weaponId }, weaponId);
      }
    }
    this.emitOutcome(outcome);
  }

  /** Advances bots (movement + combat) and returns the current bot rows. */
  tick(dtMs: number): HostBotRow[] {
    const now = Date.now();
    const dt = dtMs / 1000;

    const targets = this.livingHumanPositions();
    for (const bot of this.bots) {
      if (!this.arena.isAlive(bot.id)) {
        this.arena.setPosition(bot.id, tuple(bot.controller.getFeet()), MAP_ID);
        continue;
      }
      const targetFeet = nearest(bot.controller.getFeet(), targets);
      bot.controller.tick(dt, this.world, { targetFeet });
      this.arena.setPosition(bot.id, tuple(bot.controller.getFeet()), MAP_ID);

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
  }

  private emitOutcome(outcome: ReturnType<CombatArena['handleFire']>): void {
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
      bot.controller.respawn(new Vector3(position[0], position[1], position[2]), this.spawn.yawDeg);
    }
    this.emit.respawn({ playerId: id, position });
    this.emit.health({ playerId: id, health: this.arena.getHealth(id) ?? 100, alive: true });
  }

  private spawnFor(_id: string): [number, number, number] {
    return tuple(this.spawn.position);
  }

  private livingHumanPositions(): Vector3[] {
    const out: Vector3[] = [];
    for (const [id, pos] of this.humanPositions) {
      if (this.arena.isAlive(id)) {
        out.push(pos);
      }
    }
    return out;
  }
}

function tuple(v: Vector3): [number, number, number] {
  return [v.x, v.y, v.z];
}

function nearest(from: Vector3, targets: Vector3[]): Vector3 | null {
  let best: Vector3 | null = null;
  let bestDist = Infinity;
  for (const t of targets) {
    const d = (t.x - from.x) ** 2 + (t.z - from.z) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = t;
    }
  }
  return best;
}
