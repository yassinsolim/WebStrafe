import { Vector3 } from 'three';
import type { CollisionWorld } from '../world/CollisionWorld';

export const BOT_FORWARD_DISTANCE = 11.5;
export const BOT_LATERAL_SPACING = 3.5;

/**
 * Stages bots on the player's initial forward lane rather than on top of the
 * spawn. Both dedicated and elected-host authorities use this exact candidate.
 */
export function computeBotSpawnCandidate(
  playerSpawn: Vector3,
  playerYawDeg: number,
  index: number,
  count: number,
): Vector3 {
  const yaw = (playerYawDeg * Math.PI) / 180;
  const forward = new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const lateral = (index - (Math.max(1, count) - 1) / 2) * BOT_LATERAL_SPACING;
  return playerSpawn
    .clone()
    .addScaledVector(forward, BOT_FORWARD_DISTANCE + (index % 2) * 2)
    .addScaledVector(right, lateral);
}

/**
 * Seats a bot candidate on the nearest authored surface below it. Exact BVH
 * raycasting avoids long capsule sweeps skipping thin floors.
 */
export function groundBotSpawn(
  world: Pick<CollisionWorld, 'raycastGeometry'>,
  candidate: Vector3,
): Vector3 {
  const ground = world.raycastGeometry(
    candidate.clone().add(new Vector3(0, 12, 0)),
    new Vector3(0, -1, 0),
    64,
  );
  return ground
    ? ground.point.clone().add(new Vector3(0, 0.08, 0))
    : candidate.clone();
}
