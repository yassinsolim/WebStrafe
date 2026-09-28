import { Color } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GRADE, gradeLinear, inverseGrade, resolveGrade, whiteBalanceGains } from '../grade';

// seeded so a failure always reproduces
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const GRADES = [
  DEFAULT_GRADE,
  resolveGrade({ exposure: 1.05, contrast: 1.1, saturation: 1.06, temperature: 0.02, vignette: 0.26 }),
  resolveGrade({ exposure: 0.74, contrast: 1.16, saturation: 1.1, temperature: 0.03 }),
  resolveGrade({ exposure: 0.8, contrast: 1.12, saturation: 1.04, temperature: 0.05, tint: -0.2 }),
];

describe('color grade', () => {
  it('inverts exactly, so authored sky and fog colors show as authored', () => {
    // any color the grade can put on screen has to come back out of the inverse.
    // (very bright saturated colors can't be shown at all, the curve desaturates them)
    const random = rng(7);
    let worst = 0;
    for (const grade of GRADES) {
      for (let i = 0; i < 4000; i += 1) {
        const hdr = (): number => 0.002 * 1000 ** random();
        const display = gradeLinear([hdr(), hdr(), hdr()], grade);
        if (Math.max(...display) > 0.985) continue;
        const linear = inverseGrade(new Color(...display), grade);
        const out = gradeLinear([linear.r, linear.g, linear.b], grade);
        worst = Math.max(worst, ...out.map((v, c) => Math.abs(v - display[c])));
      }
    }
    expect(worst).toBeLessThan(1e-4);
  });

  it('keeps some blue in a warm shadow instead of crushing it to black', () => {
    // a tan wall in the shade, linear hdr before the grade
    const out = gradeLinear([0.08, 0.033, 0.0126], resolveGrade({ exposure: 1.05, contrast: 1.1, saturation: 1.06 }));
    expect(out[2]).toBeGreaterThan(0.004);
    expect(out[0]).toBeGreaterThan(out[1]);
    expect(out[1]).toBeGreaterThan(out[2]);
  });

  it('white balance keeps mid grey luminance', () => {
    for (const [temperature, tint] of [[0.3, 0], [-0.4, 0.2], [0.05, -0.5]]) {
      const g = whiteBalanceGains(temperature, tint);
      expect(0.2126 * g.x + 0.7152 * g.y + 0.0722 * g.z).toBeCloseTo(1, 6);
    }
  });

  it('clamps bad values from meta.json', () => {
    const grade = resolveGrade({ exposure: -3, contrast: 'high', saturation: 9, vignette: Number.NaN });
    expect(grade.exposure).toBe(0.05);
    expect(grade.contrast).toBe(DEFAULT_GRADE.contrast);
    expect(grade.saturation).toBe(2);
    expect(grade.vignette).toBe(DEFAULT_GRADE.vignette);
  });
});
