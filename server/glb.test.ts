import { describe, expect, it } from 'vitest';
import { stripMaterialsFromGlb } from './glb';

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK_TYPE = 0x4e4f534a;
const BIN_CHUNK_TYPE = 0x004e4942;

function pad4(n: number): number {
  return (n + 3) & ~3;
}

/** Builds a minimal GLB with the given JSON object and BIN payload. */
function buildGlb(json: object, bin: Uint8Array): Uint8Array {
  const rawJson = new TextEncoder().encode(JSON.stringify(json));
  const jsonPadded = new Uint8Array(pad4(rawJson.length)).fill(0x20);
  jsonPadded.set(rawJson);
  const binPadded = new Uint8Array(pad4(bin.byteLength));
  binPadded.set(bin);

  const total = 12 + 8 + jsonPadded.byteLength + 8 + binPadded.byteLength;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  let w = 12;
  view.setUint32(w, jsonPadded.byteLength, true);
  view.setUint32(w + 4, JSON_CHUNK_TYPE, true);
  out.set(jsonPadded, w + 8);
  w += 8 + jsonPadded.byteLength;
  view.setUint32(w, binPadded.byteLength, true);
  view.setUint32(w + 4, BIN_CHUNK_TYPE, true);
  out.set(binPadded, w + 8);
  return out;
}

function readGlb(buffer: ArrayBuffer): { json: Record<string, unknown>; bin: Uint8Array | null } {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let offset = 12;
  let json: Record<string, unknown> = {};
  let bin: Uint8Array | null = null;
  while (offset + 8 <= bytes.byteLength) {
    const len = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const data = bytes.subarray(offset + 8, offset + 8 + len);
    if (type === JSON_CHUNK_TYPE) {
      json = JSON.parse(new TextDecoder().decode(data)) as Record<string, unknown>;
    } else if (type === BIN_CHUNK_TYPE) {
      bin = data;
    }
    offset += 8 + pad4(len);
  }
  return { json, bin };
}

describe('stripMaterialsFromGlb', () => {
  const bin = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const richJson = {
    asset: { version: '2.0' },
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ name: 'steel' }],
    textures: [{ source: 0 }],
    images: [{ uri: 'x.png' }],
    samplers: [{}],
    accessors: [{}, {}],
    extensionsUsed: ['KHR_materials_pbrSpecularGlossiness', 'KHR_draco_mesh_compression'],
  };

  it('removes materials, textures, images, and samplers', () => {
    const { json } = readGlb(stripMaterialsFromGlb(buildGlb(richJson, bin)));
    expect(json.materials).toBeUndefined();
    expect(json.textures).toBeUndefined();
    expect(json.images).toBeUndefined();
    expect(json.samplers).toBeUndefined();
  });

  it('drops the material reference from mesh primitives but keeps geometry attributes', () => {
    const { json } = readGlb(stripMaterialsFromGlb(buildGlb(richJson, bin)));
    const meshes = json.meshes as Array<{ primitives: Array<Record<string, unknown>> }>;
    expect(meshes[0].primitives[0].material).toBeUndefined();
    expect(meshes[0].primitives[0].attributes).toEqual({ POSITION: 0 });
    expect(meshes[0].primitives[0].indices).toBe(1);
    expect(json.accessors).toHaveLength(2);
  });

  it('preserves the BIN chunk byte for byte', () => {
    const { bin: outBin } = readGlb(stripMaterialsFromGlb(buildGlb(richJson, bin)));
    expect(outBin).not.toBeNull();
    expect(Array.from(outBin!.subarray(0, bin.byteLength))).toEqual(Array.from(bin));
  });

  it('filters only material/texture extensions from extensionsUsed', () => {
    const { json } = readGlb(stripMaterialsFromGlb(buildGlb(richJson, bin)));
    expect(json.extensionsUsed).toEqual(['KHR_draco_mesh_compression']);
  });

  it('throws on a non-GLB buffer', () => {
    expect(() => stripMaterialsFromGlb(new Uint8Array([0, 0, 0, 0, 1, 2]))).toThrow(/GLB/);
  });
});
