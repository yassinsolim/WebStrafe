// shrinks the blender preview renders before they go into docs/:
// resize to a max width, then write a 256 colour palette png.
//
//   node tools/blender/weapons/compress_previews.mjs <in_dir> <out_dir> [max_width]
import sharp from 'sharp';
import { mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const [inDir, outDir, maxWidthArg] = process.argv.slice(2);
if (!inDir || !outDir) {
  console.error('usage: compress_previews.mjs <in_dir> <out_dir> [max_width]');
  process.exit(1);
}
const maxWidth = Number(maxWidthArg ?? 1280);
await mkdir(outDir, { recursive: true });
for (const name of (await readdir(inDir)).filter((f) => f.endsWith('.png'))) {
  const src = path.join(inDir, name);
  const dst = path.join(outDir, name);
  await sharp(src)
    .resize({ width: maxWidth, withoutEnlargement: true })
    .png({ palette: true, colors: 256, dither: 0.6, compressionLevel: 9, effort: 10 })
    .toFile(dst);
  const before = (await stat(src)).size;
  const after = (await stat(dst)).size;
  console.log(`[previews] ${name} ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB`);
}
