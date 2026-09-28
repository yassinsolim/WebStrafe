/**
 * fits the right hand's finger curls to every knife model and writes
 * src/viewmodel/knifeHandPoses.json, which the viewmodel uses for the blender
 * knives. each digit closes from open in small steps and stops at the first
 * curl where the fingertip rests on the handle (or guard), or just before any
 * part of the finger would sink into the handle or touch the blade.
 *   npx tsx tools/assets/gripFit.ts
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Vector3 } from 'three';
import { KNIVES, type KnifeId } from '../../src/combat/knives';
import { DIGIT_NAMES } from '../../src/viewmodel/ArmsRig';
import { createHandPose, type MutableHandPose } from '../../src/viewmodel/handPoses';
import { digitSamples, distanceTo, gripScene, isInside, palmSamples, poseScene, setHandOffset, type GripScene, type KnifeHandFit } from './gripProbe';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** a gloved finger's centreline sits about this far from what it grips */
export const REST_ON_SURFACE_M = 0.0105;
/** closer than this and the glove sinks into the handle */
export const MIN_HANDLE_CLEARANCE_M = 0.0072;
/** closer than this and the finger cuts into the blade */
export const MIN_BLADE_CLEARANCE_M = 0.0085;

type Digit = (typeof DIGIT_NAMES)[number];

function blocked(scene: GripScene, d: Digit): boolean {
  const { samples } = digitSamples(scene, d);
  // the first joint (knuckle) is fixed by the palm, only test what the curl moves
  for (const s of samples.slice(1)) {
    if (distanceTo(scene.handle, s) < MIN_HANDLE_CLEARANCE_M || isInside(scene.handle, s)) return true;
    if (scene.blade.length && distanceTo(scene.blade, s) < MIN_BLADE_CLEARANCE_M) return true;
  }
  return false;
}

/** returns how far the digit closed, as a fraction of the starting pose */
function fitDigit(scene: GripScene, pose: MutableHandPose, d: Digit): number {
  const base = [...pose[d]] as [number, number, number];
  let best = 0.35;
  for (let k = 0.35; k <= 1.8 + 1e-9; k += 0.025) {
    pose[d][0] = base[0] * k;
    pose[d][1] = base[1] * k;
    pose[d][2] = base[2] * k;
    poseScene(scene, pose);
    if (blocked(scene, d)) break;
    best = k;
    if (distanceTo(scene.handle, digitSamples(scene, d).tip) <= REST_ON_SURFACE_M) break;
  }
  pose[d][0] = Math.round(base[0] * best * 10) / 10;
  pose[d][1] = Math.round(base[1] * best * 10) / 10;
  pose[d][2] = Math.round(base[2] * best * 10) / 10;
  poseScene(scene, pose);
  return best;
}

const FINGERS: Digit[] = ['index', 'middle', 'ring', 'pinky'];

/** lower is better: fingertips resting on the handle, fingers well closed, palm on it without sinking in */
function fitAt(scene: GripScene, offset: [number, number, number]): { cost: number; pose: MutableHandPose } {
  setHandOffset(scene, offset);
  const pose = createHandPose(scene.basePose);
  let cost = 0;
  for (const d of FINGERS) {
    if (d === 'index' && scene.ring) continue;
    const k = fitDigit(scene, pose, d);
    const tip = distanceTo(scene.handle, digitSamples(scene, d).tip);
    const weight = d === 'pinky' ? 0.5 : 1;
    cost += weight * Math.min(0.02, Math.abs(tip - REST_ON_SURFACE_M));
    cost += weight * Math.max(0, 0.85 - k) * 0.02;
  }
  for (const p of palmSamples(scene)) {
    const dist = distanceTo(scene.handle, p);
    if (dist < 0.004 || isInside(scene.handle, p)) cost += 0.05;
    cost += Math.max(0, dist - 0.016) * 0.3;
  }
  return { cost, pose };
}

function range(a: number, b: number, step: number): number[] {
  const out: number[] = [];
  for (let v = a; v <= b + 1e-9; v += step) out.push(Math.round(v * 10000) / 10000);
  return out;
}

export async function fitKnife(id: KnifeId): Promise<KnifeHandFit> {
  const scene = await gripScene(id);
  // ring knives stay seated on the index finger, so only the fingers move
  const xs = scene.kind === 'tee' ? range(-0.004, 0.008, 0.004) : [0];
  const ys = scene.ring ? [0] : range(-0.027, 0.006, 0.003);
  const zs = scene.ring ? [0] : range(-0.027, 0.006, 0.003);
  let best: { cost: number; pose: MutableHandPose; offset: [number, number, number] } | null = null;
  for (const x of xs) for (const y of ys) for (const z of zs) {
    const r = fitAt(scene, [x, y, z]);
    if (!best || r.cost < best.cost) best = { ...r, offset: [x, y, z] };
  }
  setHandOffset(scene, best!.offset);
  const pose = best!.pose;
  poseScene(scene, pose);
  // hammer grips fold the thumb over the index finger's middle segment; ring
  // knives press it on top of the ring finger's neighbour, the index
  const [, i2, i3] = scene.digits.index;
  const overIndex = () => i2.getWorldPosition(new Vector3()).lerp(i3.getWorldPosition(new Vector3()), 0.5);
  fitThumb(scene, pose, overIndex, 0.019);
  const fit: KnifeHandFit = { pose, offset: best!.offset };
  // folders: where the thumb sits to work the opener (pivot, stud or button)
  if (scene.pivot) {
    const opener = createHandPose(pose);
    const target = scene.pivot.clone();
    fitThumb(scene, opener, () => target, 0.012);
    fit.opener = [...opener.thumb] as [number, number, number];
    poseScene(scene, pose);
  }
  return fit;
}

/** thumb: scale the curl and swing the first joint until the tip rests on `target()` */
function fitThumb(scene: GripScene, pose: MutableHandPose, target: () => Vector3, rest: number): void {
  const base = [...pose.thumb] as [number, number, number];
  const baseSum = Math.max(10, base[0] + base[1] + base[2]);
  let best = { cost: Infinity, t: base };
  for (let swing = -20; swing <= 50; swing += 5) {
    for (let curl = 0; curl <= 90; curl += 5) {
      const s = curl / baseSum;
      const t: [number, number, number] = [base[0] * s + swing, base[1] * s, base[2] * s];
      pose.thumb = t;
      poseScene(scene, pose);
      const { tip, samples } = digitSamples(scene, 'thumb');
      if (samples.slice(1).some((p) => isInside(scene.handle, p) || distanceTo(scene.handle, p) < MIN_HANDLE_CLEARANCE_M
        || (scene.blade.length > 0 && distanceTo(scene.blade, p) < MIN_BLADE_CLEARANCE_M))) continue;
      const cost = Math.abs(tip.distanceTo(target()) - rest);
      if (cost < best.cost) best = { cost, t };
    }
  }
  pose.thumb = best.t.map((v) => Math.round(v * 10) / 10) as [number, number, number];
  poseScene(scene, pose);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const table: Record<string, KnifeHandFit> = {};
  for (const def of KNIVES) {
    table[def.id] = await fitKnife(def.id);
    console.log(def.id.padEnd(16), JSON.stringify(table[def.id]));
  }
  const file = path.join(ROOT, 'src/viewmodel/knifeHandPoses.json');
  writeFileSync(file, `${JSON.stringify(table, null, 2)}\n`);
  console.log(`wrote ${path.relative(ROOT, file)}`);
}
