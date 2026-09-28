/**
 * converts the textures inside a glb to ktx2 (basisu), leaving the geometry,
 * node names and meshopt compression exactly as they were.
 *
 *   npx tsx tools/assets/ktx2-textures.ts <in.glb> [out.glb] [--quality 8]
 *   npx tsx tools/assets/ktx2-textures.ts <in.webp|png> <out.ktx2> [--uastc]   (srgb color + linear alpha, e.g. lightmaps)
 *
 * the encoder is gltfpack (GLTFPACK env var, default ~/Assets/webstrafe/tools/bin/gltfpack).
 * running gltfpack on the real file would requantize meshes and move pivots, so
 * each texture goes through a throwaway one-quad gltf instead: color textures
 * as etc1s (srgb), normal maps as uastc, everything else as linear etc1s. the
 * ktx2 that comes back replaces the webp/png in the original document.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { NodeIO, type Texture } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

type TextureClass = 'color' | 'normal' | 'linear';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const [input, output = positional[0]] = positional;
if (!input) {
  console.error('usage: npx tsx tools/assets/ktx2-textures.ts <in.glb> [out.glb] [--quality 8]');
  process.exit(1);
}
const quality = flag('quality') ?? '8';
const gltfpack = process.env.GLTFPACK ?? path.join(homedir(), 'Assets/webstrafe/tools/bin/gltfpack');

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

/** which role a texture plays, so the encoder picks srgb vs linear and etc1s vs uastc */
function classify(texture: Texture): TextureClass | null {
  let result: TextureClass | null = null;
  for (const parent of texture.listParents()) {
    if (parent.propertyType !== 'Material') continue;
    const material = parent as import('@gltf-transform/core').Material;
    if (material.getNormalTexture() === texture) return 'normal';
    if (material.getBaseColorTexture() === texture || material.getEmissiveTexture() === texture) result = 'color';
    else result ??= 'linear';
  }
  return result;
}

/** a single quad using the texture in the slot that matches its class */
function carrier(imageFile: string, kind: TextureClass): object {
  // position, normal, uv for 4 vertices, then 6 u16 indices
  const pos = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];
  const nrm = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
  const uv = [0, 1, 1, 1, 1, 0, 0, 0];
  const idx = [0, 1, 2, 0, 2, 3];
  const floats = Buffer.from(new Float32Array([...pos, ...nrm, ...uv]).buffer);
  const indices = Buffer.from(new Uint16Array(idx).buffer);
  const data = Buffer.concat([floats, indices]);
  const slot = kind === 'normal'
    ? { normalTexture: { index: 0 } }
    : kind === 'color'
      ? { pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }
      : { pbrMetallicRoughness: { metallicRoughnessTexture: { index: 0 } } };
  return {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
    // blend keeps the alpha channel through the encoder
    materials: [{ ...slot, alphaMode: kind === 'color' ? 'BLEND' : 'OPAQUE' }],
    textures: [{ source: 0 }],
    images: [{ uri: path.basename(imageFile) }],
    buffers: [{ byteLength: data.length, uri: `data:application/octet-stream;base64,${data.toString('base64')}` }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 48 },
      { buffer: 0, byteOffset: 48, byteLength: 48 },
      { buffer: 0, byteOffset: 96, byteLength: 32 },
      { buffer: 0, byteOffset: 128, byteLength: 12 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5126, count: 4, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: 4, type: 'VEC2' },
      { bufferView: 3, componentType: 5123, count: 6, type: 'SCALAR' },
    ],
  };
}

/** a lone image (a lightmap) through the same carrier, written out as a .ktx2 file */
async function encodeImage(file: string, out: string): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), 'ktx2-'));
  try {
    const png = path.join(dir, 'image.png');
    await sharp(file).png().toFile(png);
    const gltfFile = path.join(dir, 'image.gltf');
    writeFileSync(gltfFile, JSON.stringify(carrier(png, 'color')));
    const outFile = path.join(dir, 'image_out.glb');
    const encode = args.includes('--uastc') ? ['-tu'] : ['-tc'];
    execFileSync(gltfpack, ['-i', gltfFile, '-o', outFile, ...encode, '-tq', quality, '-noq'], { stdio: 'pipe' });
    const packed = await io.read(outFile);
    const ktx = packed.getRoot().listTextures().find((t) => t.getMimeType() === 'image/ktx2')?.getImage();
    if (!ktx) throw new Error(`gltfpack returned no ktx2 for ${file}`);
    writeFileSync(out, ktx);
    const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
    console.log(`[ktx2] ${file} ${kb(readFileSync(file).byteLength)} -> ${out} ${kb(ktx.byteLength)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (/\.(png|webp|jpe?g)$/i.test(input)) {
  await encodeImage(input, output);
  process.exit(0);
}

const doc = await io.read(input);
const tmp = mkdtempSync(path.join(tmpdir(), 'ktx2-'));
let converted = 0;
let before = 0;
let after = 0;
try {
  for (const [i, texture] of doc.getRoot().listTextures().entries()) {
    const mime = texture.getMimeType();
    const image = texture.getImage();
    if (!image || mime === 'image/ktx2') continue;
    const kind = classify(texture);
    if (!kind) continue;
    // the basisu encoder inside gltfpack reads png and jpeg only, webp passes through untouched
    const imageFile = path.join(tmp, `t${i}.${mime === 'image/jpeg' ? 'jpg' : 'png'}`);
    if (mime === 'image/png' || mime === 'image/jpeg') writeFileSync(imageFile, image);
    else await sharp(Buffer.from(image)).png().toFile(imageFile);
    const gltfFile = path.join(tmp, `t${i}.gltf`);
    writeFileSync(gltfFile, JSON.stringify(carrier(imageFile, kind)));
    const outFile = path.join(tmp, `t${i}_out.glb`);
    const encode = kind === 'normal' && process.env.KTX2_UASTC_NORMALS ? ['-tu'] : ['-tc'];
    execFileSync(gltfpack, ['-i', gltfFile, '-o', outFile, ...encode, '-tq', quality, '-noq', '-kn', '-km'], { stdio: 'pipe' });
    const packed = await io.read(outFile);
    const ktx = packed.getRoot().listTextures().find((t) => t.getMimeType() === 'image/ktx2')?.getImage();
    if (!ktx) throw new Error(`gltfpack returned no ktx2 for texture ${i} (${texture.getName()})`);
    before += image.byteLength;
    after += ktx.byteLength;
    texture.setImage(ktx).setMimeType('image/ktx2');
    converted += 1;
  }
  if (converted > 0) doc.createExtension(KHRTextureBasisu).setRequired(true);
  await io.write(output, doc);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
console.log(`[ktx2] ${input} -> ${output}: ${converted} textures, ${kb(before)} -> ${kb(after)}, file ${kb(readFileSync(output).byteLength)}`);
