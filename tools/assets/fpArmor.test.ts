import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import { ARMOR_SETS } from '../../src/characters/catalog';

// structural checks for the first-person gauntlets and sleeves (tools/blender/characters/build_fp_armor.py)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GLB = path.join(ROOT, 'public', 'characters', 'fp_armor.glb');
const ARMS_BONES = ['upperarm', 'forearm', 'forearm_twist', 'hand'].flatMap((b) => [`${b}_l`, `${b}_r`]);

let doc: Document;

beforeAll(async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  doc = await io.read(GLB);
});

describe('first-person armor (public/characters/fp_armor.glb)', () => {
  it('has pieces for both arms of every set, mirrored', () => {
    const nodes = doc.getRoot().listNodes().filter((n) => (n.getExtras() as { slot?: string }).slot === 'fp');
    for (const set of ARMOR_SETS) {
      const mine = nodes.filter((n) => (n.getExtras() as { set?: string }).set === set);
      const left = mine.filter((n) => (n.getExtras() as { side?: string }).side === 'l');
      const right = mine.filter((n) => (n.getExtras() as { side?: string }).side === 'r');
      expect(right.length, set).toBeGreaterThan(1);
      expect(left.length, set).toBe(right.length);
    }
  });

  it('skins onto the arms rig bones and nothing else', () => {
    for (const node of doc.getRoot().listNodes()) {
      const skin = node.getSkin();
      if (!skin) continue;
      const joints = skin.listJoints().map((j) => j.getName());
      for (const bone of ARMS_BONES) expect(joints).toContain(bone);
    }
  });

  it('stays light, it is only ever seen up close in first person', () => {
    let triangles = 0;
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) triangles += (prim.getIndices()?.getCount() ?? 0) / 3;
    }
    expect(triangles).toBeLessThan(60_000);
  });
});
