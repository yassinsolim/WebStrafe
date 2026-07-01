import { describe, expect, it } from 'vitest';
import { previewBob, previewYaw } from '../CharacterPreview';

describe('previewYaw', () => {
  it('is centered at t=0', () => {
    expect(previewYaw(0)).toBeCloseTo(0, 6);
  });

  it('stays within the amplitude bounds', () => {
    const amplitudeRad = 0.62;
    for (let t = 0; t < 20000; t += 137) {
      const y = previewYaw(t);
      expect(y).toBeGreaterThanOrEqual(-amplitudeRad - 1e-9);
      expect(y).toBeLessThanOrEqual(amplitudeRad + 1e-9);
    }
  });

  it('reaches +amplitude at a quarter period and returns at a full period', () => {
    const periodMs = 7200;
    const amplitudeRad = 0.62;
    expect(previewYaw(periodMs / 4, { periodMs, amplitudeRad })).toBeCloseTo(amplitudeRad, 5);
    expect(previewYaw(periodMs, { periodMs, amplitudeRad })).toBeCloseTo(0, 5);
  });

  it('honors a phase offset', () => {
    expect(previewYaw(0, { phase: Math.PI / 2, amplitudeRad: 1, periodMs: 1000 })).toBeCloseTo(1, 5);
  });
});

describe('previewBob', () => {
  it('is centered at t=0 and bounded by the amplitude', () => {
    expect(previewBob(0)).toBeCloseTo(0, 6);
    for (let t = 0; t < 10000; t += 91) {
      expect(Math.abs(previewBob(t))).toBeLessThanOrEqual(0.018 + 1e-9);
    }
  });
});
