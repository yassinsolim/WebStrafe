import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { getKnife, KNIVES } from '../../combat/knives';
import { alignRingGrip, gripKindFor, knifeGripSpec } from '../knifeGrips';

describe('knife grips', () => {
  it('picks the grip style each knife is really held with', () => {
    expect(gripKindFor(getKnife('karambit'))).toBe('reverse_ring');
    expect(gripKindFor(getKnife('talon'))).toBe('reverse_ring');
    expect(gripKindFor(getKnife('shadow_daggers'))).toBe('tee');
    expect(gripKindFor(getKnife('butterfly'))).toBe('balisong');
    expect(gripKindFor(getKnife('m9_bayonet'))).toBe('hammer');
    for (const def of KNIVES) expect(gripKindFor(def)).toBeTruthy();
  });

  it('puts the karambit ring on the index finger, not the thumb', () => {
    const spec = knifeGripSpec('reverse_ring', 0.024);
    expect(spec.anchor).toBe('ring');
    // index knuckle is on the hand's -x side at 10 cm; the thumb base sits near the wrist
    expect(spec.anchorInHand.x).toBeLessThan(-0.015);
    expect(spec.anchorInHand.y).toBeGreaterThan(0.1);
    expect(spec.pose.index[0]).toBeGreaterThan(45);
  });

  it('turns a ring knife so its handle ends up inside the fist', () => {
    const spec = knifeGripSpec('reverse_ring', 0.024);
    const ring = new Vector3(-0.1, 0.01, 0);
    const grip = new Vector3(-0.05, -0.012, 0);
    const aligned = alignRingGrip(spec, ring, grip);
    const gripInHand = grip.clone().sub(ring).applyQuaternion(aligned.knifeInHand).add(aligned.anchorInHand);
    // near the fist channel (9.3 cm up the hand, 2 cm to the palm side)
    expect(Math.abs(gripInHand.y - 0.095)).toBeLessThan(0.02);
    expect(gripInHand.z).toBeLessThan(0);
  });

  it('curls a ring knife claw toward the knuckles, not back at the wrist', () => {
    const spec = alignRingGrip(knifeGripSpec('reverse_ring', 0.024), new Vector3(-0.1, -0.022, 0), new Vector3(-0.043, 0.006, 0));
    // the hawkbill hooks toward the knife's -y (its edge side)
    const hook = new Vector3(0, -1, 0).applyQuaternion(spec.knifeInHand);
    expect(hook.y).toBeGreaterThan(0.5);
  });

  it('keeps every knife frame a proper rotation', () => {
    for (const kind of ['hammer', 'reverse_ring', 'tee', 'balisong'] as const) {
      const q = knifeGripSpec(kind, 0.026).knifeInHand;
      const x = new Vector3(1, 0, 0).applyQuaternion(q);
      const y = new Vector3(0, 1, 0).applyQuaternion(q);
      const z = new Vector3(0, 0, 1).applyQuaternion(q);
      expect(x.clone().cross(y).distanceTo(z)).toBeLessThan(1e-6);
    }
  });
});
