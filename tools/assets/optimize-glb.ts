/**
 * Shrinks a GLB exported from Blender for the web build.
 *
 *   npx tsx tools/assets/optimize-glb.ts <in.glb> <out.glb> [--texture-size 1024] [--no-webp]
 *     [--keep-names] [--simplify 0.0-1.0]
 *
 * Steps: dedup, prune, weld, optional simplify, textures resized and re-encoded
 * as WebP (EXT_texture_webp), then meshopt compression (EXT_meshopt_compression)
 * with quantized attributes. Node names are kept because the runtime looks up
 * sockets, bones and moving parts by name.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  meshopt,
  prune,
  simplify,
  textureCompress,
  weld,
} from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface Options {
  input: string;
  output: string;
  textureSize: number;
  webp: boolean;
  simplifyRatio: number | null;
}

function parseArgs(argv: string[]): Options {
  const positional: string[] = [];
  let textureSize = 1024;
  let webp = true;
  let simplifyRatio: number | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--texture-size') {
      textureSize = Number(argv[++i]);
    } else if (arg === '--no-webp') {
      webp = false;
    } else if (arg === '--simplify') {
      simplifyRatio = Number(argv[++i]);
    } else if (arg === '--keep-names') {
      // names are always kept, flag accepted for readability in scripts
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 2) {
    throw new Error('usage: optimize-glb.ts <in.glb> <out.glb> [--texture-size N] [--no-webp] [--simplify r]');
  }
  return { input: positional[0], output: positional[1], textureSize, webp, simplifyRatio };
}

export async function optimizeGlb(options: Options): Promise<void> {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'meshopt.decoder': MeshoptDecoder,
      'meshopt.encoder': MeshoptEncoder,
    });
  const document = await io.read(options.input);
  const transforms = [
    // named materials are hooks (the knife finishes swap knife_edge, knife_accent...), so
    // identical ones with different names stay apart
    dedup({ keepUniqueNames: true }),
    // keepLeaves keeps empty socket nodes (grip points, muzzles) alive
    prune({ keepLeaves: true, keepAttributes: true }),
    weld(),
  ];
  if (options.simplifyRatio !== null && options.simplifyRatio < 1) {
    await MeshoptSimplifier.ready;
    transforms.push(simplify({ simplifier: MeshoptSimplifier, ratio: options.simplifyRatio, error: 0.001 }));
  }
  await document.transform(...transforms);
  if (document.getRoot().listTextures().length > 0) {
    await document.transform(
      textureCompress({
        encoder: sharp,
        targetFormat: options.webp ? 'webp' : undefined,
        resize: [options.textureSize, options.textureSize],
        quality: 88,
      }),
    );
  }
  await document.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(options.output, document);
  const before = (await stat(options.input)).size;
  const after = (await stat(options.output)).size;
  console.log(`[optimize-glb] ${options.input} ${(before / 1024).toFixed(0)} KB -> ${options.output} ${(after / 1024).toFixed(0)} KB`);
}

const isMain = process.argv[1] !== undefined
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  optimizeGlb(parseArgs(process.argv.slice(2))).catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
