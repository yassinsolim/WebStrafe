import { MathUtils, Vector3 } from 'three';
import type { CapsuleShape, GroundProbe } from '../types';
import type { CollisionAdapter, OverlapResult, TraceResult } from '../../world/CollisionWorld';

interface Surface {
  height: number;
  normal: Vector3;
  slopeAngleDeg: number;
}

type SurfaceAt = (x: number, z: number) => Surface | null;

const UP = new Vector3(0, 1, 0);

/**
 * heightfield world for movement tests: one surface height per (x, z), no walls.
 * same trace rules as the world in MovementBehavior.test.ts.
 */
class HeightfieldWorld implements CollisionAdapter {
  constructor(private readonly surfaceAt: SurfaceAt) {}

  public queryGround(feet: Vector3, _capsule: CapsuleShape, probeDistance: number): GroundProbe | null {
    const surface = this.surfaceAt(feet.x, feet.z);
    if (!surface) {
      return null;
    }
    const distance = feet.y - surface.height;
    if (distance < -0.1 || distance > probeDistance) {
      return null;
    }
    return {
      distance: Math.max(0, distance),
      position: new Vector3(feet.x, surface.height, feet.z),
      normal: surface.normal.clone(),
      slopeAngleDeg: surface.slopeAngleDeg,
    };
  }

  public traceCapsule(start: Vector3, end: Vector3, _capsule: CapsuleShape): TraceResult {
    const startSurface = this.surfaceAt(start.x, start.z);
    const endSurface = this.surfaceAt(end.x, end.z);
    const miss = { hit: false, fraction: 1, normal: UP.clone(), position: end.clone() };
    if (!endSurface) {
      return miss;
    }
    const d0 = start.y - (startSurface?.height ?? endSurface.height);
    const d1 = end.y - endSurface.height;
    if (d1 >= 0) {
      return miss;
    }
    const raw = d0 / (d0 - d1);
    const fraction = MathUtils.clamp(Number.isFinite(raw) ? raw : 0, 0, 1);
    const position = start.clone().lerp(end, fraction);
    position.y = endSurface.height;
    return { hit: true, fraction, normal: endSurface.normal.clone(), position };
  }

  public resolveCapsulePosition(feet: Vector3, _capsule: CapsuleShape): OverlapResult {
    const surface = this.surfaceAt(feet.x, feet.z);
    if (!surface || feet.y >= surface.height) {
      return { collided: false, depth: 0, normal: UP.clone(), position: feet.clone() };
    }
    return {
      collided: true,
      depth: surface.height - feet.y,
      normal: surface.normal.clone(),
      position: new Vector3(feet.x, surface.height, feet.z),
    };
  }
}

const flat = (height: number): Surface => ({ height, normal: UP.clone(), slopeAngleDeg: 0 });

/** nothing to touch, for free-fall air tests */
export function emptyWorld(): CollisionAdapter {
  return new HeightfieldWorld(() => null);
}

/** endless floor at y = 0 */
export function flatWorld(): CollisionAdapter {
  return new HeightfieldWorld(() => flat(0));
}

/** floor at y = 0 for x < 0 that drops by `drop` metres at x = 0 */
export function stepDownWorld(drop: number): CollisionAdapter {
  return new HeightfieldWorld((x) => flat(x < 0 ? 0 : -drop));
}

/**
 * one surf ramp, endless along z: y = top - tan(angle) * x for x in [0, length].
 * the face points +x, so it rises toward -x and "into the ramp" is -x.
 */
export function rampWorld(angleDeg: number, top = 8, length = 10): CollisionAdapter {
  const tan = Math.tan(MathUtils.degToRad(angleDeg));
  const normal = new Vector3(tan, 1, 0).normalize();
  return new HeightfieldWorld((x) =>
    x < 0 || x > length ? null : { height: top - tan * x, normal, slopeAngleDeg: angleDeg },
  );
}

export function rampHeight(angleDeg: number, x: number, top = 8): number {
  return top - Math.tan(MathUtils.degToRad(angleDeg)) * x;
}

export function horizontalSpeed(v: Vector3): number {
  return Math.hypot(v.x, v.z);
}

/** yaw that looks along the horizontal velocity (forward is (-sin yaw, 0, -cos yaw)) */
export function headingYaw(v: Vector3): number {
  return Math.atan2(-v.x, -v.z);
}
