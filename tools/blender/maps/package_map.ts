/**
 * packs a map built by tools/blender/maps/build_<id>.py into public/maps/<id>/.
 *
 *   npx tsx tools/blender/maps/package_map.ts <id>
 *
 * scene.glb goes through the shared optimizer (meshopt + webp), collision.glb is
 * copied untouched (plain float positions, the node server parses it without the
 * meshopt decoder), the lightmap and the menu thumbnail become webp, and the
 * preview renders are copied to docs/screenshots/maps/.
 */
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { optimizeGlb } from '../../assets/optimize-glb';

const THUMB_MAX_BYTES = 60 * 1024;

async function sizeKb(file: string): Promise<number> {
  return Math.round((await stat(file)).size / 1024);
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function writeThumbnail(input: string, output: string): Promise<void> {
  // step the quality down until the card image fits the budget
  for (let quality = 82; quality >= 40; quality -= 6) {
    const buffer = await sharp(input).resize(480, 270, { fit: 'cover' }).webp({ quality, effort: 6 }).toBuffer();
    if (buffer.byteLength <= THUMB_MAX_BYTES || quality <= 40) {
      await writeFile(output, buffer);
      return;
    }
  }
}

export async function packageMap(mapId: string): Promise<void> {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const tmp = path.join(root, '.blender-tmp', 'maps', mapId);
  const out = path.join(root, 'public', 'maps', mapId);
  const shots = path.join(root, 'docs', 'screenshots', 'maps');
  await mkdir(out, { recursive: true });
  await mkdir(shots, { recursive: true });

  await optimizeGlb({
    input: path.join(tmp, 'scene.glb'),
    output: path.join(out, 'scene.glb'),
    textureSize: 1024,
    webp: true,
    simplifyRatio: null,
  });
  await copyFile(path.join(tmp, 'collision.glb'), path.join(out, 'collision.glb'));
  // alpha is the sun's baked visibility, keep it near lossless
  await sharp(path.join(tmp, 'lightmap.png')).webp({ quality: 90, alphaQuality: 100, effort: 6 }).toFile(path.join(out, 'lightmap.webp'));
  await copyFile(path.join(tmp, 'meta.json'), path.join(out, 'meta.json'));

  if (await exists(path.join(tmp, 'thumb.png'))) {
    await writeThumbnail(path.join(tmp, 'thumb.png'), path.join(out, 'thumbnail.webp'));
  }
  for (const view of ['overview', 'eye']) {
    const src = path.join(tmp, `${view}.png`);
    if (await exists(src)) {
      await sharp(src).png({ compressionLevel: 9, adaptiveFiltering: true, palette: true, quality: 95, dither: 0.6 })
        .toFile(path.join(shots, `${mapId}_${view}.png`));
    }
  }

  const files = ['scene.glb', 'collision.glb', 'lightmap.webp', 'thumbnail.webp', 'meta.json'];
  let total = 0;
  const rows: string[] = [];
  for (const file of files) {
    const full = path.join(out, file);
    if (!(await exists(full))) {
      continue;
    }
    const kb = await sizeKb(full);
    total += kb;
    rows.push(`${file} ${kb} KB`);
  }
  const stats = JSON.parse(await readFile(path.join(tmp, 'build_stats.json'), 'utf8')) as Record<string, unknown>;
  console.log(`[package_map] ${mapId}: ${rows.join(', ')}; total ${total} KB`);
  console.log(`[package_map] ${mapId}: ${JSON.stringify(stats)}`);
}

const isMain = process.argv[1] !== undefined
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const mapId = process.argv[2];
  if (!mapId || !/^[a-z0-9_]+$/.test(mapId)) {
    console.error('usage: package_map.ts <map_id>');
    process.exit(1);
  }
  packageMap(mapId).catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
