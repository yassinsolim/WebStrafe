import { Color, Vector3 } from 'three';

/**
 * per-map color grade, applied to the hdr scene before and after tone mapping.
 * maps can override any field in meta.environment.grade.
 */
export interface ColorGrade {
  /** linear multiplier before tone mapping */
  exposure: number;
  /** log space contrast around mid grey, 1 = neutral */
  contrast: number;
  /** 1 = neutral, 0 = grey */
  saturation: number;
  /** white balance, -1 cool .. 1 warm */
  temperature: number;
  /** -1 green .. 1 magenta */
  tint: number;
  /** darkening towards the corners, 0 = off */
  vignette: number;
  /** strength of the bloom mip chain */
  bloom: number;
  /** linear hdr level where bloom starts */
  bloomThreshold: number;
}

export const DEFAULT_GRADE: Readonly<ColorGrade> = {
  exposure: 1,
  contrast: 1.12,
  saturation: 1.08,
  temperature: 0.04,
  tint: 0,
  vignette: 0.22,
  bloom: 0.06,
  bloomThreshold: 0.9,
};

const MID_GREY = 0.18;
/**
 * strength of the tone map toe. khronos neutral uses 1, which pulls the lowest
 * channel of a dark color almost to zero (x -> 6.25 x^2), so warm shadows lose
 * all their blue and go muddy. half keeps some of the sky in them.
 */
export const TONE_TOE = 0.5;

function finite(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/** fills a partial grade from meta.json with the defaults and clamps it */
export function resolveGrade(raw: unknown, exposure = 1): ColorGrade {
  const src = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
  return {
    exposure: finite(src.exposure, exposure, 0.05, 8),
    contrast: finite(src.contrast, DEFAULT_GRADE.contrast, 0.5, 2),
    saturation: finite(src.saturation, DEFAULT_GRADE.saturation, 0, 2),
    temperature: finite(src.temperature, DEFAULT_GRADE.temperature, -1, 1),
    tint: finite(src.tint, DEFAULT_GRADE.tint, -1, 1),
    vignette: finite(src.vignette, DEFAULT_GRADE.vignette, 0, 1),
    bloom: finite(src.bloom, DEFAULT_GRADE.bloom, 0, 1),
    bloomThreshold: finite(src.bloomThreshold, DEFAULT_GRADE.bloomThreshold, 0, 16),
  };
}

/**
 * white balance as per channel gains. a cheap stand in for a proper cat02
 * adaptation: warm pushes red up and blue down, tint trades green for magenta.
 * the gains are normalised so mid grey keeps its luminance.
 */
export function whiteBalanceGains(temperature: number, tint: number, out = new Vector3()): Vector3 {
  const r = 1 + 0.18 * temperature + 0.06 * tint;
  const g = 1 - 0.12 * tint;
  const b = 1 - 0.22 * temperature + 0.06 * tint;
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return out.set(r / luma, g / luma, b / luma);
}

function toeOffset(x: number): number {
  return TONE_TOE * (x < 0.08 ? x - 6.25 * x * x : 0.04);
}

/** khronos pbr neutral with a softer toe, same constants as the shader */
function neutral(c: [number, number, number]): [number, number, number] {
  const start = 0.8 - 0.04;
  const desat = 0.15;
  let [r, g, b] = c;
  const offset = toeOffset(Math.min(r, g, b));
  r -= offset;
  g -= offset;
  b -= offset;
  const peak = Math.max(r, g, b);
  if (peak < start) return [r, g, b];
  const d = 1 - start;
  const newPeak = 1 - (d * d) / (peak + d - start);
  const k = newPeak / peak;
  r *= k;
  g *= k;
  b *= k;
  const t = 1 - 1 / (desat * (peak - newPeak) + 1);
  return [r + (newPeak - r) * t, g + (newPeak - g) * t, b + (newPeak - b) * t];
}

/** cpu mirror of the composite shader (without vignette and dither), linear in and out */
export function gradeLinear(input: [number, number, number], grade: ColorGrade): [number, number, number] {
  const wb = whiteBalanceGains(grade.temperature, grade.tint);
  let c: [number, number, number] = [
    Math.max(0, input[0] * grade.exposure * wb.x),
    Math.max(0, input[1] * grade.exposure * wb.y),
    Math.max(0, input[2] * grade.exposure * wb.z),
  ];
  c = c.map((v) => MID_GREY * Math.pow(Math.max(v, 1e-6) / MID_GREY, grade.contrast)) as [number, number, number];
  const luma = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  c = c.map((v) => Math.max(0, luma + (v - luma) * grade.saturation)) as [number, number, number];
  return neutral(c).map((v) => Math.min(1, Math.max(0, v))) as [number, number, number];
}

/** undoes the neutral curve's toe offset, `c` is the color after the offset */
function addToeOffset(c: [number, number, number]): [number, number, number] {
  const outMin = Math.max(0, Math.min(c[0], c[1], c[2]));
  // below 0.08 the toe maps x to (1 - t) x + 6.25 t x^2, above it subtracts a flat 0.04 t
  const t = TONE_TOE;
  const x = outMin < 0.08 - 0.04 * t
    ? (-(1 - t) + Math.sqrt((1 - t) * (1 - t) + 25 * t * outMin)) / (12.5 * t)
    : outMin + 0.04 * t;
  const offset = toeOffset(x);
  return [c[0] + offset, c[1] + offset, c[2] + offset];
}

function inverseNeutral(out: [number, number, number]): [number, number, number] {
  const start = 0.8 - 0.04;
  const desat = 0.15;
  const newPeak = Math.max(out[0], out[1], out[2]);
  if (newPeak < start) return addToeOffset(out);
  const d = 1 - start;
  const peak = (d * d) / (1 - newPeak) - d + start;
  const g = 1 - 1 / (desat * (peak - newPeak) + 1);
  const k = newPeak / peak;
  const scaled = out.map((v) => ((v - newPeak * g) / Math.max(1e-6, 1 - g)) / k) as [number, number, number];
  return addToeOffset(scaled);
}

/**
 * the linear hdr color that the grade turns into `display` (a linear, not srgb
 * encoded, display value). used so sky and fog colors authored as screen colors
 * in meta.json still show up as authored. every stage of the grade has a
 * closed form inverse, run in reverse order.
 */
export function inverseGrade(display: Color, grade: ColorGrade, out = new Color()): Color {
  const target: [number, number, number] = [
    Math.min(0.985, Math.max(0, display.r)),
    Math.min(0.985, Math.max(0, display.g)),
    Math.min(0.985, Math.max(0, display.b)),
  ];
  let c = inverseNeutral(target);
  const luma = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const sat = Math.max(1e-3, grade.saturation);
  c = c.map((v) => Math.max(0, luma + (v - luma) / sat)) as [number, number, number];
  c = c.map((v) => MID_GREY * Math.pow(Math.max(v, 1e-6) / MID_GREY, 1 / grade.contrast)) as [number, number, number];
  const wb = whiteBalanceGains(grade.temperature, grade.tint);
  const exposure = Math.max(1e-3, grade.exposure);
  return out.setRGB(c[0] / (exposure * wb.x), c[1] / (exposure * wb.y), c[2] / (exposure * wb.z));
}

/** glsl for the composite: exposure, white balance, contrast, saturation, neutral tone map */
export const GRADE_GLSL = /* glsl */ `
#define TONE_TOE ${TONE_TOE.toFixed(4)}
uniform float gradeExposure;
uniform vec3 gradeWhiteBalance;
uniform float gradeContrast;
uniform float gradeSaturation;

vec3 neutralToneMap(vec3 color) {
  const float startCompression = 0.8 - 0.04;
  const float desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = TONE_TOE * (x < 0.08 ? x - 6.25 * x * x : 0.04);
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}

vec3 gradeColor(vec3 color) {
  color = max(color * gradeExposure * gradeWhiteBalance, vec3(0.0));
  color = 0.18 * pow(max(color, vec3(1e-6)) / 0.18, vec3(gradeContrast));
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = max(vec3(luma) + (color - vec3(luma)) * gradeSaturation, vec3(0.0));
  return clamp(neutralToneMap(color), 0.0, 1.0);
}
`;
