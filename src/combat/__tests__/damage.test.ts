import { describe, expect, it } from 'vitest';
import { computeDamage, falloffMultiplier } from '../damage';
import { getWeapon } from '../weapons';

const awp = getWeapon('awp');
const deagle = getWeapon('deagle');
const knife = getWeapon('knife');
const falloffWeapon = {
  ...deagle,
  damage: 63,
  headshotMultiplier: 2,
  falloff: { start: 512, end: 3072, minMultiplier: 0.55 },
};

describe('falloffMultiplier', () => {
  it('is 1 for weapons without falloff (AWP)', () => {
    expect(falloffMultiplier(awp, 0)).toBe(1);
    expect(falloffMultiplier(awp, awp.range)).toBe(1);
  });

  it('is 1 at or under falloff start', () => {
    expect(falloffMultiplier(falloffWeapon, 0)).toBe(1);
    expect(falloffMultiplier(falloffWeapon, falloffWeapon.falloff.start)).toBe(1);
  });

  it('reaches minMultiplier at or beyond falloff end', () => {
    expect(falloffMultiplier(falloffWeapon, falloffWeapon.falloff.end)).toBeCloseTo(falloffWeapon.falloff.minMultiplier);
    expect(falloffMultiplier(falloffWeapon, falloffWeapon.falloff.end + 1000)).toBeCloseTo(
      falloffWeapon.falloff.minMultiplier,
    );
  });

  it('interpolates linearly at the midpoint', () => {
    const falloff = falloffWeapon.falloff;
    const midpoint = (falloff.start + falloff.end) / 2;
    const expected = 1 - 0.5 * (1 - falloff.minMultiplier);
    expect(falloffMultiplier(falloffWeapon, midpoint)).toBeCloseTo(expected);
  });
});

describe('computeDamage', () => {
  it('applies base body damage at point blank', () => {
    expect(computeDamage({ weapon: awp, hitbox: 'body', distance: 0 })).toBe(awp.damage);
  });

  it.each(['body', 'head'] as const)('requires two Deagle %s hits throughout its effective range', hitbox => {
    for (const distance of [0, 10, 100, 512, 2048, deagle.range]) {
      const damage = computeDamage({ weapon: deagle, hitbox, distance });
      expect(damage).toBe(50);
      expect(100 - damage).toBeGreaterThan(0);
      expect(100 - damage * 2).toBe(0);
    }
  });

  it('applies the headshot multiplier (AWP head = 173)', () => {
    // 115 * 1.5 = 172.5 -> rounds to 173.
    expect(computeDamage({ weapon: awp, hitbox: 'head', distance: 0 })).toBe(173);
  });

  it('deals full damage at exactly the effective range (inclusive boundary)', () => {
    // Deagle has a finite range; AWP is a sniper (Infinity).
    expect(computeDamage({ weapon: deagle, hitbox: 'body', distance: deagle.range })).toBe(50);
  });

  it('deals 0 just beyond effective range', () => {
    expect(computeDamage({ weapon: deagle, hitbox: 'body', distance: deagle.range + 1 })).toBe(0);
    expect(computeDamage({ weapon: knife, hitbox: 'body', distance: knife.range + 0.01 })).toBe(0);
  });

  it('keeps knife damage inside a close meter-scale reach', () => {
    expect(knife.range).toBe(1.45);
    expect(computeDamage({ weapon: knife, hitbox: 'body', distance: knife.range })).toBe(knife.damage);
  });

  it('AWP (infinite range) still deals full damage at extreme distance', () => {
    expect(computeDamage({ weapon: awp, hitbox: 'body', distance: 1_000_000 })).toBe(awp.damage);
  });

  it('deals 0 for negative distance (invalid input)', () => {
    expect(computeDamage({ weapon: awp, hitbox: 'body', distance: -5 })).toBe(0);
  });

  it('reduces damage over distance when falloff is present', () => {
    const near = computeDamage({ weapon: falloffWeapon, hitbox: 'body', distance: 0 });
    const far = computeDamage({ weapon: falloffWeapon, hitbox: 'body', distance: falloffWeapon.falloff.end });
    expect(near).toBe(63);
    // 63 * 0.55 = 34.65 -> rounds to 35. Pins the falloff math to a literal value.
    expect(far).toBe(35);
    expect(far).toBeLessThan(near);
  });

  it('does not stack headshot with falloff incorrectly', () => {
    // 63 * 2 (head) * 0.55 (falloff) = 69.3 -> 69. Guards multiplier ordering.
    expect(computeDamage({ weapon: falloffWeapon, hitbox: 'head', distance: falloffWeapon.falloff.end })).toBe(69);
  });

  it('AWP one-shots a full-health player on a body hit', () => {
    expect(computeDamage({ weapon: awp, hitbox: 'body', distance: 100 })).toBeGreaterThanOrEqual(100);
  });
});
