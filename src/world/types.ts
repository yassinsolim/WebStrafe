import type { Object3D, Texture, Vector3 } from 'three';
import type { SourceCvars } from '../movement/types';

export interface MapSpawn {
  position: [number, number, number];
  yawDeg?: number;
  /** arena maps: which half of the map the spawn belongs to. bots use the half opposite spawns[0] */
  side?: string;
}

export type MapTriggerType = 'start' | 'checkpoint' | 'teleport' | 'finish';

export interface MapTrigger {
  id: string;
  type: MapTriggerType;
  /** axis aligned volume in world space (three.js, y up), tested against the feet */
  min: [number, number, number];
  max: [number, number, number];
  /** where start/checkpoint set the respawn, or where a teleport sends you */
  target?: { position: [number, number, number]; yawDeg?: number };
  stage?: number;
}

export interface MapSkyClouds {
  color?: string;
  shadow?: string;
  /** 0..1, share of the sky covered */
  coverage?: number;
  scale?: number;
  /** drift speed in noise units per second */
  speed?: number;
  /** how high above the horizon the layer fades in (0..1 of the view elevation) */
  height?: number;
}

export interface MapSkyConfig {
  zenith?: string;
  horizon?: string;
  ground?: string;
  /** curve of the horizon to zenith blend, lower values keep the horizon colour longer */
  exponent?: number;
  sunSizeDeg?: number;
  sunGlow?: number;
  sunHaze?: number;
  clouds?: MapSkyClouds;
  /** equirectangular image instead of the procedural dome */
  panorama?: string;
}

export interface MapLightmapConfig {
  path: string;
  /** meshes whose name contains this string use the lightmap; omit for the default */
  match?: string;
}

export interface MapEnvironmentConfig {
  sky?: MapSkyConfig;
  /** flat background colour for maps without a sky */
  background?: string;
  sun?: {
    /** direction towards the sun, world space */
    direction?: [number, number, number];
    color?: string;
    intensity?: number;
  };
  hemi?: { sky?: string; ground?: string; intensity?: number };
  fog?: { color?: string; near?: number; far?: number };
  exposure?: number;
  lightmaps?: MapLightmapConfig[];
  lightMapIntensity?: number;
}

export interface MapMeta {
  id: string;
  name: string;
  author: string;
  source: string;
  license: string;
  attribution?: string;
  /** what the map is built for: movement runs, fights, or both */
  modes?: ('surf' | 'combat')[];
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
  /** full run time of the headless test rider, a reference for the run timer */
  parTimeMs?: number;
  goalY?: number;
  goalPad?: {
    center: [number, number, number];
    radius: number;
    tolerance?: number;
  };
  spawns?: MapSpawn[];
  triggers?: MapTrigger[];
  environment?: MapEnvironmentConfig;
  sceneScale?: number;
  notes?: string;
  /**
   * movement cvar overrides for this map, e.g. { "sv_airaccelerate": 100 } for
   * surf. validated by MovementController.applyMapCvars, bad entries are ignored.
   */
  cvars?: Partial<SourceCvars>;
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
  modes?: ('surf' | 'combat')[];
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
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
  /** textures listed in meta.environment.lightmaps, same order (null when one failed to load) */
  lightmaps?: Array<Texture | null>;
}

export interface CustomMapRecord {
  id: string;
  name: string;
  blob: Blob;
  meta?: MapMeta;
}
