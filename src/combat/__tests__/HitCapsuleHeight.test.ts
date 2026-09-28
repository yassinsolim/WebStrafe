import { describe, expect, it } from 'vitest';
import { CombatArena, PLAYER_CAPSULE_HEIGHT } from '../CombatArena';
import { MovementController } from '../../movement/MovementController';
import { CROUCH_HEIGHT, STAND_EYE_HEIGHT, STAND_HEIGHT } from '../../movement/hull';

// the hosts' hit capsules have to be as tall as the player the movement hull
// makes: 72 u (1.83 m) standing, 54 u (1.37 m) crouched

function arena(duck?: number): CombatArena {
  const a = new CombatArena({ spawnProtectionMs: 0 });
  a.addPlayer('shooter', 'map1', 'deagle');
  a.addPlayer('target', 'map1', 'deagle');
  a.setPosition('shooter', [0, 0, 0], 'map1', 1000);
  a.setPosition('target', [0, 0, -10], 'map1', 1000, [0, 0, 0], 0, duck);
  return a;
}

/** a level shot at `height` above the target's feet */
const shotAt = (a: CombatArena, height: number, nowMs = 2000) =>
  a.handleFire('shooter', [0, height, 0], [0, 0, -1], nowMs);

describe('hit capsule height', () => {
  it('matches the movement hull', () => {
    const movement = new MovementController();
    expect(PLAYER_CAPSULE_HEIGHT).toBeCloseTo(movement.capsule.height, 6);
    expect(PLAYER_CAPSULE_HEIGHT).toBeCloseTo(1.8288, 4);
    expect(movement.eyeHeight).toBeCloseTo(STAND_EYE_HEIGHT, 6);
  });

  it('a shot skimming the top of a standing head lands (the old 1.76 m capsule missed it)', () => {
    const hit = shotAt(arena(), 1.8).hit;
    expect(hit?.targetId).toBe('target');
    expect(hit?.hitbox).toBe('head');
    expect(shotAt(arena(), STAND_HEIGHT + 0.02).hit).toBeFalsy();
  });

  it('a crouched player is 54 u tall', () => {
    expect(shotAt(arena(1), 1.5).hit).toBeFalsy();
    const low = shotAt(arena(1), CROUCH_HEIGHT - 0.03).hit;
    expect(low?.targetId).toBe('target');
    expect(low?.hitbox).toBe('head');
    // standing again at the next sample
    const a = arena(1);
    a.setPosition('target', [0, 0, -10], 'map1', 1500, [0, 0, 0], 0, 0);
    expect(shotAt(a, 1.5).hit?.targetId).toBe('target');
  });

  it('lag compensation uses the crouch the shooter saw', () => {
    const a = arena(0);
    a.setPosition('target', [0, 0, -10], 'map1', 1500, [0, 0, 0], 0, 1);
    // on the shooter's screen the target was still standing at 1200
    const out = a.handleFire('shooter', [0, 1.5, 0], [0, 0, -1], 1600, undefined, undefined, { targetTimes: { target: 1200 } });
    expect(out.hit?.targetId).toBe('target');
    const now = a.handleFire('shooter', [0, 1.5, 0], [0, 0, -1], 3000, undefined, undefined, { targetTimes: { target: 1550 } });
    expect(now.hit).toBeFalsy();
  });
});
