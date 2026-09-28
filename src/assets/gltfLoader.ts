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
  if (isSoftwareRenderer(renderer)) {
    // software gl decodes compressed blocks on every texture sample, plain rgba is far faster there
    const config = (ktx2 as unknown as { workerConfig: Record<string, boolean> }).workerConfig;
    for (const key of Object.keys(config)) config[key] = false;
  }
}

function isSoftwareRenderer(renderer: WebGLRenderer): boolean {
  try {
    const gl = renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    return /swiftshader|llvmpipe|softpipe|software/i.test(name);
  } catch {
    return false;
  }
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
