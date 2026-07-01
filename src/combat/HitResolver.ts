import { Vector3 } from 'three';
import type { Hitbox } from './damage';

export interface TargetCapsule {
  id: string;
  /** Feet (base) position in world units. */
  feet: Vector3;
  /** Total capsule height in world units. */
  height: number;
  /** Capsule radius in world units. */
  radius: number;
  /**
   * Fraction of the height (from the top) that counts as the head hitbox.
   * Default 0.18 (top ~18% of the body).
   */
  headFraction?: number;
}

export interface HitCandidate {
  targetId: string;
  hitbox: Hitbox;
  /** Distance from ray origin to the hit, in world units. */
  distance: number;
}

/** Occlusion test: distance to the nearest wall along the ray, or null if clear. */
export type WallRaycast = (origin: Vector3, dir: Vector3, maxDist: number) => number | null;

const UP = new Vector3(0, 1, 0);

interface ClosestResult {
  /** Distance along the ray to the closest approach. */
  distanceAlongRay: number;
  /** Shortest distance between the ray and the segment. */
  gap: number;
  /** Parametric position along the segment (0 = feet, 1 = top). */
  segT: number;
}

/**
 * Closest approach between a ray (origin + t*dir, t>=0) and a finite segment
 * (a -> b). Returns the distance along the ray, the gap between them, and the
 * normalized position along the segment. Standard segment-segment closest-point
 * solution with the ray clamped to t>=0 and the segment clamped to [0,1].
 */
function closestRayToSegment(origin: Vector3, dir: Vector3, a: Vector3, b: Vector3): ClosestResult {
  const d1 = dir; // ray direction (assumed normalized)
  const d2 = new Vector3().subVectors(b, a); // segment direction
  const r = new Vector3().subVectors(origin, a);

  const A = d1.dot(d1); // = 1 if normalized
  const E = d2.dot(d2);
  const F = d2.dot(r);
  const C = d1.dot(r);
  const B = d1.dot(d2);

  const denom = A * E - B * B;

  let s: number; // along ray (t>=0)
  let t: number; // along segment (0..1)

  if (denom > 1e-9) {
    s = (B * F - C * E) / denom;
  } else {
    s = 0; // parallel: pin to ray origin
  }
  if (s < 0) s = 0;

  t = (B * s + F) / (E > 1e-9 ? E : 1);
  if (t < 0) {
    t = 0;
    s = Math.max(0, -C / (A > 1e-9 ? A : 1));
  } else if (t > 1) {
    t = 1;
    s = Math.max(0, (B - C) / (A > 1e-9 ? A : 1));
  }

  const pRay = new Vector3().copy(origin).addScaledVector(d1, s);
  const pSeg = new Vector3().copy(a).addScaledVector(d2, t);
  return { distanceAlongRay: s, gap: pRay.distanceTo(pSeg), segT: t };
}

/**
 * Resolves the nearest player hit along a ray, respecting effective range and
 * (optionally) wall occlusion. Pure and deterministic — no scene graph needed.
 *
 * Each target is modelled as a vertical capsule from `feet` to `feet + height`.
 * A hit lands on the `head` hitbox when the closest point is within the top
 * `headFraction` of the capsule, otherwise `body`. If a wall is closer than the
 * nearest player, the shot is blocked (returns null).
 */
export function resolveHit(
  origin: Vector3,
  dir: Vector3,
  maxRange: number,
  targets: TargetCapsule[],
  raycastWall?: WallRaycast,
): HitCandidate | null {
  const direction = dir.clone().normalize();

  let best: HitCandidate | null = null;
  for (const target of targets) {
    const a = target.feet;
    const b = new Vector3().copy(a).addScaledVector(UP, target.height);
    const { distanceAlongRay, gap, segT } = closestRayToSegment(origin, direction, a, b);
    if (gap > target.radius) continue;
    if (distanceAlongRay <= 0 || distanceAlongRay > maxRange) continue;

    const headFraction = target.headFraction ?? 0.18;
    const hitbox: Hitbox = segT >= 1 - headFraction ? 'head' : 'body';

    if (!best || distanceAlongRay < best.distance) {
      best = { targetId: target.id, hitbox, distance: distanceAlongRay };
    }
  }

  if (!best) return null;

  // Occlusion: a wall nearer than the player blocks the shot.
  if (raycastWall) {
    const wallDist = raycastWall(origin, direction, best.distance);
    if (wallDist !== null && wallDist < best.distance) {
      return null;
    }
  }

  return best;
}
