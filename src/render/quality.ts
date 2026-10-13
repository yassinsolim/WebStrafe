import type { GraphicsOverrides, GraphicsQuality } from '../ui/SettingsStore';

export type QualityLevel = Exclude<GraphicsQuality, 'auto'>;

/** everything the renderer, the maps and the effects read from the preset */
export interface QualityPreset {
  level: QualityLevel;
  /** msaa samples on the hdr scene target, 0 falls back to fxaa in the composite */
  msaa: number;
  fxaa: boolean;
  bloom: boolean;
  /** screen space ambient occlusion on the world pass */
  ao: boolean;
  /** player shadows from the real-time sun, 0 = off */
  shadowMapSize: number;
  /** generated normal maps and gloss on lightmapped world materials */
  detailedMaterials: boolean;
  /** sky reflections on world and weapon materials */
  reflections: boolean;
  /** light the viewmodel from a small cube capture at the eye instead of the sky alone */
  viewmodelProbe: boolean;
  /** caps the device pixel ratio before render scale and adaptive resolution */
  maxPixelRatio: number;
  /** scales particle counts for impacts and muzzle effects */
  effectDensity: number;
  /** mips in the bloom chain, fewer is cheaper and tighter */
  bloomLevels: number;
  /** bullet holes alive at once, the oldest is reused */
  maxDecals: number;
  /** largest generated normal map for world textures, 0 on low (no normal maps) */
  normalMapSize: number;
  /** anisotropic filtering on world textures, sharper floors and walls at a glance */
  anisotropy: number;
}

export const QUALITY_PRESETS: Readonly<Record<QualityLevel, QualityPreset>> = {
  // weak and software gpus: baked light only, one pass, fxaa
  low: {
    level: 'low',
    msaa: 0,
    fxaa: true,
    bloom: false,
    ao: false,
    shadowMapSize: 0,
    detailedMaterials: false,
    reflections: false,
    viewmodelProbe: false,
    maxPixelRatio: 1,
    effectDensity: 0.4,
    bloomLevels: 0,
    maxDecals: 24,
    normalMapSize: 0,
    anisotropy: 2,
  },
  // the default: the lit look without msaa or ao, aimed at 60 fps on a typical laptop
  medium: {
    level: 'medium',
    msaa: 0,
    fxaa: true,
    bloom: true,
    ao: false,
    shadowMapSize: 1024,
    detailedMaterials: true,
    reflections: true,
    viewmodelProbe: true,
    maxPixelRatio: 1.25,
    effectDensity: 0.75,
    bloomLevels: 4,
    maxDecals: 48,
    normalMapSize: 512,
    anisotropy: 4,
  },
  // strong gpus: 4x msaa, ao, sharper shadows and a wider bloom
  high: {
    level: 'high',
    msaa: 4,
    fxaa: false,
    bloom: true,
    ao: true,
    shadowMapSize: 2048,
    detailedMaterials: true,
    reflections: true,
    viewmodelProbe: true,
    maxPixelRatio: 2,
    effectDensity: 1,
    bloomLevels: 6,
    maxDecals: 96,
    normalMapSize: 1024,
    anisotropy: 8,
  },
  // the fastest gpus: 8x msaa (where the gpu has it), 4k shadows, 16x filtering
  ultra: {
    level: 'ultra',
    msaa: 8,
    fxaa: false,
    bloom: true,
    ao: true,
    shadowMapSize: 4096,
    detailedMaterials: true,
    reflections: true,
    viewmodelProbe: true,
    maxPixelRatio: 2,
    effectDensity: 1,
    bloomLevels: 6,
    maxDecals: 128,
    normalMapSize: 2048,
    anisotropy: 16,
  },
};

/**
 * auto starts on balanced; a gpu name cannot predict the cost at the current
 * display resolution. known software, phone and older integrated gpus start
 * on low. high and ultra remain explicit choices.
 */
export function detectQuality(rendererName: string | null | undefined): QualityLevel {
  const name = (rendererName ?? '').toLowerCase();
  if (!name) return 'medium';
  if (/swiftshader|llvmpipe|softpipe|software|microsoft basic/.test(name)) return 'low';
  if (/mali|adreno|powervr|apple gpu|videocore|tegra/.test(name)) return 'low';
  if (/intel/.test(name) && !/arc|iris/.test(name) && /uhd|hd graphics/.test(name)) return 'low';
  return 'medium';
}

export function autoFallbackQuality(level: QualityLevel, resolutionScale: number): QualityLevel | null {
  if (resolutionScale > 0.71 || level === 'low') return null;
  return level === 'medium' ? 'low' : 'medium';
}

/** unmasked gpu name when the browser shares it, else the plain renderer string */
export function readRendererName(renderer: { getContext(): WebGLRenderingContext | WebGL2RenderingContext }): string {
  try {
    const gl = renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return typeof name === 'string' ? name : '';
  } catch {
    return '';
  }
}

export function resolveQuality(
  setting: GraphicsQuality,
  rendererName: string | null | undefined,
  overrides?: Partial<GraphicsOverrides>,
): QualityPreset {
  const level = setting === 'auto' ? detectQuality(rendererName) : setting;
  return applyOverrides(QUALITY_PRESETS[level], overrides);
}

const SHADOW_SIZES = { off: 0, low: 1024, medium: 2048, high: 4096 } as const;

/** the preset with the player's per-option choices on top, the preset itself when there are none */
export function applyOverrides(preset: QualityPreset, overrides?: Partial<GraphicsOverrides>): QualityPreset {
  if (!overrides) return preset;
  const out = { ...preset };
  const aa = overrides.antiAliasing;
  if (aa && aa !== 'preset') {
    out.msaa = aa.startsWith('msaa') ? Number(aa.slice(4)) : 0;
    out.fxaa = aa === 'fxaa';
  }
  const shadows = overrides.shadows;
  if (shadows && shadows !== 'preset') out.shadowMapSize = SHADOW_SIZES[shadows];
  const ao = overrides.ambientOcclusion;
  if (ao && ao !== 'preset') out.ao = ao === 'on';
  const bloom = overrides.bloom;
  if (bloom && bloom !== 'preset') {
    out.bloom = bloom === 'on';
    if (out.bloom && out.bloomLevels === 0) out.bloomLevels = 4;
  }
  const filtering = overrides.textureFiltering;
  if (filtering && filtering !== 'preset') out.anisotropy = Number(filtering);
  return presetKey(out) === presetKey(preset) ? preset : out;
}

/** identity of a resolved preset, to tell when anything the renderer reads changed */
export function presetKey(preset: QualityPreset): string {
  return JSON.stringify(preset);
}
