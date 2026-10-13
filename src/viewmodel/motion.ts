import { Quaternion, Vector3 } from 'three';

/**
 * motion helpers shared by the first person rig, the camera space viewmodel
 * motion and the third person characters. all of it is frame rate independent:
 * the springs are solved exactly for the step instead of nudged per frame.
 */

/** damping of a critically damped spring that halves its distance to the goal every `halflife` seconds */
export function dampingFromHalflife(halflife: number): number {
  return (4 * Math.LN2) / Math.max(1e-5, halflife);
}

export interface SpringState {
  x: number;
  v: number;
}

/** one exact step of a critically damped spring toward `goal` */
export function springStep(state: SpringState, goal: number, halflife: number, dt: number): void {
  if (dt <= 0) return;
  const y = dampingFromHalflife(halflife) / 2;
  const j0 = state.x - goal;
  const j1 = state.v + j0 * y;
  const e = Math.exp(-y * dt);
  state.x = e * (j0 + j1 * dt) + goal;
  state.v = e * (state.v - j1 * y * dt);
}

export function createSpring(x = 0): SpringState {
  return { x, v: 0 };
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const u = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return u * u * (3 - 2 * u);
}

/** rotation vector (axis times angle, radians) of a unit quaternion, the short way round */
export function quaternionToRotationVector(q: Quaternion, out: Vector3): Vector3 {
  const sign = q.w < 0 ? -1 : 1;
  const x = q.x * sign;
  const y = q.y * sign;
  const z = q.z * sign;
  const s = Math.hypot(x, y, z);
  if (s < 1e-9) return out.set(2 * x, 2 * y, 2 * z);
  const angle = 2 * Math.atan2(s, q.w * sign);
  return out.set(x, y, z).multiplyScalar(angle / s);
}

export function rotationVectorToQuaternion(r: Vector3, out: Quaternion): Quaternion {
  const angle = r.length();
  if (angle < 1e-9) return out.set(r.x / 2, r.y / 2, r.z / 2, 1).normalize();
  const s = Math.sin(angle / 2) / angle;
  return out.set(r.x * s, r.y * s, r.z * s, Math.cos(angle / 2));
}

const qDelta = new Quaternion();
const qOffset = new Quaternion();

/** angular velocity (rad/s, rotation vector in the frames' common space) taking `from` to `to` in `dt` */
export function angularVelocity(from: Quaternion, to: Quaternion, dt: number, out: Vector3): Vector3 {
  if (dt <= 0) return out.set(0, 0, 0);
  qDelta.copy(to).multiply(qOffset.copy(from).invert());
  return quaternionToRotationVector(qDelta, out).divideScalar(dt);
}

/**
 * inertial blending: when an animation switches, the difference between where
 * the old one left the output (and how fast it was moving) and where the new
 * one starts is kept as an offset that dies away on a critically damped
 * spring. the motion carries its momentum through the switch instead of
 * freezing and crossfading, and a switch in the middle of a switch just starts
 * again from the current output.
 */
export class ScalarInertializer {
  private readonly state = createSpring();

  public begin(output: number, outputVelocity: number, target: number, targetVelocity: number): void {
    this.state.x = output - target;
    this.state.v = outputVelocity - targetVelocity;
  }

  public update(halflife: number, dt: number): void {
    springStep(this.state, 0, halflife, dt);
  }

  public offset(): number {
    return this.state.x;
  }

  public clear(): void {
    this.state.x = 0;
    this.state.v = 0;
  }
}

export class Vec3Inertializer {
  private readonly x = createSpring();
  private readonly y = createSpring();
  private readonly z = createSpring();

  public begin(output: Vector3, outputVelocity: Vector3, target: Vector3, targetVelocity: Vector3): void {
    this.x.x = output.x - target.x;
    this.y.x = output.y - target.y;
    this.z.x = output.z - target.z;
    this.x.v = outputVelocity.x - targetVelocity.x;
    this.y.v = outputVelocity.y - targetVelocity.y;
    this.z.v = outputVelocity.z - targetVelocity.z;
  }

  public update(halflife: number, dt: number): void {
    springStep(this.x, 0, halflife, dt);
    springStep(this.y, 0, halflife, dt);
    springStep(this.z, 0, halflife, dt);
  }

  /** out = target + offset (out may be target) */
  public apply(target: Vector3, out: Vector3): Vector3 {
    return out.set(target.x + this.x.x, target.y + this.y.x, target.z + this.z.x);
  }

  public size(): number {
    return Math.hypot(this.x.x, this.y.x, this.z.x);
  }

  public clear(): void {
    for (const s of [this.x, this.y, this.z]) {
      s.x = 0;
      s.v = 0;
    }
  }
}

const rotOffset = new Vector3();

/** the same for rotations: the offset is a rotation vector, picked the short way once at the switch so it never flips */
export class QuatInertializer {
  private readonly offset = new Vec3Inertializer();
  private readonly zero = new Vector3();
  private readonly start = new Vector3();

  public begin(output: Quaternion, outputVelocity: Vector3, target: Quaternion, targetVelocity: Vector3): void {
    qDelta.copy(output).multiply(qOffset.copy(target).invert());
    quaternionToRotationVector(qDelta, this.start);
    this.offset.begin(this.start, outputVelocity, this.zero, targetVelocity);
  }

  public update(halflife: number, dt: number): void {
    this.offset.update(halflife, dt);
  }

  /** out = offset * target (out may be target) */
  public apply(target: Quaternion, out: Quaternion): Quaternion {
    this.offset.apply(this.zero, rotOffset);
    rotationVectorToQuaternion(rotOffset, qOffset);
    return out.copy(qOffset).multiply(target).normalize();
  }

  /** radians left to blend out */
  public size(): number {
    return this.offset.size();
  }

  public clear(): void {
    this.offset.clear();
  }
}
