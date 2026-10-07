import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Group, Matrix4, Vector3, type Bone } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { beforeAll, describe, expect, it } from 'vitest';
import type { KnifeId } from '../../combat/knives';
import { applyKnifeIdlePose, attachKnifeModel } from '../../multiplayer/playerRig';
import { setRemoteKnife } from '../../multiplayer/remoteKnife';
import { ArmorCharacter } from '../ArmorCharacter';
import { SKIN_INFO, SKINS, type SkinId } from '../catalog';
import { CharacterLibrary, LOD_LEVELS } from '../library';
import { defaultLook } from '../look';
import { ALL_JOINTS, bindPose } from '../skeleton';
import { skinFromGltf, type SkinAsset } from '../skins';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DIR = path.join(ROOT, 'public', 'characters', 'skins');
const MB = 1024 * 1024;

async function parse(file: string): Promise<GLTF> {
  const buffer = readFileSync(file);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return new Promise((resolve, reject) => loader.parse(data, '', resolve, reject));
}

const skins = new Map<SkinId, SkinAsset>();
let library: CharacterLibrary;

beforeAll(async () => {
  await MeshoptDecoder.ready;
  library = CharacterLibrary.fromGltf(await parse(path.join(ROOT, 'public', 'characters', 'armor.glb')));
  for (const id of SKINS) {
    const skin = skinFromGltf(id, await parse(path.join(DIR, `${id}.glb`)));
    if (skin) skins.set(id, skin);
    library.skins.set(id, skin!);
  }
}, 60000);

const tris = (skin: SkinAsset, lod: number) => skin.parts[lod].reduce((sum, p) => sum + p.index.length / 3, 0);

describe.each([...SKINS])('skin %s', (id) => {
  it('loads with every lod, lighter each step', () => {
    const skin = skins.get(id)!;
    expect(skin).toBeDefined();
    expect(skin.parts).toHaveLength(LOD_LEVELS);
    expect(tris(skin, 0)).toBeLessThan(60_000);
    expect(tris(skin, 1)).toBeLessThan(tris(skin, 0) * 0.7);
    expect(tris(skin, 2)).toBeLessThan(tris(skin, 1) * 0.6);
  });

  it('stands on the floor at a human height, facing +z', () => {
    const skin = skins.get(id)!;
    let minY = Infinity;
    let maxY = -Infinity;
    let frontZ = 0;
    const p = skin.parts[0][0].position;
    for (let i = 0; i < p.length; i += 3) {
      minY = Math.min(minY, p[i + 1]);
      maxY = Math.max(maxY, p[i + 1]);
      if (p[i + 1] > 1.2 && p[i + 1] < 1.4 && Math.abs(p[i]) < 0.05) frontZ = Math.max(frontZ, p[i + 2]);
    }
    expect(minY).toBeGreaterThan(-0.03);
    expect(minY).toBeLessThan(0.04);
    expect(maxY).toBeGreaterThan(1.7);
    expect(maxY).toBeLessThan(1.95);
    // the chest is on the +z side
    expect(frontZ).toBeGreaterThan(0.1);
  });

  it('brings its own joints for the shared skeleton, in an a-pose with the hands open', () => {
    const skin = skins.get(id)!;
    expect(skin.joints.map((j) => j.name)).toEqual(ALL_JOINTS.map((j) => j.name));
    const at = new Map(bindPose(skin.joints).map((j) => [j.name, j.position]));
    // scaled to the game's neck height, then dropped onto the floor
    expect(Math.abs(at.get('neck_0')!.y - 1.54)).toBeLessThan(0.02);
    expect(at.get('head_0')!.y).toBeGreaterThan(1.55);
    expect(at.get('hand_r')!.x).toBeLessThan(-0.4);
    expect(at.get('hand_l')!.x).toBeGreaterThan(0.4);
    expect(at.get('ankle_l')!.y).toBeLessThan(0.16);
    for (const side of ['l', 'r']) {
      for (const f of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
        expect(at.get(`finger_${f}_0_${side}`)!.distanceTo(at.get(`hand_${side}`)!), `${f} ${side}`).toBeLessThan(0.14);
      }
    }
  });

  it('weights every vertex onto real joints, arms and fingers included', () => {
    const skin = skins.get(id)!;
    const used = new Set<string>();
    for (const part of skin.parts[0]) {
      for (let i = 0; i < part.skinWeight.length; i += 4) {
        const sum = part.skinWeight[i] + part.skinWeight[i + 1] + part.skinWeight[i + 2] + part.skinWeight[i + 3];
        expect(Math.abs(sum - 1)).toBeLessThan(0.01);
        for (let k = 0; k < 4; k += 1) {
          if (part.skinWeight[i + k] > 0.05) used.add(ALL_JOINTS[part.skinIndex[i + k]].name);
        }
      }
    }
    for (const bone of ['pelvis', 'spine_3', 'head_0', 'arm_upper_r', 'arm_lower_l', 'hand_r', 'finger_index_1_r', 'finger_thumb_2_l', 'leg_lower_r', 'ankle_l']) {
      expect(used.has(bone), bone).toBe(true);
    }
  });

  it('marks emblem and callsign spots on the chest', () => {
    const skin = skins.get(id)!;
    const kinds = skin.anchors.map((a) => a.kind).sort();
    expect(kinds).toEqual(['emblem', 'tag']);
    for (const anchor of skin.anchors) {
      expect(anchor.bone).toBe('spine_3');
      expect(anchor.position.y).toBeGreaterThan(1.2);
      expect(anchor.position.z).toBeGreaterThan(0.1);
      // the decal faces forward
      expect(new Vector3(0, 0, 1).applyQuaternion(anchor.quaternion).z).toBeGreaterThan(0.7);
    }
  });

  it('dresses a character on its own bind pose and back to the kit', () => {
    const look = { ...defaultLook(), skin: id, ...SKIN_INFO[id].native };
    const character = new ArmorCharacter(library, look, 'terrorist', { pose: 'none', lod: 0 });
    expect(character.triangles(0)).toBe(tris(skins.get(id)!, 0));
    character.root.updateMatrixWorld(true);
    const bind = new Map(bindPose(skins.get(id)!.joints).map((j) => [j.name, j.position]));
    const skeleton = character.skeleton;
    const m = new Matrix4();
    for (const [i, bone] of skeleton.bones.entries()) {
      // the rest pose skins every vertex to itself
      m.multiplyMatrices(bone.matrixWorld, skeleton.boneInverses[i]);
      expect(m.equals(new Matrix4()) || m.elements.every((v, k) => Math.abs(v - new Matrix4().elements[k]) < 1e-4), bone.name).toBe(true);
      const name = ALL_JOINTS[i].name;
      expect(bone.getWorldPosition(new Vector3()).distanceTo(bind.get(name)!), name).toBeLessThan(1e-4);
    }
    character.setLook({ ...look, skin: 'kit' });
    expect(character.triangles(0)).not.toBe(tris(skins.get(id)!, 0));
    character.dispose();
  });

  it('stays inside the download budget', () => {
    const files = [`${id}.glb`, `${id}_arms.glb`, ...['color', 'normal', 'data', 'mask'].map((t) => `${id}_${t}.webp`)];
    const total = files.reduce((sum, f) => sum + statSync(path.join(DIR, f)).size, 0);
    expect(total).toBeLessThan(3 * MB);
  });
});

// the third person knife hold on every body: the fingers wrap the handle
describe.each(['kit', ...SKINS] as const)('knife in the fist, %s', (body) => {
  const point = (bone: Bone) => bone.getWorldPosition(new Vector3());
  const fromLine = (p: Vector3, origin: Vector3, dir: Vector3) => {
    const d = p.clone().sub(origin);
    return d.addScaledVector(dir, -d.dot(dir)).length();
  };
  const hold = (knife: KnifeId) => {
    const character = new ArmorCharacter(library, { ...defaultLook(), skin: body }, 'terrorist', { pose: 'none', lod: 0 });
    const rig = character.rig!;
    setRemoteKnife(rig.rightWeaponHand, { id: knife });
    applyKnifeIdlePose(rig);
    character.root.updateMatrixWorld(true);
    const held = rig.rightWeaponHand.getObjectByName('RemoteKnifeModel')!;
    const grip = held.getObjectByName('socket_grip')!;
    const frame = grip.parent!.matrixWorld;
    return {
      rig,
      grip: point(grip as Bone),
      blade: new Vector3().setFromMatrixColumn(frame, 0).normalize(),
      spine: new Vector3().setFromMatrixColumn(frame, 1).normalize(),
      knuckles: [0, 3, 6, 9].reduce((sum, i) => sum.add(point(rig.rightFingers[i])), new Vector3()).divideScalar(4),
      across: point(rig.rightFingers[0]).sub(point(rig.rightFingers[9])).normalize(),
      dispose: () => character.dispose(),
    };
  };

  it.each(['bayonet', 'butterfly', 'karambit'] as const)('%s: handle down the fist, fingers round it', (knife) => {
    const h = hold(knife);
    expect(h.rig.mpfbHands).toBe(true);
    for (let f = 0; f < 4; f += 1) {
      for (const j of [1, 2]) {
        // round the handle, not through it or off it
        const d = fromLine(point(h.rig.rightFingers[f * 3 + j]), h.grip, h.blade);
        expect(d, `finger ${f} joint ${j}`).toBeGreaterThan(0.008);
        expect(d, `finger ${f} joint ${j}`).toBeLessThan(0.04);
      }
    }
    // the blade out of the thumb side, the claw under the little finger
    const out = h.blade.dot(h.across);
    if (knife === 'karambit') expect(out).toBeLessThan(-0.8);
    else expect(out).toBeGreaterThan(0.8);
    // the edge toward the knuckles
    expect(h.spine.dot(h.knuckles.clone().sub(h.grip))).toBeLessThan(0);
    h.dispose();
  });

  it('push dagger: bar across the palm, blade out between the fingers', () => {
    const h = hold('shadow_daggers');
    expect(Math.abs(h.spine.dot(h.across))).toBeGreaterThan(0.9);
    const wrist = point(h.rig.rightHand);
    expect(h.blade.dot(h.knuckles.clone().sub(wrist).normalize())).toBeGreaterThan(0.8);
    h.dispose();
  });

  it('katana: the right hand just under the guard', () => {
    const character = new ArmorCharacter(library, { ...defaultLook(), skin: body }, 'terrorist', { pose: 'none', lod: 0 });
    const rig = character.rig!;
    // the katana model's sockets, wrapped the way remoteKatanaTemplate does
    const model = new Group();
    const socket = (name: string, x: number) => {
      const node = new Group();
      node.name = name;
      node.position.x = x;
      model.add(node);
    };
    socket('socket_grip_r', 0);
    socket('socket_guard', 0.06);
    const wrapper = new Group();
    wrapper.rotation.z = Math.PI / 2;
    wrapper.add(model);
    const holder = new Group();
    holder.add(wrapper);
    attachKnifeModel(rig.rightWeaponHand, holder);
    applyKnifeIdlePose(rig);
    character.root.updateMatrixWorld(true);
    // attachKnifeModel holds a clone
    const held = rig.rightWeaponHand.getObjectByName('RemoteKnifeModel')!;
    const grip = held.getObjectByName('socket_grip_r')!;
    const guard = held.getObjectByName('socket_guard')!;
    const blade = new Vector3().setFromMatrixColumn(grip.parent!.matrixWorld, 0).normalize();
    const g = point(grip as unknown as Bone);
    for (let f = 0; f < 4; f += 1) {
      const d = fromLine(point(rig.rightFingers[f * 3 + 1]), g, blade);
      expect(d, `finger ${f}`).toBeGreaterThan(0.008);
      expect(d, `finger ${f}`).toBeLessThan(0.04);
    }
    // the guard sits a little past the index finger, toward the blade
    const index = point(rig.rightFingers[0]);
    const pastIndex = point(guard as unknown as Bone).sub(index).dot(blade);
    expect(pastIndex).toBeGreaterThan(-0.01);
    expect(pastIndex).toBeLessThan(0.04);
    character.dispose();
  });
});
