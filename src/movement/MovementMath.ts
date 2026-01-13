import { Vector3 } from 'three';

const EPSILON = 1e-6;

export function accelerate(
  vel: Vector3,
  wishDir: Vector3,
  wishSpeed: number,
  accel: number,
  dt: number,
  surfaceFriction = 1,
): Vector3 {
  const next = vel.clone();
  const currentSpeed = next.dot(wishDir);
  const addSpeed = wishSpeed - currentSpeed;
  if (addSpeed <= 0) {
    return next;
  }

  let accelSpeed = accel * dt * wishSpeed * surfaceFriction;
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

export function clampHorizontalSpeed(vel: Vector3, maxSpeed: number): Vector3 {
  const next = vel.clone();
  const horizontalSpeed = Math.hypot(next.x, next.z);
  if (horizontalSpeed <= maxSpeed || horizontalSpeed <= EPSILON) {
    return next;
  }

  const scale = maxSpeed / horizontalSpeed;
  next.x *= scale;
  next.z *= scale;
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
