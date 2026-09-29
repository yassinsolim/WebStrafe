import { Matrix3, Vector3 } from 'three';
import type { PartMesh } from './library';
import { ALL_JOINTS, bindPose } from './skeleton';

/**
 * moves a kit's third-person arm pieces onto the first-person arms rig, so the
 * gauntlets in first person are the same plates (same atlas uvs, same finish)
 * the other players see.
 *
 * every vertex is carried from the body's shoulder / forearm / hand frames into
 * the arms rig's matching frames (built from elbow, wrist and knuckle joints,
 * so the forearm roll follows the hand on both rigs), blended by its skin
 * weights. the forearm's radius is rescaled per slice so the plates hug the
 * first-person sleeve instead of the thinner body arm. then each vertex takes
 * the skin weights of the nearest arms vertex (plates twist and bend exactly
 * like the sleeve and glove under them) and is pushed out of that surface if
 * it sank in.
 */

/** third-person pieces that are ever in view in first person (the glove brings its own cuff) */
export const FP_PART = /^(elbow|vambrace|vam_|wrap_|hand_plate)/;

/** first-person arms at rest, in one space (the arms mesh's bind space) */
export interface ArmsSurface {
  position: Float32Array;
  normal: Float32Array;
  skinIndex: ArrayLike<number>;
  skinWeight: ArrayLike<number>;
  /** index of each arms skeleton bone by name */
  boneIndex: Map<string, number>;
  /** rest position of each landmark bone (upperarm, forearm, hand, middle/index/pinky_01, per side) */
  joints: Map<string, Vector3>;
}

/** forearm length of the first-person arms rig (forearm to hand joint, tools/blender/arms) */
export const FP_FOREARM_M = 0.26;

/** how far plates stay off the sleeve and glove, metres */
export const FP_CLEARANCE = 0.0035;

interface Frame {
  o: Vector3;
  r: Matrix3;
}

function frame(o: Vector3, towards: Vector3, acrossA: Vector3, acrossB: Vector3): Frame {
  const x = towards.clone().sub(o).normalize();
  const y = acrossA.clone().sub(acrossB);
  y.addScaledVector(x, -y.dot(x)).normalize();
  const z = new Vector3().crossVectors(x, y);
  return { o: o.clone(), r: new Matrix3().set(x.x, y.x, z.x, x.y, y.y, z.y, x.z, y.z, z.z) };
}

type Segment = 'upper' | 'lower' | 'hand';

interface SegmentMap {
  src: Frame;
  dst: Frame;
  /** axial length ratio */
  axial: number;
  /** radial scale at axial t (0..1 along the source segment) */
  radial: (t: number) => number;
  length: number;
}

const tmp = new Vector3();
const local = new Vector3();

function mapPoint(m: SegmentMap, p: Vector3, out: Vector3): Vector3 {
  local.copy(p).sub(m.src.o).applyMatrix3(m.src.r.clone().transpose());
  const s = m.radial(local.x / m.length);
  local.set(local.x * m.axial, local.y * s, local.z * s);
  return out.copy(local).applyMatrix3(m.dst.r).add(m.dst.o);
}

function mapNormal(m: SegmentMap, n: Vector3, t: number, out: Vector3): Vector3 {
  local.copy(n).applyMatrix3(m.src.r.clone().transpose());
  const s = m.radial(t);
  // inverse transpose of the scale
  local.set(local.x / m.axial, local.y / s, local.z / s);
  return out.copy(local).applyMatrix3(m.dst.r);
}

/** radius profile of a surface around a segment axis, in slices */
function radiusProfile(points: Vector3[], f: Frame, length: number, bins: number): Array<number | null> {
  const sums: number[][] = Array.from({ length: bins }, () => []);
  const rt = f.r.clone().transpose();
  for (const p of points) {
    local.copy(p).sub(f.o).applyMatrix3(rt);
    const t = local.x / length;
    if (t < 0 || t >= 1) continue;
    sums[Math.floor(t * bins)].push(Math.hypot(local.y, local.z));
  }
  return sums.map((list) => {
    if (list.length < 6) return null;
    list.sort((a, b) => a - b);
    return list[Math.floor(list.length * 0.6)];
  });
}

function profileRatio(src: Array<number | null>, dst: Array<number | null>): (t: number) => number {
  const bins = src.length;
  const ratio: number[] = [];
  let last = 1;
  for (let i = 0; i < bins; i += 1) {
    const a = src[i];
    const b = dst[i];
    if (a && b) last = Math.min(2.4, Math.max(0.7, b / a));
    ratio.push(last);
  }
  // back-fill leading gaps, then smooth
  const first = ratio.findIndex((_, i) => src[i] && dst[i]);
  for (let i = 0; i < first; i += 1) ratio[i] = ratio[first];
  const smooth = ratio.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let j = Math.max(0, i - 1); j <= Math.min(bins - 1, i + 1); j += 1) {
      s += ratio[j];
      n += 1;
    }
    return s / n;
  });
  return (t: number) => {
    const x = Math.min(bins - 1, Math.max(0, t * bins - 0.5));
    const i = Math.floor(x);
    const f = x - i;
    return smooth[i] * (1 - f) + smooth[Math.min(bins - 1, i + 1)] * f;
  };
}

/** nearest-vertex lookup over the arms surface */
class Grid {
  private readonly cells = new Map<string, number[]>();
  constructor(private readonly pos: Float32Array, private readonly cell = 0.02) {
    for (let i = 0; i < pos.length / 3; i += 1) {
      const key = this.key(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      const list = this.cells.get(key);
      if (list) list.push(i);
      else this.cells.set(key, [i]);
    }
  }
  private key(x: number, y: number, z: number): string {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)},${Math.floor(z / this.cell)}`;
  }
  nearest(p: Vector3, reach = 3): number {
    const cx = Math.floor(p.x / this.cell);
    const cy = Math.floor(p.y / this.cell);
    const cz = Math.floor(p.z / this.cell);
    let best = -1;
    let bestD = Infinity;
    for (let r = 0; r <= reach; r += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        for (let dy = -r; dy <= r; dy += 1) {
          for (let dz = -r; dz <= r; dz += 1) {
            if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
            const list = this.cells.get(`${cx + dx},${cy + dy},${cz + dz}`);
            if (!list) continue;
            for (const i of list) {
              const d = (this.pos[i * 3] - p.x) ** 2 + (this.pos[i * 3 + 1] - p.y) ** 2 + (this.pos[i * 3 + 2] - p.z) ** 2;
              if (d < bestD) {
                bestD = d;
                best = i;
              }
            }
          }
        }
      }
      // anything in a further shell is at least r cells away
      if (best >= 0 && Math.sqrt(bestD) <= r * this.cell) break;
    }
    return best;
  }
}

/** small pieces (cuffs, caps, hand plates) move as one on their averaged weights instead of tearing across a joint */
function rigidIfSmall(position: Float32Array, skinIndex: Uint16Array, skinWeight: Float32Array): void {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < position.length; i += 3) {
    minX = Math.min(minX, position[i]); maxX = Math.max(maxX, position[i]);
    minY = Math.min(minY, position[i + 1]); maxY = Math.max(maxY, position[i + 1]);
    minZ = Math.min(minZ, position[i + 2]); maxZ = Math.max(maxZ, position[i + 2]);
  }
  if (Math.max(maxX - minX, maxY - minY, maxZ - minZ) > 0.07) return;
  const sums = new Map<number, number>();
  for (let i = 0; i < skinWeight.length; i += 1) {
    if (skinWeight[i] > 0) sums.set(skinIndex[i], (sums.get(skinIndex[i]) ?? 0) + skinWeight[i]);
  }
  const top = [...sums].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const total = top.reduce((t, [, w]) => t + w, 0) || 1;
  for (let i = 0; i < skinWeight.length; i += 4) {
    for (let k = 0; k < 4; k += 1) {
      skinIndex[i + k] = top[k]?.[0] ?? 0;
      skinWeight[i + k] = top[k] ? top[k][1] / total : 0;
    }
  }
}

// the elbow cap helper sits at the forearm's pivot with the forearm's bind frame
const SEGMENT_OF: Record<string, Segment> = { arm_upper: 'upper', arm_lower: 'lower', elbow: 'lower', hand: 'hand', finger: 'hand' };

function segmentOfJoint(name: string): { segment: Segment; side: 'l' | 'r' } | null {
  const side = name.endsWith('_l') ? 'l' : name.endsWith('_r') ? 'r' : null;
  if (!side) return null;
  for (const [prefix, segment] of Object.entries(SEGMENT_OF)) {
    if (name.startsWith(prefix)) return { segment, side };
  }
  return null;
}

/**
 * transplants pieces (third-person bind space, skinned to ALL_JOINTS) onto the
 * arms. `body` is the third-person undersuit, used for the forearm radius.
 * returns new parts whose skin indices point into the arms skeleton.
 */
export function transplantArms(pieces: PartMesh[], body: PartMesh[], armsIn: ArmsSurface): PartMesh[] {
  // the viewmodel's bind space can be in any unit: work in metres (the arms rig's forearm is
  // FP_FOREARM_M long), so the grid cells, clearance and piece sizes below mean what they say
  const unit = armsIn.joints.get('forearm_r')!.distanceTo(armsIn.joints.get('hand_r')!) / FP_FOREARM_M;
  const arms: ArmsSurface = {
    ...armsIn,
    position: armsIn.position.map((v) => v / unit),
    joints: new Map([...armsIn.joints].map(([k, v]) => [k, v.clone().divideScalar(unit)])),
  };
  const bind = new Map(bindPose(ALL_JOINTS).map((j) => [j.name, j.position]));
  const jointNames = ALL_JOINTS.map((j) => j.name);
  const armsPoints: Vector3[] = [];
  for (let i = 0; i < arms.position.length / 3; i += 1) {
    armsPoints.push(new Vector3(arms.position[i * 3], arms.position[i * 3 + 1], arms.position[i * 3 + 2]));
  }
  const armsDominant = armsPoints.map((_, i) => {
    let best = 0;
    for (let k = 1; k < 4; k += 1) if (arms.skinWeight[i * 4 + k] > arms.skinWeight[i * 4 + best]) best = k;
    return arms.skinIndex[i * 4 + best];
  });

  const maps = new Map<string, SegmentMap>();
  for (const side of ['l', 'r'] as const) {
    const j3 = (n: string) => bind.get(`${n}_${side}`)!;
    const jf = (n: string) => arms.joints.get(`${n}_${side}`)!;
    const across3: [Vector3, Vector3] = [j3('finger_index_0'), j3('finger_pinky_0')];
    const acrossF: [Vector3, Vector3] = [jf('index_01'), jf('pinky_01')];
    const segs: Array<[Segment, Vector3, Vector3, Vector3, Vector3]> = [
      ['upper', j3('arm_upper'), j3('arm_lower'), jf('upperarm'), jf('forearm')],
      ['lower', j3('arm_lower'), j3('hand'), jf('forearm'), jf('hand')],
      ['hand', j3('hand'), j3('finger_middle_0'), jf('hand'), jf('middle_01')],
    ];
    // forearm radius: the body's forearm undersuit against the arms' sleeve
    const lowerSrc = frame(segs[1][1], segs[1][2], ...across3);
    const lowerDst = frame(segs[1][3], segs[1][4], ...acrossF);
    const lowerLen = segs[1][1].distanceTo(segs[1][2]);
    const lowerLenF = segs[1][3].distanceTo(segs[1][4]);
    const bodyLower: Vector3[] = [];
    const lowerIdx = jointNames.indexOf(`arm_lower_${side}`);
    for (const p of body) {
      for (let i = 0; i < p.position.length / 3; i += 1) {
        let best = 0;
        for (let k = 1; k < 4; k += 1) if (p.skinWeight[i * 4 + k] > p.skinWeight[i * 4 + best]) best = k;
        if (p.skinIndex[i * 4 + best] === lowerIdx) {
          bodyLower.push(new Vector3(p.position[i * 3], p.position[i * 3 + 1], p.position[i * 3 + 2]));
        }
      }
    }
    const forearmBones = new Set([arms.boneIndex.get(`forearm_${side}`), arms.boneIndex.get(`forearm_twist_${side}`)]);
    const sleeve = armsPoints.filter((_, i) => forearmBones.has(armsDominant[i]));
    const bins = 10;
    const radial = profileRatio(radiusProfile(bodyLower, lowerSrc, lowerLen, bins), radiusProfile(sleeve, lowerDst, lowerLenF, bins));
    for (const [segment, a3, b3, af, bf] of segs) {
      const length = a3.distanceTo(b3);
      const src = frame(a3, b3, ...across3);
      const dst = frame(af, bf, ...acrossF);
      const axial = af.distanceTo(bf) / length;
      let scale: (t: number) => number;
      if (segment === 'lower') scale = radial;
      else if (segment === 'upper') scale = () => radial(0.05);
      else {
        const width = acrossF[0].distanceTo(acrossF[1]) / across3[0].distanceTo(across3[1]);
        scale = () => width;
      }
      maps.set(`${segment}_${side}`, { src, dst, axial, radial: scale, length });
    }
  }

  const grid = new Grid(arms.position);
  const out: PartMesh[] = [];
  const p = new Vector3();
  const n = new Vector3();
  const acc = new Vector3();
  const accN = new Vector3();
  const mapped = new Vector3();
  const mappedN = new Vector3();
  const armsN = new Vector3();
  for (const piece of pieces) {
    const count = piece.position.length / 3;
    const position = new Float32Array(count * 3);
    const normal = new Float32Array(count * 3);
    const skinIndex = new Uint16Array(count * 4);
    const skinWeight = new Float32Array(count * 4);
    const nearest = new Int32Array(count);
    const depth = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      p.fromArray(piece.position, i * 3);
      n.fromArray(piece.normal, i * 3);
      acc.set(0, 0, 0);
      accN.set(0, 0, 0);
      let total = 0;
      for (let k = 0; k < 4; k += 1) {
        const w = piece.skinWeight[i * 4 + k];
        if (w <= 0) continue;
        const seg = segmentOfJoint(jointNames[piece.skinIndex[i * 4 + k]] ?? '');
        if (!seg) continue;
        const m = maps.get(`${seg.segment}_${seg.side}`)!;
        mapPoint(m, p, mapped);
        tmp.copy(p).sub(m.src.o).applyMatrix3(m.src.r.clone().transpose());
        mapNormal(m, n, tmp.x / m.length, mappedN);
        acc.addScaledVector(mapped, w);
        accN.addScaledVector(mappedN, w);
        total += w;
      }
      if (total <= 0) {
        acc.copy(p);
        accN.copy(n);
        total = 1;
      }
      acc.multiplyScalar(1 / total);
      accN.normalize();
      // every vertex needs weights: unweighted vertices skin to the origin
      let near = grid.nearest(acc);
      if (near < 0) near = grid.nearest(acc, 12);
      nearest[i] = near;
      if (near >= 0) {
        armsN.fromArray(arms.normal, near * 3).normalize();
        depth[i] = tmp.copy(acc).sub(armsPoints[near]).dot(armsN);
        // take over the surface underneath: plates twist and bend with it
        for (let k = 0; k < 4; k += 1) {
          skinIndex[i * 4 + k] = arms.skinIndex[near * 4 + k];
          skinWeight[i * 4 + k] = arms.skinWeight[near * 4 + k];
        }
      }
      acc.toArray(position, i * 3);
      accN.toArray(normal, i * 3);
    }
    // lift the whole piece by one amount so its shape survives, then fix the few stragglers
    const needs = Array.from(depth, (d, i) => (nearest[i] >= 0 ? Math.max(0, FP_CLEARANCE - d) : 0)).sort((a, b) => a - b);
    const lift = needs[Math.floor(needs.length * 0.95)] ?? 0;
    for (let i = 0; i < count; i += 1) {
      const near = nearest[i];
      if (near < 0) continue;
      armsN.fromArray(arms.normal, near * 3).normalize();
      const extra = Math.max(0, FP_CLEARANCE - (depth[i] + lift));
      acc.fromArray(position, i * 3).addScaledVector(armsN, lift + extra).toArray(position, i * 3);
    }
    rigidIfSmall(position, skinIndex, skinWeight);
    for (let i = 0; i < position.length; i += 1) position[i] *= unit;
    out.push({ ...piece, position, normal, skinIndex, skinWeight });
  }
  return out;
}
