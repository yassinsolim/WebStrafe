import { Vector3 } from 'three';
import type { GunId } from '../cosmetics/WeaponViewmodels';

interface MuzzleOffset {
  forward: number;
  right: number;
  down: number;
}

const MUZZLE_OFFSETS: Record<GunId, MuzzleOffset> = {
  deagle: { forward: 0.58, right: 0.18, down: 0.16 },
  awp: { forward: 0.7, right: 0.14, down: 0.15 },
};

/**
 * Finite terminal distance used when an accepted remote round reaches neither
 * a player nor map geometry. It matches the client's readable world-effect
 * horizon instead of emitting an infinite AWP endpoint.
 */
export const REMOTE_SHOT_VISUAL_DISTANCE = 120;

/**
 * Converts an eye-space shot origin into a visible world muzzle point. The
 * lateral/vertical offsets are derived from the shot direction, so remote shots
 * remain attached to the shooter's weapon whether aiming level, uphill, or down.
 */
export function computeWorldMuzzlePosition(
  weaponId: GunId,
  origin: Vector3,
  direction: Vector3,
  upHint = new Vector3(0, 1, 0),
): Vector3 | null {
  if (direction.lengthSq() < 1e-8) return null;

  const forward = direction.clone().normalize();
  const up = upHint.clone().normalize();
  let right = new Vector3().crossVectors(forward, up);
  if (right.lengthSq() < 1e-6) {
    right = new Vector3().crossVectors(forward, new Vector3(0, 0, 1));
  }
  right.normalize();
  const down = new Vector3().crossVectors(forward, right).normalize();
  const offset = MUZZLE_OFFSETS[weaponId];
  return origin
    .clone()
    .addScaledVector(forward, offset.forward)
    .addScaledVector(right, offset.right)
    .addScaledVector(down, offset.down);
}
