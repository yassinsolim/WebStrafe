import { describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { CollisionWorld } from '../../world/CollisionWorld';
import { createMovementTestScene } from '../../movement/MovementTestScene';
import { HostSimulation, type HostEmitter } from '../HostSimulation';

function makeWorld(): CollisionWorld {
  const { root } = createMovementTestScene();
  const world = new CollisionWorld();
  world.setCollisionFromRoot(root);
  return world;
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
    const sim = new HostSimulation(makeWorld(), { position: new Vector3(0, 6, 0), yawDeg: 0 }, 2, makeEmitter());
    const rows = sim.tick(16);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.id.startsWith('bot:'))).toBe(true);
    expect(rows.every((r) => r.alive && r.health === 100)).toBe(true);
  });

  it('resolves a human gun shot that hits a bot (delegates hit + health)', () => {
    const emit = makeEmitter();
    const sim = new HostSimulation(makeWorld(), { position: new Vector3(0, 6, 0), yawDeg: 0 }, 1, emit);
    const bot = sim.tick(16)[0];

    // Register a human with a gun and fire straight at the bot's upper body.
    sim.syncHumans([{ id: 'h1', name: 'H', model: 'terrorist', position: [bot.position[0], bot.position[1], bot.position[2] + 30] }]);
    sim.applyEquip('h1', 'deagle');

    const origin: [number, number, number] = [bot.position[0], bot.position[1] + 1.6, bot.position[2] + 30];
    const aim: [number, number, number] = [bot.position[0], bot.position[1] + 1.2, bot.position[2]];
    sim.applyFire('h1', origin, normalize(origin, aim));

    expect(emit.hit).toHaveBeenCalled();
    expect(emit.hit.mock.calls[0][0].targetId).toBe('bot:0');
    expect(emit.health).toHaveBeenCalled();
    const health = emit.health.mock.calls.find((c) => c[0].playerId === 'bot:0');
    expect(health?.[0].health).toBeLessThan(100);
  });

  it('drops a human from the arena when they leave', () => {
    const sim = new HostSimulation(makeWorld(), { position: new Vector3(0, 6, 0), yawDeg: 0 }, 1, makeEmitter());
    sim.syncHumans([{ id: 'h1', name: 'H', model: 'terrorist', position: [0, 6, 5] }]);
    sim.syncHumans([]); // h1 left
    // Firing as the departed human must not throw or emit.
    expect(() => sim.applyFire('h1', [0, 1, 0], [0, 0, -1])).not.toThrow();
  });

  it('dispose clears bots (rows become empty)', () => {
    const sim = new HostSimulation(makeWorld(), { position: new Vector3(0, 6, 0), yawDeg: 0 }, 2, makeEmitter());
    expect(sim.tick(16)).toHaveLength(2);
    sim.dispose();
    expect(sim.tick(16)).toHaveLength(0);
  });
});
