import { describe, expect, it } from 'vitest';
import {
  TakeoffTracker,
  formatSignedUnits,
  normalizeStrafeStats,
  speedTrend,
  toStrafeStatsView,
  toUnitsPerSecond,
} from '../hud/speedometerLogic';

describe('toUnitsPerSecond', () => {
  it('converts metres to hammer units and rounds', () => {
    expect(toUnitsPerSecond(6.35)).toBe(250);
    expect(toUnitsPerSecond(9.5)).toBe(374);
    expect(toUnitsPerSecond(0)).toBe(0);
    expect(toUnitsPerSecond(-3)).toBe(0);
    expect(toUnitsPerSecond(Number.NaN)).toBe(0);
  });
});

describe('speedTrend', () => {
  it('is green above the last takeoff and red below', () => {
    expect(speedTrend(320, 300)).toBe('gain');
    expect(speedTrend(280, 300)).toBe('loss');
  });

  it('stays neutral without a takeoff or inside the tolerance', () => {
    expect(speedTrend(320, null)).toBe('neutral');
    expect(speedTrend(301, 300)).toBe('neutral');
    expect(speedTrend(299, 300)).toBe('neutral');
    expect(speedTrend(310, 300, 15)).toBe('neutral');
  });
});

describe('strafe stats input', () => {
  it('reads the documented shape', () => {
    expect(normalizeStrafeStats({ takeoffSpeed: 8, gain: 0.5, syncPercent: 87.4, jumpCount: 4 })).toEqual({
      takeoffSpeed: 8,
      gain: 0.5,
      syncPercent: 87.4,
      jumpCount: 4,
    });
  });

  it('tolerates alternative names and a 0..1 sync fraction', () => {
    expect(normalizeStrafeStats({ lastTakeoffSpeed: 7, speedGain: -0.2, sync: 0.9, jumps: 2 })).toEqual({
      takeoffSpeed: 7,
      gain: -0.2,
      syncPercent: 90,
      jumpCount: 2,
    });
  });

  it('rejects inputs without a usable takeoff speed', () => {
    expect(normalizeStrafeStats(null)).toBeNull();
    expect(normalizeStrafeStats({ gain: 1 })).toBeNull();
    expect(normalizeStrafeStats({ takeoffSpeed: Number.NaN })).toBeNull();
  });

  it('converts to display units', () => {
    expect(toStrafeStatsView({ takeoffSpeed: 7.62, gain: 0.254, syncPercent: 71.6, jumpCount: 3 })).toEqual({
      takeoffUps: 300,
      gainUps: 10,
      syncPercent: 72,
      jumpCount: 3,
    });
    expect(toStrafeStatsView({ takeoffSpeed: 7.62 })).toMatchObject({ gainUps: null, syncPercent: null, jumpCount: null });
  });

  it('formats signed gains', () => {
    expect(formatSignedUnits(12.4)).toBe('+12');
    expect(formatSignedUnits(-8.6)).toBe('-9');
    expect(formatSignedUnits(0.2)).toBe('0');
  });
});

describe('TakeoffTracker', () => {
  it('tracks takeoff speed and gain across a jump chain', () => {
    const tracker = new TakeoffTracker();
    expect(tracker.getStats()).toBeNull();
    tracker.onJump(7);
    expect(tracker.getStats()).toEqual({ takeoffSpeed: 7, gain: null, syncPercent: null, jumpCount: 1 });
    tracker.update(false, 0.6);
    tracker.onJump(7.5);
    expect(tracker.getStats()).toMatchObject({ takeoffSpeed: 7.5, gain: 0.5, jumpCount: 2 });
  });

  it('keeps the chain through a one tick ground touch and ends it after standing', () => {
    const tracker = new TakeoffTracker(0.45);
    tracker.onJump(8);
    tracker.update(true, 0.02);
    expect(tracker.getTakeoffSpeed()).toBe(8);
    tracker.update(true, 0.5);
    expect(tracker.getTakeoffSpeed()).toBeNull();
    expect(tracker.getStats()).toBeNull();
  });
});
