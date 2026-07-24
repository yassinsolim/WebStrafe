import { Vector3 } from 'three';
import { PLAYER_CAPSULE_RADIUS } from './CombatArena';
import { getWeapon } from './weapons';

export const BACKSTAB_READY_SURFACE_RANGE = getWeapon('knife').range + 0.35;

export interface BackstabTarget {
  id: string;
  position: readonly [number, number, number];
  yaw: number;
  alive: boolean;
}

export interface BackstabOpportunityQuery {
  attackerFeet: Vector3;
  attackerForward: Vector3;
  targets: readonly BackstabTarget[];
  hasLineOfSight?: (target: BackstabTarget) => boolean;
}

export function findBackstabOpportunity(
  query: BackstabOpportunityQuery,
): BackstabTarget | null {
  const forwardX = query.attackerForward.x;
  const forwardZ = query.attackerForward.z;
  const forwardLength = Math.hypot(forwardX, forwardZ);
  if (forwardLength <= 1e-6) {
    return null;
  }

  let best: BackstabTarget | null = null;
  let bestDistance = Infinity;
  for (const target of query.targets) {
    if (!target.alive || !Number.isFinite(target.yaw)) continue;

    const dx = target.position[0] - query.attackerFeet.x;
    const dz = target.position[2] - query.attackerFeet.z;
    const centerDistance = Math.hypot(dx, dz);
    const surfaceDistance = Math.max(0, centerDistance - PLAYER_CAPSULE_RADIUS);
    if (
      centerDistance <= 1e-6
      || surfaceDistance > BACKSTAB_READY_SURFACE_RANGE
      || Math.abs(target.position[1] - query.attackerFeet.y) > 0.9
    ) {
      continue;
    }

    const toTargetX = dx / centerDistance;
    const toTargetZ = dz / centerDistance;
    const attackerAim = (
      forwardX * toTargetX + forwardZ * toTargetZ
    ) / forwardLength;
    if (attackerAim < 0.6) continue;

    const targetForwardX = -Math.sin(target.yaw);
    const targetForwardZ = -Math.cos(target.yaw);
    const targetToAttackerDot = targetForwardX * -toTargetX + targetForwardZ * -toTargetZ;
    if (targetToAttackerDot > -0.45) continue;
    if (query.hasLineOfSight && !query.hasLineOfSight(target)) continue;

    if (surfaceDistance < bestDistance) {
      best = target;
      bestDistance = surfaceDistance;
    }
  }
  return best;
}
