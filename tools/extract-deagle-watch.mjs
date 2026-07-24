import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { glbToGltf, gltfToGlb, processGltf } = require('gltf-pipeline');

const source = resolve(process.argv[2] ?? 'public/viewmodels/deagle/deagle.glb');
const output = resolve(process.argv[3] ?? 'public/viewmodels/shared/deagle-watch.glb');
const allowedMaterials = new Set(['Watch', 'Watch_Emission']);

const { gltf } = await glbToGltf(await readFile(source));
const watchNodeIndex = gltf.nodes.findIndex((node) => node.name === 'DeagleArms');
if (watchNodeIndex < 0) {
  throw new Error('DeagleArms node was not found in the production Deagle GLB');
}

const watchNode = gltf.nodes[watchNodeIndex];
const watchMesh = gltf.meshes[watchNode.mesh];
watchMesh.name = 'DeagleAuthoredWatch';
watchMesh.primitives = watchMesh.primitives.filter((primitive) => (
  allowedMaterials.has(gltf.materials[primitive.material]?.name)
));
if (watchMesh.primitives.length !== allowedMaterials.size) {
  throw new Error('Expected authored Watch and Watch_Emission primitives');
}

for (const primitive of watchMesh.primitives) {
  delete primitive.attributes.JOINTS_0;
  delete primitive.attributes.WEIGHTS_0;
  for (const attribute of Object.keys(primitive.attributes)) {
    if (/^TEXCOORD_[1-9]|^COLOR_/.test(attribute)) {
      delete primitive.attributes[attribute];
    }
  }
}

gltf.nodes.forEach((node, index) => {
  delete node.children;
  if (index !== watchNodeIndex) {
    delete node.mesh;
    delete node.skin;
  }
});
delete watchNode.skin;
delete watchNode.translation;
delete watchNode.rotation;
delete watchNode.scale;
delete watchNode.matrix;
watchNode.name = 'DeagleAuthoredWatch';
gltf.scenes = [{ name: 'DeagleWatch', nodes: [watchNodeIndex] }];
gltf.scene = 0;
delete gltf.animations;
delete gltf.skins;

const processed = await processGltf(gltf, { keepUnusedElements: false });
const { glb } = await gltfToGlb(processed.gltf);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, glb);
console.log(`[deagle-watch] wrote ${output} (${glb.length} bytes)`);
