import { DoubleSide, Matrix4, Mesh, Quaternion, Ray, Vector3, type Material, type Object3D } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { DigitBones } from './ArmsRig';

/**
 * checks the live hand against the live knife in the engine: for every digit,
 * joints, segment midpoints and the fingertip are tested against the knife's
 * meshes. used by the dev screenshot route and the in-game grip test.
 */
export interface DigitCheck {
  digit: string;
  /** fingertip to the nearest handle, guard or metal surface, metres */
  tipToHandle: number;
  /** closest any sample gets to the blade */
  bladeClearance: number;
  /** closest any sample (past the knuckle) gets to the handle */
  handleClearance: number;
  /** samples that are inside a handle or blade mesh */
  inside: number;
}

export interface GripCheck {
  digits: DigitCheck[];
  /** ring knives: index first phalanx midpoint to the ring centre */
  indexToRing: number | null;
  /** index knuckle in the knife's frame (for comparing against offline tools) */
  indexKnuckleInKnife: [number, number, number];
}

const BLADE = new Set(['knife_blade', 'knife_edge']);
const DIGITS = ['index', 'middle', 'ring', 'pinky', 'thumb'] as const;
/** a gloved finger's radius: centreline samples closer than this are in the surface */
export const FINGER_RADIUS_M = 0.0075;

interface Surface {
  mesh: Mesh;
  bvh: MeshBVH;
  blade: boolean;
}

function materialName(mesh: Mesh): string {
  const m = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as Material;
  // finishes swap the material, the original name is stashed on the mesh
  const stashed = mesh.userData.knifeFinishOriginal as Material | undefined;
  return (mesh.userData.knifeMaterial as string | undefined) ?? stashed?.name ?? m?.name ?? '';
}

function surfacesOf(knife: Object3D): Surface[] {
  const out: Surface[] = [];
  knife.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh || !mesh.geometry.getAttribute('position')) return;
    if (!mesh.userData.knifeMaterial) mesh.userData.knifeMaterial = materialName(mesh);
    const geo = mesh.geometry as Mesh['geometry'] & { gripBvh?: MeshBVH };
    geo.gripBvh ??= new MeshBVH(geo);
    out.push({ mesh, bvh: geo.gripBvh, blade: BLADE.has(mesh.userData.knifeMaterial) });
  });
  return out;
}

const inv = new Matrix4();
const local = new Vector3();
const hitWorld = new Vector3();
const dirs = [new Vector3(1, 0.13, 0.07).normalize(), new Vector3(-0.11, 1, 0.05).normalize(), new Vector3(0.05, -0.09, 1).normalize()];

function distance(surfaces: Surface[], p: Vector3): number {
  let best = Infinity;
  for (const s of surfaces) {
    inv.copy(s.mesh.matrixWorld).invert();
    local.copy(p).applyMatrix4(inv);
    const hit = s.bvh.closestPointToPoint(local);
    if (!hit) continue;
    hitWorld.copy(hit.point).applyMatrix4(s.mesh.matrixWorld);
    best = Math.min(best, hitWorld.distanceTo(p));
  }
  return best;
}

function inside(surfaces: Surface[], p: Vector3): boolean {
  for (const s of surfaces) {
    inv.copy(s.mesh.matrixWorld).invert();
    local.copy(p).applyMatrix4(inv);
    let odd = 0;
    for (const d of dirs) {
      const dir = d.clone().transformDirection(inv);
      if (s.bvh.raycast(new Ray(local.clone(), dir), DoubleSide).length % 2 === 1) odd += 1;
    }
    if (odd >= 2) return true;
  }
  return false;
}

export function digitSamplePoints(bones: [Object3D, Object3D, Object3D]): { tip: Vector3; samples: Vector3[] } {
  const [a, b, c] = bones;
  const pa = a.getWorldPosition(new Vector3());
  const pb = b.getWorldPosition(new Vector3());
  const pc = c.getWorldPosition(new Vector3());
  const tip = pc.clone().add(new Vector3(0, 1, 0).applyQuaternion(c.getWorldQuaternion(new Quaternion())).multiplyScalar(pb.distanceTo(pc) * 0.8));
  return { tip, samples: [pb, pc, tip, pa.clone().lerp(pb, 0.5), pb.clone().lerp(pc, 0.5), pc.clone().lerp(tip, 0.5)] };
}

export function checkGrip(knife: Object3D, digits: DigitBones, ring: Vector3 | null): GripCheck {
  knife.updateWorldMatrix(true, true);
  const all = surfacesOf(knife);
  const handle = all.filter((s) => !s.blade);
  const blade = all.filter((s) => s.blade);
  const out: DigitCheck[] = [];
  for (const d of DIGITS) {
    const { tip, samples } = digitSamplePoints(digits[d]);
    out.push({
      digit: d,
      tipToHandle: distance(handle, tip),
      bladeClearance: blade.length ? Math.min(...samples.map((s) => distance(blade, s))) : Infinity,
      handleClearance: Math.min(...samples.map((s) => distance(handle, s))),
      inside: samples.filter((s) => inside(all, s)).length,
    });
  }
  const knifeInv = new Matrix4().copy(knife.matrixWorld).invert();
  const knuckle = digits.index[0].getWorldPosition(new Vector3()).applyMatrix4(knifeInv);
  let indexToRing: number | null = null;
  if (ring) {
    const [a, b] = digits.index;
    const mid = a.getWorldPosition(new Vector3()).lerp(b.getWorldPosition(new Vector3()), 0.5);
    indexToRing = mid.distanceTo(ring.clone().applyMatrix4(knife.matrixWorld));
  }
  return { digits: out, indexToRing, indexKnuckleInKnife: [knuckle.x, knuckle.y, knuckle.z] };
}
