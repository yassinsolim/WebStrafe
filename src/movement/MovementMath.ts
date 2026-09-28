import { Vector3 } from 'three';

const EPSILON = 1e-6;

/**
 * source's CGameMovement::Accelerate. `accelScale` is the speed the accel rate
 * scales with, the wishspeed itself unless a crop (crouching) lowered only the
 * goal speed.
 */
export function accelerate(
  vel: Vector3,
  wishDir: Vector3,
  wishSpeed: number,
  accel: number,
  dt: number,
  surfaceFriction = 1,
  accelScale = wishSpeed,
): Vector3 {
  const next = vel.clone();
  const currentSpeed = next.dot(wishDir);
  const addSpeed = wishSpeed - currentSpeed;
  if (addSpeed <= 0) {
    return next;
  }

  let accelSpeed = accel * dt * accelScale * surfaceFriction;
  accelSpeed = Math.min(accelSpeed, addSpeed);
  next.addScaledVector(wishDir, accelSpeed);
  return next;
}

/**
 * source's CGameMovement::AirAccelerate. the speed you can still add along
 * wishdir is capped by maxWishSpeed (sv_air_max_wishspeed, 30 u/s), but the
 * accel rate uses the full uncapped wishspeed. with a big sv_airaccelerate the
 * cap wins every tick, so velocity along wishdir can't go past the cap and you
 * only gain speed while wishdir keeps turning away from your velocity, which is
 * what turning in sync with the strafe key does.
 */
export function airAccelerate(
  vel: Vector3,
  wishDir: Vector3,
  wishSpeed: number,
  accel: number,
  dt: number,
  maxWishSpeed: number,
  surfaceFriction = 1,
): Vector3 {
  const next = vel.clone();
  const cappedWishSpeed = Math.min(wishSpeed, maxWishSpeed);
  const currentSpeed = next.dot(wishDir);
  const addSpeed = cappedWishSpeed - currentSpeed;
  if (addSpeed <= 0) {
    return next;
  }

  let accelSpeed = accel * wishSpeed * dt * surfaceFriction;
  accelSpeed = Math.min(accelSpeed, addSpeed);
  next.addScaledVector(wishDir, accelSpeed);
  return next;
}

export function applyFriction(
  vel: Vector3,
  dt: number,
  friction: number,
  stopspeed: number,
): Vector3 {
  const next = vel.clone();
  const speed = Math.hypot(next.x, next.z);
  if (speed <= EPSILON) {
    next.x = 0;
    next.z = 0;
    return next;
  }

  const control = Math.max(speed, stopspeed);
  const drop = control * friction * dt;
  const newSpeed = Math.max(0, speed - drop);
  const scale = newSpeed / speed;
  next.x *= scale;
  next.z *= scale;
  return next;
}

export function clipVelocity(
  vel: Vector3,
  normal: Vector3,
  overbounce: number,
): Vector3 {
  const next = vel.clone();
  const backoff = next.dot(normal) * overbounce;
  next.addScaledVector(normal, -backoff);

  // Remove residual velocity pointing into the plane to prevent sticky ramps.
  const adjust = next.dot(normal);
  if (adjust < 0) {
    next.addScaledVector(normal, -adjust);
  }
  return next;
}

export function projectDirectionOnPlane(dir: Vector3, normal: Vector3): Vector3 {
  const projected = dir.clone().addScaledVector(normal, -dir.dot(normal));
  if (projected.lengthSq() <= EPSILON) {
    return new Vector3();
  }
  return projected.normalize();
}

export function horizontalLength(vec: Vector3): number {
  return Math.hypot(vec.x, vec.z);
}
