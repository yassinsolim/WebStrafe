import {
  BufferAttribute,
  type BufferGeometry,
  type Material,
  Matrix3,
  Matrix4,
  Mesh,
  type Object3D,
  Quaternion,
  Vector3,
} from 'three';
import {
  clampKnifeWear,
  type KnifeFinishSelection,
  normalizePatternSeed,
  resolveKnifeFinish,
  type ResolvedKnifeFinish,
} from './catalog';
import {
  acquireHandleMaterial,
  acquireSurfaceMaterial,
  isKnifeFinishMaterial,
  releaseFinishMaterial,
} from './finishMaterials';

export type { KnifeFinishSelection } from './catalog';

/**
 * puts a finish on a knife: the procedural knives today and the contract glbs
 * (docs/assets/knife-contract.md) later. materials named knife_blade,
 * knife_edge, knife_handle and knife_metal (or meshes with those names) get
 * swapped for shared finish materials; the originals are kept on the mesh and
 * come back with {@link clearKnifeFinish}. whoever disposes a knife must clear
 * its finish first (disposeProceduralKnife does).
 *
 * the shaders work in knife space. each finished geometry gets three baked
 * attributes (see shaders.ts) in the rest pose of the knife root: folder
 * blades and balisong handles are read with their pivots closed to rest, so
 * the pattern sticks to the part while it swings.
 */

export type KnifeFinishPart = 'blade' | 'edge' | 'handle' | 'metal';

const PIVOTS = new Set(['blade_pivot', 'handle_safe', 'handle_bite']);
const PART_NAME = /^knife_(blade|edge|handle|metal)(?:$|[._\-\d])/;
const STASH_MATERIAL = 'knifeFinishMaterial';
const STASH_GEOMETRY = 'knifeFinishGeometry';
const BAKE_KEY = 'knifeFinishBake';
const NO_EDGE = 1;
const MAX_EDGE_POINTS = 640;

/** which finish slot a material belongs to, by material name then by mesh name */
export function knifeFinishPart(material: Material | null | undefined, meshName = ''): KnifeFinishPart | null {
  if (!material || isKnifeFinishMaterial(material)) return null;
  const byMaterial = PART_NAME.exec(material.name ?? '');
  if (byMaterial) return byMaterial[1] as KnifeFinishPart;
  const byMesh = PART_NAME.exec(meshName);
  return byMesh ? (byMesh[1] as KnifeFinishPart) : null;
}

interface Target {
  mesh: Mesh;
  /** part per material slot */
  parts: (KnifeFinishPart | null)[];
  rest: Matrix4;
}

export function applyKnifeFinish(knifeRoot: Object3D, selection: KnifeFinishSelection): void {
  clearKnifeFinish(knifeRoot);
  const resolved = resolveKnifeFinish(selection.finishId);
  const { parts } = resolved.finish;
  const wear = clampKnifeWear(resolved.id, selection.wear);
  const seed = resolved.finish.seedMatters ? normalizePatternSeed(selection.seed) : 0;
  knifeRoot.userData.knifeFinishSelection = { finishId: resolved.id, wear, seed };
  if (!parts.blade && !parts.edge && !parts.metal && parts.handle.kind === 'keep') return;

  const targets = collectTargets(knifeRoot);
  if (targets.length === 0) return;
  bakeKnifeSpace(knifeRoot, targets);
  for (const target of targets) {
    const { mesh } = target;
    const current = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    let changed = false;
    const next = current.map((material, i) => {
      const part = target.parts[i];
      const swap = part ? finishMaterial(part, material, resolved, wear, seed) : null;
      if (swap) changed = true;
      return swap ?? material;
    });
    if (!changed) continue;
    mesh.userData[STASH_MATERIAL] = mesh.material;
    mesh.material = Array.isArray(mesh.material) ? next : next[0];
  }
}

/** puts the original materials (and geometry, if it had to be split) back */
export function clearKnifeFinish(knifeRoot: Object3D): void {
  knifeRoot.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    const original = node.userData[STASH_MATERIAL] as Material | Material[] | undefined;
    if (original !== undefined) {
      const current = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of current) if (isKnifeFinishMaterial(material)) releaseFinishMaterial(material);
      node.material = original;
      delete node.userData[STASH_MATERIAL];
    }
    const geometry = node.userData[STASH_GEOMETRY] as BufferGeometry | undefined;
    if (geometry !== undefined) {
      (node.geometry as BufferGeometry).dispose();
      node.geometry = geometry;
      delete node.userData[STASH_GEOMETRY];
    }
  });
  delete knifeRoot.userData.knifeFinishSelection;
}

/** the selection currently on a knife, null when it has none */
export function knifeFinishOf(knifeRoot: Object3D): KnifeFinishSelection | null {
  const sel = knifeRoot.userData.knifeFinishSelection as KnifeFinishSelection | undefined;
  return sel ? { ...sel } : null;
}

function finishMaterial(part: KnifeFinishPart, original: Material, resolved: ResolvedKnifeFinish, wear: number, seed: number): Material | null {
  const { parts } = resolved.finish;
  switch (part) {
    case 'blade':
      return parts.blade ? acquireSurfaceMaterial(resolved, wear, seed, 'blade', original) : null;
    case 'metal':
      return parts.metal ? acquireSurfaceMaterial(resolved, wear, seed, 'blade', original) : null;
    case 'edge':
      return parts.edge ? acquireSurfaceMaterial(resolved, wear, seed, 'edge', original) : null;
    case 'handle':
      return acquireHandleMaterial(resolved, wear, seed, original);
    default:
      return null;
  }
}

function collectTargets(root: Object3D): Target[] {
  const targets: Target[] = [];
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    const parts = materials.map((m) => knifeFinishPart(m, node.name));
    if (parts.some((p) => p !== null)) targets.push({ mesh: node, parts, rest: restMatrix(node, root) });
  });
  return targets;
}

const IDENTITY = new Quaternion();

/** mesh to knife root, with pivots at rest (rotation 0 is open in the contract) */
function restMatrix(mesh: Object3D, root: Object3D): Matrix4 {
  const out = new Matrix4();
  const local = new Matrix4();
  for (let node: Object3D | null = mesh; node && node !== root; node = node.parent) {
    if (PIVOTS.has(node.name)) {
      local.compose(node.position, IDENTITY, node.scale);
    } else {
      if (node.matrixAutoUpdate) node.updateMatrix();
      local.copy(node.matrix);
    }
    out.premultiply(local);
  }
  return out;
}

interface KnifeDims {
  length: number;
  height: number;
  edgeY: number;
  edge: Float32Array;
}

/** vertex indices a material slot draws */
function slotVertices(geometry: BufferGeometry, slot: number, slotCount: number): Set<number> {
  const out = new Set<number>();
  const index = geometry.index;
  const count = geometry.getAttribute('position').count;
  const groups = slotCount > 1 && geometry.groups.length > 0
    ? geometry.groups.filter((g) => (g.materialIndex ?? 0) === slot)
    : [{ start: 0, count: index ? index.count : count }];
  for (const g of groups) {
    const end = Math.min(g.start + g.count, index ? index.count : count);
    for (let i = g.start; i < end; i += 1) out.add(index ? index.getX(i) : i);
  }
  return out;
}

function knifeDims(root: Object3D, targets: Target[]): KnifeDims {
  const blade: number[] = [];
  const edge: number[] = [];
  const p = new Vector3();
  for (const t of targets) {
    const geometry = t.mesh.geometry as BufferGeometry;
    const pos = geometry.getAttribute('position');
    if (!pos) continue;
    t.parts.forEach((part, slot) => {
      if (part !== 'blade' && part !== 'edge') return;
      for (const i of slotVertices(geometry, slot, t.parts.length)) {
        p.fromBufferAttribute(pos, i).applyMatrix4(t.rest);
        blade.push(p.x, p.y);
        if (part === 'edge') edge.push(p.x, p.y);
      }
    });
  }
  const hint = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
  let maxX = 0;
  for (let i = 0; i < blade.length; i += 2) maxX = Math.max(maxX, blade[i]);
  const length = hint(root.userData.bladeLength) ?? (maxX > 0 ? maxX : 0.1);
  // the edge line near the guard sets v = 0, the spine there sets the height
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < blade.length; i += 2) {
    if (blade[i] < 0 || blade[i] > length * 0.2) continue;
    minY = Math.min(minY, blade[i + 1]);
    maxY = Math.max(maxY, blade[i + 1]);
  }
  const edgeY = Number.isFinite(minY) ? minY : 0;
  const height = hint(root.userData.bladeHeight) ?? (maxY > minY ? maxY - minY : 0.03);
  // thin the edge points out, the bevel has far more than the distance needs
  const stride = Math.max(1, Math.ceil(edge.length / 2 / MAX_EDGE_POINTS));
  const pts: number[] = [];
  for (let i = 0; i < edge.length; i += 2 * stride) pts.push(edge[i], edge[i + 1]);
  return { length, height, edgeY, edge: new Float32Array(pts) };
}

function edgeDistance(x: number, y: number, edge: Float32Array): number {
  let best = Infinity;
  for (let i = 0; i < edge.length; i += 2) {
    const dx = edge[i] - x;
    const dy = edge[i + 1] - y;
    const d = dx * dx + dy * dy;
    if (d < best) best = d;
  }
  return Number.isFinite(best) ? Math.sqrt(best) : NO_EDGE;
}

function bakeKnifeSpace(root: Object3D, targets: Target[]): void {
  const dims = knifeDims(root, targets);
  const bakedThisPass = new Map<BufferGeometry, string>();
  const p = new Vector3();
  const n = new Vector3();
  const normalMatrix = new Matrix3();
  for (const t of targets) {
    const onBlade = t.parts.some((part) => part === 'blade' || part === 'edge');
    const key = [
      ...t.rest.elements.map((e) => e.toFixed(6)),
      dims.length.toFixed(5), dims.height.toFixed(5), dims.edgeY.toFixed(5), dims.edge.length, onBlade,
    ].join(',');
    let geometry = t.mesh.geometry as BufferGeometry;
    const other = bakedThisPass.get(geometry);
    if (other !== undefined && other !== key) {
      // the same geometry under two different transforms needs its own copy
      t.mesh.userData[STASH_GEOMETRY] = geometry;
      geometry = geometry.clone();
      t.mesh.geometry = geometry;
    }
    bakedThisPass.set(geometry, key);
    if (geometry.userData[BAKE_KEY] === key) continue;

    const pos = geometry.getAttribute('position');
    const nrm = geometry.getAttribute('normal');
    if (!pos) continue;
    const count = pos.count;
    const outPos = new Float32Array(count * 3);
    const outNrm = new Float32Array(count * 4);
    const outUv = new Float32Array(count * 4);
    normalMatrix.getNormalMatrix(t.rest);
    for (let i = 0; i < count; i += 1) {
      p.fromBufferAttribute(pos, i).applyMatrix4(t.rest);
      if (nrm) n.fromBufferAttribute(nrm, i).applyMatrix3(normalMatrix);
      // degenerate vertices (the point of a blade) have no normal
      if (!nrm || n.lengthSq() < 1e-12) n.set(0, 0, 1);
      n.normalize();
      outPos.set([p.x, p.y, p.z], i * 3);
      outNrm.set([n.x, n.y, n.z, dims.height], i * 4);
      const edgeDist = onBlade && dims.edge.length > 0 ? edgeDistance(p.x, p.y, dims.edge)
        : onBlade ? Math.max(0, p.y - dims.edgeY) : NO_EDGE;
      outUv.set([p.x / dims.length, (p.y - dims.edgeY) / dims.height, edgeDist, dims.length], i * 4);
    }
    geometry.setAttribute('finishPos', new BufferAttribute(outPos, 3));
    geometry.setAttribute('finishNormal', new BufferAttribute(outNrm, 4));
    geometry.setAttribute('finishUv', new BufferAttribute(outUv, 4));
    geometry.userData[BAKE_KEY] = key;
  }
}
