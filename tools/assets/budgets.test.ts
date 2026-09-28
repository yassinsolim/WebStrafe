import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// performance budgets for shipped assets, see docs/PERFORMANCE.md
const ROOT = path.resolve(__dirname, '..', '..');
const MB = 1024 * 1024;
const MAP_TEXTURE_GPU_BUDGET = 16 * MB;
const VIEWMODEL_TEXTURE_GPU_BUDGET = 12 * MB;
const VIEWMODEL_FILE_BUDGET = 1.5 * MB;

interface KtxInfo { width: number; height: number; levels: number }

/** width, height and mip count straight from a ktx2 header */
function ktxInfo(bytes: Uint8Array): KtxInfo | null {
  const id = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb];
  if (!id.every((b, i) => bytes[i] === b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(20, true), height: view.getUint32(24, true), levels: Math.max(1, view.getUint32(40, true)) };
}

/** every image in a glb, as raw bytes plus mime type */
function glbImages(file: string): Array<{ mime: string; bytes: Uint8Array }> {
  const data = readFileSync(file);
  const jsonLength = data.readUInt32LE(12);
  const json = JSON.parse(data.subarray(20, 20 + jsonLength).toString('utf8')) as {
    images?: Array<{ bufferView?: number; mimeType?: string }>;
    bufferViews?: Array<{ byteOffset?: number; byteLength: number }>;
  };
  const binStart = 20 + jsonLength + 8;
  return (json.images ?? []).flatMap((image) => {
    if (image.bufferView === undefined || !json.bufferViews) return [];
    const bv = json.bufferViews[image.bufferView];
    const start = binStart + (bv.byteOffset ?? 0);
    return [{ mime: image.mimeType ?? '', bytes: new Uint8Array(data.subarray(start, start + bv.byteLength)) }];
  });
}

/** gpu bytes once transcoded: about one byte per texel for bc7/astc/etc2, plus mips */
function gpuBytes(info: KtxInfo): number {
  return info.width * info.height * (info.levels > 1 ? 4 / 3 : 1);
}

const maps = readdirSync(path.join(ROOT, 'public/maps')).filter((id) => statSync(path.join(ROOT, 'public/maps', id, 'scene.glb'), { throwIfNoEntry: false }));

describe.each(maps)('map %s', (id) => {
  it('ships every texture as ktx2 and stays inside the texture memory budget', () => {
    const dir = path.join(ROOT, 'public/maps', id);
    let total = 0;
    for (const image of glbImages(path.join(dir, 'scene.glb'))) {
      expect(image.mime).toBe('image/ktx2');
      const info = ktxInfo(image.bytes);
      expect(info).not.toBeNull();
      total += gpuBytes(info!);
    }
    // the practice scene is unlit and ships no lightmap
    const lightmapFile = path.join(dir, 'lightmap.ktx2');
    if (statSync(lightmapFile, { throwIfNoEntry: false })) {
      const lightmap = ktxInfo(new Uint8Array(readFileSync(lightmapFile)));
      expect(lightmap).not.toBeNull();
      total += gpuBytes(lightmap!);
    }
    expect(total).toBeLessThan(MAP_TEXTURE_GPU_BUDGET);
  });
});

describe('viewmodels', () => {
  const dir = path.join(ROOT, 'public/viewmodels/v2');
  const files = readdirSync(dir).filter((f) => f.endsWith('.glb'));

  it('ship ktx2 textures, stay under the file size budget and fit the texture memory budget together', () => {
    let total = 0;
    for (const file of files) {
      expect(statSync(path.join(dir, file)).size, file).toBeLessThan(VIEWMODEL_FILE_BUDGET);
      for (const image of glbImages(path.join(dir, file))) {
        expect(image.mime, file).toBe('image/ktx2');
        total += gpuBytes(ktxInfo(image.bytes)!);
      }
    }
    expect(total).toBeLessThan(VIEWMODEL_TEXTURE_GPU_BUDGET);
  });
});
