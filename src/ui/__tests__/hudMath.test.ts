import { describe, expect, it } from 'vitest';
import { FrameStats, damageDirection, formatRunTime, lowHealthIntensity } from '../hud/hudMath';

describe('damageDirection', () => {
  // yaw 0 looks down -z, so +x is to the right
  it('is zero straight ahead, positive to the right, pi behind', () => {
    expect(damageDirection([0, 0, 0], 0, [0, 0, -10])).toBeCloseTo(0);
    expect(damageDirection([0, 0, 0], 0, [10, 0, 0])).toBeCloseTo(Math.PI / 2);
    expect(damageDirection([0, 0, 0], 0, [-10, 0, 0])).toBeCloseTo(-Math.PI / 2);
    expect(Math.abs(damageDirection([0, 0, 0], 0, [0, 0, 10])!)).toBeCloseTo(Math.PI);
  });

  it('turns with the view', () => {
    // turned left by 90 degrees, the old forward is now on the right
    expect(damageDirection({ x: 0, y: 0, z: 0 }, Math.PI / 2, { x: 0, y: 5, z: -10 })).toBeCloseTo(Math.PI / 2);
  });

  it('ignores height and returns null when on top of the player', () => {
    expect(damageDirection([1, 0, 1], 0, [1, 30, 1])).toBeNull();
    expect(damageDirection([0, 0, 0], Number.NaN, [5, 0, 0])).toBeNull();
  });
});

describe('FrameStats', () => {
  it('averages the last second of frames', () => {
    const stats = new FrameStats(1000);
    for (let i = 0; i < 120; i += 1) {
      stats.push(i % 2 === 0 ? 6 : 10, i * 8);
    }
    const { fps, avgMs, maxMs } = stats.get();
    expect(avgMs).toBeCloseTo(8, 0);
    expect(fps).toBeCloseTo(125, -1);
    expect(maxMs).toBe(10);
  });

  it('drops samples outside the window and ignores junk', () => {
    const stats = new FrameStats(100);
    stats.push(50, 0);
    stats.push(Number.NaN, 10);
    stats.push(5, 200);
    expect(stats.get()).toMatchObject({ samples: 1, maxMs: 5 });
    stats.clear();
    expect(stats.get().samples).toBe(0);
  });
});

describe('hud helpers', () => {
  it('fades the low health vignette in under the threshold', () => {
    expect(lowHealthIntensity(100)).toBe(0);
    expect(lowHealthIntensity(35)).toBe(0);
    expect(lowHealthIntensity(0)).toBe(1);
    expect(lowHealthIntensity(10)).toBeGreaterThan(lowHealthIntensity(30));
  });

  it('formats run times', () => {
    expect(formatRunTime(0)).toBe('0.000');
    expect(formatRunTime(12_345)).toBe('12.345');
    expect(formatRunTime(83_007)).toBe('1:23.007');
    expect(formatRunTime(-5)).toBe('0.000');
  });
});
