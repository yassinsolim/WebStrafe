import { describe, expect, it } from 'vitest';
import { CROUCH_HEIGHT, STAND_HEIGHT } from '../src/movement/hull';
import { sleep, SPAWN_PROTECTION_MS, TestClient, useWsServer } from './wsTestHarness';

// the websocket server sizes hit capsules from the crouch each client reports:
// 72 u standing, 54 u crouched, same as the movement hull

useWsServer();

describe('websocket server hit capsules', () => {
  it('misses a crouched player above 54 u and hits a standing one up to the top of a 72 u head', async () => {
    const shooter = await TestClient.open();
    await shooter.enter('hull_ws_a', [0, 0, 0], 0);
    shooter.send({ type: 'equip', weaponId: 'deagle' });

    // a fresh target 8 m ahead for every shot (a headshot kills)
    const lands = async (height: number, duck: number): Promise<boolean> => {
      const target = await TestClient.open();
      try {
        await target.enter('hull_ws_a', [0, 0, -8], 0);
        // a sample in the same millisecond as the join's first one is dropped
        await sleep(20);
        target.stand([0, 0, -8], 0, duck);
        await sleep(SPAWN_PROTECTION_MS + 100);
        shooter.clear();
        shooter.send({ type: 'fire', origin: [0, height, 0], dir: [0, 0, -1], t: Date.now() });
        const shot = await shooter.waitFor((m) => m.type === 'shot');
        return shot.result !== 'miss';
      } finally {
        target.close();
        await sleep(100);
      }
    };

    try {
      expect(await lands(1.5, 1)).toBe(false);
      expect(await lands(CROUCH_HEIGHT - 0.05, 1)).toBe(true);
      expect(await lands(1.5, 0)).toBe(true);
      expect(await lands(STAND_HEIGHT - 0.03, 0)).toBe(true);
      expect(await lands(STAND_HEIGHT + 0.05, 0)).toBe(false);
    } finally {
      shooter.close();
    }
  }, 30000);
});
