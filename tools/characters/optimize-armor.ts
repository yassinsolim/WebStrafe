/**
 * merges and shrinks the character part library for the web.
 *
 *   npx tsx tools/characters/optimize-armor.ts <out.glb> <in.glb> [more.glb ...]
 *
 * the blender build writes the undersuit and each armor set to its own glb so
 * they can build in parallel; this joins them into one file.
 * like tools/assets/optimize-glb.ts but quantizes every mesh in one shared
 * volume, so all ~200 skinned parts keep a single skin instead of getting one
 * skin (with 32 bind matrices) each. meshopt compressed, names and extras kept.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, mergeDocuments, prune, quantize, reorder, unpartition, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function optimizeArmor(output: string, inputs: string[]): Promise<void> {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const document = await io.read(inputs[0]);
  for (const extra of inputs.slice(1)) {
    mergeDocuments(document, await io.read(extra));
  }
  // one scene, one buffer
  const root = document.getRoot();
  const main = root.getDefaultScene() ?? root.listScenes()[0];
  for (const scene of root.listScenes()) {
    if (scene === main) continue;
    for (const child of scene.listChildren()) main.addChild(child);
    scene.dispose();
  }
  root.setDefaultScene(main);
  await document.transform(
    unpartition(),
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
  let before = 0;
  for (const input of inputs) before += (await stat(input)).size;
  const after = (await stat(output)).size;
  const skins = document.getRoot().listSkins().length;
  console.log(`[optimize-armor] ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB, ${skins} skin(s)`);
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const [output, ...inputs] = process.argv.slice(2);
  if (!output || inputs.length === 0) {
    console.error('usage: optimize-armor.ts <out.glb> <in.glb> [more.glb ...]');
    process.exit(1);
  }
  optimizeArmor(output, inputs).catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
