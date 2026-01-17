import type { Object3D, Vector3 } from 'three';

export interface MapSpawn {
  position: [number, number, number];
  yawDeg?: number;
}

export interface MapMeta {
  id: string;
  name: string;
  author: string;
  source: string;
  license: string;
  attribution?: string;
  spawns?: MapSpawn[];
  sceneScale?: number;
  notes?: string;
}

export interface MapManifestEntry {
  id: string;
  name: string;
  author: string;
  source: string;
  license: string;
  scenePath: string;
  collisionPath?: string;
  metaPath: string;
  thumbnailPath?: string;
}

export interface MapManifest {
  maps: MapManifestEntry[];
}

export interface LoadedMap {
  entry: MapManifestEntry;
  meta: MapMeta;
  sceneRoot: Object3D;
  collisionRoot: Object3D;
  spawnPosition: Vector3;
  spawnYawDeg: number;
}

export interface CustomMapRecord {
  id: string;
  name: string;
  blob: Blob;
  meta?: MapMeta;
}
