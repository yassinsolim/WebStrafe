import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Accessor, Document, Node, NodeIO, Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';

// structural checks for the shared first-person arms (tools/blender/arms/build_arms.py)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GLB = path.join(ROOT, 'public', 'viewmodels', 'v2', 'arms.glb');

const DIGITS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const BASE_BONES = [
  'upperarm',
  'forearm',
  'forearm_twist',
  'hand',
  ...DIGITS.flatMap((d) => ['01', '02', '03'].map((i) => `${d}_${i}`)),
];
const REQUIRED_BONES = ['l', 'r'].flatMap((side) => BASE_BONES.map((b) => `${b}_${side}`));
const WATCH_NODES = [
  'watch',
  'watch_case',
  'watch_bezel',
  'watch_crystal',
  'watch_dial',
  'watch_strap',
  'watch_crown',
  'watch_hand_hour',
  'watch_hand_minute',
  'watch_hand_second',
];
const MATERIALS = [
  'mat_glove',
  'mat_sleeve',
  'mat_skin',
  'mat_watch_steel',
  'mat_watch_bezel',
  'mat_watch_dial',
  'mat_watch_lume',
  'mat_watch_crystal',
  'mat_watch_strap',
];
const MAX_TRIANGLES = 40_000;
const MAX_WATCH_TRIANGLES = 6_000;

let doc: Document;

function nodeByName(name: string): Node | undefined {
  return doc.getRoot().listNodes().find((n) => n.getName() === name);
}

function triangles(prim: Primitive): number {
  const indices = prim.getIndices();
  const count = indices ? indices.getCount() : prim.getAttribute('POSITION')!.getCount();
  return count / 3;
}

function meshTriangles(node: Node): number {
  const mesh = node.getMesh();
  return mesh ? mesh.listPrimitives().reduce((sum, p) => sum + triangles(p), 0) : 0;
}

function subtreeTriangles(node: Node): number {
  return meshTriangles(node) + node.listChildren().reduce((sum, c) => sum + subtreeTriangles(c), 0);
}

// getElement already decodes normalized (quantized) integers to 0..1 floats
function readVec4(acc: Accessor, i: number, out: number[]): number[] {
  return acc.getElement(i, out);
}

beforeAll(async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  doc = await io.read(GLB);
});

describe('public/viewmodels/v2/arms.glb', () => {
  it('has exactly one skin and every required bone is one of its joints', () => {
    const skins = doc.getRoot().listSkins();
    expect(skins).toHaveLength(1);
    const joints = new Set(skins[0].listJoints().map((j) => j.getName()));
    for (const bone of REQUIRED_BONES) {
      expect(joints.has(bone), `missing bone ${bone}`).toBe(true);
    }
    expect(nodeByName('ArmsRig')).toBeDefined();
  });

  it('skins the arms with at most 4 normalized influences', () => {
    const skin = doc.getRoot().listSkins()[0];
    const skinned = doc.getRoot().listNodes().filter((n) => n.getSkin());
    // one skinned mesh, a primitive per material, so the file keeps one skin
    expect(skinned.map((n) => n.getName())).toEqual(['arms']);
    const primMaterials = skinned[0].getMesh()!.listPrimitives().map((p) => p.getMaterial()?.getName());
    expect(primMaterials.sort()).toEqual(['mat_glove', 'mat_skin', 'mat_sleeve']);
    const w = [0, 0, 0, 0];
    const j = [0, 0, 0, 0];
    const jointCount = skin.listJoints().length;
    for (const node of skinned) {
      expect(node.getSkin()).toBe(skin);
      for (const prim of node.getMesh()!.listPrimitives()) {
        // a 5th influence would need a second joints/weights set
        expect(prim.getAttribute('JOINTS_1')).toBeNull();
        expect(prim.getAttribute('WEIGHTS_1')).toBeNull();
        const joints = prim.getAttribute('JOINTS_0')!;
        const weights = prim.getAttribute('WEIGHTS_0')!;
        expect(joints.getCount()).toBe(weights.getCount());
        for (let i = 0; i < weights.getCount(); i++) {
          readVec4(weights, i, w);
          joints.getElement(i, j);
          const sum = w[0] + w[1] + w[2] + w[3];
          expect(Math.abs(sum - 1), `${node.getName()} vertex ${i} weight sum ${sum}`).toBeLessThan(0.01);
          for (let k = 0; k < 4; k++) {
            expect(w[k]).toBeGreaterThanOrEqual(0);
            expect(j[k]).toBeLessThan(jointCount);
          }
        }
      }
    }
    // walks every vertex of the skinned mesh, slow on a busy machine
  }, 30000);

  it('parents the watch to forearm_twist_l with all its parts', () => {
    for (const name of WATCH_NODES) {
      expect(nodeByName(name), `missing ${name}`).toBeDefined();
    }
    const watch = nodeByName('watch')!;
    const twist = nodeByName('forearm_twist_l')!;
    expect(watch.getParentNode()).toBe(twist);
    for (const name of WATCH_NODES.slice(1)) {
      expect(nodeByName(name)!.getParentNode(), `${name} parent`).toBe(watch);
    }
    // nodes the runtime spins are identity pivots on the dial centre with the
    // geometry below them, so mesh quantization can never move the pivot
    for (const name of ['watch_hand_hour', 'watch_hand_minute', 'watch_hand_second', 'watch_bezel']) {
      const pivot = nodeByName(name)!;
      const t = pivot.getTranslation();
      const r = pivot.getRotation();
      expect(Math.hypot(t[0], t[1], t[2]), `${name} translation`).toBeLessThan(1e-6);
      expect(r[3], `${name} rotation`).toBeCloseTo(1, 6);
      expect(pivot.listChildren().some((c) => subtreeTriangles(c) > 0), `${name} geometry`).toBe(true);
    }
  });

  it('maps the dial disk onto the full uv square', () => {
    const uv = nodeByName('watch_dial')!.getMesh()!.listPrimitives()[0].getAttribute('TEXCOORD_0')!;
    const el = [0, 0];
    let [minU, minV, maxU, maxV] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < uv.getCount(); i++) {
      const [u, v] = uv.getElement(i, el);
      [minU, minV, maxU, maxV] = [Math.min(minU, u), Math.min(minV, v), Math.max(maxU, u), Math.max(maxV, v)];
    }
    for (const [value, target] of [[minU, 0], [minV, 0], [maxU, 1], [maxV, 1]]) {
      expect(Math.abs(value - target)).toBeLessThan(0.01);
    }
  });

  it('stays inside the triangle budget', () => {
    const root = doc.getRoot();
    const total = root.listNodes().reduce((sum, n) => sum + meshTriangles(n), 0);
    const watch = subtreeTriangles(nodeByName('watch')!);
    expect(total).toBeLessThanOrEqual(MAX_TRIANGLES);
    expect(watch).toBeLessThanOrEqual(MAX_WATCH_TRIANGLES);
  });

  it('uses the agreed material names', () => {
    const names = new Set(doc.getRoot().listMaterials().map((m) => m.getName()));
    for (const name of MATERIALS) {
      expect(names.has(name), `missing ${name}`).toBe(true);
    }
  });

  it('places the rest pose where the viewmodel camera expects it', () => {
    // blender (x, y, z) exports as three.js (x, z, -y): the right shoulder at
    // blender (0.19, -0.12, -0.28) is (0.19, -0.28, 0.12), arms reach down -z
    const shoulder = nodeByName('upperarm_r')!.getWorldTranslation();
    expect(shoulder[0]).toBeCloseTo(0.19, 2);
    expect(shoulder[1]).toBeCloseTo(-0.28, 2);
    expect(shoulder[2]).toBeCloseTo(0.12, 2);
    const left = nodeByName('upperarm_l')!.getWorldTranslation();
    expect(left[0]).toBeCloseTo(-0.19, 2);
    const wrist = nodeByName('hand_r')!.getWorldTranslation();
    expect(wrist[2]).toBeLessThan(shoulder[2] - 0.5);
  });
});
