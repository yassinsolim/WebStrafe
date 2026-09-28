import type { GraphicsQuality } from '../ui/SettingsStore';

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
  },
};

/**
 * picks a preset from the webgl renderer string. auto never picks high: every
 * real gpu starts on balanced (medium) and high is opt-in in the settings.
 * software gl, phone gpus and old intel hd/uhd graphics get low. adaptive
 * resolution covers the rest.
 */
export function detectQuality(rendererName: string | null | undefined): QualityLevel {
  const name = (rendererName ?? '').toLowerCase();
  if (!name) return 'medium';
  if (/swiftshader|llvmpipe|softpipe|software|microsoft basic/.test(name)) return 'low';
  if (/mali|adreno|powervr|apple gpu|videocore|tegra/.test(name)) return 'low';
  if (/intel/.test(name) && !/arc|iris/.test(name) && /uhd|hd graphics/.test(name)) return 'low';
  return 'medium';
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

export function resolveQuality(setting: GraphicsQuality, rendererName: string | null | undefined): QualityPreset {
  const level = setting === 'auto' ? detectQuality(rendererName) : setting;
  return QUALITY_PRESETS[level];
}
