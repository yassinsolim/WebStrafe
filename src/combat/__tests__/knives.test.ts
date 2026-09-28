import { describe, expect, it } from 'vitest';
import { Box3, Mesh, Vector3 } from 'three';
import {
  getKnife,
  isBackstab,
  isKnifeId,
  knifeDamage,
  KNIFE_DAMAGE,
  KNIVES,
} from '../knives';
import { buildProceduralKnife, disposeProceduralKnife } from '../../cosmetics/ProceduralKnife';

// verified sep 2026: 20 types, kukri (feb 2024) is the newest
const CS2_KNIFE_TYPES = [
  'Bayonet', 'M9 Bayonet', 'Karambit', 'Butterfly Knife', 'Flip Knife', 'Gut Knife',
  'Huntsman Knife', 'Falchion Knife', 'Bowie Knife', 'Shadow Daggers', 'Navaja Knife',
  'Stiletto Knife', 'Talon Knife', 'Ursus Knife', 'Classic Knife', 'Paracord Knife',
  'Survival Knife', 'Nomad Knife', 'Skeleton Knife', 'Kukri Knife',
];

describe('knife catalog', () => {
  it('covers every CS2 knife type exactly once', () => {
    expect(KNIVES).toHaveLength(20);
    expect(new Set(KNIVES.map((k) => k.referenceType))).toEqual(new Set(CS2_KNIFE_TYPES));
    expect(new Set(KNIVES.map((k) => k.id)).size).toBe(20);
  });

  it('uses our own display names, not the reference names', () => {
    const renamed = KNIVES.filter((k) => k.name !== k.referenceType);
    // generic knife words (karambit, kukri, navaja...) may stay as they are
    expect(renamed.length).toBeGreaterThanOrEqual(14);
    expect(KNIVES.some((k) => /shadow daggers|ursus|talon|nomad|paracord/i.test(k.name))).toBe(false);
  });

  it('falls back to the default knife for unknown ids', () => {
    expect(getKnife('nope').id).toBe('karambit');
    expect(isKnifeId('kukri')).toBe(true);
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
      expect(triangles, def.id).toBeLessThan(6000);
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
});
