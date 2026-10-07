import { readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder as MeshoptDecoderNode, MeshoptEncoder } from 'meshoptimizer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Color, type Mesh } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { ARMOR_SETS } from '../catalog';
import { FirstPersonArmor } from '../fpArmor';
import { MATERIAL_SLOTS } from '../library';
import { defaultLook } from '../look';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// webp textures don't decode in node and only the geometry matters here
async function parseWithoutTextures(file: string): Promise<GLTF> {
  await Promise.all([MeshoptDecoderNode.ready, MeshoptEncoder.ready]);
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoderNode, 'meshopt.encoder': MeshoptEncoder });
  const doc = await io.read(path.join(ROOT, file));
  for (const tex of doc.getRoot().listTextures()) tex.dispose();
  const bin = await io.writeBinary(doc);
  const data = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer;
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  await MeshoptDecoder.ready;
  return new Promise((resolve, reject) => loader.parse(data, '', resolve, reject));
}

let arms: GLTF;
const armor = new FirstPersonArmor();

beforeAll(async () => {
  readFileSync(path.join(ROOT, 'public/viewmodels/v2/arms.glb'));
  arms = await parseWithoutTextures('public/viewmodels/v2/arms.glb');
  armor.attach(arms.scene);
}, 60_000);

function armsParts(): Mesh[] {
  const out: Mesh[] = [];
  arms.scene.traverse((n) => {
    if ((n as Mesh).isMesh && (n as Mesh).material === armor.armorMaterial) out.push(n as Mesh);
  });
  return out;
}

describe('first-person cyborg arms', () => {
  it('carries the core and a plate kit for every armor set', () => {
    expect(armor.sets()).toEqual(['core', ...ARMOR_SETS].sort());
  });

  it('paints every arms part with the one armor material and a valid slot', () => {
    const parts = armsParts();
    expect(parts.length).toBeGreaterThan(8);
    for (const mesh of parts) {
      const slot = mesh.geometry.getAttribute('aSlot');
      const occ = mesh.geometry.getAttribute('aOcclusion');
      expect(slot.count).toBe(mesh.geometry.getAttribute('position').count);
      expect(occ.getX(0)).toBe(1);
      expect(slot.getX(0)).toBeGreaterThanOrEqual(0);
      expect(slot.getX(0)).toBeLessThan(MATERIAL_SLOTS.length);
    }
  });

  it('shows the core plus the kit of the look arms piece, and the watch when asked', () => {
    for (const set of ARMOR_SETS) {
      armor.setLook({ ...defaultLook(), arms: set, watch: false });
      expect(armor.visibleSets()).toEqual(['core', set].sort());
      expect(arms.scene.getObjectByName('watch')!.visible).toBe(false);
    }
    armor.setLook({ ...defaultLook(), watch: true });
    expect(arms.scene.getObjectByName('watch')!.visible).toBe(true);
  });

  it('takes plates, muscle and glow colours from the look', () => {
    const look = { ...defaultLook(), primary: '#e4ddcf', secondary: '#141518', accent: '#9e2231' };
    armor.setLook(look);
    const m = armor.armorMaterial;
    const slot = (name: (typeof MATERIAL_SLOTS)[number]) => MATERIAL_SLOTS.indexOf(name);
    const primary = new Color(look.primary);
    expect(m.slotColor[slot('primary')].x).toBeCloseTo(primary.r, 5);
    // the muscle stays dark whatever the secondary paint
    const muscle = m.slotColor[slot('muscle')];
    expect(Math.max(muscle.x, muscle.y, muscle.z)).toBeLessThan(0.05);
    // glow lines are the accent's hue at full brightness, and they emit
    const glow = m.slotColor[slot('glow')];
    expect(Math.max(glow.x, glow.y, glow.z)).toBeCloseTo(1, 5);
    expect(glow.x).toBeGreaterThan(glow.z);
    expect(m.slotPbr[slot('glow')].z).toBeGreaterThan(1);
  });
});
