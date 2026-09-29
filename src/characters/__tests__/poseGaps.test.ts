import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bone, Quaternion, Vector3, type Object3D } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { ArmorCharacter } from '../ArmorCharacter';
import { ARMOR_SETS } from '../catalog';
import { CharacterLibrary, type PartMesh } from '../library';
import { defaultLook } from '../look';
import { ALL_JOINTS } from '../skeleton';

// extreme poses (crouch, full aim up and down, a running stride, knife inspect):
// every plate has to stay on the body. a plate that drifts away from the bones
// it covers has come off its joint.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

async function parse(file: string): Promise<GLTF> {
  const data = readFileSync(path.join(ROOT, file)).buffer;
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  await MeshoptDecoder.ready;
  return new Promise((resolve, reject) => loader.parse(data, '', resolve, reject));
}

type Pose = { drop?: number; x?: Record<string, number>; y?: Record<string, number>; twist?: Record<string, number> };

// same as tools/character-preview.html ?pose=
export const POSES: Record<string, Pose> = {
  crouch: { drop: 0.36, x: { spine_1: 0.18, spine_2: 0.16, neck_0: -0.2, head_0: -0.14, leg_upper_l: -1.45, leg_upper_r: -1.35, leg_lower_l: 2.25, leg_lower_r: 2.1, ankle_l: -0.8, ankle_r: -0.75 } },
  aimup: { x: { spine_2: -0.3, spine_3: -0.3, neck_0: -0.35, head_0: -0.4 } },
  aimdown: { x: { spine_2: 0.32, spine_3: 0.3, neck_0: 0.35, head_0: 0.4 } },
  run: { y: { spine_2: 0.22, spine_3: 0.14 }, x: { spine_1: 0.14, leg_upper_l: -1.0, leg_upper_r: 0.55, leg_lower_l: 0.5, leg_lower_r: 1.45, ankle_l: -0.2, ankle_r: 0.35 } },
  inspect: { x: { arm_upper_r: -0.5 }, twist: { arm_lower_r: 1.4, hand_r: 0.5 } },
};

function bone(root: Object3D, name: string): Bone | null {
  let found: Bone | null = null;
  root.traverse((n) => {
    if ((n as Bone).isBone && n.name.replace(/_\d+$/, '') === name) found = n as Bone;
  });
  return found;
}

function applyPose(root: Object3D, pose: Pose): void {
  const qp = new Quaternion();
  const rot = (name: string, axis: Vector3, angle: number) => {
    const b = bone(root, name);
    if (!b) return;
    b.parent!.updateWorldMatrix(true, false);
    b.parent!.getWorldQuaternion(qp);
    const w = new Quaternion().setFromAxisAngle(axis, angle);
    b.quaternion.premultiply(qp.clone().invert().multiply(w).multiply(qp));
  };
  for (const [n, a] of Object.entries(pose.x ?? {})) rot(n, new Vector3(1, 0, 0), a);
  for (const [n, a] of Object.entries(pose.y ?? {})) rot(n, new Vector3(0, 1, 0), a);
  for (const [n, a] of Object.entries(pose.twist ?? {})) {
    bone(root, n)?.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), a));
  }
  if (pose.drop) bone(root, 'pelvis')!.position.y -= pose.drop;
  root.updateMatrixWorld(true);
}

/** cpu skinning of a library part through the character's live skeleton */
function skin(part: PartMesh, ch: ArmorCharacter): Vector3[] {
  const skel = ch.skeleton;
  skel.update();
  const out: Vector3[] = [];
  const v = new Vector3();
  const acc = new Vector3();
  const m = skel.boneMatrices!;
  for (let i = 0; i < part.position.length / 3; i += 1) {
    acc.set(0, 0, 0);
    for (let k = 0; k < 4; k += 1) {
      const w = part.skinWeight[i * 4 + k];
      if (!w) continue;
      const j = part.skinIndex[i * 4 + k] * 16;
      v.fromArray(part.position, i * 3);
      const x = m[j] * v.x + m[j + 4] * v.y + m[j + 8] * v.z + m[j + 12];
      const y = m[j + 1] * v.x + m[j + 5] * v.y + m[j + 9] * v.z + m[j + 13];
      const z = m[j + 2] * v.x + m[j + 6] * v.y + m[j + 10] * v.z + m[j + 14];
      acc.x += w * x;
      acc.y += w * y;
      acc.z += w * z;
    }
    out.push(acc.clone());
  }
  return out;
}

let library: CharacterLibrary;
beforeAll(async () => {
  library = CharacterLibrary.fromGltf(await parse('public/characters/armor.glb'));
}, 60_000);

/** for each part: its median vertex distance to the nearest limb segment of the posed skeleton */
function gaps(set: string, poseName: string | null): Array<[string, number]> {
  const look = { ...defaultLook('terrorist'), helmet: set, arms: set, chest: set, legs: set, classItem: set } as ReturnType<typeof defaultLook>;
  const ch = new ArmorCharacter(library, look, 'terrorist', { pose: 'none' });
  ch.root.updateMatrixWorld(true);
  if (poseName) applyPose(ch.root, POSES[poseName]);
  ch.skeleton.update();
  // limb segments: every body bone to its parent (the cloth and cap helpers are not limbs)
  const segs: Array<[Vector3, Vector3]> = [];
  const body = new Set(ALL_JOINTS.filter((j) => !/^(cape|tail|knee|elbow)_/.test(j.name)).map((j) => j.name));
  for (const b of ch.skeleton.bones) {
    const name = b.name.replace(/_\d+$/, '');
    const parent = b.parent as Bone;
    if (!body.has(name) || !parent?.isBone || !body.has(parent.name.replace(/_\d+$/, ''))) continue;
    segs.push([parent.getWorldPosition(new Vector3()), b.getWorldPosition(new Vector3())]);
  }
  const ab = new Vector3();
  const ap = new Vector3();
  const segDist = (p: Vector3) => {
    let best = Infinity;
    for (const [a, b] of segs) {
      ab.subVectors(b, a);
      ap.subVectors(p, a);
      const t = Math.min(1, Math.max(0, ap.dot(ab) / Math.max(ab.lengthSq(), 1e-9)));
      best = Math.min(best, ap.addScaledVector(ab, -t).length());
    }
    return best;
  };
  const out: Array<[string, number]> = [];
  for (const slot of ['arms', 'legs']) {
    for (const part of library.get(slot, set, 0)) {
      const pts = skin(part, ch);
      const d: number[] = [];
      for (let i = 0; i < pts.length; i += 3) d.push(segDist(pts[i]));
      d.sort((x, y) => x - y);
      out.push([`${slot}.${part.part}`, d[Math.floor(d.length / 2)]]);
    }
  }
  ch.dispose();
  return out;
}

describe('plates stay on the body in extreme poses', () => {
  it('knows the cap helpers', () => {
    expect(ALL_JOINTS.some((j) => j.name === 'knee_l')).toBe(true);
    const knee = library.get('legs', 'strafe', 0).find((p) => p.part === 'knee_l')!;
    const kneeIdx = ALL_JOINTS.findIndex((j) => j.name === 'knee_l');
    expect(knee.skinIndex[0]).toBe(kneeIdx);
  });

  it('turns each cap helper half way through its joint and sinks it into the bend', () => {
    const ch = new ArmorCharacter(library, defaultLook('terrorist'), 'terrorist', { pose: 'none' });
    ch.root.updateMatrixWorld(true);
    applyPose(ch.root, POSES.crouch);
    ch.skeleton.update();
    for (const side of ['l', 'r']) {
      const thigh = bone(ch.root, `leg_upper_${side}`)!.getWorldQuaternion(new Quaternion());
      const calf = bone(ch.root, `leg_lower_${side}`)!;
      const calfQ = calf.getWorldQuaternion(new Quaternion());
      const knee = bone(ch.root, `knee_${side}`)!;
      const kneeQ = knee.getWorldQuaternion(new Quaternion());
      // the knee helper sits between the thigh's and calf's world frames (both relative to the bind)
      const bend = thigh.angleTo(calfQ);
      expect(Math.abs(kneeQ.angleTo(calfQ) - kneeQ.angleTo(thigh))).toBeLessThan(bend * 0.35);
      expect(knee.position.length(), side).toBeGreaterThan(0.01);
    }
    ch.dispose();
  });

  for (const set of ARMOR_SETS) {
    for (const poseName of Object.keys(POSES)) {
      it(`${set} ${poseName}`, () => {
        // pauldrons and lights stand off the body by design: measure how far each plate drifts from where it rests
        const rest = new Map(gaps(set, null));
        const drift = gaps(set, poseName)
          .map(([n, d]) => [n, d - (rest.get(n) ?? 0)] as [string, number])
          .sort((a, b) => b[1] - a[1]);
        // eslint-disable-next-line no-console
        if (process.env.GAPS) console.log(set, poseName, drift.slice(0, 3).map(([n, d]) => `${n}=+${(d * 100).toFixed(1)}cm`).join(' '));
        for (const [name, d] of drift) expect(d, `${set} ${poseName} ${name}`).toBeLessThan(0.025);
      });
    }
  }
});
