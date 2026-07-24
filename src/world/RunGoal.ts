import { Vector3 } from 'three';
import type { MapMeta } from './types';

export interface GoalPad {
  center: Vector3;
  radius: number;
  y: number;
  tolerance: number;
}

/**
 * Resolves only authored run finishes. Open-ended/training maps must not infer
 * their lowest catch floor as a goal and force pointer lock back to the menu.
 */
export function resolveRunGoal(meta: MapMeta): GoalPad | null {
  const goal = meta.goalPad;
  if (!goal) {
    return null;
  }
  const [x, y, z] = goal.center;
  if (
    !Number.isFinite(x)
    || !Number.isFinite(y)
    || !Number.isFinite(z)
    || !Number.isFinite(goal.radius)
  ) {
    return null;
  }
  return {
    center: new Vector3(x, y, z),
    radius: Math.max(0.25, goal.radius),
    y,
    tolerance: Math.max(0.2, goal.tolerance ?? 0.6),
  };
}
