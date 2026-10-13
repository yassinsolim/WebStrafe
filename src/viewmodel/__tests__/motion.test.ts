import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  angularVelocity,
  createSpring,
  QuatInertializer,
  quaternionToRotationVector,
  rotationVectorToQuaternion,
  ScalarInertializer,
  springStep,
  Vec3Inertializer,
} from '../motion';

describe('springStep', () => {
  it('halves the distance to the goal every halflife from rest', () => {
    const spring = createSpring(1);
    for (let i = 0; i < 1000; i += 1) springStep(spring, 0, 0.1, 0.0001);
    // a critically damped spring from rest lags a pure exponential a little
    expect(spring.x).toBeGreaterThan(0.5);
    expect(spring.x).toBeLessThan(0.62);
    expect(spring.v).toBeLessThan(0);
  });

  it('lands in the same place whatever the frame rate', () => {
    const run = (fps: number) => {
      const spring = createSpring(0.2);
      spring.v = -3;
      for (let i = 0; i < fps; i += 1) springStep(spring, 0.05, 0.08, 1 / fps);
      return spring;
    };
    const slow = run(30);
    const fast = run(240);
    expect(slow.x).toBeCloseTo(fast.x, 9);
    expect(slow.v).toBeCloseTo(fast.v, 9);
  });

  it('ignores zero and negative steps', () => {
    const spring = createSpring(1);
    springStep(spring, 0, 0.1, 0);
    expect(spring).toEqual({ x: 1, v: 0 });
  });
});

describe('inertializers', () => {
  it('carries the old motion through a switch without a jump in position or speed', () => {
    const blend = new ScalarInertializer();
    // the output was 8 cm off moving at 1.5 m/s, the new clip starts moving at 0.3 m/s
    blend.begin(0.08, 1.5, 0, 0.3);
    const at = (t: number) => t * 0.3 + blend.offset();
    expect(at(0)).toBeCloseTo(0.08, 9);
    const tiny = 1e-5;
    blend.update(0.05, tiny);
    expect((at(tiny) - 0.08) / tiny).toBeCloseTo(1.5, 2);
    for (let i = 0; i < 240; i += 1) blend.update(0.05, 1 / 240);
    expect(Math.abs(blend.offset())).toBeLessThan(1e-4);
  });

  it('blends positions out component by component', () => {
    const blend = new Vec3Inertializer();
    blend.begin(new Vector3(1, 2, 3), new Vector3(), new Vector3(1, 1, 1), new Vector3());
    const out = blend.apply(new Vector3(1, 1, 1), new Vector3());
    expect(out.toArray()).toEqual([1, 2, 3]);
    blend.update(0.05, 1);
    expect(blend.size()).toBeLessThan(1e-6);
  });

  it('takes rotations the short way and never flips while the target spins past half a turn', () => {
    const blend = new QuatInertializer();
    const axis = new Vector3(0, 1, 0);
    const output = new Quaternion().setFromAxisAngle(axis, 0);
    const target = (t: number) => new Quaternion().setFromAxisAngle(axis, 2.4 + t * 20);
    blend.begin(output, new Vector3(), target(0), new Vector3(0, 20, 0));
    const shown = new Quaternion();
    const prev = blend.apply(target(0), new Quaternion());
    expect(prev.angleTo(output)).toBeLessThan(1e-6);
    const dt = 1 / 240;
    let worstStep = 0;
    for (let i = 1; i <= 96; i += 1) {
      blend.update(0.05, dt);
      blend.apply(target(i * dt), shown);
      worstStep = Math.max(worstStep, shown.angleTo(prev));
      prev.copy(shown);
    }
    // the target turns 20 rad/s (0.083 rad a step); nothing near a flip
    expect(worstStep).toBeLessThan(0.2);
  });

  it('measures angular velocity and round trips rotation vectors', () => {
    const r = new Vector3(0.3, -1.2, 0.5);
    const q = rotationVectorToQuaternion(r, new Quaternion());
    expect(quaternionToRotationVector(q, new Vector3()).distanceTo(r)).toBeLessThan(1e-9);
    const w = angularVelocity(new Quaternion(), q, 0.5, new Vector3());
    expect(w.distanceTo(r.clone().multiplyScalar(2))).toBeLessThan(1e-9);
    expect(angularVelocity(new Quaternion(), q, 0, new Vector3()).length()).toBe(0);
  });
});
