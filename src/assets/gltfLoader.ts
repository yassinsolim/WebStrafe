import type { LoadingManager, WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

let ktx2: KTX2Loader | null = null;

/**
 * ktx2 textures (tools/assets/ktx2-textures.ts) transcode to whatever the gpu
 * supports (astc, bc7, etc2...), so they need the renderer once before any glb
 * with them loads. call this right after creating the renderer.
 */
export function configureTextureTranscoder(renderer: WebGLRenderer): void {
  if (ktx2) return;
  ktx2 = new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer);
}

/** the configured ktx2 loader, for textures that don't come from a glb (lightmaps) */
export function textureTranscoder(): KTX2Loader | null {
  return ktx2;
}

/**
 * One place to build GLTF loaders so every asset (maps, viewmodels, knives,
 * player models) can use meshopt-compressed GLBs from tools/assets/optimize-glb.ts
 * and ktx2 textures.
 */
export function createGltfLoader(manager?: LoadingManager): GLTFLoader {
  const loader = new GLTFLoader(manager);
  loader.setMeshoptDecoder(MeshoptDecoder);
  if (ktx2) loader.setKTX2Loader(ktx2);
  return loader;
}

let shared: GLTFLoader | null = null;

/** lazily created loader for code that doesn't need its own loading manager */
export function sharedGltfLoader(): GLTFLoader {
  shared ??= createGltfLoader();
  return shared;
}
