import { describe, expect, it } from 'vitest';
import { ARMOR_SETS, EMBLEMS, FINISHES, slotOptions } from '../catalog';
import {
  decodeLook,
  defaultLook,
  encodeLook,
  isPlausibleLookWire,
  lookForBot,
  MAX_LOOK_WIRE_LENGTH,
  randomLook,
  sanitizeLook,
  sanitizeTag,
  type CharacterLook,
} from '../look';
import { BUILTIN_PRESETS } from '../presets';

const full: CharacterLook = {
  helmet: 'quill',
  arms: 'anvil',
  chest: 'vector',
  legs: 'strafe',
  classItem: 'none',
  primary: '#123abc',
  secondary: '#ffeedd',
  accent: '#00ff7f',
  finish: 'worn',
  emblem: 'reticle',
  tag: 'YS-07',
  watch: false,
};

describe('look wire codec', () => {
  it('round trips every field', () => {
    const wire = encodeLook(full);
    expect(wire).toBe('1.qu.an.ve.st.no.123abc.ffeedd.00ff7f.w.rt.0.YS-07');
    expect(decodeLook(wire)).toEqual(full);
  });

  it('round trips every piece, finish and emblem', () => {
    for (const set of ARMOR_SETS) {
      for (const finish of FINISHES) {
        for (const emblem of EMBLEMS) {
          const look = { ...full, helmet: set, chest: set, classItem: set, finish, emblem };
          expect(decodeLook(encodeLook(look))).toEqual(look);
        }
      }
    }
  });

  it('stays compact and within the accepted length', () => {
    const wire = encodeLook({ ...full, tag: 'ABCDEFGH' });
    expect(wire.length).toBeLessThanOrEqual(56);
    expect(wire.length).toBeLessThan(MAX_LOOK_WIRE_LENGTH);
    expect(isPlausibleLookWire(wire)).toBe(true);
  });

  it('rejects things that are not a look at all', () => {
    for (const bad of [undefined, null, 42, {}, [], '', 'hello', '2.st.st.st.st.st.aaaaaa.bbbbbb.cccccc.s.cv.1.X', 'x'.repeat(200)]) {
      expect(decodeLook(bad)).toBeNull();
    }
  });

  it('falls back per field on garbage from a peer', () => {
    const fallback = defaultLook('counterterrorist');
    const look = decodeLook('1.zz.an.??.st.q9.nothex.ffeedd.12345.k.xx.7.<script>', fallback)!;
    expect(look.helmet).toBe(fallback.helmet);
    expect(look.arms).toBe('anvil');
    expect(look.chest).toBe(fallback.chest);
    expect(look.classItem).toBe(fallback.classItem);
    expect(look.primary).toBe(fallback.primary);
    expect(look.secondary).toBe('#ffeedd');
    expect(look.accent).toBe(fallback.accent);
    expect(look.finish).toBe(fallback.finish);
    expect(look.emblem).toBe(fallback.emblem);
    expect(look.watch).toBe(fallback.watch);
    expect(look.tag).toBe('SCRIPT');
  });

  it('flags implausible strings before they are stored', () => {
    expect(isPlausibleLookWire('1.st.st.st.st.st.aaaaaa.bbbbbb.cccccc.s.cv.1.')).toBe(true);
    expect(isPlausibleLookWire('1.st <img>')).toBe(false);
    expect(isPlausibleLookWire(12)).toBe(false);
    expect(isPlausibleLookWire('a'.repeat(MAX_LOOK_WIRE_LENGTH + 1))).toBe(false);
  });
});

describe('sanitizing', () => {
  it('cleans tags', () => {
    expect(sanitizeTag('ys 07')).toBe('YS-07');
    expect(sanitizeTag('a.b/c!d😀efghijk')).toBe('ABCDEFGH');
    expect(sanitizeTag(5)).toBe('');
  });

  it('keeps valid fields and replaces broken ones', () => {
    const look = sanitizeLook({ helmet: 'anvil', primary: '#ABCDEF', finish: 'shiny', tag: 'hi there' }, defaultLook());
    expect(look.helmet).toBe('anvil');
    expect(look.primary).toBe('#abcdef');
    expect(look.finish).toBe(defaultLook().finish);
    expect(look.tag).toBe('HI-THERE');
    expect(sanitizeLook('nonsense')).toEqual(defaultLook());
  });

  it('team defaults differ so an untouched look still reads as its side', () => {
    expect(defaultLook('terrorist').primary).not.toBe(defaultLook('counterterrorist').primary);
  });
});

describe('random looks', () => {
  it('are valid and repeatable with a seed', () => {
    for (let i = 0; i < 200; i += 1) {
      const look = randomLook(i);
      expect(sanitizeLook(look)).toEqual(look);
      expect(randomLook(i)).toEqual(look);
    }
    expect(lookForBot('bot:1')).toEqual(lookForBot('bot:1'));
    const bots = new Set(Array.from({ length: 8 }, (_, i) => encodeLook(lookForBot(`bot:${i}`))));
    expect(bots.size).toBeGreaterThan(4);
  });

  it('covers every option eventually', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 400; i += 1) {
      const look = randomLook(i * 7919);
      seen.add(`h:${look.helmet}`);
      seen.add(`k:${look.classItem}`);
      seen.add(`f:${look.finish}`);
    }
    for (const option of slotOptions('classItem')) expect(seen.has(`k:${option}`)).toBe(true);
    for (const set of ARMOR_SETS) expect(seen.has(`h:${set}`)).toBe(true);
    for (const finish of FINISHES) expect(seen.has(`f:${finish}`)).toBe(true);
  });
});

describe('presets', () => {
  it('are all valid looks with unique ids', () => {
    const ids = new Set<string>();
    for (const preset of BUILTIN_PRESETS) {
      expect(sanitizeLook(preset.look)).toEqual(preset.look);
      ids.add(preset.id);
    }
    expect(ids.size).toBe(BUILTIN_PRESETS.length);
    expect(BUILTIN_PRESETS.length).toBeGreaterThanOrEqual(6);
  });
});
