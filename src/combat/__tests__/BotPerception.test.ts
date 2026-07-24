import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { BotTargetMemory, isBotWithinTargetView } from '../BotPerception';

describe('BotTargetMemory', () => {
  it('requires an oriented player to have the bot inside the encounter view', () => {
    const target = {
      id: 'human',
      feet: new Vector3(0, 0, 10),
      alive: true,
      viewYawRad: 0,
      viewPitchRad: 0,
    };

    expect(isBotWithinTargetView(target, new Vector3(0, 0, 0))).toBe(true);
    target.viewYawRad = Math.PI;
    expect(isBotWithinTargetView(target, new Vector3(0, 0, 0))).toBe(false);
  });

  it('uses the encounter gate only for acquisition, not to make an engaged bot inert', () => {
    const memory = new BotTargetMemory();
    const target = { id: 'human', feet: new Vector3(0, 0, -10), alive: true };
    expect(memory.observe({
      observer: new Vector3(),
      yawRad: 0,
      candidates: [target],
      hasLineOfSight: () => true,
      canAcquire: () => false,
    }).targetFeet).toBeNull();

    expect(memory.observe({
      observer: new Vector3(),
      yawRad: 0,
      candidates: [target],
      hasLineOfSight: () => true,
      canAcquire: () => true,
    })).toMatchObject({ targetId: 'human', targetVisible: true });
    expect(memory.observe({
      observer: new Vector3(),
      yawRad: 0,
      candidates: [target],
      hasLineOfSight: () => true,
      canAcquire: () => false,
    })).toMatchObject({ targetId: 'human', targetVisible: true });
  });

  it('acquires only identified targets inside its FOV with clear LOS', () => {
    const memory = new BotTargetMemory();
    const behind = { id: 'behind', feet: new Vector3(0, 0, 10), alive: true };

    expect(memory.observe({
      observer: new Vector3(),
      yawRad: 0,
      candidates: [behind],
      hasLineOfSight: () => true,
    })).toMatchObject({ targetId: null, targetFeet: null, targetVisible: false });

    const throughWall = { id: 'wall', feet: new Vector3(0, 0, -10), alive: true };
    expect(memory.observe({
      observer: new Vector3(),
      yawRad: 0,
      candidates: [throughWall],
      hasLineOfSight: () => false,
    })).toMatchObject({ targetId: null, targetFeet: null, targetVisible: false });
  });

  it('pursues a frozen last-seen point without receiving hidden live positions', () => {
    const memory = new BotTargetMemory();
    const target = { id: 'human', feet: new Vector3(0, 0, -10), alive: true };
    const seen = memory.observe({
      observer: new Vector3(),
      yawRad: 0,
      candidates: [target],
      hasLineOfSight: () => true,
    });
    expect(seen).toMatchObject({ targetId: 'human', targetVisible: true });

    target.feet.set(40, 0, -60);
    const hidden = memory.observe({
      observer: new Vector3(),
      yawRad: 0,
      candidates: [target],
      hasLineOfSight: () => false,
    });
    expect(hidden).toMatchObject({ targetId: 'human', targetVisible: false });
    expect(hidden.targetFeet?.toArray()).toEqual([0, 0, -10]);

    target.alive = false;
    expect(memory.observe({
      observer: new Vector3(),
      yawRad: 0,
      candidates: [target],
      hasLineOfSight: () => true,
    }).targetFeet).toBeNull();
  });

  it('switches identity only for a materially closer visible target', () => {
    const memory = new BotTargetMemory();
    const first = { id: 'first', feet: new Vector3(0, 0, -20), alive: true };
    memory.observe({
      observer: new Vector3(),
      yawRad: 0,
      candidates: [first],
      hasLineOfSight: () => true,
    });
    const next = memory.observe({
      observer: new Vector3(),
      yawRad: 0,
      candidates: [
        first,
        { id: 'closer', feet: new Vector3(0, 0, -8), alive: true },
      ],
      hasLineOfSight: () => true,
    });
    expect(next.targetId).toBe('closer');
  });
});
