import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BufferGeometry, Mesh, Vector3, type Object3D } from 'three';
import { stripMaterialsFromGlb } from '../../../server/glb';
import { CollisionWorld } from '../CollisionWorld';
import type { MapMeta } from '../types';

// three's GLTFLoader touches `self`; alias it so it runs under node
(globalThis as unknown as { self?: unknown }).self ??= globalThis;

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export function mapFile(id: string, file: string): string {
  return path.join(ROOT, 'public', 'maps', id, file);
}

export function fileSize(file: string): number {
  return existsSync(file) ? statSync(file).size : 0;
}

export function readMeta(id: string): MapMeta & Record<string, unknown> {
  return JSON.parse(readFileSync(mapFile(id, 'meta.json'), 'utf8')) as MapMeta & Record<string, unknown>;
}

export function readLayout<T>(id: string): T {
  return JSON.parse(readFileSync(path.join(ROOT, 'tools', 'blender', 'maps', 'layouts', `${id}.json`), 'utf8')) as T;
}

export function glbJson(file: string): Record<string, unknown> {
  const buf = readFileSync(file);
  const length = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + length).toString('utf8')) as Record<string, unknown>;
}

/** parses a glb without its textures (node has no image decoder), meshopt included */
export async function loadGlbScene(file: string): Promise<Object3D> {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
  await MeshoptDecoder.ready;
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const root = await new Promise<Object3D>((resolve, reject) => {
    loader.parse(stripMaterialsFromGlb(readFileSync(file)), '', (gltf) => resolve(gltf.scene), reject);
  });
  root.updateWorldMatrix(true, true);
  return root;
}

export interface Triangle {
  a: Vector3;
  b: Vector3;
  c: Vector3;
  normal: Vector3;
  mesh: string;
}

/** world space triangles of every mesh under root */
export function trianglesOf(root: Object3D, filter?: (name: string) => boolean): Triangle[] {
  const out: Triangle[] = [];
  root.traverse((child) => {
    if (!(child instanceof Mesh) || (filter && !filter(child.name))) {
      return;
    }
    const geometry = child.geometry as BufferGeometry;
    const pos = geometry.getAttribute('position');
    const index = geometry.getIndex();
    const count = index ? index.count : pos.count;
    const v = (i: number) => new Vector3().fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(child.matrixWorld);
    for (let i = 0; i + 2 < count; i += 3) {
      const a = v(i);
      const b = v(i + 1);
      const c = v(i + 2);
      const normal = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
      if (normal.lengthSq() < 1e-12) {
        continue;
      }
      out.push({ a, b, c, normal: normal.normalize(), mesh: child.name });
    }
  });
  return out;
}

export async function loadCollisionWorld(id: string): Promise<{ world: CollisionWorld; root: Object3D }> {
  const root = await loadGlbScene(mapFile(id, 'collision.glb'));
  const world = new CollisionWorld();
  world.setCollisionFromRoot(root);
  return { world, root };
}

export function vec(p: readonly number[]): Vector3 {
  return new Vector3(p[0], p[1], p[2]);
}

export function inBox(p: Vector3, min: readonly number[], max: readonly number[], pad = 0): boolean {
  return p.x >= min[0] - pad && p.x <= max[0] + pad
    && p.y >= min[1] - pad && p.y <= max[1] + pad
    && p.z >= min[2] - pad && p.z <= max[2] + pad;
}
