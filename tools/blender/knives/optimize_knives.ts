/**
 * shrinks the raw knife glbs from build_knives.py into public/knives/<id>.glb
 * (lod0, webp textures up to 2048 px) and public/knives/<id>_lod1.glb (third
 * person, textures at 512 px), meshopt, names kept
 *
 *   npx tsx tools/blender/knives/optimize_knives.ts [raw_dir] [id ...]
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KNIVES } from '../../../src/combat/knives';
import { optimizeGlb } from '../../assets/optimize-glb';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const rawDir = process.argv[2] ?? path.join(repo, '.blender-tmp', 'knives');
const only = process.argv.slice(3);
const outDir = path.join(repo, 'public', 'knives');

await mkdir(outDir, { recursive: true });
for (const knife of KNIVES) {
  if (only.length > 0 && !only.includes(knife.id)) continue;
  for (const [suffix, textureSize] of [['', 2048], ['_lod1', 512]] as const) {
    await optimizeGlb({
      input: path.join(rawDir, `${knife.id}${suffix}.glb`),
      output: path.join(outDir, `${knife.id}${suffix}.glb`),
      textureSize,
      webp: true,
      simplifyRatio: null,
    });
  }
}
