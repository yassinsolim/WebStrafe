import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { constrainWristRotation, frameFromYZ, signedAngleAbout, solveTwoBone } from '../ik';

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

  it('moves the elbow to support the hand without changing the grip target or bone lengths', () => {
    const shoulder = new Vector3(-0.19, -0.28, 0.12);
    const target = new Vector3(-0.172, -0.147, -0.242);
    const pole = new Vector3(0.259, -0.942, -0.212);
    const handDirection = new Vector3(0.467, 0.226, -0.855).normalize();
    const elbow = new Vector3();
    const wrist = new Vector3();
    solveTwoBone(shoulder, target, pole, a, b, elbow, wrist);
    const before = wrist.clone().sub(elbow).normalize().angleTo(handDirection);
    solveTwoBone(shoulder, target, pole, a, b, elbow, wrist, handDirection);
    const after = wrist.clone().sub(elbow).normalize().angleTo(handDirection);
    expect(before * 180 / Math.PI).toBeGreaterThan(55);
    expect(after * 180 / Math.PI).toBeLessThanOrEqual(35.001);
    expect(wrist.distanceTo(target)).toBeLessThan(1e-5);
    expect(elbow.distanceTo(shoulder)).toBeCloseTo(a, 5);
    expect(elbow.distanceTo(wrist)).toBeCloseTo(b, 5);
  });

  it('keeps the authored elbow when the wrist is already comfortable', () => {
    const target = new Vector3(0.12, -0.16, -0.3);
    const pole = new Vector3(0.5, -0.8, 0);
    const elbow = new Vector3();
    const wrist = new Vector3();
    solveTwoBone(root, target, pole, a, b, elbow, wrist);
    const original = elbow.clone();
    const handDirection = wrist.clone().sub(elbow).normalize();
    solveTwoBone(root, target, pole, a, b, elbow, wrist, handDirection);
    expect(elbow.distanceTo(original)).toBeLessThan(1e-6);
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

describe('constrainWristRotation', () => {
  it('keeps a free support hand away from the wrist limits used for attacks', () => {
    const forearm = new Vector3(0.7, 0.15, -0.65).normalize();
    const rotation = constrainWristRotation(forearm, new Quaternion(), new Quaternion(), true);
    const relative = forearm.clone().applyQuaternion(rotation.clone().invert());
    expect(Math.abs(Math.atan2(relative.z, relative.y) * 180 / Math.PI)).toBeLessThanOrEqual(20.001);
    expect(Math.abs(Math.atan2(relative.x, relative.y) * 180 / Math.PI)).toBeLessThanOrEqual(15.001);
  });

  it('keeps comfortable hand rotations unchanged', () => {
    const rotation = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.3);
    const result = constrainWristRotation(new Vector3(0, 1, 0), rotation, new Quaternion());
    expect(result.angleTo(rotation)).toBeLessThan(1e-6);
  });

  it('bounds flexion, extension and sideways deviation even for folded-back targets', () => {
    const forearm = new Vector3(0.2, 0.7, -0.8).normalize();
    for (const axis of [new Vector3(1, 0, 0), new Vector3(0, 0, 1), new Vector3(1, 1, 1).normalize()]) {
      for (let degrees = -180; degrees <= 180; degrees += 10) {
        const desired = new Quaternion().setFromAxisAngle(axis, degrees * Math.PI / 180);
        const actual = constrainWristRotation(forearm, desired, new Quaternion());
        const relative = forearm.clone().applyQuaternion(actual.clone().invert());
        const flex = Math.atan2(relative.z, relative.y) * 180 / Math.PI;
        const deviation = Math.atan2(relative.x, relative.y) * 180 / Math.PI;
        expect(flex).toBeGreaterThanOrEqual(-45.001);
        expect(flex).toBeLessThanOrEqual(40.001);
        expect(Math.abs(deviation)).toBeLessThanOrEqual(25.001);
        expect(actual.length()).toBeCloseTo(1, 6);
      }
    }
  });
});

describe('signedAngleAbout', () => {
  it('measures twist about an axis', () => {
    const angle = signedAngleAbout(new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1));
    expect(angle).toBeCloseTo(Math.PI / 2, 6);
    expect(signedAngleAbout(new Vector3(0, 1, 0), new Vector3(1, 0, 0), new Vector3(0, 0, 1))).toBeCloseTo(-Math.PI / 2, 6);
  });
});
