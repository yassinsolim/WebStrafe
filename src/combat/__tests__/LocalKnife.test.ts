import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { LocalKnife } from '../LocalKnife';
import type { MeleeTarget } from '../MeleeResolver';

const swing = (targets: MeleeTarget[] = [], isBlocked?: () => boolean) => ({
  origin: new Vector3(0, 1.6, 0),
  direction: new Vector3(0, 0, -1),
  targets,
  isBlocked,
});

const victim: MeleeTarget = { id: 'v', feet: new Vector3(0, 0, -1.2), height: 1.76, radius: 0.34 };

describe('LocalKnife', () => {
  it('gates slashes with the cs miss cooldown when nothing is in reach', () => {
    const knife = new LocalKnife();
    expect(knife.tryAttack('primary', 1000, swing())).toMatchObject({ accepted: true, predictedHit: false });
    expect(knife.tryAttack('primary', 1399, swing()).accepted).toBe(false);
    expect(knife.tryAttack('primary', 1400, swing()).accepted).toBe(true);
  });

  it('predicts a hit on a drawn target and waits the longer hit cooldown', () => {
    const knife = new LocalKnife();
    expect(knife.tryAttack('primary', 0, swing([victim]))).toEqual({
      accepted: true,
      predictedHit: true,
      predictedTargetId: 'v',
    });
    expect(knife.canAttack('primary', 499)).toBe(false);
    expect(knife.canAttack('primary', 500)).toBe(true);
  });

  it('does not predict hits through walls', () => {
    const knife = new LocalKnife();
    expect(knife.tryAttack('secondary', 0, swing([victim], () => true)).predictedHit).toBe(false);
    expect(knife.canAttack('secondary', 1000)).toBe(true);
  });

  it('adopts the longer cooldown when the server reports a hit we guessed as a miss', () => {
    const knife = new LocalKnife();
    knife.tryAttack('secondary', 0, swing());
    knife.onServerHit('primary');
    expect(knife.canAttack('secondary', 1000)).toBe(true);
    knife.onServerHit('secondary');
    expect(knife.canAttack('secondary', 1099)).toBe(false);
    expect(knife.canAttack('secondary', 1100)).toBe(true);
  });

  it('clears on reset', () => {
    const knife = new LocalKnife();
    knife.tryAttack('secondary', 0, swing());
    knife.reset();
    expect(knife.canAttack('primary', 1)).toBe(true);
  });
});
