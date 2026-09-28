import {
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  ShaderChunk,
  type Material,
  type Texture,
} from 'three';
import type { NormalFromAlbedo } from './NormalFromAlbedo';
import type { QualityPreset } from './quality';

/** what a surface is made of, drives decals, impact particles and normal strength */
export type SurfaceKind = 'metal' | 'concrete' | 'stone' | 'sand' | 'wood' | 'glass' | 'emissive' | 'generic';

export interface SurfaceProfile {
  kind: SurfaceKind;
  /** strength of the normal map generated from the albedo, 0 = none */
  normal: number;
}

const PROFILES: Array<[RegExp, SurfaceProfile]> = [
  [/glow|lava|lamp|emissive/, { kind: 'emissive', normal: 0 }],
  [/glass|window|crystal/, { kind: 'glass', normal: 0 }],
  [/cliff|rock|basalt|stone|ruin|brick/, { kind: 'stone', normal: 2.2 }],
  [/steel|iron|brass|metal|frame|cont_|container|rail|pipe|yellow/, { kind: 'metal', normal: 0.9 }],
  [/crate|wood|plank|timber/, { kind: 'wood', normal: 1.6 }],
  [/sand|dirt|dust|ground/, { kind: 'sand', normal: 1.4 }],
  [/concrete|tower|hazard|floor|wall|ramp|paint/, { kind: 'concrete', normal: 1.1 }],
];

export function surfaceProfile(materialName: string | undefined | null): SurfaceProfile {
  const name = (materialName ?? '').toLowerCase();
  for (const [pattern, profile] of PROFILES) {
    if (pattern.test(name)) {
      // flat painted stripes and prism ramps read better nearly flat
      if (/hazard|ramp|paint|yellow/.test(name)) return { ...profile, normal: 0.35 };
      return profile;
    }
  }
  return { kind: 'generic', normal: 0.8 };
}

/**
 * the lightmap's alpha is the sun's baked visibility. every directional light
 * (only the sun on sky maps) is multiplied by it, so the live sun keeps the
 * baked soft shadows but gets normal maps, specular and player shadows.
 */
const SUN_MASKED_LIGHTS_BEGIN = ShaderChunk.lights_fragment_begin
  .replace(
    'IncidentLight directLight;',
    `IncidentLight directLight;
#ifdef USE_LIGHTMAP
	float wsSunVisibility = texture2D( lightMap, vLightMapUv ).a;
#else
	float wsSunVisibility = 1.0;
#endif`,
  )
  .replace(
    'getDirectionalLightInfo( directionalLight, directLight );',
    `getDirectionalLightInfo( directionalLight, directLight );
		directLight.color *= wsSunVisibility;`,
  );

/**
 * baked indirect light replaces the sky's diffuse ibl, and sky reflections are
 * occluded wherever the bake saw less sky than an open surface would
 */
const BAKED_LIGHTS_MAPS = /* glsl */ `
#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#if defined( USE_LIGHTMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
		float wsOpenSky = dot( getIBLIrradiance( geometryNormal ), vec3( 0.2126, 0.7152, 0.0722 ) );
		float wsBaked = dot( lightMapIrradiance, vec3( 0.2126, 0.7152, 0.0722 ) );
		radiance *= clamp( wsBaked / max( wsOpenSky * wsSkyRef, 1e-4 ), 0.0, 1.0 );
	#endif
#endif
`;

export function sunMaskAvailable(): boolean {
  return SUN_MASKED_LIGHTS_BEGIN !== ShaderChunk.lights_fragment_begin;
}

export interface WorldMaterialOptions {
  preset: QualityPreset;
  lightMap: Texture;
  /** pi * encode scale * the map's indirect multiplier */
  lightMapIntensity: number;
  normals: NormalFromAlbedo | null;
  /** how much baked light counts as open sky for reflection occlusion */
  skyRef: number;
}

/**
 * material for a lightmapped world mesh whose lightmap holds indirect light in
 * rgb and sun visibility in alpha. low gets a lambert surface, medium and high
 * a standard surface with a generated normal map and occluded sky reflections.
 */
export function buildBakedMaterial(source: MeshStandardMaterial, options: WorldMaterialOptions): Material {
  const profile = surfaceProfile(source.name);
  const common = {
    name: source.name,
    map: source.map,
    color: source.color.clone(),
    lightMap: options.lightMap,
    lightMapIntensity: options.lightMapIntensity,
    side: source.side,
    transparent: source.transparent,
    opacity: source.opacity,
    alphaTest: source.alphaTest,
    vertexColors: source.vertexColors,
    fog: true,
  };
  if (!options.preset.detailedMaterials) {
    const lambert = new MeshLambertMaterial(common);
    lambert.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', SUN_MASKED_LIGHTS_BEGIN);
    };
    lambert.customProgramCacheKey = () => 'ws-baked-lambert';
    lambert.userData.surface = profile.kind;
    return lambert;
  }
  const normalMap = options.normals && source.map && profile.normal > 0
    ? options.normals.get(source.map, profile.normal, options.preset.normalMapSize)
    : null;
  const standard = new MeshStandardMaterial({
    ...common,
    roughness: source.roughness,
    metalness: source.metalness,
    normalMap,
    envMapIntensity: options.preset.reflections ? 1 : 0,
  });
  const skyRef = options.skyRef;
  standard.onBeforeCompile = (shader) => {
    shader.uniforms.wsSkyRef = { value: skyRef };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float wsSkyRef;')
      .replace('#include <lights_fragment_begin>', SUN_MASKED_LIGHTS_BEGIN)
      .replace('#include <lights_fragment_maps>', BAKED_LIGHTS_MAPS);
  };
  standard.customProgramCacheKey = () => `ws-baked-standard-${skyRef.toFixed(3)}`;
  standard.userData.surface = profile.kind;
  return standard;
}

/** v2 bakes hold every light: albedo x lightmap, no live lighting at all */
export function buildFullBakeMaterial(source: MeshStandardMaterial, lightMap: Texture, lightMapIntensity: number): MeshBasicMaterial {
  const basic = new MeshBasicMaterial({
    name: source.name,
    map: source.map,
    color: source.color.clone(),
    lightMap,
    lightMapIntensity,
    side: source.side,
    transparent: source.transparent,
    opacity: source.opacity,
    alphaTest: source.alphaTest,
    vertexColors: source.vertexColors,
    fog: true,
  });
  basic.userData.surface = surfaceProfile(source.name).kind;
  return basic;
}
