import { describe, expect, it } from 'vitest';
import { decodeCosmetics, encodeCosmetics } from '../../network/cosmetics';
import { armorToLook, defaultLook, lookToArmor, randomLook } from '../look';

describe('look in the shared cosmetics field', () => {
  it('survives the armor part of encode/decode for many looks', () => {
    for (let i = 0; i < 200; i += 1) {
      const look = { ...randomLook(i), tag: i % 3 ? 'YS-07' : '' };
      const wire = encodeCosmetics({ armor: lookToArmor(look) });
      const back = armorToLook(decodeCosmetics(JSON.parse(JSON.stringify(wire)))?.armor);
      expect(back).toEqual(look);
    }
  });

  it('stays within the field limits (16 slots, lowercase tokens)', () => {
    const armor = lookToArmor({ ...defaultLook(), tag: 'ABCDEFGH' });
    expect(Object.keys(armor).length).toBeLessThanOrEqual(16);
    for (const [slot, item] of Object.entries(armor)) {
      expect(slot).toMatch(/^[a-z0-9_-]{1,32}$/);
      expect(item).toMatch(/^[a-z0-9_-]{1,32}$/);
    }
  });

  it('falls back per field and treats no armor as no look', () => {
    expect(armorToLook(undefined)).toBeNull();
    expect(armorToLook({})).toBeNull();
    const look = armorToLook({ helmet: 'quill', primary: 'zzzzzz', finish: 'shiny' }, defaultLook('counterterrorist'))!;
    expect(look.helmet).toBe('quill');
    expect(look.primary).toBe(defaultLook('counterterrorist').primary);
    expect(look.finish).toBe(defaultLook('counterterrorist').finish);
  });
});
