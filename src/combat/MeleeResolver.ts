import { Vector3 } from 'three';

export interface MeleeTarget {
  id: string;
  /** feet (base) position */
  feet: Vector3;
  height: number;
  radius: number;
}

export interface MeleeSweep {
  /** attacker eye */
  origin: Vector3;
  /** aim direction, normalized internally */
  direction: Vector3;
  /** max distance from the eye to the target capsule surface */
  range: number;
  /** radius of the sphere swept along the aim */
  radius: number;
}

export interface MeleeHit {
  targetId: string;
  /** where the swing connects, on the target's capsule surface */
  point: Vector3;
  /** eye to `point` */
  distance: number;
  /** eye to the nearest point of the target capsule */
  surfaceDistance: number;
}

/** true when world geometry sits between the two points */
export type SegmentBlocked = (from: Vector3, to: Vector3) => boolean;

const UP = new Vector3(0, 1, 0);
const EPS = 1e-9;
/** wall checks aim at least this far above the victim's feet so the floor under them never blocks */
const BLOCK_CHECK_MIN_HEIGHT = 0.3;
const BLOCK_CHECK_PULLBACK = 0.03;

/**
 * Forgiving knife hit test, like CS's hull trace: a sphere of `radius` is swept
 * from the eye along the aim for `range`, and any capsule it touches that is in
 * front of the attacker and within `range` of the eye counts. The nearest one
 * wins. With `isBlocked`, a swing whose contact point is behind world geometry
 * cannot land, so knives never cut through walls where the authority has
 * collision.
 */
export function resolveMeleeHit(
  sweep: MeleeSweep,
  targets: readonly MeleeTarget[],
  isBlocked?: SegmentBlocked,
): MeleeHit | null {
  if (!(sweep.range > 0) || sweep.direction.lengthSq() < 1e-12) {
    return null;
  }
  const origin = sweep.origin;
  const dir = sweep.direction.clone().normalize();
  const sweepEnd = origin.clone().addScaledVector(dir, sweep.range);
  const radius = Math.max(0, sweep.radius);

  let best: MeleeHit | null = null;
  for (const target of targets) {
    // core segment inset by the radius, so the capsule ends at the feet and the head
    const inset = Math.min(target.radius, target.height / 2);
    const bottom = target.feet.clone().addScaledVector(UP, inset);
    const top = target.feet.clone().addScaledVector(UP, target.height - inset);
    const closest = closestSegmentPoints(origin, sweepEnd, bottom, top);
    const gap = Math.sqrt(closest.distSq);
    if (gap > target.radius + radius) continue;

    // only in front of the attacker, a sweep starting at the eye must not
    // reach people standing behind or exactly beside them
    if (closest.onB.clone().sub(origin).dot(dir) <= 0) continue;

    const nearestToEye = closestPointOnSegment(bottom, top, origin);
    const surfaceDistance = Math.max(0, origin.distanceTo(nearestToEye) - target.radius);
    if (surfaceDistance > sweep.range) continue;

    const point = contactPoint(origin, dir, bottom, top, target.radius, closest.onA, closest.onB, gap);
    if (isBlocked) {
      const check = point.clone();
      check.y = Math.max(check.y, bottom.y + BLOCK_CHECK_MIN_HEIGHT);
      const back = origin.clone().sub(check);
      const backLength = back.length();
      if (backLength > BLOCK_CHECK_PULLBACK) {
        check.addScaledVector(back, BLOCK_CHECK_PULLBACK / backLength);
      }
      if (isBlocked(origin, check)) continue;
    }

    if (!best || surfaceDistance < best.surfaceDistance) {
      best = {
        targetId: target.id,
        point,
        distance: origin.distanceTo(point),
        surfaceDistance,
      };
    }
  }
  return best;
}

/**
 * Where the swing lands: the ray's entry into the capsule when the exact aim
 * crosses it, else the capsule surface point facing the sweep.
 */
function contactPoint(
  origin: Vector3,
  dir: Vector3,
  bottom: Vector3,
  top: Vector3,
  capsuleRadius: number,
  onSweep: Vector3,
  onAxis: Vector3,
  gap: number,
): Vector3 {
  const farEnd = origin.clone().addScaledVector(dir, 1e4);
  const ray = closestSegmentPoints(origin, farEnd, bottom, top);
  const rayGap = Math.sqrt(ray.distSq);
  if (rayGap <= capsuleRadius) {
    const along = ray.onA.distanceTo(origin);
    const entry = Math.max(0, along - Math.sqrt(Math.max(0, capsuleRadius ** 2 - rayGap ** 2)));
    return origin.clone().addScaledVector(dir, entry);
  }
  if (gap < 1e-6) {
    return onAxis.clone();
  }
  return onAxis.clone().addScaledVector(onSweep.clone().sub(onAxis), capsuleRadius / gap);
}

function closestPointOnSegment(a: Vector3, b: Vector3, p: Vector3): Vector3 {
  const ab = b.clone().sub(a);
  const lengthSq = ab.lengthSq();
  if (lengthSq < EPS) return a.clone();
  const t = Math.min(1, Math.max(0, p.clone().sub(a).dot(ab) / lengthSq));
  return a.clone().addScaledVector(ab, t);
}

/**
 * Closest points between segments a0-a1 and b0-b1 (Ericson, Real-Time
 * Collision Detection, 5.1.9).
 */
export function closestSegmentPoints(
  a0: Vector3,
  a1: Vector3,
  b0: Vector3,
  b1: Vector3,
): { onA: Vector3; onB: Vector3; distSq: number } {
  const d1 = a1.clone().sub(a0);
  const d2 = b1.clone().sub(b0);
  const r = a0.clone().sub(b0);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  let s = 0;
  let t = 0;
  if (a <= EPS && e <= EPS) {
    s = 0;
    t = 0;
  } else if (a <= EPS) {
    t = clamp01(f / e);
  } else {
    const c = d1.dot(r);
    if (e <= EPS) {
      s = clamp01(-c / a);
    } else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      s = denom > EPS ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  const onA = a0.clone().addScaledVector(d1, s);
  const onB = b0.clone().addScaledVector(d2, t);
  return { onA, onB, distSq: onA.distanceToSquared(onB) };
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
