import { describe, expect, it } from 'vitest';
import { computeDamage, falloffMultiplier } from '../damage';
import { getWeapon } from '../weapons';

const awp = getWeapon('awp');
const deagle = getWeapon('deagle');

describe('falloffMultiplier', () => {
  it('is 1 for weapons without falloff (AWP)', () => {
    expect(falloffMultiplier(awp, 0)).toBe(1);
    expect(falloffMultiplier(awp, awp.range)).toBe(1);
  });

  it('is 1 at or under falloff start (Deagle)', () => {
    expect(falloffMultiplier(deagle, 0)).toBe(1);
    expect(falloffMultiplier(deagle, deagle.falloff!.start)).toBe(1);
  });

  it('reaches minMultiplier at or beyond falloff end (Deagle)', () => {
    expect(falloffMultiplier(deagle, deagle.falloff!.end)).toBeCloseTo(deagle.falloff!.minMultiplier);
    expect(falloffMultiplier(deagle, deagle.falloff!.end + 1000)).toBeCloseTo(
      deagle.falloff!.minMultiplier,
    );
  });

  it('interpolates linearly at the midpoint (Deagle)', () => {
    const f = deagle.falloff!;
    const mid = (f.start + f.end) / 2;
    const expected = 1 - 0.5 * (1 - f.minMultiplier);
    expect(falloffMultiplier(deagle, mid)).toBeCloseTo(expected);
  });
});

describe('computeDamage', () => {
  it('applies base body damage at point blank', () => {
    expect(computeDamage({ weapon: awp, hitbox: 'body', distance: 0 })).toBe(awp.damage);
  });

  it('applies the headshot multiplier (Deagle head = 126)', () => {
    // Hard-coded expected value (63 * 2) pins behavior, so an incorrect
    // multiplier order or stacking would fail this test.
    expect(computeDamage({ weapon: deagle, hitbox: 'head', distance: 0 })).toBe(126);
  });

  it('applies the headshot multiplier (AWP head = 173)', () => {
    // 115 * 1.5 = 172.5 -> rounds to 173.
    expect(computeDamage({ weapon: awp, hitbox: 'head', distance: 0 })).toBe(173);
  });

  it('deals full damage at exactly the effective range (inclusive boundary)', () => {
    // Deagle has a finite range; AWP is a sniper (Infinity).
    expect(computeDamage({ weapon: deagle, hitbox: 'body', distance: deagle.range })).toBe(
      Math.round(63 * deagle.falloff!.minMultiplier),
    );
  });

  it('deals 0 just beyond effective range', () => {
    expect(computeDamage({ weapon: deagle, hitbox: 'body', distance: deagle.range + 1 })).toBe(0);
  });

  it('AWP (infinite range) still deals full damage at extreme distance', () => {
    expect(computeDamage({ weapon: awp, hitbox: 'body', distance: 1_000_000 })).toBe(awp.damage);
  });

  it('deals 0 for negative distance (invalid input)', () => {
    expect(computeDamage({ weapon: awp, hitbox: 'body', distance: -5 })).toBe(0);
  });

  it('reduces damage over distance when falloff is present (Deagle far body = 35)', () => {
    const near = computeDamage({ weapon: deagle, hitbox: 'body', distance: 0 });
    const far = computeDamage({ weapon: deagle, hitbox: 'body', distance: deagle.falloff!.end });
    expect(near).toBe(63);
    // 63 * 0.55 = 34.65 -> rounds to 35. Pins the falloff math to a literal value.
    expect(far).toBe(35);
    expect(far).toBeLessThan(near);
  });

  it('does not stack headshot with falloff incorrectly (Deagle far head = 69)', () => {
    // 63 * 2 (head) * 0.55 (falloff) = 69.3 -> 69. Guards multiplier ordering.
    expect(computeDamage({ weapon: deagle, hitbox: 'head', distance: deagle.falloff!.end })).toBe(69);
  });

  it('AWP one-shots a full-health player on a body hit', () => {
    expect(computeDamage({ weapon: awp, hitbox: 'body', distance: 100 })).toBeGreaterThanOrEqual(100);
  });
});
