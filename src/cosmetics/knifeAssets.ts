import { Group, Mesh, type Material, type Object3D } from 'three';
import { sharedGltfLoader } from '../assets/gltfLoader';
import type { KnifeId } from '../combat/knives';

/**
 * the blender-built knife models (public/knives/<id>.glb, see
 * docs/assets/knife-contract.md). callers show the procedural knife until the
 * model arrives, and keep it when a model is missing.
 */
const templates = new Map<KnifeId, Promise<Group | null>>();

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
  const template = await loadTemplate(id);
  if (!template) return null;
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

/** disposes the per-copy materials, never the shared geometry */
export function disposeKnifeModel(root: Object3D): void {
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose();
  });
}

export function isKnifeModel(root: Object3D): boolean {
  return root.userData.source === 'glb';
}
