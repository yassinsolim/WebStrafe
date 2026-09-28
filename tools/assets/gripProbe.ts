/**
 * measures how the right hand holds each knife at idle, using the real arms
 * rig bones, the real knife glbs and the viewmodel's own grip specs:
 * fingertip distance to the handle, finger clearance from the blade and, for
 * ring knives, whether the index finger sits inside the ring.
 *   npx tsx tools/assets/gripProbe.ts            prints the table
 */
import { NodeIO, type Node as GltfNode } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Mesh, Object3D, Quaternion, Ray, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { getKnife, KNIVES, type KnifeId } from '../../src/combat/knives';
import { applyDigitPose, DIGIT_NAMES, type DigitBones, type DigitRest } from '../../src/viewmodel/ArmsRig';
import { alignRingGrip, gripKindFor, knifeGripSpec, measureHandleDiameter, type KnifeGripKind, type RingFit } from '../../src/viewmodel/knifeGrips';
import type { HandPose } from '../../src/viewmodel/handPoses';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface DigitProbe {
  digit: string;
  /** fingertip to the nearest handle, guard or metal surface, metres */
  tipToHandle: number;
  /** closest any joint or segment midpoint comes to the blade surface */
  bladeClearance: number;
}

export interface GripProbe {
  id: KnifeId;
  kind: KnifeGripKind;
  digits: DigitProbe[];
  /** ring knives: index first phalanx midpoint to the ring centre, and the ring's inner radius */
  indexToRing: number | null;
  ringInnerRadius: number | null;
}

async function io(): Promise<NodeIO> {
  await MeshoptDecoder.ready;
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
}

/** node tree as three objects, with meshes (positions and indices only) and their material names */
function toThree(node: GltfNode): Object3D {
  const obj = new Object3D();
  obj.name = node.getName();
  obj.position.fromArray(node.getTranslation());
  obj.quaternion.fromArray(node.getRotation());
  obj.scale.fromArray(node.getScale());
  Object.assign(obj.userData, node.getExtras());
  const mesh = node.getMesh();
  if (mesh) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const geo = new BufferGeometry();
      const arr = new Float32Array(pos.getCount() * 3);
      const el = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i += 1) {
        // getElement returns dequantized values
        pos.getElement(i, el);
        arr.set(el, i * 3);
      }
      geo.setAttribute('position', new BufferAttribute(arr, 3));
      const idx = prim.getIndices();
      if (idx) geo.setIndex(Array.from(idx.getArray() as ArrayLike<number>));
      const m = new Mesh(geo);
      m.name = `${node.getName()}:${prim.getMaterial()?.getName() ?? ''}`;
      m.userData.material = prim.getMaterial()?.getName() ?? '';
      obj.add(m);
    }
  }
  for (const child of node.listChildren()) obj.add(toThree(child));
  return obj;
}

async function loadScene(file: string): Promise<Object3D> {
  const doc = await (await io()).read(path.join(ROOT, file));
  const root = new Object3D();
  for (const n of doc.getRoot().listScenes()[0].listChildren()) root.add(toThree(n));
  root.updateMatrixWorld(true);
  return root;
}

let handTemplate: Object3D | null = null;

async function rightHand(): Promise<Object3D> {
  if (!handTemplate) {
    const arms = await loadScene('public/viewmodels/v2/arms.glb');
    const hand = arms.getObjectByName('hand_r');
    if (!hand) throw new Error('arms.glb has no hand_r');
    handTemplate = hand;
  }
  return handTemplate.clone(true);
}

const BLADE = new Set(['knife_blade', 'knife_edge']);

function surfaces(knife: Object3D, want: (mat: string) => boolean): Mesh[] {
  const out: Mesh[] = [];
  knife.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh && want(m.userData.material)) {
      m.geometry.boundsTree = new MeshBVH(m.geometry);
      out.push(m);
    }
  });
  return out;
}

const tmp = new Vector3();
const inv = new Matrix4();

const rayDirs = [new Vector3(1, 0.13, 0.07).normalize(), new Vector3(-0.11, 1, 0.05).normalize(), new Vector3(0.05, -0.09, 1).normalize()];

/** true when the point is inside any of the (closed) meshes: odd crossings on most of three rays */
export function isInside(meshes: Mesh[], world: Vector3): boolean {
  for (const m of meshes) {
    inv.copy(m.matrixWorld).invert();
    const local = world.clone().applyMatrix4(inv);
    const normalMatrix = new Matrix4().copy(inv);
    let odd = 0;
    for (const dir of rayDirs) {
      const d = dir.clone().transformDirection(normalMatrix);
      const hits = (m.geometry.boundsTree as MeshBVH).raycast(new Ray(local, d), DoubleSide);
      if (hits.length % 2 === 1) odd += 1;
    }
    if (odd >= 2) return true;
  }
  return false;
}

export function distanceTo(meshes: Mesh[], world: Vector3): number {
  let best = Infinity;
  for (const m of meshes) {
    inv.copy(m.matrixWorld).invert();
    const local = tmp.copy(world).applyMatrix4(inv);
    const hit = (m.geometry.boundsTree as MeshBVH).closestPointToPoint(local);
    if (hit) {
      // back to world units (knife meshes carry quantization scales)
      const p = hit.point.clone().applyMatrix4(m.matrixWorld);
      best = Math.min(best, p.distanceTo(world));
    }
  }
  return best;
}

/** hand pose override hook for experiments */
export interface GripScene {
  kind: KnifeGripKind;
  basePose: HandPose;
  digits: DigitBones;
  rest: DigitRest;
  holder: Object3D;
  handle: Mesh[];
  blade: Mesh[];
  ring: Vector3 | null;
  ringInnerRadius: number | null;
  /** folders: the blade pivot, where the opener is */
  pivot: Vector3 | null;
  /** the grip socket (hammer-grip centre) in world space */
  grip: Vector3;
  /** to move the hand along the handle without reloading (the fitter) */
  anchor: Vector3;
  anchorInHand: Vector3;
  knifeInHand: Quaternion;
}

/** re-seats the hand with the handle nudged by `offset` (hand frame) */
export function setHandOffset(scene: GripScene, offset: readonly [number, number, number]): void {
  const inHand = scene.anchorInHand.clone().add(new Vector3(offset[0], offset[1], offset[2]));
  new Matrix4().makeTranslation(scene.anchor.x, scene.anchor.y, scene.anchor.z)
    .multiply(new Matrix4().compose(inHand, scene.knifeInHand, new Vector3(1, 1, 1)).invert())
    .decompose(scene.holder.position, scene.holder.quaternion, scene.holder.scale);
  scene.holder.updateMatrixWorld(true);
}

export async function probeKnife(id: KnifeId, poseOverride?: HandPose): Promise<GripProbe> {
  const scene = await gripScene(id);
  return measure(id, scene, poseOverride ?? scene.basePose);
}

export interface KnifeHandFit {
  pose: HandPose;
  /** handle position nudge in the hand frame, metres [x, y, z] */
  offset: [number, number, number];
  /** folders: thumb curls that put it on the opener */
  opener?: [number, number, number];
  /** ring knives: index curl and turn about the ring */
  ring?: RingFit;
}

export async function gripScene(
  id: KnifeId,
  poseTable: Record<string, HandPose | KnifeHandFit> = {},
  offsetOverride?: [number, number, number],
  ringOverride?: RingFit,
): Promise<GripScene> {
  const knife = await loadScene(`public/knives/${id}.glb`);
  const top = knife.children.length === 1 ? knife.children[0] : knife;
  Object.assign(knife.userData, top.userData);
  const def = getKnife(id);
  const hint = knife.userData.grip;
  const kind = hint === 'hammer' || hint === 'reverse_ring' || hint === 'tee' || hint === 'balisong'
    ? (id === 'skeleton' ? 'hammer' : hint) as KnifeGripKind
    : gripKindFor(def);
  const socket = (name: string) => {
    const s = knife.getObjectByName(name);
    return s ? s.getWorldPosition(new Vector3()) : null;
  };
  const grip = socket('socket_grip') ?? new Vector3(-0.06, 0, 0);
  const ring = socket('socket_ring');
  const tee = socket('socket_tee');
  const entry = poseTable[id];
  const fit = entry && 'pose' in entry ? entry : null;
  const offset = offsetOverride ?? fit?.offset;
  let spec = knifeGripSpec(kind, measureHandleDiameter(knife), offset, ringOverride ?? fit?.ring);
  if (ring) spec = alignRingGrip(spec, ring, grip);
  const anchor = spec.anchor === 'ring' && ring ? ring : spec.anchor === 'tee' && tee ? tee : grip;

  const hand = await rightHand();
  const holder = new Object3D();
  new Matrix4().makeTranslation(anchor.x, anchor.y, anchor.z).multiply(spec.handInAnchor)
    .decompose(holder.position, holder.quaternion, holder.scale);
  hand.position.set(0, 0, 0);
  hand.quaternion.identity();
  holder.add(hand);
  const digits = {} as DigitBones;
  const rest = {} as DigitRest;
  for (const d of DIGIT_NAMES) {
    const bones = [1, 2, 3].map((i) => hand.getObjectByName(`${d}_0${i}_r`)!) as DigitBones[typeof d];
    digits[d] = bones;
    rest[d] = bones.map((b) => b.quaternion.clone()) as DigitRest[typeof d];
  }
  holder.updateMatrixWorld(true);
  return {
    kind,
    basePose: fit ? fit.pose : (entry as HandPose | undefined) ?? spec.pose,
    digits,
    rest,
    holder,
    handle: surfaces(knife, (m) => !BLADE.has(m)),
    blade: surfaces(knife, (m) => BLADE.has(m)),
    ring: ring && kind === 'reverse_ring' ? ring : null,
    ringInnerRadius: typeof knife.userData.ringInnerRadius === 'number' ? knife.userData.ringInnerRadius : null,
    pivot: socket('socket_pivot'),
    grip: grip.clone(),
    anchor: anchor.clone(),
    anchorInHand: spec.anchorInHand.clone().sub(new Vector3(...(offset ?? [0, 0, 0]))),
    knifeInHand: spec.knifeInHand.clone(),
  };
}

/** joint, midpoint and tip samples for one digit after posing */
export function digitSamples(scene: GripScene, d: (typeof DIGIT_NAMES)[number]): { tip: Vector3; samples: Vector3[] } {
  const [a, b, c] = scene.digits[d];
  const pa = a.getWorldPosition(new Vector3());
  const pb = b.getWorldPosition(new Vector3());
  const pc = c.getWorldPosition(new Vector3());
  const distal = pb.distanceTo(pc) * 0.8;
  const tip = pc.clone().add(new Vector3(0, 1, 0).applyQuaternion(c.getWorldQuaternion(new Quaternion())).multiplyScalar(distal));
  return { tip, samples: [pa, pb, pc, tip, pa.clone().lerp(pb, 0.5), pb.clone().lerp(pc, 0.5), pc.clone().lerp(tip, 0.5)] };
}

/** points on the palm skin, hand frame: heel, middle and under the knuckles */
const PALM_POINTS = [
  new Vector3(0.0, 0.045, -0.02), new Vector3(-0.018, 0.07, -0.02), new Vector3(0.018, 0.07, -0.02),
  new Vector3(0.0, 0.085, -0.02),
];

export function palmSamples(scene: GripScene): Vector3[] {
  const hand = scene.digits.index[0].parent!;
  return PALM_POINTS.map((p) => p.clone().applyMatrix4(hand.matrixWorld));
}

export function poseScene(scene: GripScene, pose: HandPose): void {
  applyDigitPose(scene.digits, scene.rest, 'r', pose);
  scene.holder.updateMatrixWorld(true);
}

export function measure(id: KnifeId, scene: GripScene, pose: HandPose): GripProbe {
  poseScene(scene, pose);
  const { handle, blade, digits, ring, kind } = scene;
  const out: DigitProbe[] = [];
  for (const d of DIGIT_NAMES) {
    const { tip, samples } = digitSamples(scene, d);
    out.push({
      digit: d,
      tipToHandle: distanceTo(handle, tip),
      bladeClearance: blade.length ? Math.min(...samples.map((s) => distanceTo(blade, s))) : Infinity,
    });
  }
  let indexToRing: number | null = null;
  if (ring) {
    const [a, b] = digits.index;
    indexToRing = a.getWorldPosition(new Vector3()).lerp(b.getWorldPosition(new Vector3()), 0.5).distanceTo(ring);
  }
  return {
    id,
    kind,
    digits: out,
    indexToRing,
    ringInnerRadius: scene.ringInnerRadius,
  };
}

export async function probeAll(poseTable: Record<string, HandPose | KnifeHandFit> = {}): Promise<GripProbe[]> {
  const out: GripProbe[] = [];
  for (const def of KNIVES) {
    const scene = await gripScene(def.id, poseTable);
    out.push(measure(def.id, scene, scene.basePose));
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const mm = (v: number) => (Number.isFinite(v) ? (v * 1000).toFixed(0).padStart(4) : '   -');
  console.log('knife            kind          tip->handle mm (T I M R P)      blade clearance mm (T I M R P)   ring');
  const table = JSON.parse((await import('node:fs')).readFileSync(path.join(ROOT, 'src/viewmodel/knifeHandPoses.json'), 'utf8'));
  for (const p of await probeAll(table)) {
    const tips = p.digits.map((d) => mm(d.tipToHandle)).join(' ');
    const clear = p.digits.map((d) => mm(d.bladeClearance)).join(' ');
    const ring = p.indexToRing === null ? '' : `index ${mm(p.indexToRing)} / r ${mm(p.ringInnerRadius ?? NaN)}`;
    console.log(`${p.id.padEnd(16)} ${p.kind.padEnd(13)} ${tips}    ${clear}    ${ring}`);
  }
}
