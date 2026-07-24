import { describe, expect, it } from 'vitest';
import { previewBreath, previewCameraDistance } from '../CharacterPreview';

describe('previewBreath', () => {
  it('is centered, slow, and normalized', () => {
    const periodMs = 4400;
    expect(previewBreath(0, periodMs)).toBeCloseTo(0, 6);
    expect(previewBreath(periodMs / 4, periodMs)).toBeCloseTo(1, 6);
    for (let t = 0; t < 20000; t += 137) {
      expect(Math.abs(previewBreath(t, periodMs))).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

describe('previewCameraDistance', () => {
  it('backs up for narrow frames so the model width cannot clip', () => {
    const wide = previewCameraDistance(1.2, 1.85, 0.5, 16 / 9, 32);
    const narrow = previewCameraDistance(1.2, 1.85, 0.5, 0.55, 32);
    expect(narrow).toBeGreaterThan(wide);
  });

  it('adds half the model depth beyond the planar fit distance', () => {
    const flat = previewCameraDistance(1.2, 1.85, 0, 1, 32);
    const deep = previewCameraDistance(1.2, 1.85, 0.6, 1, 32);
    expect(deep - flat).toBeCloseTo(0.3, 6);
  });
});
