import { describe, expect, it } from 'vitest';
import { KnifeController } from '../KnifeController';
import { KNIFE_TIMING_MS } from '../knives';

describe('KnifeController (cs knife timing)', () => {
  it('allows the first attack of either kind and makes the first slash a full hit', () => {
    const knife = new KnifeController();
    expect(knife.canAttack('primary', 0)).toBe(true);
    expect(knife.canAttack('secondary', 0)).toBe(true);
    expect(knife.isFollowUp(0)).toBe(false);
  });

  it('locks slashes for 0.4 s after a miss and 0.5 s after a hit', () => {
    const knife = new KnifeController();
    knife.commit('primary', 1000, false);
    expect(knife.canAttack('primary', 1000 + KNIFE_TIMING_MS.primaryInterval - 1)).toBe(false);
    expect(knife.canAttack('primary', 1000 + KNIFE_TIMING_MS.primaryInterval)).toBe(true);

    knife.commit('primary', 2000, true);
    expect(knife.canAttack('primary', 2000 + 499)).toBe(false);
    expect(knife.canAttack('primary', 2000 + KNIFE_TIMING_MS.primaryIntervalHit)).toBe(true);
  });

  it('locks the stab for 0.5 s after any slash', () => {
    const knife = new KnifeController();
    knife.commit('primary', 0, false);
    expect(knife.canAttack('secondary', 499)).toBe(false);
    expect(knife.canAttack('secondary', 500)).toBe(true);
  });

  it('locks both attacks for 1.0 s after a missed stab and 1.1 s after a hit', () => {
    const knife = new KnifeController();
    knife.commit('secondary', 0, false);
    expect(knife.canAttack('primary', 999)).toBe(false);
    expect(knife.canAttack('secondary', 999)).toBe(false);
    expect(knife.canAttack('primary', 1000)).toBe(true);
    expect(knife.canAttack('secondary', 1000)).toBe(true);

    knife.commit('secondary', 5000, true);
    expect(knife.canAttack('secondary', 6099)).toBe(false);
    expect(knife.canAttack('secondary', 6100)).toBe(true);
  });

  it('treats slashes inside the follow-up window as follow-ups and later ones as fresh', () => {
    const knife = new KnifeController();
    knife.commit('primary', 0, true);
    // cooldown ends at 500, follow-up window runs to 900
    expect(knife.isFollowUp(500)).toBe(true);
    expect(knife.isFollowUp(899)).toBe(true);
    expect(knife.isFollowUp(900)).toBe(false);
  });

  it('forgets everything on reset', () => {
    const knife = new KnifeController();
    knife.commit('secondary', 0, true);
    knife.reset();
    expect(knife.canAttack('primary', 1)).toBe(true);
    expect(knife.isFollowUp(1)).toBe(false);
  });
});
