import type { LoadingManager } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/**
 * One place to build GLTF loaders so every asset (maps, viewmodels, knives,
 * player models) can use meshopt-compressed GLBs from tools/assets/optimize-glb.ts.
 */
export function createGltfLoader(manager?: LoadingManager): GLTFLoader {
  const loader = new GLTFLoader(manager);
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

let shared: GLTFLoader | null = null;

/** lazily created loader for code that doesn't need its own loading manager */
export function sharedGltfLoader(): GLTFLoader {
  shared ??= createGltfLoader();
  return shared;
}
