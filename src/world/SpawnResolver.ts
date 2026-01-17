import { Box3, Object3D, Vector3 } from 'three';
import type { MapMeta } from './types';

const DEFAULT_SPAWN = new Vector3(0, 5, 0);

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
