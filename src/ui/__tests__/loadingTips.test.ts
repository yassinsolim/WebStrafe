import { describe, expect, it } from 'vitest';
import { LOADING_TIPS, tipsFor } from '../loadingTips';
import { mapPalette } from '../menu/menuInfo';

describe('loading tips', () => {
  it('are short plain sentences without em dashes', () => {
    for (const tip of LOADING_TIPS) {
      expect(tip.text.length).toBeGreaterThan(10);
      expect(tip.text.length).toBeLessThan(140);
      expect(tip.text).not.toMatch(/\u2014/);
      expect(tip.text.endsWith('.')).toBe(true);
    }
  });

  it('only shows combat tips in combat builds and reset tips without combat', () => {
    const combat = tipsFor('aim', true);
    const calm = tipsFor('aim', false);
    expect(combat.some((text) => text.includes('AWP body shot'))).toBe(true);
    expect(calm.some((text) => text.includes('AWP'))).toBe(false);
    expect(calm.some((text) => text.includes('reset to spawn'))).toBe(true);
    expect(combat.some((text) => text.includes('reset to spawn'))).toBe(false);
  });

  it('keeps surf tips on surf maps', () => {
    expect(tipsFor('surf', false).some((text) => text.includes('surf ramp'))).toBe(true);
    expect(tipsFor('bhop', false).some((text) => text.includes('surf ramp'))).toBe(false);
  });

  it('shuffles deterministically per seed without losing tips', () => {
    const a = tipsFor('surf', true, 1);
    expect(tipsFor('surf', true, 1)).toEqual(a);
    const b = tipsFor('surf', true, 2);
    expect([...b].sort()).toEqual([...a].sort());
  });
});

describe('map palettes', () => {
  it('has hand picked colours for the built-in maps', () => {
    expect(mapPalette('surf_prismline').accent).toBe('#46d5ff');
    expect(mapPalette('bhop_emberdrift').accent).toBe('#ff6a2b');
  });

  it('derives a stable colour for anything else', () => {
    expect(mapPalette('surf_custom_x')).toEqual(mapPalette('surf_custom_x'));
    expect(mapPalette('surf_custom_x').accent).toMatch(/^hsl\(\d+ 85% 62%\)$/);
  });
});
