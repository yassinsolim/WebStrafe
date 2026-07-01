import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Object3D } from 'three';
import { CollisionWorld } from '../src/world/CollisionWorld';
import { resolveSpawn, type ResolvedSpawn } from '../src/world/SpawnResolver';
import type { MapMeta } from '../src/world/types';
import { stripMaterialsFromGlb } from './glb';

// three's GLTFLoader touches the browser `self` global at runtime; alias it to
// globalThis so the loader can run headlessly in Node.
(globalThis as unknown as { self?: unknown }).self ??= globalThis;

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_MAPS_DIR = path.join(ROOT_DIR, 'public', 'maps');
const MAP_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

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
    readFile(path.join(dir, 'collision.glb')),
    readFile(path.join(dir, 'meta.json'), 'utf8'),
  ]);
  const meta = JSON.parse(metaRaw) as MapMeta;
  const scene = await parseCollisionGlb(glb);

  const world = new CollisionWorld();
  world.setCollisionFromRoot(scene);
  if (!world.hasCollision()) {
    return null;
  }
  const spawn = resolveSpawn(meta, scene);
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
