import { describe, expect, it } from 'vitest';
import {
  defaultKnifeSelection,
  KNIFE_SELECTION_KEY,
  LEGACY_KNIFE_STYLE_KEY,
  loadKnifeSelection,
  sanitizeKnifeSelection,
  saveKnifeSelection,
} from '../selection';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

describe('knife selection validation', () => {
  it('passes a good selection through', () => {
    const sel = { knifeId: 'm9_bayonet', finishId: 'doppler_phase2', wear: 0.031, seed: 661 };
    expect(sanitizeKnifeSelection(sel)).toEqual(sel);
  });

  it('falls back field by field on junk', () => {
    expect(sanitizeKnifeSelection(null)).toEqual(defaultKnifeSelection());
    expect(sanitizeKnifeSelection('karambit')).toEqual(defaultKnifeSelection());
    const out = sanitizeKnifeSelection({ knifeId: 'spork', finishId: 'plaid', wear: 'lots', seed: 'x' });
    expect(out).toEqual(defaultKnifeSelection());
    const partial = sanitizeKnifeSelection({ knifeId: 'butterfly', finishId: 42 });
    expect(partial.knifeId).toBe('butterfly');
    expect(partial.finishId).toBe('vanilla');
  });

  it('resolves finish families, clamps wear into the finish range and rounds the seed', () => {
    const out = sanitizeKnifeSelection({ knifeId: 'karambit', finishId: 'doppler', wear: 0.9, seed: 1234.7 });
    expect(out.finishId).toBe('doppler_phase1');
    expect(out.wear).toBe(0.08);
    expect(out.seed).toBe(999);
    expect(sanitizeKnifeSelection({ finishId: 'crimson_web', wear: 0 }).wear).toBe(0.06);
    expect(sanitizeKnifeSelection({ finishId: 'crimson_web' }).wear).toBe(0.06);
    expect(sanitizeKnifeSelection({ finishId: 'vanilla', wear: 0.5 }).wear).toBe(0);
    expect(sanitizeKnifeSelection({ finishId: 'stained', wear: Number.NaN, seed: -5 })).toMatchObject({ wear: 0, seed: 0 });
  });
});

describe('knife selection storage', () => {
  it('round trips through storage', () => {
    const storage = memoryStorage();
    const sel = { knifeId: 'butterfly' as const, finishId: 'case_hardened', wear: 0.2, seed: 387 };
    saveKnifeSelection(sel, storage);
    expect(loadKnifeSelection(storage)).toEqual(sel);
    // the v1 key keeps the knife for older builds
    expect(storage.data.get(LEGACY_KNIFE_STYLE_KEY)).toBe('butterfly');
  });

  it('migrates the old knife-only key', () => {
    const storage = memoryStorage({ [LEGACY_KNIFE_STYLE_KEY]: 'flip' });
    const sel = loadKnifeSelection(storage);
    expect(sel).toEqual({ ...defaultKnifeSelection(), knifeId: 'flip' });
    expect(JSON.parse(storage.data.get(KNIFE_SELECTION_KEY)!)).toEqual(sel);
  });

  it("maps the removed 'legacy' knife to the default knife", () => {
    const storage = memoryStorage({ [LEGACY_KNIFE_STYLE_KEY]: 'legacy' });
    expect(loadKnifeSelection(storage)).toEqual(defaultKnifeSelection());
  });

  it('prefers the v2 key and survives corrupt json', () => {
    const good = memoryStorage({
      [KNIFE_SELECTION_KEY]: JSON.stringify({ knifeId: 'gut', finishId: 'night', wear: 0.3, seed: 5 }),
      [LEGACY_KNIFE_STYLE_KEY]: 'flip',
    });
    expect(loadKnifeSelection(good).knifeId).toBe('gut');
    const corrupt = memoryStorage({ [KNIFE_SELECTION_KEY]: '{not json', [LEGACY_KNIFE_STYLE_KEY]: 'talon' });
    expect(loadKnifeSelection(corrupt).knifeId).toBe('talon');
  });

  it('works without storage and when storage throws', () => {
    expect(loadKnifeSelection(null)).toEqual(defaultKnifeSelection());
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadKnifeSelection(throwing)).toEqual(defaultKnifeSelection());
    expect(() => saveKnifeSelection(defaultKnifeSelection(), throwing)).not.toThrow();
  });
});
