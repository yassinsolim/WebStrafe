import { Color, type Material, MeshStandardMaterial, type Texture, Vector4 } from 'three';
import {
  caseHardenedPattern,
  crimsonWebCenters,
  fadePercent,
  finishSeedParams,
  type KnifeFinishDef,
  type KnifeFinishWearStyle,
  marbleFadePattern,
  type ResolvedKnifeFinish,
} from './catalog';
import { finishFragmentShader, finishVertexShader } from './shaders';

/**
 * finish materials, shared between every knife showing the same finish, wear
 * step and seed (the viewmodel, the menu preview and the swatches). they are
 * reference counted: a material nobody uses waits in a small idle list so
 * scrubbing the wear slider doesn't rebuild everything, then gets disposed.
 * one shader program per finish family and part, all variation is uniforms.
 */

/** wear is quantized to this step for material sharing, finer than any visible change */
export const FINISH_WEAR_STEP = 0.005;
const IDLE_LIMIT = 48;
const PROGRAM_VERSION = 1;

interface Entry {
  key: string;
  material: MeshStandardMaterial;
  refs: number;
}

const entries = new Map<string, Entry>();
const byMaterial = new Map<Material, Entry>();
const idle: string[] = [];

export function isKnifeFinishMaterial(material: Material | null | undefined): boolean {
  return material?.userData.knifeFinish !== undefined;
}

function acquire(key: string, make: () => MeshStandardMaterial): MeshStandardMaterial {
  let entry = entries.get(key);
  if (!entry) {
    const material = make();
    material.userData.knifeFinish = key;
    entry = { key, material, refs: 0 };
    entries.set(key, entry);
    byMaterial.set(material, entry);
  }
  if (entry.refs === 0) {
    const at = idle.indexOf(key);
    if (at >= 0) idle.splice(at, 1);
  }
  entry.refs += 1;
  return entry.material;
}

/** gives a finish material back; unused ones are disposed once the idle list is full */
export function releaseFinishMaterial(material: Material): void {
  const entry = byMaterial.get(material);
  if (!entry || entry.refs === 0) return;
  entry.refs -= 1;
  if (entry.refs > 0) return;
  idle.push(entry.key);
  while (idle.length > IDLE_LIMIT) evict(idle.shift()!);
}

function evict(key: string): void {
  const entry = entries.get(key);
  if (!entry || entry.refs > 0) return;
  entries.delete(key);
  byMaterial.delete(entry.material);
  entry.material.dispose();
}

/** disposes every finish material that no knife uses right now */
export function disposeIdleFinishMaterials(): void {
  for (const key of idle.splice(0)) evict(key);
}

export function finishMaterialStats(): { live: number; idle: number } {
  return { live: entries.size - idle.length, idle: idle.length };
}

// ---------------------------------------------------------------- uniforms

interface FinishUniforms {
  finSeed: { value: Vector4 };
  finParams: { value: Vector4 };
  finWear: { value: Vector4 };
  finBase: { value: Vector4 };
  finData: { value: Vector4[] };
}

const EDGE_POLISH: Readonly<Record<KnifeFinishWearStyle, number>> = {
  none: 0,
  paint: 0.85,
  anodized: 0.3,
  patina: 0.45,
  etched: 0.35,
};

/** inverse normal cdf (abramowitz and stegun 26.2.23), good to 4.5e-4 */
function probit(p: number): number {
  const q = Math.min(Math.max(p < 0.5 ? p : 1 - p, 1e-6), 0.5);
  const t = Math.sqrt(-2 * Math.log(q));
  const x = t - (2.515517 + 0.802853 * t + 0.010328 * t * t) / (1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t);
  return p < 0.5 ? -x : x;
}

/** finFbm threshold that leaves `share` of the surface below it (mean 0.5, sd 0.12, see shaders.ts) */
function fbmThreshold(share: number): number {
  return 0.5 + 0.12 * probit(Math.min(0.999, Math.max(0.001, share)));
}

function linear(hex: number): Vector4 {
  const c = new Color(hex);
  return new Vector4(c.r, c.g, c.b, 1);
}

function finishUniforms(resolved: ResolvedKnifeFinish, wear: number, seed: number, polish: number): FinishUniforms {
  const { finish, variant } = resolved;
  const s = finishSeedParams(resolved.id, seed);
  const params = new Vector4();
  const data = Array.from({ length: 6 }, () => new Vector4());
  switch (finish.id) {
    case 'doppler':
      if (variant) {
        variant.colors.forEach((hex, i) => data[i].copy(linear(hex)));
        const [dark, second, highlight, pearl] = variant.params;
        params.set(fbmThreshold(dark), second, highlight, pearl);
      }
      break;
    case 'fade': {
      // more percent: colour reaches further down and the tip goes fully purple
      const k = (fadePercent(seed) - 80) / 20;
      const start = 0.3 - 0.22 * k;
      params.set(1 - start - 0.04 * k, start, 0, 0);
      break;
    }
    case 'marble_fade': {
      const p = marbleFadePattern(seed);
      params.set(p.yellow, p.blue, p.shift, 0);
      break;
    }
    case 'case_hardened': {
      // threshold on the fbm field so `blue` of the blade ends up blue
      params.set(fbmThreshold(1 - caseHardenedPattern(seed).blue), 0, 0, 0);
      break;
    }
    case 'crimson_web':
      crimsonWebCenters(seed).forEach((c, i) => data[i].set(c.u, c.v, c.spin, 1));
      break;
    default:
      break;
  }
  return {
    finSeed: { value: new Vector4(s.offset[0], s.offset[1], s.offset[2], s.angle) },
    finParams: { value: params },
    finWear: { value: new Vector4(wear, polish, 0, 0) },
    finBase: { value: new Vector4(0, 0, 0, 0.5) },
    finData: { value: data },
  };
}

function installShader(material: MeshStandardMaterial, finish: KnifeFinishDef, kind: 'surface' | 'handle', uniforms: FinishUniforms): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = finishVertexShader(shader.vertexShader);
    shader.fragmentShader = finishFragmentShader(shader.fragmentShader, finish.id, finish.wearStyle, kind === 'handle');
  };
  // same source for every variant, seed and wear of a finish, so they share one program
  const programKey = `knife-finish:${PROGRAM_VERSION}:${finish.id}:${kind}`;
  material.customProgramCacheKey = () => programKey;
  material.userData.knifeFinishUniforms = uniforms;
}

function wearKey(wear: number): number {
  return Math.round(wear / FINISH_WEAR_STEP);
}

/** blade (and metal parts) or the polished edge bevel */
export function acquireSurfaceMaterial(resolved: ResolvedKnifeFinish, wear: number, seed: number, part: 'blade' | 'edge'): MeshStandardMaterial {
  const step = wearKey(wear);
  const key = `${resolved.id}|${part}|w${step}|s${seed}`;
  return acquire(key, () => {
    const material = new MeshStandardMaterial({ name: `knife_finish_${part}`, color: 0xffffff, metalness: 1, roughness: 0.3 });
    // matte paint would pick up too much of the bright studio environment
    if (part === 'blade' && resolved.finish.wearStyle === 'paint') material.envMapIntensity = 0.6;
    const polish = part === 'edge' ? EDGE_POLISH[resolved.finish.wearStyle] : 0;
    installShader(material, resolved.finish, 'surface', finishUniforms(resolved, step * FINISH_WEAR_STEP, seed, polish));
    return material;
  });
}

function styleSignature(original: Material): string {
  const std = original as MeshStandardMaterial;
  const tex = (t: Texture | null | undefined) => t?.uuid ?? '-';
  if (!(std instanceof MeshStandardMaterial)) return `${original.type}|${original.uuid}`;
  return [std.type, tex(std.map), tex(std.normalMap), tex(std.roughnessMap), std.color.getHexString(),
    std.metalness.toFixed(2), std.roughness.toFixed(2), std.normalScale.x.toFixed(2)].join('|');
}

function standardFrom(original: Material): MeshStandardMaterial {
  if (original instanceof MeshStandardMaterial) return original.clone();
  const fallback = new MeshStandardMaterial({ roughness: 0.6, metalness: 0 });
  const withMap = original as Material & { map?: Texture | null; color?: Color };
  if (withMap.map) fallback.map = withMap.map;
  if (withMap.color instanceof Color) fallback.color.copy(withMap.color);
  return fallback;
}

/** what the finish puts on a knife_handle material, null to keep it */
export function acquireHandleMaterial(resolved: ResolvedKnifeFinish, wear: number, seed: number, original: Material): MeshStandardMaterial | null {
  const treatment = resolved.finish.parts.handle;
  const sig = styleSignature(original);
  switch (treatment.kind) {
    case 'keep':
      return null;
    case 'dark':
    case 'tint': {
      const color = treatment.kind === 'dark' ? 0x1b1c1f : treatment.color;
      return acquire(`handle-${treatment.kind}|${color.toString(16)}|${sig}`, () => {
        const material = standardFrom(original);
        material.name = 'knife_finish_handle';
        material.color.setHex(color);
        return material;
      });
    }
    case 'pattern': {
      const step = wearKey(wear);
      return acquire(`${resolved.id}|handle|w${step}|s${seed}|${sig}`, () => {
        const material = standardFrom(original);
        const base = material.color.clone();
        const uniforms = finishUniforms(resolved, step * FINISH_WEAR_STEP, seed, 0);
        uniforms.finBase.value.set(base.r, base.g, base.b, material.roughness);
        uniforms.finWear.value.z = material.metalness;
        material.name = 'knife_finish_handle';
        material.color.setHex(0xffffff);
        material.roughnessMap = null;
        installShader(material, resolved.finish, 'handle', uniforms);
        return material;
      });
    }
    default:
      return null;
  }
}
