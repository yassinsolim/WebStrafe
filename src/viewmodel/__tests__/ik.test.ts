import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { frameFromYZ, signedAngleAbout, solveTwoBone } from '../ik';

describe('solveTwoBone', () => {
  const root = new Vector3(0.19, -0.28, 0.12);
  const a = 0.3;
  const b = 0.26;

  it('reaches a reachable target with the right bone lengths', () => {
    const target = new Vector3(0.12, -0.16, -0.3);
    const pole = new Vector3(0.5, -0.8, 0);
    const elbow = new Vector3();
    const wrist = new Vector3();
    expect(solveTwoBone(root, target, pole, a, b, elbow, wrist)).toBe(true);
    expect(wrist.distanceTo(target)).toBeLessThan(1e-4);
    expect(elbow.distanceTo(root)).toBeCloseTo(a, 5);
    expect(elbow.distanceTo(wrist)).toBeCloseTo(b, 5);
  });

  it('bends the elbow toward the pole', () => {
    const target = new Vector3(0.12, -0.16, -0.3);
    const elbow = new Vector3();
    const wrist = new Vector3();
    solveTwoBone(root, target, new Vector3(0.19, -2, -0.1), a, b, elbow, wrist);
    const mid = root.clone().lerp(target, 0.5);
    expect(elbow.y).toBeLessThan(mid.y);
    solveTwoBone(root, target, new Vector3(0.19, 2, -0.1), a, b, elbow, wrist);
    expect(elbow.y).toBeGreaterThan(mid.y);
  });

  it('clamps an out of reach target onto the straight arm', () => {
    const target = new Vector3(0.19, -0.28, -2);
    const elbow = new Vector3();
    const wrist = new Vector3();
    expect(solveTwoBone(root, target, new Vector3(0, -1, 0), a, b, elbow, wrist)).toBe(false);
    expect(wrist.distanceTo(root)).toBeCloseTo(a + b, 3);
    expect(wrist.z).toBeLessThan(root.z);
  });

  it('still returns finite joints when the pole is on the arm line', () => {
    const target = new Vector3(0.19, -0.28, -0.3);
    const elbow = new Vector3();
    const wrist = new Vector3();
    solveTwoBone(root, target, new Vector3(0.19, -0.28, -1), a, b, elbow, wrist);
    expect(Number.isFinite(elbow.x + elbow.y + elbow.z)).toBe(true);
    expect(elbow.distanceTo(root)).toBeCloseTo(a, 5);
  });
});

describe('frameFromYZ', () => {
  it('builds a right handed frame with y exact and z orthogonalised', () => {
    const q = new Quaternion();
    frameFromYZ(new Vector3(0, 0, -1), new Vector3(0, 1, 0.3), q);
    const x = new Vector3(1, 0, 0).applyQuaternion(q);
    const y = new Vector3(0, 1, 0).applyQuaternion(q);
    const z = new Vector3(0, 0, 1).applyQuaternion(q);
    expect(y.distanceTo(new Vector3(0, 0, -1))).toBeLessThan(1e-6);
    expect(z.distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-6);
    expect(x.distanceTo(new Vector3(1, 0, 0))).toBeLessThan(1e-6);
  });
});

describe('signedAngleAbout', () => {
  it('measures twist about an axis', () => {
    const angle = signedAngleAbout(new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1));
    expect(angle).toBeCloseTo(Math.PI / 2, 6);
    expect(signedAngleAbout(new Vector3(0, 1, 0), new Vector3(1, 0, 0), new Vector3(0, 0, 1))).toBeCloseTo(-Math.PI / 2, 6);
  });
});
