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
  /** caps the device pixel ratio before render scale and adaptive resolution */
  maxPixelRatio: number;
  /** scales particle counts for impacts and muzzle effects */
  effectDensity: number;
}

export const QUALITY_PRESETS: Readonly<Record<QualityLevel, QualityPreset>> = {
  low: {
    level: 'low',
    msaa: 0,
    fxaa: true,
    bloom: false,
    ao: false,
    shadowMapSize: 0,
    detailedMaterials: false,
    reflections: false,
    maxPixelRatio: 1,
    effectDensity: 0.5,
  },
  medium: {
    level: 'medium',
    msaa: 2,
    fxaa: false,
    bloom: true,
    ao: false,
    shadowMapSize: 1024,
    detailedMaterials: true,
    reflections: true,
    maxPixelRatio: 1.5,
    effectDensity: 0.8,
  },
  high: {
    level: 'high',
    msaa: 4,
    fxaa: false,
    bloom: true,
    ao: true,
    shadowMapSize: 2048,
    detailedMaterials: true,
    reflections: true,
    maxPixelRatio: 2,
    effectDensity: 1,
  },
};

/**
 * picks a preset from the webgl renderer string. apple silicon and discrete
 * cards get high, integrated intel and older laptop parts medium, software gl
 * and phone gpus low. unknown strings get medium, adaptive resolution covers
 * the rest.
 */
export function detectQuality(rendererName: string | null | undefined): QualityLevel {
  const name = (rendererName ?? '').toLowerCase();
  if (!name) return 'medium';
  if (/swiftshader|llvmpipe|softpipe|software|microsoft basic/.test(name)) return 'low';
  if (/mali|adreno|powervr|apple gpu|videocore|tegra/.test(name)) return 'low';
  if (/apple m\d/.test(name)) return 'high';
  if (/nvidia|geforce|rtx|gtx|quadro|radeon|amd/.test(name)) {
    // old laptop radeons and the vega igpus are closer to intel
    if (/vega \d\b|radeon\(tm\) graphics|radeon graphics/.test(name)) return 'medium';
    return 'high';
  }
  if (/intel/.test(name)) {
    if (/arc/.test(name)) return 'high';
    if (/uhd|hd graphics/.test(name)) return 'low';
    return 'medium';
  }
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
