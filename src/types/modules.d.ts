declare module 'obj2gltf' {
  export interface Obj2GltfOptions {
    binary?: boolean;
  }

  export default function obj2gltf(
    input: string,
    options?: Obj2GltfOptions,
  ): Promise<Buffer | ArrayBuffer>;
}

declare module 'gltf-pipeline' {
  export interface GltfToGlbOptions {
    resourceDirectory: string;
    separate: boolean;
  }

  export function gltfToGlb(
    gltf: unknown,
    options: GltfToGlbOptions,
  ): Promise<{
    glb: Uint8Array;
  }>;
}
