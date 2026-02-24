import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { accelerate, applyFriction, clipVelocity, clampHorizontalSpeed, projectDirectionOnPlane } from '../MovementMath';

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

describe('clampHorizontalSpeed', () => {
  it('does not modify velocity already under the limit', () => {
    const vel = new Vector3(3, 5, 0); // horizontal speed = 3, under limit of 10
    const result = clampHorizontalSpeed(vel, 10);
    expect(result.x).toBeCloseTo(3);
    expect(result.z).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(5); // vertical unchanged
  });

  it('clamps horizontal speed to the limit when over', () => {
    const vel = new Vector3(6, 0, 8); // horizontal speed = 10, limit = 5
    const result = clampHorizontalSpeed(vel, 5);
    expect(Math.hypot(result.x, result.z)).toBeCloseTo(5);
    expect(result.y).toBeCloseTo(0); // vertical unchanged
  });

  it('preserves direction when clamping', () => {
    const vel = new Vector3(6, 2, 8); // horizontal speed = 10
    const result = clampHorizontalSpeed(vel, 5);
    // Direction ratio x/z should be preserved
    expect(result.x / result.z).toBeCloseTo(vel.x / vel.z);
  });

  it('handles zero vector without division by zero', () => {
    const vel = new Vector3(0, 0, 0);
    const result = clampHorizontalSpeed(vel, 10);
    expect(result.x).toBeCloseTo(0);
    expect(result.z).toBeCloseTo(0);
  });
});

describe('projectDirectionOnPlane', () => {
  it('returns a normalized vector perpendicular to the normal', () => {
    const dir = new Vector3(1, 1, 0).normalize();
    const normal = new Vector3(0, 1, 0);
    const result = projectDirectionOnPlane(dir, normal);
    // Result should be unit length
    expect(result.length()).toBeCloseTo(1);
    // Result should be perpendicular to the normal (dot product ≈ 0)
    expect(result.dot(normal)).toBeCloseTo(0);
  });

  it('returns zero vector when direction is parallel to normal', () => {
    const dir = new Vector3(0, 1, 0); // same direction as normal
    const normal = new Vector3(0, 1, 0);
    const result = projectDirectionOnPlane(dir, normal);
    expect(result.length()).toBeCloseTo(0);
  });

  it('does not mutate input vectors', () => {
    const dir = new Vector3(1, 1, 0).normalize();
    const normal = new Vector3(0, 1, 0);
    const dirBefore = dir.clone();
    const normalBefore = normal.clone();
    projectDirectionOnPlane(dir, normal);
    expect(dir.equals(dirBefore)).toBe(true);
    expect(normal.equals(normalBefore)).toBe(true);
  });
});
