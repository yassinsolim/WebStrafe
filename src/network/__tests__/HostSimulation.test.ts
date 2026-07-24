import { describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { CollisionWorld } from '../../world/CollisionWorld';
import { createMovementTestScene } from '../../movement/MovementTestScene';
import { HostSimulation, type HostEmitter } from '../HostSimulation';
import { SPAWN_PROTECTION_MS } from '../../combat/CombatArena';

function makeWorld(): CollisionWorld {
  const { root } = createMovementTestScene();
  const world = new CollisionWorld();
  world.setCollisionFromRoot(root);
  return world;
}

function makeSpawn() {
  return { position: new Vector3(0, 0.04, 56), yawDeg: 0 };
}

function makeEmitter() {
  return {
    hit: vi.fn(),
    death: vi.fn(),
    health: vi.fn(),
    respawn: vi.fn(),
    shot: vi.fn(),
  } satisfies HostEmitter;
}

function normalize(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  return [d[0] / len, d[1] / len, d[2] / len];
}

describe('HostSimulation', () => {
  it('spawns the requested number of bots that appear in the rows', () => {
    const sim = new HostSimulation(makeWorld(), makeSpawn(), 2, makeEmitter());
    const rows = sim.tick(16);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.id.startsWith('bot:'))).toBe(true);
    expect(rows.every((r) => r.alive && r.health === 100)).toBe(true);
  });

  it('uses the same forward training lane staging as the dedicated authority', () => {
    const { spawn } = createMovementTestScene();
    const sim = new HostSimulation(
      makeWorld(),
      { position: spawn, yawDeg: 0 },
      1,
      makeEmitter(),
    );
    const bot = sim.tick(16)[0];
    expect(bot.position[0]).toBeCloseTo(0, 3);
    expect(bot.position[2]).toBeCloseTo(44.5, 3);
    const world = makeWorld();
    expect(world.segmentIntersectsGeometry(
      spawn.clone().add(new Vector3(0, 1.6, 0)),
      new Vector3(...bot.position).add(new Vector3(0, 1.2, 0)),
    )).toBe(false);
  });

  it('resolves a human gun shot that hits a bot (delegates hit + health)', () => {
    vi.useFakeTimers();
    try {
      const emit = makeEmitter();
      const sim = new HostSimulation(makeWorld(), makeSpawn(), 1, emit);
      const bot = sim.tick(16)[0];

      // Register a human with a gun and fire straight at the bot's upper body.
      sim.syncHumans([{ id: 'h1', name: 'H', model: 'terrorist', combatReady: true, position: [bot.position[0], bot.position[1], bot.position[2] + 30] }]);
      sim.applyEquip('h1', 'deagle');

      // Wait out the bot's spawn protection so the shot can land.
      vi.advanceTimersByTime(SPAWN_PROTECTION_MS + 100);

      const origin: [number, number, number] = [bot.position[0], bot.position[1] + 1.6, bot.position[2] + 30];
      const aim: [number, number, number] = [bot.position[0], bot.position[1] + 1.2, bot.position[2]];
      sim.applyFire('h1', origin, normalize(origin, aim));

      expect(emit.shot).toHaveBeenCalledWith(
        expect.objectContaining({ sequence: 1, result: 'hit', playerId: 'h1' }),
      );
      expect(emit.hit).toHaveBeenCalled();
      expect(emit.hit.mock.calls[0][0].targetId).toBe('bot:0');
      expect(emit.health).toHaveBeenCalled();
      const health = emit.health.mock.calls.find((c) => c[0].playerId === 'bot:0');
      expect(health?.[0].health).toBeLessThan(100);
    } finally {
      vi.useRealTimers();
    }
  });


  it('labels accepted miss, hit, and kill shots in authority order', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1000);
      const emit = makeEmitter();
      const sim = new HostSimulation(
        makeWorld(),
        makeSpawn(),
        1,
        emit,
      );
      const bot = sim.tick(16)[0];
      const humanPosition: [number, number, number] = [
        bot.position[0],
        bot.position[1],
        bot.position[2] + 30,
      ];
      sim.syncHumans([{
        id: 'h1',
        name: 'H',
        model: 'terrorist',
        combatReady: true,
        position: humanPosition,
      }]);
      sim.applyEquip('h1', 'deagle');
      vi.advanceTimersByTime(SPAWN_PROTECTION_MS + 100);
      const origin: [number, number, number] = [
        bot.position[0],
        bot.position[1] + 1.6,
        bot.position[2] + 30,
      ];
      const aim: [number, number, number] = [
        bot.position[0],
        bot.position[1] + 1.2,
        bot.position[2],
      ];

      sim.applyFire('h1', origin, [1, 0, 0]);
      vi.advanceTimersByTime(300);
      sim.applyFire('h1', origin, normalize(origin, aim));
      sim.applyEquip('h1', 'awp');
      vi.advanceTimersByTime(1200);
      sim.applyFire('h1', origin, normalize(origin, aim));

      expect(emit.shot.mock.calls.map(([event]) => event.sequence)).toEqual([1, 2, 3]);
      expect(emit.shot.mock.calls.map(([event]) => event.result)).toEqual([
        'miss',
        'hit',
        'kill',
      ]);
      expect(emit.shot.mock.calls[0][0]).toMatchObject({
        endpoint: expect.any(Array),
        impactNormal: expect.any(Array),
      });
      expect(emit.death).toHaveBeenCalledWith(
        expect.objectContaining({ victimId: 'bot:0', killerId: 'h1' }),
      );
      const killShotOrder = emit.shot.mock.invocationCallOrder[2];
      expect(killShotOrder).toBeLessThan(emit.death.mock.invocationCallOrder[0]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits a warning miss before natural nonfatal damage', () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, 'random');
    // Box-Muller pairs whose second value is 0.25 yield zero aim wander, making the
    // decision-path test deterministic without bypassing BotController.
    random.mockReturnValue(0.25);
    try {
      vi.setSystemTime(1000);
      const emit = makeEmitter();
      const sim = new HostSimulation(
        makeWorld(),
        makeSpawn(),
        1,
        emit,
      );
      const staged = sim.tick(16)[0];
      sim.syncHumans([
        { id: 'human', name: 'H', model: 'terrorist', combatReady: true, position: [0, 0, 52] },
      ]);
      // Let both combatants' real spawn protection expire before the natural
      // acquisition/reaction path begins.
      vi.advanceTimersByTime(SPAWN_PROTECTION_MS + 100);

      let held = staged;
      for (let index = 0; index < 50; index += 1) {
        vi.advanceTimersByTime(16);
        held = sim.tick(16)[0];
      }
      expect(emit.shot).not.toHaveBeenCalled();
      expect(held.position[0]).toBeCloseTo(staged.position[0], 3);
      expect(held.position[2]).toBeCloseTo(staged.position[2], 3);

      for (let index = 0; index < 600 && emit.shot.mock.calls.length === 0; index += 1) {
        vi.advanceTimersByTime(16);
        sim.tick(16);
      }

      expect(emit.shot).toHaveBeenCalled();
      const warning = emit.shot.mock.calls[0][0];
      expect(warning.sequence).toBe(1);
      expect(warning.result).toBe('miss');
      expect(warning.playerId).toBe('bot:0');
      expect(warning.weaponId).toBe('deagle');
      expect(warning.origin.every(Number.isFinite)).toBe(true);
      expect(warning.dir.every(Number.isFinite)).toBe(true);
      expect(warning.endpoint?.every(Number.isFinite)).toBe(true);
      expect(warning.impactNormal?.every(Number.isFinite)).toBe(true);
      expect(emit.health).not.toHaveBeenCalled();

      for (let index = 0; index < 600 && emit.shot.mock.calls.length < 2; index += 1) {
        vi.advanceTimersByTime(16);
        sim.tick(16);
      }
      const nonfatal = emit.shot.mock.calls[1][0];
      expect(nonfatal.sequence).toBe(2);
      expect(nonfatal.result).toBe('hit');
      expect(emit.health).toHaveBeenCalledWith(
        expect.objectContaining({ playerId: 'human', alive: true }),
      );
      expect(emit.shot.mock.invocationCallOrder[1]).toBeLessThan(
        emit.health.mock.invocationCallOrder[0],
      );
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });


  it('requires a fresh reaction window after a player resumes active combat', () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.25);
    try {
      vi.setSystemTime(1000);
      const emit = makeEmitter();
      const sim = new HostSimulation(
        makeWorld(),
        makeSpawn(),
        1,
        emit,
      );
      const inactive = {
        id: 'human',
        name: 'H',
        model: 'terrorist' as const,
        combatReady: false,
        position: [0, 0, 52] as [number, number, number],
      };
      sim.syncHumans([inactive]);
      vi.advanceTimersByTime(2100);
      for (let index = 0; index < 240; index += 1) {
        vi.advanceTimersByTime(16);
        sim.tick(16);
      }
      expect(emit.shot).not.toHaveBeenCalled();

      sim.syncHumans([{ ...inactive, combatReady: true }]);
      vi.advanceTimersByTime(SPAWN_PROTECTION_MS);
      for (let index = 0; index < 70; index += 1) {
        vi.advanceTimersByTime(16);
        sim.tick(16);
      }
      expect(emit.shot).not.toHaveBeenCalled();
      for (let index = 0; index < 180 && emit.shot.mock.calls.length === 0; index += 1) {
        vi.advanceTimersByTime(16);
        sim.tick(16);
      }
      expect(emit.shot).toHaveBeenCalled();

      emit.shot.mockClear();
      sim.syncHumans([inactive]);
      sim.syncHumans([{ ...inactive, combatReady: true }]);
      for (let index = 0; index < 70; index += 1) {
        vi.advanceTimersByTime(16);
        sim.tick(16);
      }
      expect(emit.shot).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  it('resets bot reaction and trigger state across a human death and respawn', () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.25);
    try {
      vi.setSystemTime(1000);
      const emit = makeEmitter();
      const sim = new HostSimulation(
        makeWorld(),
        makeSpawn(),
        1,
        emit,
      );
      sim.syncHumans([{
        id: 'human',
        name: 'H',
        model: 'terrorist',
        combatReady: true,
        position: [0, 0, 52],
      }]);
      vi.advanceTimersByTime(SPAWN_PROTECTION_MS + 100);

      for (let index = 0; index < 800 && emit.death.mock.calls.length === 0; index += 1) {
        vi.advanceTimersByTime(16);
        sim.tick(16);
      }
      expect(emit.death).toHaveBeenCalledWith(
        expect.objectContaining({ victimId: 'human', killerId: 'bot:0' }),
      );

      emit.shot.mockClear();
      for (let index = 0; index < 240 && emit.respawn.mock.calls.length === 0; index += 1) {
        vi.advanceTimersByTime(16);
        sim.tick(16);
      }
      expect(emit.respawn).toHaveBeenCalledWith(
        expect.objectContaining({ playerId: 'human' }),
      );
      for (let index = 0; index < 70; index += 1) {
        vi.advanceTimersByTime(16);
        sim.tick(16);
      }
      expect(emit.shot).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  it('waits for the player to see the bot before beginning its reaction window', () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.25);
    try {
      vi.setSystemTime(1000);
      const emit = makeEmitter();
      const sim = new HostSimulation(
        makeWorld(),
        makeSpawn(),
        1,
        emit,
      );
      const bot = sim.tick(16)[0];
      const human = {
        id: 'human',
        name: 'H',
        model: 'terrorist' as const,
        combatReady: true,
        position: [0, 0, 52] as [number, number, number],
        yaw: Math.PI,
        pitch: 0,
      };
      sim.syncHumans([human]);
      vi.advanceTimersByTime(SPAWN_PROTECTION_MS + 100);
      for (let index = 0; index < 240; index += 1) {
        vi.advanceTimersByTime(16);
        sim.tick(16);
      }
      expect(emit.shot).not.toHaveBeenCalled();

      const dx = bot.position[0] - human.position[0];
      const dz = bot.position[2] - human.position[2];
      sim.syncHumans([{ ...human, yaw: Math.atan2(-dx, -dz) }]);
      for (let index = 0; index < 70; index += 1) {
        vi.advanceTimersByTime(16);
        sim.tick(16);
      }
      expect(emit.shot).not.toHaveBeenCalled();
      for (let index = 0; index < 180 && emit.shot.mock.calls.length === 0; index += 1) {
        vi.advanceTimersByTime(16);
        sim.tick(16);
      }
      expect(emit.shot).toHaveBeenCalled();
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  it('drops a human from the arena when they leave', () => {
    const sim = new HostSimulation(makeWorld(), makeSpawn(), 1, makeEmitter());
    sim.syncHumans([{ id: 'h1', name: 'H', model: 'terrorist', combatReady: true, position: [0, 6, 5] }]);
    sim.syncHumans([]); // h1 left
    // Firing as the departed human must not throw or emit.
    expect(() => sim.applyFire('h1', [0, 1, 0], [0, 0, -1])).not.toThrow();
  });

  it('dispose clears bots (rows become empty)', () => {
    const sim = new HostSimulation(makeWorld(), makeSpawn(), 2, makeEmitter());
    expect(sim.tick(16)).toHaveLength(2);
    sim.dispose();
    expect(sim.tick(16)).toHaveLength(0);
  });
});
