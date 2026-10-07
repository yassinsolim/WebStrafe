import { Group, Mesh, type Material, type Object3D, type Texture } from 'three';
import { sharedGltfLoader } from '../assets/gltfLoader';
import type { KnifeId } from '../combat/knives';

/**
 * the blender-built knife models (public/knives/<id>.glb, see
 * docs/assets/knife-contract.md). callers show the procedural knife until the
 * model arrives, and keep it when a model is missing.
 */
const templates = new Map<KnifeId, Promise<Group | null>>();
/** live copies per knife */
const users = new Map<KnifeId, number>();
/** knives with no copies left, oldest first; only the newest stays loaded */
const idle: KnifeId[] = [];
// a knife's webp textures take 48-64 mb of gpu memory once drawn
const KEEP_IDLE = 1;

export function knifeModelUrl(id: KnifeId): string {
  return `/knives/${id}.glb`;
}

function loadTemplate(id: KnifeId): Promise<Group | null> {
  let pending = templates.get(id);
  if (!pending) {
    pending = sharedGltfLoader()
      .loadAsync(knifeModelUrl(id))
      .then((gltf) => {
        const root = new Group();
        root.name = `KnifeModel:${id}`;
        // the contract puts the hints on the knife root node
        const top = gltf.scene.children.length === 1 ? gltf.scene.children[0] : gltf.scene;
        Object.assign(root.userData, gltf.scene.userData, top.userData, { knifeId: id, source: 'glb' });
        root.add(gltf.scene);
        root.traverse((node) => {
          node.frustumCulled = false;
        });
        return root;
      })
      .catch(() => null);
    templates.set(id, pending);
  }
  return pending;
}

/**
 * a fresh copy of the knife model. geometry is shared with the template,
 * materials are cloned so a finish can swap them per copy.
 */
export async function loadKnifeModel(id: KnifeId): Promise<Group | null> {
  const pending = loadTemplate(id);
  const template = await pending;
  if (!template) return null;
  // unloaded while this waited: take it back before its resources go
  if (!templates.has(id)) templates.set(id, pending);
  users.set(id, (users.get(id) ?? 0) + 1);
  const wasIdle = idle.indexOf(id);
  if (wasIdle >= 0) idle.splice(wasIdle, 1);
  const copy = template.clone(true);
  copy.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((m: Material) => m.clone())
      : (mesh.material as Material).clone();
  });
  return copy;
}

/** disposes the per-copy materials; once a knife's last copy goes its model can unload */
export function disposeKnifeModel(root: Object3D): void {
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose();
  });
  const id = root.userData.knifeId as KnifeId | undefined;
  const count = id ? users.get(id) ?? 0 : 0;
  if (!id || count <= 0) return;
  if (count > 1) {
    users.set(id, count - 1);
    return;
  }
  users.delete(id);
  idle.push(id);
  while (idle.length > KEEP_IDLE) unloadTemplate(idle.shift()!);
}

/** frees a knife nobody holds: geometry, textures and the template's own materials */
function unloadTemplate(id: KnifeId): void {
  const pending = templates.get(id);
  templates.delete(id);
  void pending?.then((template) => {
    if (!template || templates.get(id) === pending) return;
    const textures = new Set<Texture>();
    template.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        for (const value of Object.values(material)) {
          if ((value as Texture | null)?.isTexture) textures.add(value as Texture);
        }
        material.dispose();
      }
    });
    for (const texture of textures) {
      texture.dispose();
      (texture.source.data as ImageBitmap | null)?.close?.();
    }
  });
}

/** knives with a model in memory (tests, tooling) */
export function loadedKnifeModels(): KnifeId[] {
  return [...templates.keys()];
}

export function isKnifeModel(root: Object3D): boolean {
  return root.userData.source === 'glb';
}
