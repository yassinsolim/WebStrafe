import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  aimDirection,
  createSeededRandom,
  Inaccuracy,
  INACCURACY_PROFILES,
  METRES_PER_UNIT,
  type AimMotion,
} from '../Inaccuracy';

const TICK = 1 / 128;
const MAX_SPEED = 9.5;
const JUMP = 5.4;

const standing: AimMotion = {
  horizontalSpeed: 0,
  verticalSpeed: 0,
  grounded: true,
  maxSpeed: MAX_SPEED,
  jumpImpulse: JUMP,
};

function run(model: Inaccuracy, seconds: number, motion: AimMotion = standing): void {
  for (let t = 0; t < seconds - 1e-9; t += TICK) model.tick(TICK, motion);
}

function withWeapon(weapon: 'awp' | 'deagle', seed = 7): Inaccuracy {
  const model = new Inaccuracy(createSeededRandom(seed));
  model.setWeapon(weapon);
  run(model, 0.1);
  return model;
}

describe('Inaccuracy', () => {
  it('is zero for the knife', () => {
    const model = new Inaccuracy();
    model.setWeapon(null);
    run(model, 0.5);
    expect(model.getInaccuracyRadians()).toBe(0);
    expect(model.sampleSpread()).toEqual({ x: 0, y: 0 });
  });

  it('gives the deagle cs first-shot accuracy while standing still', () => {
    const deagle = withWeapon('deagle');
    const profile = INACCURACY_PROFILES.deagle;
    expect(deagle.getInaccuracyRadians()).toBeCloseTo(profile.stand + profile.spread, 9);
    expect(deagle.getInaccuracyRadians()).toBeLessThan(0.007);
  });

  it('opens up after a deagle shot and recovers over about 0.4 s', () => {
    const deagle = withWeapon('deagle');
    const first = deagle.getInaccuracyRadians();
    deagle.onShot();
    expect(deagle.getInaccuracyRadians()).toBeCloseTo(first + INACCURACY_PROFILES.deagle.fire, 9);
    run(deagle, 0.2);
    const midway = deagle.getInaccuracyRadians();
    expect(midway).toBeGreaterThan(first * 3);
    run(deagle, 0.2);
    // 90% of the shot penalty is gone after the recovery time
    expect(deagle.getInaccuracyRadians()).toBeCloseTo(first + INACCURACY_PROFILES.deagle.fire * 0.1, 3);
    run(deagle, 0.4);
    expect(deagle.getInaccuracyRadians()).toBeLessThan(first * 1.2);
  });

  it('makes a no-scope very inaccurate and a settled scope pin-point', () => {
    const awp = withWeapon('awp');
    const noScope = awp.getInaccuracyRadians();
    expect(noScope).toBeGreaterThan(0.08);

    awp.setScoped(true);
    run(awp, 0.1);
    expect(awp.getInaccuracyRadians()).toBeGreaterThan(0.02);
    run(awp, 0.2);
    // under 0.5 degrees 0.3 s after zooming in
    expect(awp.getInaccuracyRadians()).toBeLessThan(0.0087);
    run(awp, 0.5);
    const settled = INACCURACY_PROFILES.awpScoped.stand + INACCURACY_PROFILES.awpScoped.spread;
    expect(awp.getInaccuracyRadians()).toBeCloseTo(settled, 4);
  });

  it('collapses awp accuracy above 34% of max speed', () => {
    const awp = withWeapon('awp');
    awp.setScoped(true);
    run(awp, 1);
    const still = awp.getInaccuracyRadians();
    run(awp, TICK, { ...standing, horizontalSpeed: MAX_SPEED * 0.33 });
    expect(awp.getInaccuracyRadians()).toBeCloseTo(still, 5);
    run(awp, TICK, { ...standing, horizontalSpeed: MAX_SPEED * 0.4 });
    expect(awp.getInaccuracyRadians()).toBeGreaterThan(still + 0.08);
    run(awp, TICK, { ...standing, horizontalSpeed: MAX_SPEED });
    expect(awp.getInaccuracyRadians()).toBeCloseTo(still + INACCURACY_PROFILES.awp.move, 3);
  });

  it('is worst at take-off, better at the apex, and pays a landing penalty', () => {
    const deagle = withWeapon('deagle');
    const ground = deagle.getInaccuracyRadians();
    run(deagle, TICK, { ...standing, grounded: false, verticalSpeed: JUMP });
    const takeOff = deagle.getInaccuracyRadians();
    run(deagle, 0.25, { ...standing, grounded: false, verticalSpeed: 0.05 });
    const apex = deagle.getInaccuracyRadians();
    expect(takeOff).toBeGreaterThan(apex);
    expect(apex).toBeGreaterThan(ground);
    const profile = INACCURACY_PROFILES.deagle;
    expect(apex).toBeCloseTo(profile.stand + profile.jump + profile.spread, 3);

    run(deagle, 0.25, { ...standing, grounded: false, verticalSpeed: -JUMP });
    run(deagle, TICK, standing);
    const landed = deagle.getInaccuracyRadians();
    const landPenalty = profile.landPerUnitSpeed * (JUMP / METRES_PER_UNIT);
    expect(landed).toBeGreaterThan(ground + landPenalty * 0.9);
    run(deagle, 1);
    expect(deagle.getInaccuracyRadians()).toBeCloseTo(ground, 3);
  });

  it('samples a deterministic cone that stays inside the reported radius', () => {
    const a = withWeapon('deagle', 42);
    const b = withWeapon('deagle', 42);
    a.onShot();
    b.onShot();
    const radius = a.getInaccuracyRadians();
    for (let i = 0; i < 200; i += 1) {
      const sa = a.sampleSpread();
      const sb = b.sampleSpread();
      expect(sa).toEqual(sb);
      expect(Math.hypot(sa.x, sa.y)).toBeLessThanOrEqual(radius + 1e-12);
    }
  });

  it('starts a switched-in gun at its floor', () => {
    const model = withWeapon('deagle');
    model.onShot();
    model.setWeapon('awp');
    expect(model.getInaccuracyRadians()).toBeCloseTo(
      INACCURACY_PROFILES.awp.stand + INACCURACY_PROFILES.awp.spread,
      9,
    );
  });
});

describe('aimDirection', () => {
  it('matches the movement forward vector and tilts by the offsets', () => {
    const yaw = 0.7;
    const pitch = -0.3;
    const forward = aimDirection(yaw, pitch);
    const expected = new Vector3(
      -Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch),
    );
    expect(forward.distanceTo(expected)).toBeLessThan(1e-12);

    const up = aimDirection(0, 0, { x: 0, y: 0.01 });
    expect(up.y).toBeGreaterThan(0);
    expect(Math.atan2(up.y, -up.z)).toBeCloseTo(0.01, 4);
    const right = aimDirection(0, 0, { x: 0.02, y: 0 });
    expect(Math.atan2(right.x, -right.z)).toBeCloseTo(0.02, 4);
  });
});
