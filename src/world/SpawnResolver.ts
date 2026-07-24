import { Box3, Object3D, Vector3 } from 'three';
import type { CapsuleShape } from '../movement/types';
import type { CollisionWorld } from './CollisionWorld';
import type { MapMeta } from './types';

const DEFAULT_SPAWN = new Vector3(0, 5, 0);
const DOWN = new Vector3(0, -1, 0);
const SPAWN_CLEARANCE = 0.04;
const LOCAL_GROUND_SEARCH = 10;
const MIN_PLAYABLE_NORMAL_Y = 0.45;

export interface ResolvedSpawn {
  position: Vector3;
  yawDeg: number;
}

export function resolveSpawn(meta: MapMeta, collisionRoot: Object3D): ResolvedSpawn {
  if (meta.spawns && meta.spawns.length > 0) {
    const spawn = meta.spawns[0];
    return {
      position: new Vector3(spawn.position[0], spawn.position[1], spawn.position[2]),
      yawDeg: spawn.yawDeg ?? 0,
    };
  }

  const bbox = new Box3().setFromObject(collisionRoot);
  if (bbox.isEmpty()) {
    return {
      position: DEFAULT_SPAWN.clone(),
      yawDeg: 0,
    };
  }

  const centerX = (bbox.min.x + bbox.max.x) * 0.5;
  const centerZ = (bbox.min.z + bbox.max.z) * 0.5;
  return {
    position: new Vector3(centerX, bbox.max.y + 2, centerZ),
    yawDeg: 0,
  };
}

/**
 * Seats a metadata/fallback spawn on collision using a BVH ray first. Long
 * capsule sweeps can skip thin map triangles because they intentionally sample
 * a bounded number of points, so spawn resolution must not use them as a drop
 * ray. The short capsule probe below only validates the final seated result.
 */
export function groundResolvedSpawn(
  spawn: ResolvedSpawn,
  bounds: Box3,
  world: Pick<CollisionWorld, 'queryGround' | 'raycastGeometry' | 'resolveCapsulePosition'>,
  capsule: CapsuleShape,
): ResolvedSpawn {
  const unchanged = (): ResolvedSpawn => ({
    position: spawn.position.clone(),
    yawDeg: spawn.yawDeg,
  });
  if (bounds.isEmpty()) {
    return unchanged();
  }

  const localLift = Math.max(1, capsule.height);
  const localStart = spawn.position.clone().add(new Vector3(0, localLift, 0));
  const localHit = world.raycastGeometry(
    localStart,
    DOWN,
    localLift + LOCAL_GROUND_SEARCH,
  );
  const fullStart = new Vector3(spawn.position.x, bounds.max.y + 2, spawn.position.z);
  const fullHit = world.raycastGeometry(
    fullStart,
    DOWN,
    Math.max(4, bounds.max.y - bounds.min.y + 4),
  );
  const hit = localHit && localHit.normal.y >= MIN_PLAYABLE_NORMAL_Y
    ? localHit
    : fullHit && fullHit.normal.y >= MIN_PLAYABLE_NORMAL_Y
      ? fullHit
      : null;
  if (!hit) {
    return unchanged();
  }

  const seated = hit.point.clone().add(new Vector3(0, SPAWN_CLEARANCE, 0));
  const resolved = world.resolveCapsulePosition(seated, capsule).position;
  const ground = world.queryGround(resolved, capsule, SPAWN_CLEARANCE + 0.12);
  if (!ground || ground.normal.y < MIN_PLAYABLE_NORMAL_Y) {
    return unchanged();
  }

  return {
    position: ground.position.clone().add(new Vector3(0, SPAWN_CLEARANCE, 0)),
    yawDeg: spawn.yawDeg,
  };
}
