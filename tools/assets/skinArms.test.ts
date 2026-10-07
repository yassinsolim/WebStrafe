import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import { SKINS } from '../../src/characters/catalog';

// the skins' first-person arms (tools/blender/characters/build_skins.py): the
// runtime swaps their bones for arms.glb's by name and keeps their inverse
// bind matrices (src/characters/fpArmor.ts), so the rigs must match exactly
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ARMS = path.join(ROOT, 'public', 'viewmodels', 'v2', 'arms.glb');
const DIGITS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const BONES = ['l', 'r'].flatMap((side) =>
  ['upperarm', 'forearm', 'forearm_twist', 'hand', ...DIGITS.flatMap((d) => ['01', '02', '03'].map((i) => `${d}_${i}`))]
    .map((b) => `${b}_${side}`));
const MAX_TRIANGLES_PER_ARM = 12_000;

let io: NodeIO;
let arms: Document;

function worldMatrices(doc: Document): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const node of doc.getRoot().listSkins()[0].listJoints()) out.set(node.getName(), node.getWorldMatrix() as number[]);
  return out;
}

beforeAll(async () => {
  await MeshoptDecoder.ready;
  io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  arms = await io.read(ARMS);
});

describe.each([...SKINS])('public/characters/skins/%s_arms.glb', (id) => {
  let doc: Document;
  beforeAll(async () => {
    doc = await io.read(path.join(ROOT, 'public', 'characters', 'skins', `${id}_arms.glb`));
  });

  it("sits on arms.glb's rig: every bone, in the same rest pose", () => {
    expect(doc.getRoot().listSkins()).toHaveLength(1);
    const ours = worldMatrices(doc);
    const theirs = worldMatrices(arms);
    for (const bone of BONES) {
      expect(ours.has(bone), `missing ${bone}`).toBe(true);
      const a = ours.get(bone)!;
      const b = theirs.get(bone)!;
      for (let i = 0; i < 16; i += 1) expect(Math.abs(a[i] - b[i]), `${bone}[${i}]`).toBeLessThan(1e-4);
    }
  });

  it('has a left and a right arm with normalized weights on the arm bones', () => {
    const skinned = doc.getRoot().listNodes().filter((n) => n.getSkin());
    expect(skinned.map((n) => n.getExtras().side).sort()).toEqual(['l', 'r']);
    for (const node of skinned) {
      expect(node.getExtras().skin_arms).toBe(id);
      const joints = node.getSkin()!.listJoints().map((j) => j.getName());
      const side = String(node.getExtras().side);
      let tris = 0;
      for (const prim of node.getMesh()!.listPrimitives()) {
        tris += (prim.getIndices()?.getCount() ?? 0) / 3;
        expect(prim.getAttribute('JOINTS_1')).toBeNull();
        const J = prim.getAttribute('JOINTS_0')!;
        const W = prim.getAttribute('WEIGHTS_0')!;
        const j: number[] = [];
        const w: number[] = [];
        for (let i = 0; i < W.getCount(); i += 1) {
          W.getElement(i, w);
          J.getElement(i, j);
          const sum = w.reduce((s, v) => s + v, 0);
          expect(Math.abs(sum - 1), `${node.getName()} vertex ${i}`).toBeLessThan(0.02);
          for (let k = 0; k < 4; k += 1) {
            if (w[k] > 0.01) expect(joints[j[k]].endsWith(`_${side}`), `${joints[j[k]]} on the ${side} arm`).toBe(true);
          }
        }
      }
      expect(tris).toBeGreaterThan(1000);
      expect(tris).toBeLessThan(MAX_TRIANGLES_PER_ARM);
    }
  });
});
