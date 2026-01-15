import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { accelerate, applyFriction, clipVelocity } from '../MovementMath';

describe('MovementMath', () => {
  it('accelerate increases speed toward wishdir up to addSpeed', () => {
    const vel = new Vector3(1, 0, 0);
    const wishDir = new Vector3(1, 0, 0).normalize();
    const next = accelerate(vel, wishDir, 10, 12, 1 / 128, 1);
    expect(next.x).toBeGreaterThan(vel.x);
    expect(next.x).toBeLessThanOrEqual(10);
  });

  it('applyFriction drops horizontal speed', () => {
    const vel = new Vector3(6, 0, 4);
    const next = applyFriction(vel, 1 / 128, 5, 2);
    expect(Math.hypot(next.x, next.z)).toBeLessThan(Math.hypot(vel.x, vel.z));
  });

  it('clipVelocity removes velocity into the collision plane', () => {
    const vel = new Vector3(2, -4, 0);
    const normal = new Vector3(0, 1, 0);
    const clipped = clipVelocity(vel, normal, 1.001);
    expect(clipped.y).toBeGreaterThanOrEqual(-1e-5);
  });
});
