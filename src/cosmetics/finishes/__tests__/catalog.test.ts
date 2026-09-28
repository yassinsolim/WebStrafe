import { describe, expect, it } from 'vitest';
import {
  caseHardenedPattern,
  clampKnifeWear,
  crimsonWebCenters,
  DEFAULT_KNIFE_FINISH_ID,
  fadePercent,
  finishPatternLabel,
  finishSeedParams,
  isKnifeFinishId,
  KNIFE_FINISHES,
  knifeFinishDisplayName,
  marbleFadePattern,
  normalizePatternSeed,
  resolveKnifeFinish,
  seedHash,
  selectableKnifeFinishIds,
  WEAR_CONDITIONS,
  wearCondition,
} from '../catalog';

const REQUIRED = [
  'Vanilla', 'Doppler', 'Marble Fade', 'Tiger Tooth', 'Fade', 'Slaughter', 'Crimson Web', 'Case Hardened',
  'Damascus Steel', 'Ultraviolet', 'Night', 'Blue Steel', 'Stained', 'Safari Mesh', 'Boreal Forest', 'Scorched',
];

describe('finish catalog', () => {
  it('has every required finish under its cs name, once', () => {
    const names = KNIFE_FINISHES.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of REQUIRED) expect(names, name).toContain(name);
  });

  it('has unique ids across finishes and variants', () => {
    const ids = [...KNIFE_FINISHES.map((f) => f.id), ...KNIFE_FINISHES.flatMap((f) => (f.variants ?? []).map((v) => v.id))];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9_]+$/);
  });

  it('gives doppler its four phases and the four gems', () => {
    const doppler = KNIFE_FINISHES.find((f) => f.id === 'doppler')!;
    expect(doppler.variants!.map((v) => v.name)).toEqual([
      'Phase 1', 'Phase 2', 'Phase 3', 'Phase 4', 'Ruby', 'Sapphire', 'Black Pearl', 'Emerald',
    ]);
    for (const v of doppler.variants!) {
      expect(v.colors).toHaveLength(4);
      expect(v.params).toHaveLength(4);
    }
  });

  it('describes parts, wear limits and seeds for every finish', () => {
    for (const f of KNIFE_FINISHES) {
      const [min, max] = f.wearRange;
      expect(min, f.id).toBeGreaterThanOrEqual(0);
      expect(max, f.id).toBeLessThanOrEqual(1);
      expect(min, f.id).toBeLessThanOrEqual(max);
      expect(['keep', 'dark', 'tint', 'pattern']).toContain(f.parts.handle.kind);
      expect(f.swatch.length, f.id).toBeGreaterThan(1);
      if (f.id === 'vanilla') {
        expect(f.parts.blade || f.parts.edge || f.parts.metal).toBe(false);
      } else {
        expect(f.parts.blade && f.parts.edge, f.id).toBe(true);
      }
    }
    // cs limits for a few well known ones
    expect(resolveKnifeFinish('fade').finish.wearRange).toEqual([0, 0.08]);
    expect(resolveKnifeFinish('crimson_web').finish.wearRange).toEqual([0.06, 0.8]);
    expect(resolveKnifeFinish('case_hardened').finish.wearRange).toEqual([0, 1]);
    // the contract: these keep or tint a dark handle
    for (const id of ['case_hardened', 'slaughter']) expect(resolveKnifeFinish(id).finish.parts.handle.kind).toBe('dark');
    for (const id of ['crimson_web', 'night']) expect(resolveKnifeFinish(id).finish.parts.handle.kind).toBe('tint');
    for (const id of ['safari_mesh', 'boreal_forest', 'scorched']) expect(resolveKnifeFinish(id).finish.parts.handle.kind).toBe('pattern');
  });

  it('resolves family ids, variant ids and junk', () => {
    expect(resolveKnifeFinish('doppler').id).toBe('doppler_phase1');
    expect(resolveKnifeFinish('doppler_ruby').name).toBe('Doppler (Ruby)');
    expect(resolveKnifeFinish('doppler_emerald').finish.id).toBe('doppler');
    expect(resolveKnifeFinish('night').id).toBe('night');
    expect(resolveKnifeFinish('not_a_finish').id).toBe(DEFAULT_KNIFE_FINISH_ID);
    expect(resolveKnifeFinish(null).id).toBe(DEFAULT_KNIFE_FINISH_ID);
    expect(isKnifeFinishId('doppler_phase3')).toBe(true);
    expect(isKnifeFinishId('doppler')).toBe(true);
    expect(isKnifeFinishId('phase3')).toBe(false);
    expect(isKnifeFinishId(3)).toBe(false);
    expect(knifeFinishDisplayName('tiger_tooth')).toBe('Tiger Tooth');
  });

  it('lists variants instead of their parent in the selectable ids', () => {
    const ids = selectableKnifeFinishIds();
    expect(ids).not.toContain('doppler');
    expect(ids).toContain('doppler_black_pearl');
    expect(ids).toContain('vanilla');
    expect(ids.length).toBe(KNIFE_FINISHES.length - 1 + 8);
  });
});

describe('wear buckets', () => {
  it('maps floats to the cs exteriors, boundaries going to the worse bucket', () => {
    const cases: Array<[number, string]> = [
      [0, 'Factory New'], [0.0699, 'Factory New'], [0.07, 'Minimal Wear'], [0.1499, 'Minimal Wear'],
      [0.15, 'Field-Tested'], [0.3799, 'Field-Tested'], [0.38, 'Well-Worn'], [0.4499, 'Well-Worn'],
      [0.45, 'Battle-Scarred'], [0.99, 'Battle-Scarred'], [1, 'Battle-Scarred'],
    ];
    for (const [wear, name] of cases) expect(wearCondition(wear).name, String(wear)).toBe(name);
    expect(wearCondition(Number.NaN).short).toBe('FN');
    expect(WEAR_CONDITIONS.map((c) => c.short)).toEqual(['FN', 'MW', 'FT', 'WW', 'BS']);
  });

  it('clamps floats into each finish range', () => {
    expect(clampKnifeWear('doppler_phase2', 0.5)).toBe(0.08);
    expect(clampKnifeWear('crimson_web', 0)).toBe(0.06);
    expect(clampKnifeWear('crimson_web', 0.9)).toBe(0.8);
    expect(clampKnifeWear('case_hardened', 0.42)).toBe(0.42);
    expect(clampKnifeWear('vanilla', 0.3)).toBe(0);
    expect(clampKnifeWear('slaughter', Number.NaN)).toBe(0.01);
  });
});

describe('pattern seeds', () => {
  it('normalizes seeds into 0..999', () => {
    expect(normalizePatternSeed(12.4)).toBe(12);
    expect(normalizePatternSeed(-3)).toBe(0);
    expect(normalizePatternSeed(4000)).toBe(999);
    expect(normalizePatternSeed('661')).toBe(661);
    expect(normalizePatternSeed('abc')).toBe(0);
    expect(normalizePatternSeed(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('is deterministic and different seeds move the pattern', () => {
    for (const id of ['doppler_phase2', 'case_hardened', 'boreal_forest']) {
      const a = finishSeedParams(id, 123);
      expect(finishSeedParams(id, 123)).toEqual(a);
      expect(finishSeedParams(id, 124)).not.toEqual(a);
      for (const o of a.offset) expect(Math.abs(o)).toBeLessThanOrEqual(80);
      expect(Math.abs(a.angle)).toBeLessThanOrEqual(0.35);
    }
    // the same seed on two finishes doesn't give the same offsets
    expect(finishSeedParams('stained', 7)).not.toEqual(finishSeedParams('blue_steel', 7));
    expect(seedHash(5, 'a')).toBe(seedHash(5, 'a'));
    expect(seedHash(5, 'a')).not.toBe(seedHash(5, 'b'));
  });

  it('ignores the seed where cs does', () => {
    expect(finishSeedParams('night', 1)).toEqual(finishSeedParams('night', 900));
    expect(finishSeedParams('ultraviolet', 1)).toEqual(finishSeedParams('ultraviolet', 900));
  });

  it('has a few percent blue gem case hardened seeds, including the showcase ones', () => {
    let gems = 0;
    let high = 0;
    let mean = 0;
    for (let s = 0; s <= 999; s += 1) {
      const p = caseHardenedPattern(s);
      expect(p.blue).toBeGreaterThanOrEqual(0);
      expect(p.blue).toBeLessThanOrEqual(1);
      if (p.tier === 'Blue gem') {
        gems += 1;
        expect(p.blue).toBeGreaterThan(0.85);
      }
      if (p.tier === 'High blue') high += 1;
      mean += p.blue / 1000;
    }
    expect(gems).toBeGreaterThanOrEqual(5);
    expect(gems).toBeLessThanOrEqual(40);
    expect(high).toBeGreaterThan(gems);
    expect(mean).toBeLessThan(0.35);
    expect(caseHardenedPattern(387).tier).toBe('Blue gem');
    expect(caseHardenedPattern(387)).toEqual(caseHardenedPattern(387));
  });

  it('derives fade percentages, marble fade kinds and web hubs from the seed', () => {
    for (let s = 0; s <= 999; s += 37) {
      const pct = fadePercent(s);
      expect(pct).toBeGreaterThanOrEqual(80);
      expect(pct).toBeLessThanOrEqual(100);
      const webs = crimsonWebCenters(s);
      expect(webs.length).toBeGreaterThanOrEqual(1);
      expect(webs.length).toBeLessThanOrEqual(3);
      expect(webs[0].u).toBeGreaterThan(0.2);
      expect(webs[0].u).toBeLessThan(0.85);
    }
    const kinds = new Set<string | null>();
    let fireIce = 0;
    for (let s = 0; s <= 999; s += 1) {
      const p = marbleFadePattern(s);
      kinds.add(p.kind);
      if (p.kind === 'Fire & Ice') {
        fireIce += 1;
        expect(p.yellow).toBe(0);
      }
    }
    expect(kinds.has('Fire & Ice')).toBe(true);
    expect(kinds.has('Tricolour')).toBe(true);
    expect(fireIce).toBeGreaterThan(20);
    expect(fireIce).toBeLessThan(150);
    expect(finishPatternLabel('fade', 10)).toMatch(/^Fade \d+\.\d%$/);
    expect(finishPatternLabel('case_hardened', 387)).toBe('Blue gem');
    expect(finishPatternLabel('night', 10)).toBeNull();
    expect(finishPatternLabel('crimson_web', 10)).toMatch(/web/);
  });
});
