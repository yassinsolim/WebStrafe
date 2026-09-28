import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Box3, Quaternion, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { PLAYER_CAPSULE_HEIGHT } from '../../combat/CombatArena';
import { applyKnifeIdlePose } from '../../multiplayer/playerRig';
import { ArmorCharacter } from '../ArmorCharacter';
import { ARMOR_SETS, ARMOR_SLOTS } from '../catalog';
import { CharacterLibrary, LOD_LEVELS, MATERIAL_SLOTS } from '../library';
import { defaultLook, randomLook } from '../look';
import { ALL_JOINTS } from '../skeleton';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GLB = path.join(ROOT, 'public', 'characters', 'armor.glb');

let library: CharacterLibrary;

async function parse(file: string): Promise<GLTF> {
  const buffer = readFileSync(file);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return new Promise((resolve, reject) => loader.parse(data, '', resolve, reject));
}

beforeAll(async () => {
  await MeshoptDecoder.ready;
  library = CharacterLibrary.fromGltf(await parse(GLB));
}, 30000);

describe('armor library (public/characters/armor.glb)', () => {
  it('has the undersuit and every piece of every set at every lod', () => {
    for (let lod = 0; lod < LOD_LEVELS; lod += 1) {
      expect(library.get('body', 'core', lod).length, `body lod${lod}`).toBeGreaterThan(0);
      for (const set of ARMOR_SETS) {
        for (const slot of ARMOR_SLOTS) {
          expect(library.get(slot, set, lod).length, `${slot}.${set}.lod${lod}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('lods get lighter, and a full character stays within budget', () => {
    for (const set of ARMOR_SETS) {
      const tris = [0, 1, 2].map((lod) =>
        ['body', ...ARMOR_SLOTS].reduce((sum, slot) => {
          const list = slot === 'body' ? library.get('body', 'core', lod) : library.get(slot, set, lod);
          return sum + list.reduce((s, p) => s + p.index.length / 3, 0);
        }, 0));
      expect(tris[0], `${set} lod0`).toBeLessThan(50_000);
      expect(tris[1], `${set} lod1`).toBeLessThan(tris[0] * 0.6);
      expect(tris[2], `${set} lod2`).toBeLessThan(tris[1] * 0.6);
    }
  });

  it('parts carry valid material slots, normalized skin weights and runtime bone indices', () => {
    for (const set of ARMOR_SETS) {
      for (const slot of ARMOR_SLOTS) {
        for (const part of library.get(slot, set, 0)) {
          expect(MATERIAL_SLOTS).toContain(part.material);
          const verts = part.position.length / 3;
          for (let i = 0; i < verts; i += Math.max(1, Math.floor(verts / 50))) {
            const w = part.skinWeight;
            expect(w[i * 4] + w[i * 4 + 1] + w[i * 4 + 2] + w[i * 4 + 3]).toBeCloseTo(1, 3);
            for (let k = 0; k < 4; k += 1) expect(part.skinIndex[i * 4 + k]).toBeLessThan(ALL_JOINTS.length);
            expect(part.occlusion[i * 2]).toBeGreaterThanOrEqual(0);
            expect(part.occlusion[i * 2]).toBeLessThanOrEqual(1.0001);
          }
        }
      }
    }
  }, 30_000);

  it('decal anchors face out of the chest with their up axis up', () => {
    for (const set of ARMOR_SETS) {
      const anchors = library.anchors.filter((a) => a.set === set);
      expect(anchors.map((a) => a.kind).sort(), set).toEqual(['emblem', 'tag']);
      for (const anchor of anchors) {
        const out = new Vector3(0, 0, 1).applyQuaternion(anchor.quaternion);
        const up = new Vector3(0, 1, 0).applyQuaternion(anchor.quaternion);
        expect(out.z, `${set} ${anchor.kind} faces forward`).toBeGreaterThan(0.6);
        expect(up.y, `${set} ${anchor.kind} up`).toBeGreaterThan(0.6);
        expect(anchor.position.y).toBeGreaterThan(1.1);
        expect(anchor.position.y).toBeLessThan(1.5);
      }
    }
  });
});

describe('armored characters', () => {
  it('build for every set and random mixes, one draw call per lod', () => {
    const looks = [
      ...ARMOR_SETS.map((set) => ({ ...defaultLook(), helmet: set, arms: set, chest: set, legs: set, classItem: set })),
      ...Array.from({ length: 12 }, (_, i) => randomLook(i)),
    ];
    for (const look of looks) {
      const character = new ArmorCharacter(library, look, 'counterterrorist', { pose: 'none' });
      const meshes: SkinnedMesh[] = [];
      character.root.traverse((o) => {
        if ((o as SkinnedMesh).isSkinnedMesh) meshes.push(o as SkinnedMesh);
      });
      expect(meshes.length).toBe(LOD_LEVELS);
      expect(character.triangles(0)).toBeGreaterThan(character.triangles(1));
      expect(character.rig).not.toBeNull();
      character.dispose();
    }
  });

  it('cosmetics never change the size: every look stands the same height, head in the head hitbox', () => {
    const headZoneBottom = PLAYER_CAPSULE_HEIGHT * (1 - 0.18);
    const heights: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      const look = randomLook(i * 31 + 7);
      const character = new ArmorCharacter(library, look, i % 2 ? 'terrorist' : 'counterterrorist', { pose: 'none' });
      if (character.rig) applyKnifeIdlePose(character.rig);
      character.root.updateMatrixWorld(true);
      const head = character.rig!.head!.getWorldPosition(new Vector3());
      expect(head.y).toBeGreaterThan(headZoneBottom);
      expect(head.y).toBeLessThan(PLAYER_CAPSULE_HEIGHT);
      // the skeleton is shared and unscaled, so the head never moves with cosmetics
      heights.push(head.y);
      expect(character.root.scale.toArray()).toEqual([1, 1, 1]);
      character.dispose();
    }
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1e-9);
  });

  it('swapping pieces keeps the skeleton and its pose', () => {
    const character = new ArmorCharacter(library, defaultLook(), 'terrorist', { pose: 'none' });
    applyKnifeIdlePose(character.rig!);
    const before = character.rig!.rightUpper.quaternion.clone();
    const triangles = character.triangles(0);
    character.setLook({ ...defaultLook(), helmet: 'quill', chest: 'anvil', classItem: 'none' });
    expect(character.rig!.rightUpper.quaternion.angleTo(before)).toBeLessThan(1e-9);
    expect(character.triangles(0)).not.toBe(triangles);
    character.dispose();
  });

  it('the merged bind pose sits on the floor at about player height', () => {
    const character = new ArmorCharacter(library, { ...defaultLook(), helmet: 'quill' }, 'terrorist', { pose: 'none', lod: 0 });
    const mesh = character.root.getObjectByName('ArmorMesh:lod0') as SkinnedMesh;
    const box = new Box3().setFromBufferAttribute(mesh.geometry.getAttribute('position') as never);
    expect(box.min.y).toBeGreaterThan(-0.01);
    expect(box.min.y).toBeLessThan(0.02);
    expect(box.max.y).toBeGreaterThan(1.75);
    expect(box.max.y).toBeLessThan(1.95);
    void Quaternion;
    character.dispose();
  });
});
