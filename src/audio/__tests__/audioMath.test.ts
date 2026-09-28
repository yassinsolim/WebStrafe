import { describe, expect, it } from 'vitest';
import {
  airAbsorptionHz,
  distanceGain,
  footstepIntensity,
  footstepInterval,
  landingIntensity,
  mulberry32,
  reverbSendForDistance,
  semitonesToRatio,
  toVec3,
  vary,
  volumeToGain,
} from '../audioMath';

describe('volumeToGain', () => {
  it('maps the slider through a squared taper', () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(1)).toBe(1);
    expect(volumeToGain(0.5)).toBeCloseTo(0.25);
  });

  it('treats junk and out of range values safely', () => {
    expect(volumeToGain(-1)).toBe(0);
    expect(volumeToGain(Number.NaN)).toBe(0);
    expect(volumeToGain(3)).toBe(1);
  });
});

describe('positional helpers', () => {
  it('uses the inverse distance curve past the reference distance', () => {
    expect(distanceGain(0, 10, 1)).toBe(1);
    expect(distanceGain(10, 10, 1)).toBe(1);
    expect(distanceGain(30, 10, 1)).toBeCloseTo(10 / 30);
    expect(distanceGain(30, 10, 0)).toBe(1);
    expect(distanceGain(200, 14, 0.9)).toBeLessThan(distanceGain(50, 14, 0.9));
  });

  it('dulls far sounds and adds room, both bounded', () => {
    expect(airAbsorptionHz(0)).toBe(20000);
    expect(airAbsorptionHz(40)).toBeCloseTo(10000);
    expect(airAbsorptionHz(10_000)).toBe(1800);
    expect(reverbSendForDistance(0)).toBeCloseTo(0.06);
    expect(reverbSendForDistance(1e6)).toBe(0.42);
    expect(reverbSendForDistance(100)).toBeGreaterThan(reverbSendForDistance(10));
  });

  it('accepts tuples and vector-like objects', () => {
    expect(toVec3([1, 2, 3])).toEqual({ x: 1, y: 2, z: 3 });
    expect(toVec3({ x: 4, y: 5, z: 6 })).toEqual({ x: 4, y: 5, z: 6 });
  });
});

describe('movement sound parameters', () => {
  it('steps about every 300 ms at cs run speed and slower when walking', () => {
    expect(footstepInterval(6.35)).toBeCloseTo(0.3, 2);
    expect(footstepInterval(3)).toBeGreaterThan(footstepInterval(6));
    expect(footstepInterval(50)).toBe(0.27);
    expect(footstepInterval(0)).toBe(0.5);
  });

  it('keeps footstep intensity inside 0.25..1', () => {
    expect(footstepIntensity(0)).toBe(0.25);
    expect(footstepIntensity(6.4)).toBe(1);
    expect(footstepIntensity(30)).toBe(1);
  });

  it('scales landings with fall speed', () => {
    expect(landingIntensity(1)).toBe(0);
    expect(landingIntensity(14)).toBe(1);
    expect(landingIntensity(8)).toBeGreaterThan(landingIntensity(5));
    expect(landingIntensity(Number.NaN)).toBe(0);
  });
});

describe('variation helpers', () => {
  it('stays within the requested spread', () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 200; i += 1) {
      const value = vary(100, 0.1, rand);
      expect(value).toBeGreaterThanOrEqual(90);
      expect(value).toBeLessThanOrEqual(110);
    }
  });

  it('is deterministic for a seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('converts semitones to ratios', () => {
    expect(semitonesToRatio(12)).toBeCloseTo(2);
    expect(semitonesToRatio(-12)).toBeCloseTo(0.5);
  });
});
