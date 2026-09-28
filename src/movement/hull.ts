import { METRES_PER_UNIT } from './cvars';

// cs2 hull is 72 u standing and 54 u crouched, eyes 64 u and 46 u above the feet.
// movement, the hosts' hit capsules and the ws server all size players from these
export const STAND_HEIGHT = 72 * METRES_PER_UNIT;
export const CROUCH_HEIGHT = 54 * METRES_PER_UNIT;
export const STAND_EYE_HEIGHT = 64 * METRES_PER_UNIT;
export const CROUCH_EYE_HEIGHT = 46 * METRES_PER_UNIT;

/** hull height for a duck amount (0 standing, 1 fully crouched) */
export function hullHeight(duck: number): number {
  return STAND_HEIGHT + (CROUCH_HEIGHT - STAND_HEIGHT) * clampDuck(duck);
}

/** eye height above the feet for a duck amount */
export function eyeHeight(duck: number): number {
  return STAND_EYE_HEIGHT + (CROUCH_EYE_HEIGHT - STAND_EYE_HEIGHT) * clampDuck(duck);
}

/** anything missing or malformed counts as standing */
export function clampDuck(duck: unknown): number {
  return typeof duck === 'number' && Number.isFinite(duck) ? Math.min(1, Math.max(0, duck)) : 0;
}
