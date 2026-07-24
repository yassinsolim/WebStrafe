import { Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { CombatArena } from '../src/combat/CombatArena';
import { BOT_FORWARD_DISTANCE } from '../src/combat/BotSpawn';
import {
  BotManager,
  computeBotSpawnCandidate,
  type BotTarget,
} from './BotManager';

describe('computeBotSpawnCandidate', () => {
  it('places bots ahead of and spread across a yaw-zero player view', () => {
    const spawn = new Vector3(0, 4, 16);
    const left = computeBotSpawnCandidate(spawn, 0, 0, 2);
    const right = computeBotSpawnCandidate(spawn, 0, 1, 2);

    expect(left.z).toBeCloseTo(spawn.z - BOT_FORWARD_DISTANCE, 6);
    expect(right.z).toBeCloseTo(spawn.z - BOT_FORWARD_DISTANCE - 2, 6);
    expect(left.x).toBeLessThan(0);
    expect(right.x).toBeGreaterThan(0);
    expect(left.distanceTo(spawn)).toBeGreaterThan(11);
  });

  describe('BotManager engagement staging', () => {
    it('populates for an empty target list, holds, then naturally fires', async () => {
      const random = vi.spyOn(Math, 'random').mockReturnValue(0.25);
      try {
        const arena = new CombatArena();
        const manager = new BotManager(arena, 1);
        const mapId = 'movement_test_scene';
        const targets = new Map<string, BotTarget[]>([[mapId, []]]);
        manager.requestMap(mapId);

        await vi.waitFor(() => {
          manager.tick(1 / 60, targets);
          expect(manager.snapshotRows(mapId)).toHaveLength(1);
        });
        const staged = manager.snapshotRows(mapId)[0];
        expect(staged.position[2]).toBeCloseTo(44.5, 2);
        expect(manager.collectFireEvents()).toHaveLength(0);

        targets.set(mapId, [{
          id: 'human',
          feet: new Vector3(0, 0.04, 56),
          alive: true,
        }]);
        for (let frame = 0; frame < 50; frame += 1) {
          manager.tick(1 / 60, targets);
          expect(manager.collectFireEvents()).toHaveLength(0);
        }
        const held = manager.snapshotRows(mapId)[0];
        expect(held.position[0]).toBeCloseTo(staged.position[0], 3);
        expect(held.position[2]).toBeCloseTo(staged.position[2], 3);

        let shot = false;
        for (let frame = 0; frame < 180 && !shot; frame += 1) {
          manager.tick(1 / 60, targets);
          shot = manager.collectFireEvents().length > 0;
        }
        expect(shot).toBe(true);
      } finally {
        random.mockRestore();
      }
    });
  });

  it('rotates the forward staging area with player yaw', () => {
    const spawn = new Vector3(10, 2, 20);
    const candidate = computeBotSpawnCandidate(spawn, 90, 0, 1);

    expect(candidate.x).toBeLessThan(-1);
    expect(candidate.z).toBeCloseTo(20, 6);
    expect(candidate.y).toBe(2);
  });
});
