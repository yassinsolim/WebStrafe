import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { accelerate, airAccelerate, applyFriction, clipVelocity } from '../MovementMath';

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

describe('airAccelerate (source AirAccelerate)', () => {
  const dt = 1 / 128;
  const cap = 0.762;

  it('stops adding once the speed along wishdir reaches the cap', () => {
    const wishDir = new Vector3(1, 0, 0);
    let vel = new Vector3(0, 0, -9.5);
    for (let i = 0; i < 10; i += 1) {
      vel = airAccelerate(vel, wishDir, 9.5, 150, dt, cap);
      expect(vel.dot(wishDir)).toBeLessThanOrEqual(cap + 1e-12);
    }
    expect(vel.dot(wishDir)).toBeCloseTo(cap, 12);
    expect(vel.z).toBe(-9.5);
  });

  it('does nothing when the velocity along wishdir is already past the cap', () => {
    const vel = new Vector3(6, 0, 0);
    const next = airAccelerate(vel, new Vector3(1, 0, 0), 9.5, 150, dt, cap);
    expect(next.equals(vel)).toBe(true);
  });

  it('uses the full wishspeed for the accel rate, only addspeed is capped', () => {
    // 10 * 9.5 / 128 = 0.742 < cap, so one tick adds exactly accel * wishspeed * dt
    const next = airAccelerate(new Vector3(), new Vector3(1, 0, 0), 9.5, 10, dt, cap);
    expect(next.x).toBeCloseTo((10 * 9.5) / 128, 12);
  });

  it('a perpendicular wishdir adds exactly the cap, so |v| goes to sqrt(v^2 + cap^2)', () => {
    const vel = new Vector3(0, 0, -9.5);
    const next = airAccelerate(vel, new Vector3(1, 0, 0), 9.5, 150, dt, cap);
    expect(Math.hypot(next.x, next.z)).toBeCloseTo(Math.hypot(9.5, cap), 12);
  });

  it('pushing against the velocity can remove a lot in one tick (air stopping)', () => {
    // addspeed = cap + 9.5 = 10.26 and 150 * 9.5 / 128 = 11.13, so S reverses you to -cap
    const next = airAccelerate(new Vector3(0, 0, -9.5), new Vector3(0, 0, 1), 9.5, 150, dt, cap);
    expect(next.z).toBeCloseTo(cap, 12);
  });
});
