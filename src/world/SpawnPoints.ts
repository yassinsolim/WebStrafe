import { Vector3 } from 'three';
import type { ResolvedSpawn } from './SpawnResolver';
import type { MapMeta } from './types';

export interface SpawnThreat {
  position: readonly [number, number, number] | Vector3;
  alive?: boolean;
}

/** every authored spawn as a resolved spawn, in meta order (spawns[0] is where runs start) */
export function listMetaSpawns(meta: MapMeta): ResolvedSpawn[] {
  return (meta.spawns ?? [])
    .filter((spawn) => Array.isArray(spawn.position) && spawn.position.length === 3 && spawn.position.every(Number.isFinite))
    .map((spawn) => ({
      position: new Vector3(spawn.position[0], spawn.position[1], spawn.position[2]),
      yawDeg: typeof spawn.yawDeg === 'number' && Number.isFinite(spawn.yawDeg) ? spawn.yawDeg : 0,
    }));
}

/**
 * where bots gather. arena maps tag spawns with a `side`, bots take the first
 * spawn on a different side than spawns[0] so they start across the map from
 * the player. maps without sides stage bots around spawns[0] like before.
 */
export function resolveBotAnchor(meta: MapMeta): ResolvedSpawn | null {
  const spawns = meta.spawns ?? [];
  if (spawns.length === 0) {
    return null;
  }
  const home = spawns[0].side;
  const index = home === undefined ? -1 : spawns.findIndex((spawn) => spawn.side !== undefined && spawn.side !== home);
  const list = listMetaSpawns(meta);
  return list[index >= 0 ? index : 0] ?? null;
}

function toVector(p: readonly [number, number, number] | Vector3): Vector3 {
  return p instanceof Vector3 ? p : new Vector3(p[0], p[1], p[2]);
}

/**
 * picks a respawn point away from living enemies. each spawn is scored by its
 * distance to the nearest threat, then one of the spawns within `slack` of the
 * best score is picked at random so respawns stay safe but not predictable.
 * with no threats any spawn can be picked.
 */
export function pickSpawnAwayFrom<T extends { position: Vector3 }>(
  spawns: readonly T[],
  threats: readonly SpawnThreat[],
  random: () => number = Math.random,
  slack = 0.8,
): T | null {
  if (spawns.length === 0) {
    return null;
  }
  const living = threats.filter((t) => t.alive !== false).map((t) => toVector(t.position));
  if (living.length === 0) {
    return spawns[Math.min(spawns.length - 1, Math.floor(random() * spawns.length))];
  }
  const scores = spawns.map((spawn) => Math.min(...living.map((p) => p.distanceTo(spawn.position))));
  const best = Math.max(...scores);
  const candidates = spawns.filter((_, i) => scores[i] >= best * slack);
  return candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
}
