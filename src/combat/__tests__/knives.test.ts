import { describe, expect, it } from 'vitest';
import { Box3, Mesh, Vector3 } from 'three';
import {
  BACKSTAB_DOT,
  getKnife,
  isBackstab,
  isKnifeId,
  knifeDamage,
  KNIFE_DAMAGE,
  KNIFE_TIMING_MS,
  KNIVES,
} from '../knives';
import { buildProceduralKnife, disposeProceduralKnife } from '../../cosmetics/ProceduralKnife';

// twelve of cs2's twenty types, picked so no two look alike
const CS2_KNIFE_TYPES = [
  'Karambit', 'Butterfly Knife', 'M9 Bayonet', 'Talon Knife', 'Skeleton Knife', 'Bayonet',
  'Flip Knife', 'Stiletto Knife', 'Huntsman Knife', 'Bowie Knife', 'Gut Knife', 'Shadow Daggers',
];

describe('knife catalog', () => {
  it('has twelve distinct cs2 knife types, once each', () => {
    expect(KNIVES).toHaveLength(12);
    expect(KNIVES.map((k) => k.referenceType)).toEqual(CS2_KNIFE_TYPES);
    expect(new Set(KNIVES.map((k) => k.id)).size).toBe(12);
  });

  it('goes by the cs2 type names', () => {
    for (const k of KNIVES) expect(k.name, k.id).toBe(k.referenceType);
  });

  it('marks the folders, the balisong and the ring knives', () => {
    const by = (pred: (k: (typeof KNIVES)[number]) => boolean) => KNIVES.filter(pred).map((k) => k.id).sort();
    expect(by((k) => k.shape.mechanism === 'folder')).toEqual(['flip', 'stiletto', 'talon']);
    expect(by((k) => k.shape.mechanism === 'balisong')).toEqual(['butterfly']);
    expect(by((k) => k.shape.fingerRing === true)).toEqual(['karambit', 'talon']);
    expect(by((k) => k.shape.pair === true)).toEqual(['shadow_daggers']);
  });

  it('falls back to the default knife for unknown and retired ids', () => {
    expect(getKnife('nope').id).toBe('karambit');
    expect(getKnife('kukri').id).toBe('karambit');
    expect(isKnifeId('kukri')).toBe(false);
    expect(isKnifeId('talon')).toBe(true);
    expect(isKnifeId('awp')).toBe(false);
  });

  it('builds a sane model for every knife', () => {
    for (const def of KNIVES) {
      const model = buildProceduralKnife(def);
      const box = new Box3().setFromObject(model);
      const size = box.getSize(new Vector3());
      let meshes = 0;
      let triangles = 0;
      model.traverse((o) => {
        if (o instanceof Mesh) {
          meshes += 1;
          const pos = o.geometry.getAttribute('position');
          triangles += (o.geometry.index ? o.geometry.index.count : pos.count) / 3;
          for (let i = 0; i < pos.count; i += 1) {
            expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))).toBe(true);
          }
        }
      });
      expect(meshes, def.id).toBeGreaterThanOrEqual(2);
      // viewmodel budget, and big enough to read on screen
      expect(triangles, def.id).toBeLessThanOrEqual(8000);
      expect(size.x, def.id).toBeGreaterThan(def.shape.handle === 'tee' ? 0.08 : 0.15);
      expect(size.x, def.id).toBeLessThan(0.4);
      // tip is the +x end
      expect(box.max.x, def.id).toBeCloseTo(def.shape.bladeLength, 1);
      disposeProceduralKnife(model);
    }
  });
});

describe('knife damage', () => {
  it('matches cs values', () => {
    expect(knifeDamage('primary', false, false)).toBe(40);
    expect(knifeDamage('primary', false, true)).toBe(25);
    expect(knifeDamage('secondary', false, false)).toBe(65);
    expect(knifeDamage('primary', true, false)).toBe(90);
    expect(knifeDamage('secondary', true, false)).toBe(KNIFE_DAMAGE.secondaryBackstab);
    expect(KNIFE_DAMAGE.secondaryBackstab).toBeGreaterThanOrEqual(100);
  });

  it('detects stabs from behind only', () => {
    // victim at origin facing -z (yaw 0); attacker behind them at +z
    expect(isBackstab([0, 0, 1], [0, 0, 0], 0)).toBe(true);
    expect(isBackstab([0, 0, -1], [0, 0, 0], 0)).toBe(false);
    expect(isBackstab([1, 0, 0], [0, 0, 0], 0)).toBe(false);
  });

  it('uses the cs:go backstab cone (dot above 0.475)', () => {
    expect(BACKSTAB_DOT).toBe(0.475);
    const behindAt = (deg: number): [number, number, number] => {
      const rad = (deg * Math.PI) / 180;
      return [Math.sin(rad), 0, Math.cos(rad)];
    };
    // acos(0.475) is about 61.6 degrees off the victim's back
    expect(isBackstab(behindAt(60), [0, 0, 0], 0)).toBe(true);
    expect(isBackstab(behindAt(63), [0, 0, 0], 0)).toBe(false);
    expect(isBackstab([0, 0, 1], [0, 0, 0], Number.NaN)).toBe(false);
  });

  it('keeps cs knife timings', () => {
    expect(KNIFE_TIMING_MS).toMatchObject({
      primaryInterval: 400,
      primaryIntervalHit: 500,
      secondaryAfterPrimary: 500,
      secondaryInterval: 1000,
      secondaryIntervalHit: 1100,
      followUpWindow: 400,
    });
  });
});
