/**
 * Knife finishes (skins). Display names are the CS names so players recognise
 * them; every pattern is an original procedural shader (shaders.ts), nothing is
 * taken from Valve. Wear ranges are the CS float limits of each finish, seeds
 * are the CS pattern index (0..999) and move the pattern deterministically.
 */

export type KnifeFinishCategory = 'stock' | 'anodized' | 'steel' | 'paint' | 'camo';

/**
 * how wear shows: paint chips down to bare steel, anodized coats scuff a
 * little, patina and etched steel mostly darken (cs keeps them unscratched)
 */
export type KnifeFinishWearStyle = 'none' | 'anodized' | 'patina' | 'etched' | 'paint';

/** what a finish does to the knife_handle material */
export type KnifeHandleTreatment =
  | { kind: 'keep' }
  | { kind: 'dark' }
  | { kind: 'tint'; color: number }
  | { kind: 'pattern' };

export interface KnifeFinishVariant {
  id: string;
  name: string;
  /** shader palette, srgb hex: dark smoke, main, second, highlight */
  colors: readonly [number, number, number, number];
  /** shader knobs: dark share, second colour weight, highlight weight, pearl sheen */
  params: readonly [number, number, number, number];
  /** css colours for swatch fallbacks */
  swatch: readonly string[];
}

export interface KnifeFinishDef {
  id: string;
  name: string;
  category: KnifeFinishCategory;
  wearStyle: KnifeFinishWearStyle;
  /** cs float limits [min, max] */
  wearRange: readonly [number, number];
  /** false when the pattern index changes nothing (night, ultraviolet) */
  seedMatters: boolean;
  /** which knife materials the finish replaces (see docs/assets/knife-contract.md) */
  parts: { blade: boolean; edge: boolean; metal: boolean; handle: KnifeHandleTreatment };
  /** css colours for swatch fallbacks */
  swatch: readonly string[];
  /** phases and gems, each with its own id */
  variants?: readonly KnifeFinishVariant[];
}

/** what a player picked, the same shape the viewmodel and the menu pass around */
export interface KnifeFinishSelection {
  finishId: string;
  /** 0..1 float like the cs wear value */
  wear: number;
  /** 0..999 pattern index */
  seed: number;
}

export const DEFAULT_KNIFE_FINISH_ID = 'vanilla';
export const PATTERN_SEED_MAX = 999;

const KEEP: KnifeHandleTreatment = { kind: 'keep' };
const DARK: KnifeHandleTreatment = { kind: 'dark' };
const PATTERN: KnifeHandleTreatment = { kind: 'pattern' };
const ALL = (handle: KnifeHandleTreatment) => ({ blade: true, edge: true, metal: true, handle });

const DOPPLER_VARIANTS: readonly KnifeFinishVariant[] = [
  {
    id: 'doppler_phase1', name: 'Phase 1',
    colors: [0x0c0611, 0xd6388e, 0x7428b4, 0x4a5ce0], params: [0.6, 0.55, 0.3, 0],
    swatch: ['#1a0c22', '#d6388e', '#7428b4'],
  },
  {
    id: 'doppler_phase2', name: 'Phase 2',
    colors: [0x3a0a34, 0xff4aa2, 0xb03ad8, 0xff9fd2], params: [0.2, 0.45, 0.5, 0],
    swatch: ['#ff4aa2', '#b03ad8', '#ff9fd2'],
  },
  {
    id: 'doppler_phase3', name: 'Phase 3',
    colors: [0x04070c, 0x1f5cd4, 0x1b9a70, 0x5a8cff], params: [0.5, 0.55, 0.25, 0],
    swatch: ['#04070c', '#1f5cd4', '#1b9a70'],
  },
  {
    id: 'doppler_phase4', name: 'Phase 4',
    colors: [0x060a26, 0x2a6cff, 0x5ac8ff, 0x8a4ee0], params: [0.28, 0.55, 0.3, 0],
    swatch: ['#2a6cff', '#5ac8ff', '#060a26'],
  },
  {
    id: 'doppler_ruby', name: 'Ruby',
    colors: [0x4a0007, 0xe8101f, 0xff3a4c, 0xff7c8c], params: [0.14, 0.4, 0.35, 0],
    swatch: ['#4a0007', '#e8101f', '#ff7c8c'],
  },
  {
    id: 'doppler_sapphire', name: 'Sapphire',
    colors: [0x000a4c, 0x0f3cff, 0x2a7aff, 0x80b3ff], params: [0.12, 0.45, 0.35, 0],
    swatch: ['#000a4c', '#0f3cff', '#80b3ff'],
  },
  {
    id: 'doppler_black_pearl', name: 'Black Pearl',
    colors: [0x050308, 0x2c1452, 0x173a68, 0x7a4eb2], params: [0.5, 0.5, 0.35, 0.6],
    swatch: ['#050308', '#2c1452', '#173a68'],
  },
  {
    id: 'doppler_emerald', name: 'Emerald',
    colors: [0x00240e, 0x10c850, 0x3cff8e, 0x9cffd0], params: [0.12, 0.45, 0.35, 0],
    swatch: ['#00240e', '#10c850', '#9cffd0'],
  },
];

/** grouped by look: stock, anodized, steel, paint, camo */
export const KNIFE_FINISHES: readonly KnifeFinishDef[] = [
  {
    id: 'vanilla', name: 'Vanilla', category: 'stock', wearStyle: 'none', wearRange: [0, 0], seedMatters: false,
    parts: { blade: false, edge: false, metal: false, handle: KEEP },
    swatch: ['#8d949e', '#e6e9ee', '#9aa1ab'],
  },
  {
    id: 'doppler', name: 'Doppler', category: 'anodized', wearStyle: 'anodized', wearRange: [0, 0.08], seedMatters: true,
    parts: ALL(KEEP), swatch: DOPPLER_VARIANTS[1].swatch, variants: DOPPLER_VARIANTS,
  },
  {
    id: 'marble_fade', name: 'Marble Fade', category: 'anodized', wearStyle: 'anodized', wearRange: [0, 0.08], seedMatters: true,
    parts: ALL(KEEP), swatch: ['#ffc21f', '#f01820', '#1a38f0'],
  },
  {
    id: 'fade', name: 'Fade', category: 'anodized', wearStyle: 'anodized', wearRange: [0, 0.08], seedMatters: true,
    parts: ALL(KEEP), swatch: ['#ffc44a', '#ff3c8a', '#8a30e6'],
  },
  {
    id: 'tiger_tooth', name: 'Tiger Tooth', category: 'anodized', wearStyle: 'anodized', wearRange: [0, 0.08], seedMatters: true,
    parts: ALL(KEEP), swatch: ['#ffb21c', '#3a1a04', '#ffc84a'],
  },
  {
    id: 'slaughter', name: 'Slaughter', category: 'anodized', wearStyle: 'anodized', wearRange: [0.01, 0.26], seedMatters: true,
    parts: ALL(DARK), swatch: ['#b3101c', '#ff6f7a', '#ffe0e0'],
  },
  {
    id: 'case_hardened', name: 'Case Hardened', category: 'steel', wearStyle: 'patina', wearRange: [0, 1], seedMatters: true,
    parts: ALL(DARK), swatch: ['#d6a640', '#2c56c8', '#7a4a96'],
  },
  {
    id: 'damascus_steel', name: 'Damascus Steel', category: 'steel', wearStyle: 'etched', wearRange: [0, 0.5], seedMatters: true,
    parts: ALL(KEEP), swatch: ['#5a5e64', '#d8dbe0', '#6e7278'],
  },
  {
    id: 'blue_steel', name: 'Blue Steel', category: 'steel', wearStyle: 'patina', wearRange: [0, 1], seedMatters: true,
    parts: ALL(KEEP), swatch: ['#1c2a48', '#5d7aa4', '#2a3a5c'],
  },
  {
    id: 'stained', name: 'Stained', category: 'steel', wearStyle: 'patina', wearRange: [0, 1], seedMatters: true,
    parts: ALL(KEEP), swatch: ['#b9bcc2', '#6c7078', '#c9bd8c'],
  },
  {
    id: 'crimson_web', name: 'Crimson Web', category: 'paint', wearStyle: 'paint', wearRange: [0.06, 0.8], seedMatters: true,
    parts: ALL({ kind: 'tint', color: 0x141414 }), swatch: ['#a3141a', '#1a0204', '#c21c22'],
  },
  {
    id: 'ultraviolet', name: 'Ultraviolet', category: 'paint', wearStyle: 'paint', wearRange: [0.06, 0.8], seedMatters: false,
    parts: ALL({ kind: 'tint', color: 0x5b2d8e }), swatch: ['#15101c', '#2a1840', '#5b2d8e'],
  },
  {
    id: 'night', name: 'Night', category: 'paint', wearStyle: 'paint', wearRange: [0.06, 0.8], seedMatters: false,
    parts: ALL({ kind: 'tint', color: 0x2f3c46 }), swatch: ['#1a1f26', '#2a323c', '#3d4854'],
  },
  {
    id: 'safari_mesh', name: 'Safari Mesh', category: 'camo', wearStyle: 'paint', wearRange: [0.06, 0.8], seedMatters: true,
    parts: ALL(PATTERN), swatch: ['#77734f', '#aaa37c', '#5c5c3e'],
  },
  {
    id: 'boreal_forest', name: 'Boreal Forest', category: 'camo', wearStyle: 'paint', wearRange: [0.06, 0.8], seedMatters: true,
    parts: ALL(PATTERN), swatch: ['#8e8456', '#5b7036', '#3a2a18'],
  },
  {
    id: 'scorched', name: 'Scorched', category: 'camo', wearStyle: 'paint', wearRange: [0.06, 0.8], seedMatters: true,
    parts: ALL(PATTERN), swatch: ['#a39c8c', '#101010', '#57504a'],
  },
];

const byId = new Map<string, KnifeFinishDef>(KNIFE_FINISHES.map((f) => [f.id, f]));
const variantById = new Map<string, { finish: KnifeFinishDef; variant: KnifeFinishVariant }>();
for (const finish of KNIFE_FINISHES) {
  for (const variant of finish.variants ?? []) variantById.set(variant.id, { finish, variant });
}

export interface ResolvedKnifeFinish {
  finish: KnifeFinishDef;
  variant: KnifeFinishVariant | null;
  /** the selectable id: the variant id for finishes with phases */
  id: string;
  /** "Doppler (Phase 2)" */
  name: string;
}

export function getKnifeFinish(id: string | null | undefined): KnifeFinishDef {
  return resolveKnifeFinish(id).finish;
}

/** finish or variant id to the finish, its variant and a display name; unknown ids fall back to vanilla */
export function resolveKnifeFinish(id: string | null | undefined): ResolvedKnifeFinish {
  const hit = id ? variantById.get(id) : undefined;
  if (hit) return { ...hit, id: hit.variant.id, name: `${hit.finish.name} (${hit.variant.name})` };
  const finish = (id && byId.get(id)) || byId.get(DEFAULT_KNIFE_FINISH_ID)!;
  const variant = finish.variants?.[0] ?? null;
  return {
    finish,
    variant,
    id: variant ? variant.id : finish.id,
    name: variant ? `${finish.name} (${variant.name})` : finish.name,
  };
}

export function isKnifeFinishId(id: unknown): id is string {
  return typeof id === 'string' && (byId.has(id) || variantById.has(id));
}

/** every id a player can end up with, variants instead of their parent */
export function selectableKnifeFinishIds(): string[] {
  return KNIFE_FINISHES.flatMap((f) => (f.variants ? f.variants.map((v) => v.id) : [f.id]));
}

export function knifeFinishDisplayName(id: string | null | undefined): string {
  return resolveKnifeFinish(id).name;
}

// ---------------------------------------------------------------- wear

export interface WearCondition {
  id: 'fn' | 'mw' | 'ft' | 'ww' | 'bs';
  name: string;
  short: string;
  min: number;
  max: number;
}

/** cs exteriors; a float on a boundary belongs to the worse bucket */
export const WEAR_CONDITIONS: readonly WearCondition[] = [
  { id: 'fn', name: 'Factory New', short: 'FN', min: 0, max: 0.07 },
  { id: 'mw', name: 'Minimal Wear', short: 'MW', min: 0.07, max: 0.15 },
  { id: 'ft', name: 'Field-Tested', short: 'FT', min: 0.15, max: 0.38 },
  { id: 'ww', name: 'Well-Worn', short: 'WW', min: 0.38, max: 0.45 },
  { id: 'bs', name: 'Battle-Scarred', short: 'BS', min: 0.45, max: 1 },
];

export function wearCondition(wear: number): WearCondition {
  const w = Number.isFinite(wear) ? wear : 0;
  return WEAR_CONDITIONS.find((c) => w < c.max) ?? WEAR_CONDITIONS[WEAR_CONDITIONS.length - 1];
}

/** clamps a float into the finish's cs limits (vanilla has no wear) */
export function clampKnifeWear(finishId: string | null | undefined, wear: number): number {
  const [min, max] = resolveKnifeFinish(finishId).finish.wearRange;
  const w = Number.isFinite(wear) ? wear : min;
  return Math.min(max, Math.max(min, w));
}

export function normalizePatternSeed(seed: unknown): number {
  const n = typeof seed === 'number' ? seed : Number(seed);
  if (!Number.isFinite(n)) return 0;
  return Math.min(PATTERN_SEED_MAX, Math.max(0, Math.round(n)));
}

// ---------------------------------------------------------------- seeds

function saltOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** stable 0..1 hash of a seed, salted per use so different knobs don't correlate */
export function seedHash(seed: number, salt: string): number {
  let h = (Math.imul(normalizePatternSeed(seed) + 1, 0x9e3779b1) ^ saltOf(salt)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export interface FinishSeedParams {
  /** noise domain offset */
  offset: [number, number, number];
  /** pattern rotation in the blade plane, radians */
  angle: number;
}

/** where a seed moves the pattern; finishes that ignore the seed always get the same look */
export function finishSeedParams(finishId: string | null | undefined, seed: number): FinishSeedParams {
  const { finish } = resolveKnifeFinish(finishId);
  if (!finish.seedMatters) return { offset: [0, 0, 0], angle: 0 };
  const h = (k: string) => seedHash(seed, `${finish.id}:${k}`);
  return {
    offset: [(h('x') - 0.5) * 160, (h('y') - 0.5) * 160, (h('z') - 0.5) * 160],
    angle: (h('a') - 0.5) * 0.7,
  };
}

// hand picked heavy-blue seeds; 387 and 661 are a nod to the famous cs blue gems
const BLUE_GEM_SEEDS = new Set([387, 661]);

export interface CaseHardenedPattern {
  /** 0..1 share of the blade in blue */
  blue: number;
  tier: 'Blue gem' | 'High blue' | 'Gold gem' | null;
}

export function caseHardenedPattern(seed: number): CaseHardenedPattern {
  const s = normalizePatternSeed(seed);
  const h = seedHash(s, 'case_hardened:blue');
  if (BLUE_GEM_SEEDS.has(s) || h < 0.015) return { blue: 0.88 + 0.1 * seedHash(s, 'case_hardened:gem'), tier: 'Blue gem' };
  if (h < 0.075) return { blue: 0.55 + 0.2 * seedHash(s, 'case_hardened:high'), tier: 'High blue' };
  if (h > 0.988) return { blue: 0.02, tier: 'Gold gem' };
  // most seeds are gold with some blue, like cs
  const t = (h - 0.075) / (0.988 - 0.075);
  return { blue: 0.08 + 0.34 * Math.pow(t, 1.7), tier: null };
}

/** fade percentage: higher seeds of this hash give more colour and a fuller purple tip */
export function fadePercent(seed: number): number {
  return Math.round((80 + 20 * seedHash(seed, 'fade:pct')) * 10) / 10;
}

export interface MarbleFadePattern {
  kind: 'Fire & Ice' | 'Fake Fire & Ice' | 'Blue dominant' | 'Tricolour' | null;
  /** 0 removes yellow (fire and ice), 1 is the full red, yellow, blue marble */
  yellow: number;
  /** pushes the colour bands towards blue */
  blue: number;
  /** shifts the band sequence along the blade */
  shift: number;
}

export function marbleFadePattern(seed: number): MarbleFadePattern {
  const h = seedHash(seed, 'marble_fade:kind');
  const shift = seedHash(seed, 'marble_fade:shift');
  if (h < 0.07) return { kind: 'Fire & Ice', yellow: 0, blue: 0.5, shift };
  if (h < 0.12) return { kind: 'Fake Fire & Ice', yellow: 0.35, blue: 0.45, shift };
  if (h < 0.26) return { kind: 'Blue dominant', yellow: 0.7, blue: 0.85, shift };
  if (h < 0.5) return { kind: 'Tricolour', yellow: 1, blue: 0.5, shift };
  return { kind: null, yellow: 1, blue: 0.35, shift };
}

export interface WebCenter {
  /** blade space: u along the blade, v from edge to spine */
  u: number;
  v: number;
  spin: number;
}

/** web hubs of a crimson web seed (one to three, the first one on the blade) */
export function crimsonWebCenters(seed: number): WebCenter[] {
  const h = (k: string) => seedHash(seed, `crimson_web:${k}`);
  const count = h('count') < 0.12 ? 3 : h('count') < 0.45 ? 2 : 1;
  const centers: WebCenter[] = [{ u: 0.22 + 0.62 * h('u0'), v: 0.12 + 0.76 * h('v0'), spin: h('s0') * Math.PI }];
  for (let i = 1; i < count; i += 1) {
    const du = 0.35 + 0.35 * h(`du${i}`);
    const u = centers[0].u + (h(`side${i}`) < 0.5 ? -du : du);
    centers.push({ u, v: -0.2 + 1.4 * h(`v${i}`), spin: h(`s${i}`) * Math.PI });
  }
  return centers;
}

/** short note about what a seed does for pattern-driven finishes, null when nothing stands out */
export function finishPatternLabel(finishId: string | null | undefined, seed: number): string | null {
  const { finish } = resolveKnifeFinish(finishId);
  switch (finish.id) {
    case 'case_hardened': {
      const p = caseHardenedPattern(seed);
      return p.tier ?? `${Math.round(p.blue * 100)}% blue`;
    }
    case 'fade':
      return `Fade ${fadePercent(seed).toFixed(1)}%`;
    case 'marble_fade':
      return marbleFadePattern(seed).kind;
    case 'crimson_web': {
      const centers = crimsonWebCenters(seed);
      const first = centers[0];
      if (centers.length === 1 && Math.abs(first.u - 0.55) < 0.14 && Math.abs(first.v - 0.5) < 0.2) return 'Centred web';
      return centers.length === 1 ? '1 web centre' : `${centers.length} web centres`;
    }
    default:
      return null;
  }
}
