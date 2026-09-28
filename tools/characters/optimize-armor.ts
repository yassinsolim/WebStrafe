/**
 * shrinks the character part library for the web.
 *
 *   npx tsx tools/characters/optimize-armor.ts .blender-tmp/characters/armor_raw.glb public/characters/armor.glb
 *
 * like tools/assets/optimize-glb.ts but quantizes every mesh in one shared
 * volume, so all ~200 skinned parts keep a single skin instead of getting one
 * skin (with 32 bind matrices) each. meshopt compressed, names and extras kept.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, quantize, reorder, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function optimizeArmor(input: string, output: string): Promise<void> {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const document = await io.read(input);
  await document.transform(
    dedup(),
    prune({ keepLeaves: true, keepAttributes: true, keepExtras: true }),
    weld(),
    reorder({ encoder: MeshoptEncoder, target: 'size' }),
    quantize({
      quantizationVolume: 'scene',
      quantizePosition: 14,
      quantizeNormal: 10,
      quantizeColor: 8,
      quantizeWeight: 8,
    }),
    dedup(),
    prune({ keepLeaves: true, keepAttributes: true, keepExtras: true }),
  );
  document.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({
    method: EXTMeshoptCompression.EncoderMethod.FILTER,
  });
  await io.write(output, document);
  const before = (await stat(input)).size;
  const after = (await stat(output)).size;
  const skins = document.getRoot().listSkins().length;
  console.log(`[optimize-armor] ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB, ${skins} skin(s)`);
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error('usage: optimize-armor.ts <in.glb> <out.glb>');
    process.exit(1);
  }
  optimizeArmor(input, output).catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
