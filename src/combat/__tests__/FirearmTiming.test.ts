import { describe, expect, it } from 'vitest';
import { FIREARM_TIMINGS, clipPlaybackRate } from '../FirearmTiming';
import { getWeapon } from '../weapons';

describe('firearm animation timing contract', () => {
  it('uses authored reload durations for mechanical refill', () => {
    expect(getWeapon('deagle').reloadMs).toBe(3330);
    expect(getWeapon('awp').reloadMs).toBe(3450);
    expect(getWeapon('deagle').reloadMs).toBe(FIREARM_TIMINGS.deagle.reloadMs);
    expect(getWeapon('awp').reloadMs).toBe(FIREARM_TIMINGS.awp.reloadMs);
  });

  it('finishes each fire action before the next legal retrigger', () => {
    for (const timing of Object.values(FIREARM_TIMINGS)) {
      expect(timing.firePlaybackMs).toBeLessThan(timing.fireIntervalMs);
      expect(timing.fireIntervalMs - timing.firePlaybackMs).toBeGreaterThanOrEqual(35);
    }
  });

  it('computes deterministic playback rates from source clip duration', () => {
    expect(clipPlaybackRate(0.43, 190)).toBeCloseTo(0.43 / 0.19, 8);
    expect(clipPlaybackRate(3.45, 3450)).toBeCloseTo(1, 8);
    expect(() => clipPlaybackRate(0, 190)).toThrow(/source duration/i);
    expect(() => clipPlaybackRate(0.43, 0)).toThrow(/target duration/i);
  });
});
