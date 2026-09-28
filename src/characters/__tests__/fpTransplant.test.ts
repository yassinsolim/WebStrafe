import { readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder as MeshoptDecoderNode, MeshoptEncoder } from 'meshoptimizer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Box3, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { ARMOR_SETS } from '../catalog';
import { FirstPersonArmor } from '../fpArmor';
import { CharacterLibrary } from '../library';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

async function parse(file: string, stripTextures = false): Promise<GLTF> {
  let data: ArrayBuffer = readFileSync(path.join(ROOT, file)).buffer as ArrayBuffer;
  if (stripTextures) {
    // ktx2 textures don't decode in node, and only the geometry and rig matter here
    await Promise.all([MeshoptDecoderNode.ready, MeshoptEncoder.ready]);
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoderNode, 'meshopt.encoder': MeshoptEncoder });
    const doc = await io.read(path.join(ROOT, file));
    for (const tex of doc.getRoot().listTextures()) tex.dispose();
    for (const ext of doc.getRoot().listExtensionsUsed()) {
      if (ext.extensionName === 'KHR_texture_basisu') ext.dispose();
    }
    const bin = await io.writeBinary(doc);
    data = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer;
  }
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  await MeshoptDecoder.ready;
  return new Promise((resolve, reject) => loader.parse(data, '', resolve, reject));
}

let library: CharacterLibrary;
let arms: GLTF;
const armor = new FirstPersonArmor();

beforeAll(async () => {
  library = CharacterLibrary.fromGltf(await parse('public/characters/armor.glb'));
  arms = await parse('public/viewmodels/v2/arms.glb', true);
  await armor.attach(arms.scene, Promise.resolve(library));
}, 60_000);

/** glove, skin and sleeve: the arms come as one skinned mesh per material */
function armsMeshes(): SkinnedMesh[] {
  const found: SkinnedMesh[] = [];
  arms.scene.traverse((n) => {
    if ((n as SkinnedMesh).isSkinnedMesh && !n.name.startsWith('FirstPersonArmor')) found.push(n as SkinnedMesh);
  });
  return found;
}

function armsMesh(): SkinnedMesh {
  return armsMeshes()[0];
}

/** bind-space bounds of the parts of a skinned mesh whose vertices ride mostly on the given bones */
function forearmBox(mesh: SkinnedMesh, bones: Set<number>): Box3 {
  const box = new Box3();
  const pos = mesh.geometry.getAttribute('position');
  const si = mesh.geometry.getAttribute('skinIndex');
  const sw = mesh.geometry.getAttribute('skinWeight');
  const v = new Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    let best = 0;
    for (let k = 1; k < 4; k += 1) if (sw.getComponent(i, k) > sw.getComponent(i, best)) best = k;
    if (!bones.has(si.getComponent(i, best))) continue;
    box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(mesh.bindMatrix));
  }
  return box;
}

describe('first-person armor transplanted from the kit arm pieces', () => {
  it('builds a mesh per set on the arms skeleton', () => {
    const skel = armsMesh().skeleton;
    for (const set of ARMOR_SETS) {
      const mesh = armor.meshFor(set);
      expect(mesh, set).toBeTruthy();
      expect(mesh!.skeleton).toBe(skel);
      expect(mesh!.geometry.getAttribute('position').count, set).toBeGreaterThan(500);
    }
  });

  it('weights every vertex (unweighted vertices collapse to the origin)', () => {
    for (const set of ARMOR_SETS) {
      const sw = armor.meshFor(set)!.geometry.getAttribute('skinWeight');
      for (let i = 0; i < sw.count; i += 1) {
        const total = sw.getX(i) + sw.getY(i) + sw.getZ(i) + sw.getW(i);
        expect(total, `${set} vertex ${i}`).toBeGreaterThan(0.99);
      }
    }
  });

  it('covers the forearm the way the sleeve does, not just the wrist', () => {
    const base = armsMesh();
    const idx = new Map(base.skeleton.bones.map((b, i) => [b.name, i]));
    for (const side of ['l', 'r']) {
      const bones = new Set([idx.get(`forearm_${side}`)!, idx.get(`forearm_twist_${side}`)!]);
      const sleeve = new Box3();
      for (const m of armsMeshes()) sleeve.union(forearmBox(m, bones));
      for (const set of ARMOR_SETS) {
        const plates = forearmBox(armor.meshFor(set)!, bones);
        const s = sleeve.getSize(new Vector3());
        const p = plates.getSize(new Vector3());
        // plates span most of the forearm's length (its longest axis)
        const axis = s.x > s.y ? (s.x > s.z ? 'x' : 'z') : s.y > s.z ? 'y' : 'z';
        expect(p[axis], `${set} ${side}`).toBeGreaterThan(s[axis] * 0.6);
        // and stay near the arm
        expect(plates.getCenter(new Vector3()).distanceTo(sleeve.getCenter(new Vector3())), `${set} ${side}`).toBeLessThan(0.1);
      }
    }
  });
});
