/**
 * Minimal GLB surgery: strip material/texture/image data so a collision mesh
 * can be parsed headlessly (in Node) without three's GLTFLoader trying to decode
 * embedded textures — which both spams the console with "couldn't load texture"
 * errors and wastes work we don't need for collision geometry.
 *
 * GLB layout: 12-byte header (magic, version, total length) followed by chunks
 * of `[uint32 length][uint32 type][data]`. Chunk type 0x4E4F534A is JSON,
 * 0x004E4942 is BIN. We rewrite only the JSON chunk (removing materials, etc.)
 * and keep the BIN chunk — which holds the vertex/index buffers — byte for byte.
 */

const GLB_MAGIC = 0x46546c67; // 'glTF'
const JSON_CHUNK_TYPE = 0x4e4f534a; // 'JSON'
const BIN_CHUNK_TYPE = 0x004e4942; // 'BIN\0'

interface GltfJson {
  meshes?: Array<{ primitives?: Array<{ material?: number }> }>;
  materials?: unknown;
  textures?: unknown;
  images?: unknown;
  samplers?: unknown;
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  [key: string]: unknown;
}

function pad4(value: number): number {
  return (value + 3) & ~3;
}

/**
 * Returns a new GLB ArrayBuffer with all material/texture/image data removed.
 * Throws if the input is not a valid binary glTF (GLB) container.
 */
export function stripMaterialsFromGlb(input: Uint8Array): ArrayBuffer {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) {
    throw new Error('Not a GLB container (bad magic)');
  }

  // Walk chunks to find JSON + BIN.
  let offset = 12;
  let jsonBytes: Uint8Array | null = null;
  let binBytes: Uint8Array | null = null;
  while (offset + 8 <= input.byteLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const dataStart = offset + 8;
    const data = input.subarray(dataStart, dataStart + chunkLength);
    if (chunkType === JSON_CHUNK_TYPE) {
      jsonBytes = data;
    } else if (chunkType === BIN_CHUNK_TYPE) {
      binBytes = data;
    }
    offset = dataStart + pad4(chunkLength);
  }

  if (!jsonBytes) {
    throw new Error('GLB has no JSON chunk');
  }

  const json = JSON.parse(new TextDecoder().decode(jsonBytes)) as GltfJson;
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      delete primitive.material;
    }
  }
  delete json.materials;
  delete json.textures;
  delete json.images;
  delete json.samplers;
  // Drop texture/material extensions so the loader doesn't chase them.
  const dropExt = (name: string) => name.startsWith('KHR_materials') || name.startsWith('KHR_texture');
  if (json.extensionsUsed) json.extensionsUsed = json.extensionsUsed.filter((n) => !dropExt(n));
  if (json.extensionsRequired) json.extensionsRequired = json.extensionsRequired.filter((n) => !dropExt(n));

  // Re-encode the JSON chunk, space-padded to 4-byte alignment.
  const rawJson = new TextEncoder().encode(JSON.stringify(json));
  const jsonPadded = new Uint8Array(pad4(rawJson.length)).fill(0x20);
  jsonPadded.set(rawJson);

  const binPadded = binBytes
    ? (() => {
        const padded = new Uint8Array(pad4(binBytes.byteLength));
        padded.set(binBytes);
        return padded;
      })()
    : null;

  const totalLength =
    12 + 8 + jsonPadded.byteLength + (binPadded ? 8 + binPadded.byteLength : 0);
  const out = new Uint8Array(totalLength);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, GLB_MAGIC, true);
  outView.setUint32(4, 2, true);
  outView.setUint32(8, totalLength, true);

  let write = 12;
  outView.setUint32(write, jsonPadded.byteLength, true);
  outView.setUint32(write + 4, JSON_CHUNK_TYPE, true);
  out.set(jsonPadded, write + 8);
  write += 8 + jsonPadded.byteLength;

  if (binPadded) {
    outView.setUint32(write, binPadded.byteLength, true);
    outView.setUint32(write + 4, BIN_CHUNK_TYPE, true);
    out.set(binPadded, write + 8);
  }

  return out.buffer;
}
