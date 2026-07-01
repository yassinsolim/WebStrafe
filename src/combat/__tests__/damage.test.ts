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

  it('applies the headshot multiplier', () => {
    expect(computeDamage({ weapon: deagle, hitbox: 'head', distance: 0 })).toBe(
      Math.round(deagle.damage * deagle.headshotMultiplier),
    );
  });

  it('deals 0 beyond effective range', () => {
    expect(computeDamage({ weapon: awp, hitbox: 'body', distance: awp.range + 1 })).toBe(0);
  });

  it('deals 0 for negative distance (invalid input)', () => {
    expect(computeDamage({ weapon: awp, hitbox: 'body', distance: -5 })).toBe(0);
  });

  it('reduces damage over distance when falloff is present (Deagle)', () => {
    const near = computeDamage({ weapon: deagle, hitbox: 'body', distance: 0 });
    const far = computeDamage({ weapon: deagle, hitbox: 'body', distance: deagle.falloff!.end });
    expect(far).toBeLessThan(near);
    expect(far).toBe(Math.round(deagle.damage * deagle.falloff!.minMultiplier));
  });

  it('AWP one-shots a full-health player on a body hit', () => {
    expect(computeDamage({ weapon: awp, hitbox: 'body', distance: 100 })).toBeGreaterThanOrEqual(100);
  });
});
