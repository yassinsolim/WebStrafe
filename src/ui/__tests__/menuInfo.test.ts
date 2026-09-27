import { describe, expect, it } from 'vitest';
import { KNIVES } from '../../combat/knives';
import { WEAPONS } from '../../combat/weapons';
import { knifeDescriptor, knifeSilhouette, knifeSilhouetteMarkup } from '../menu/knifeSilhouette';
import { firearmStats, mapHue, mapTypeFromId, showsRunTimer, weaponDisplayName } from '../menu/menuInfo';

describe('map info', () => {
  it('infers the type badge from the id prefix', () => {
    expect(mapTypeFromId('surf_skyworld_x')).toBe('surf');
    expect(mapTypeFromId('bhop_blocks')).toBe('bhop');
    expect(mapTypeFromId('AIM_duel')).toBe('aim');
    expect(mapTypeFromId('training_straight')).toBe('training');
    expect(mapTypeFromId('movement_test_scene')).toBe('practice');
  });

  it('times surf and bhop maps and anything with a finish', () => {
    expect(showsRunTimer('surf_x', false)).toBe(true);
    expect(showsRunTimer('bhop_x', false)).toBe(true);
    expect(showsRunTimer('aim_x', false)).toBe(false);
    expect(showsRunTimer('training_straight', true)).toBe(true);
  });

  it('gives each map a stable hue', () => {
    expect(mapHue('surf_skyworld_x')).toBe(mapHue('surf_skyworld_x'));
    expect(mapHue('a')).toBeGreaterThanOrEqual(0);
    expect(mapHue('a')).toBeLessThan(360);
  });
});

describe('weapon stats', () => {
  it('derives the loadout numbers from weapons.ts', () => {
    const awp = Object.fromEntries(firearmStats(WEAPONS.awp).map((line) => [line.label, line.value]));
    expect(awp).toMatchObject({ Damage: '115', Headshot: '172', Magazine: '10', 'Fire rate': '40 rpm' });
    const deagle = Object.fromEntries(firearmStats(WEAPONS.deagle).map((line) => [line.label, line.value]));
    expect(deagle).toMatchObject({ Damage: '63', Headshot: '126', Magazine: '7', 'Fire rate': '267 rpm' });
    for (const line of firearmStats(WEAPONS.deagle)) {
      expect(line.fraction).toBeGreaterThan(0);
      expect(line.fraction).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the short display names', () => {
    expect(weaponDisplayName('awp')).toBe('AWP');
    expect(weaponDisplayName('deagle')).toBe('Deagle');
    expect(weaponDisplayName('knife', 'Karambit')).toBe('Karambit');
  });
});

describe('knife silhouettes', () => {
  it('builds finite svg paths for all 20 knives', () => {
    expect(KNIVES).toHaveLength(20);
    for (const knife of KNIVES) {
      const art = knifeSilhouette(knife);
      const numbers = [art.viewBox, art.blade, art.handle, art.guard ?? ''].join(' ').match(/-?\d+(\.\d+)?(e-?\d+)?/g) ?? [];
      expect(numbers.length, knife.id).toBeGreaterThan(8);
      expect(numbers.every((value) => Number.isFinite(Number(value))), knife.id).toBe(true);
      const [, , width, height] = art.viewBox.split(' ').map(Number);
      expect(width, knife.id).toBeGreaterThan(0);
      expect(height, knife.id).toBeGreaterThan(0);
      expect(knifeSilhouetteMarkup(knife)).toContain('knife-art-blade');
    }
  });

  it('describes knives without the reference game names', () => {
    const karambit = KNIVES.find((knife) => knife.id === 'karambit')!;
    expect(knifeDescriptor(karambit)).toBe('hawkbill, finger ring');
    const daggers = KNIVES.find((knife) => knife.id === 'shadow_daggers')!;
    expect(knifeDescriptor(daggers)).toContain('pair');
  });
});
