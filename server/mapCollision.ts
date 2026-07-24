import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Box3, type Object3D } from 'three';
import { CollisionWorld } from '../src/world/CollisionWorld';
import {
  groundResolvedSpawn,
  resolveSpawn,
  type ResolvedSpawn,
} from '../src/world/SpawnResolver';
import type { MapMeta } from '../src/world/types';
import { createMovementTestScene } from '../src/movement/MovementTestScene';
import { stripMaterialsFromGlb } from './glb';

// three's GLTFLoader touches the browser `self` global at runtime; alias it to
// globalThis so the loader can run headlessly in Node.
(globalThis as unknown as { self?: unknown }).self ??= globalThis;

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_MAPS_DIR = path.join(ROOT_DIR, 'public', 'maps');
const MAP_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
const SERVER_PLAYER_CAPSULE = { radius: 0.42, height: 1.8 };

export interface HeadlessMap {
  world: CollisionWorld;
  spawn: ResolvedSpawn;
}

const cache = new Map<string, Promise<HeadlessMap | null>>();

/**
 * Loads a map's collision geometry into a Node-side {@link CollisionWorld},
 * resolving its spawn. Cached per map id; a failed load resolves to null (and is
 * cached as null so we don't retry a broken map every tick).
 */
export function loadHeadlessMap(mapId: string): Promise<HeadlessMap | null> {
  if (!MAP_ID_REGEX.test(mapId)) {
    return Promise.resolve(null);
  }
  let entry = cache.get(mapId);
  if (!entry) {
    entry = loadUncached(mapId).catch((error) => {
      console.warn(`[bots] failed to load collision for map "${mapId}":`, error);
      return null;
    });
    cache.set(mapId, entry);
  }
  return entry;
}

async function loadUncached(mapId: string): Promise<HeadlessMap | null> {
  const dir = path.join(PUBLIC_MAPS_DIR, mapId);
  const [glb, metaRaw] = await Promise.all([
    mapId === 'movement_test_scene'
      ? Promise.resolve(null)
      : readFile(path.join(dir, 'collision.glb')),
    readFile(path.join(dir, 'meta.json'), 'utf8'),
  ]);
  const meta = JSON.parse(metaRaw) as MapMeta;
  // The browser generates this authored training range from the same source.
  // Reusing it here prevents cover/LOS and spawn geometry from drifting between
  // the dedicated authority, the browser, and the elected-host simulation.
  const scene = glb
    ? await parseCollisionGlb(glb)
    : createMovementTestScene().root;
  const configuredScale = meta.sceneScale;
  if (
    typeof configuredScale === 'number'
    && Number.isFinite(configuredScale)
    && configuredScale > 0
    && Math.abs(configuredScale - 1) > 1e-6
  ) {
    // Match MapLoader.normalizeMapScale exactly. Server authority, bot movement,
    // LOS, and browser rendering must share one coordinate system.
    scene.scale.multiplyScalar(configuredScale);
    scene.updateWorldMatrix(true, true);
  }

  const world = new CollisionWorld();
  world.setCollisionFromRoot(scene);
  if (!world.hasCollision()) {
    return null;
  }
  const bounds = new Box3().setFromObject(scene);
  const spawn = groundResolvedSpawn(
    resolveSpawn(meta, scene),
    bounds,
    world,
    SERVER_PLAYER_CAPSULE,
  );
  return { world, spawn };
}

async function parseCollisionGlb(glb: Buffer): Promise<Object3D> {
  // Strip materials/textures first so the loader stays quiet and fast.
  const stripped = stripMaterialsFromGlb(glb);
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  return await new Promise<Object3D>((resolve, reject) => {
    new GLTFLoader().parse(
      stripped,
      '',
      (gltf) => resolve(gltf.scene),
      (error) => reject(error instanceof Error ? error : new Error(String(error))),
    );
  });
}
