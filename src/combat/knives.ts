/**
 * Knife catalog. One entry per CS2 knife type (verified list of 20, current as
 * of the Kukri in Feb 2024; no newer type through Sep 2026). In-game names are
 * our own generic descriptions; `referenceType` records which CS2 type each one
 * plays like, for balancing and loadout mapping only. Every model is built
 * procedurally in ProceduralKnife.ts, nothing is taken from Valve.
 */

export type BladeProfile =
  | 'spear'      // straight double-edged point (bayonet, push dagger)
  | 'drop'       // convex spine dropping to the point
  | 'clip'       // concave clipped spine (bowie, huntsman)
  | 'tanto'      // angular chisel point
  | 'hawkbill'   // strong downward curve (karambit, talon)
  | 'recurve'    // forward-weighted bent blade (kukri)
  | 'needle'     // long thin point (stiletto)
  | 'cleaver'    // wide curved single edge (falchion)
  | 'gut';       // drop point with a hook cut into the spine

export type HandleStyle =
  | 'grip'       // moulded rubber with finger ridges
  | 'scales'     // flat scales on a full tang
  | 'wood'
  | 'cord'       // paracord wrapped
  | 'split'      // balisong: two halves either side of the tang
  | 'ring'       // karambit: finger ring at the butt
  | 'skeleton'   // open frame with a big cut-out
  | 'tee';       // push dagger: handle across the blade axis

export type GuardStyle = 'none' | 'cross' | 'bolster' | 'ring';

/** how the blade and handle move: folders swing the blade, balisongs swing both handles */
export type KnifeMechanism = 'fixed' | 'folder' | 'balisong';

/** primary grind: flat (straight taper), hollow (concave), sabre (low flat grind) */
export type GrindStyle = 'flat' | 'hollow' | 'sabre';

export interface KnifeShape {
  profile: BladeProfile;
  /** metres */
  bladeLength: number;
  bladeHeight: number;
  bladeThickness: number;
  serratedSpine?: boolean;
  /** gutter groove down the blade */
  fuller?: boolean;
  guard: GuardStyle;
  handle: HandleStyle;
  handleLength: number;
  bladeColor: number;
  handleColor: number;
  accentColor: number;
  /** two blades (push daggers are dual wielded) */
  pair?: boolean;
  /** default 'fixed' */
  mechanism?: KnifeMechanism;
  /** finger ring at the butt (karambit style) */
  fingerRing?: boolean;
  /** default 'flat' */
  grind?: GrindStyle;
}

export interface KnifeTiming {
  /** draw/deploy time before the first attack, ms */
  drawMs: number;
  /** full inspect animation, ms */
  inspectMs: number;
}

export interface KnifeDef {
  id: KnifeId;
  name: string;
  referenceType: string;
  shape: KnifeShape;
  timing: KnifeTiming;
}

export type KnifeId =
  | 'bayonet' | 'm9_bayonet' | 'karambit' | 'butterfly' | 'flip' | 'gut' | 'huntsman'
  | 'falchion' | 'bowie' | 'shadow_daggers' | 'navaja' | 'stiletto' | 'talon' | 'ursus'
  | 'classic' | 'paracord' | 'survival' | 'nomad' | 'skeleton' | 'kukri';

const STEEL = 0xc9ced6;
const DARK_STEEL = 0x70767f;
const BLACK = 0x1d1f22;
const OLIVE = 0x4a5139;
const TAN = 0x9c7a52;
const WOOD = 0x6b4226;
const ORANGE = 0xff6a2b;

/** CS2 knife types, in the order they were introduced. */
export const KNIVES: readonly KnifeDef[] = [
  {
    id: 'bayonet', name: 'Trench Bayonet', referenceType: 'Bayonet',
    shape: { profile: 'spear', bladeLength: 0.2, bladeHeight: 0.032, bladeThickness: 0.006, fuller: true, guard: 'cross', handle: 'grip', handleLength: 0.12, bladeColor: STEEL, handleColor: BLACK, accentColor: DARK_STEEL, grind: 'sabre' },
    timing: { drawMs: 1000, inspectMs: 4200 },
  },
  {
    id: 'flip', name: 'Flip Folder', referenceType: 'Flip Knife',
    shape: { profile: 'drop', bladeLength: 0.1, bladeHeight: 0.028, bladeThickness: 0.004, guard: 'bolster', handle: 'scales', handleLength: 0.11, bladeColor: STEEL, handleColor: BLACK, accentColor: STEEL, mechanism: 'folder', grind: 'hollow' },
    timing: { drawMs: 1000, inspectMs: 3600 },
  },
  {
    id: 'gut', name: 'Gut Hook', referenceType: 'Gut Knife',
    shape: { profile: 'gut', bladeLength: 0.105, bladeHeight: 0.034, bladeThickness: 0.005, guard: 'none', handle: 'grip', handleLength: 0.1, bladeColor: STEEL, handleColor: BLACK, accentColor: DARK_STEEL, grind: 'flat' },
    timing: { drawMs: 1000, inspectMs: 3400 },
  },
  {
    id: 'karambit', name: 'Karambit', referenceType: 'Karambit',
    shape: { profile: 'hawkbill', bladeLength: 0.085, bladeHeight: 0.03, bladeThickness: 0.004, guard: 'none', handle: 'ring', handleLength: 0.095, bladeColor: STEEL, handleColor: BLACK, accentColor: STEEL, fingerRing: true, grind: 'hollow' },
    timing: { drawMs: 1000, inspectMs: 4400 },
  },
  {
    id: 'm9_bayonet', name: 'Field Bayonet', referenceType: 'M9 Bayonet',
    shape: { profile: 'clip', bladeLength: 0.18, bladeHeight: 0.036, bladeThickness: 0.006, serratedSpine: true, guard: 'ring', handle: 'grip', handleLength: 0.125, bladeColor: STEEL, handleColor: OLIVE, accentColor: DARK_STEEL, grind: 'sabre' },
    timing: { drawMs: 1000, inspectMs: 4400 },
  },
  {
    id: 'huntsman', name: 'Hunting Knife', referenceType: 'Huntsman Knife',
    shape: { profile: 'clip', bladeLength: 0.16, bladeHeight: 0.038, bladeThickness: 0.006, serratedSpine: true, guard: 'cross', handle: 'grip', handleLength: 0.12, bladeColor: STEEL, handleColor: TAN, accentColor: DARK_STEEL, grind: 'flat' },
    timing: { drawMs: 1000, inspectMs: 4000 },
  },
  {
    id: 'butterfly', name: 'Balisong', referenceType: 'Butterfly Knife',
    shape: { profile: 'drop', bladeLength: 0.1, bladeHeight: 0.024, bladeThickness: 0.004, guard: 'none', handle: 'split', handleLength: 0.125, bladeColor: STEEL, handleColor: DARK_STEEL, accentColor: STEEL, mechanism: 'balisong', grind: 'flat' },
    timing: { drawMs: 1300, inspectMs: 4600 },
  },
  {
    id: 'falchion', name: 'Falchion Folder', referenceType: 'Falchion Knife',
    shape: { profile: 'cleaver', bladeLength: 0.11, bladeHeight: 0.036, bladeThickness: 0.004, guard: 'bolster', handle: 'scales', handleLength: 0.11, bladeColor: STEEL, handleColor: BLACK, accentColor: STEEL, mechanism: 'folder', grind: 'flat' },
    timing: { drawMs: 1000, inspectMs: 3800 },
  },
  {
    id: 'shadow_daggers', name: 'Push Daggers', referenceType: 'Shadow Daggers',
    shape: { profile: 'spear', bladeLength: 0.075, bladeHeight: 0.03, bladeThickness: 0.004, guard: 'none', handle: 'tee', handleLength: 0.09, bladeColor: DARK_STEEL, handleColor: BLACK, accentColor: STEEL, pair: true, grind: 'flat' },
    timing: { drawMs: 1000, inspectMs: 3400 },
  },
  {
    id: 'bowie', name: 'Bowie', referenceType: 'Bowie Knife',
    shape: { profile: 'clip', bladeLength: 0.21, bladeHeight: 0.045, bladeThickness: 0.007, guard: 'cross', handle: 'wood', handleLength: 0.12, bladeColor: STEEL, handleColor: WOOD, accentColor: 0xb08d57, grind: 'flat' },
    timing: { drawMs: 1000, inspectMs: 4000 },
  },
  {
    id: 'navaja', name: 'Navaja', referenceType: 'Navaja Knife',
    shape: { profile: 'drop', bladeLength: 0.095, bladeHeight: 0.022, bladeThickness: 0.003, guard: 'bolster', handle: 'wood', handleLength: 0.11, bladeColor: STEEL, handleColor: WOOD, accentColor: 0xb08d57, mechanism: 'folder', grind: 'flat' },
    timing: { drawMs: 1000, inspectMs: 3400 },
  },
  {
    id: 'stiletto', name: 'Stiletto', referenceType: 'Stiletto Knife',
    shape: { profile: 'needle', bladeLength: 0.12, bladeHeight: 0.018, bladeThickness: 0.004, guard: 'cross', handle: 'scales', handleLength: 0.12, bladeColor: STEEL, handleColor: BLACK, accentColor: STEEL, mechanism: 'folder', grind: 'flat' },
    timing: { drawMs: 1000, inspectMs: 3600 },
  },
  {
    id: 'talon', name: 'Folding Hawkbill', referenceType: 'Talon Knife',
    shape: { profile: 'hawkbill', bladeLength: 0.1, bladeHeight: 0.028, bladeThickness: 0.004, guard: 'bolster', handle: 'scales', handleLength: 0.11, bladeColor: STEEL, handleColor: 0x2f3a4a, accentColor: STEEL, mechanism: 'folder', fingerRing: true, grind: 'hollow' },
    timing: { drawMs: 1000, inspectMs: 4000 },
  },
  {
    id: 'ursus', name: 'Heavy Folder', referenceType: 'Ursus Knife',
    shape: { profile: 'drop', bladeLength: 0.11, bladeHeight: 0.034, bladeThickness: 0.005, guard: 'bolster', handle: 'grip', handleLength: 0.12, bladeColor: STEEL, handleColor: BLACK, accentColor: DARK_STEEL, mechanism: 'folder', grind: 'flat' },
    timing: { drawMs: 1000, inspectMs: 3600 },
  },
  {
    id: 'classic', name: 'Classic Fixed Blade', referenceType: 'Classic Knife',
    shape: { profile: 'drop', bladeLength: 0.16, bladeHeight: 0.032, bladeThickness: 0.005, guard: 'cross', handle: 'grip', handleLength: 0.12, bladeColor: STEEL, handleColor: BLACK, accentColor: DARK_STEEL, grind: 'hollow' },
    timing: { drawMs: 1000, inspectMs: 3800 },
  },
  {
    id: 'paracord', name: 'Cord-Wrap Knife', referenceType: 'Paracord Knife',
    shape: { profile: 'tanto', bladeLength: 0.11, bladeHeight: 0.028, bladeThickness: 0.005, guard: 'none', handle: 'cord', handleLength: 0.11, bladeColor: DARK_STEEL, handleColor: OLIVE, accentColor: BLACK, grind: 'flat' },
    timing: { drawMs: 1000, inspectMs: 3400 },
  },
  {
    id: 'survival', name: 'Survival Knife', referenceType: 'Survival Knife',
    shape: { profile: 'drop', bladeLength: 0.13, bladeHeight: 0.034, bladeThickness: 0.006, serratedSpine: true, guard: 'cross', handle: 'cord', handleLength: 0.11, bladeColor: DARK_STEEL, handleColor: TAN, accentColor: BLACK, grind: 'sabre' },
    timing: { drawMs: 1000, inspectMs: 3600 },
  },
  {
    id: 'nomad', name: 'Wanderer', referenceType: 'Nomad Knife',
    shape: { profile: 'drop', bladeLength: 0.11, bladeHeight: 0.03, bladeThickness: 0.005, guard: 'none', handle: 'scales', handleLength: 0.11, bladeColor: STEEL, handleColor: 0x5a3b2a, accentColor: ORANGE, mechanism: 'folder', grind: 'flat' },
    timing: { drawMs: 1000, inspectMs: 3600 },
  },
  {
    id: 'skeleton', name: 'Skeleton Blade', referenceType: 'Skeleton Knife',
    shape: { profile: 'drop', bladeLength: 0.11, bladeHeight: 0.03, bladeThickness: 0.005, guard: 'none', handle: 'skeleton', handleLength: 0.11, bladeColor: STEEL, handleColor: DARK_STEEL, accentColor: ORANGE, grind: 'hollow' },
    timing: { drawMs: 1000, inspectMs: 3600 },
  },
  {
    id: 'kukri', name: 'Kukri', referenceType: 'Kukri Knife',
    shape: { profile: 'recurve', bladeLength: 0.2, bladeHeight: 0.05, bladeThickness: 0.007, guard: 'bolster', handle: 'wood', handleLength: 0.12, bladeColor: STEEL, handleColor: WOOD, accentColor: 0xb08d57, grind: 'flat' },
    timing: { drawMs: 1000, inspectMs: 4000 },
  },
];

export const DEFAULT_KNIFE_ID: KnifeId = 'karambit';

const byId = new Map<string, KnifeDef>(KNIVES.map((k) => [k.id, k]));

export function getKnife(id: string | null | undefined): KnifeDef {
  return (id && byId.get(id)) || byId.get(DEFAULT_KNIFE_ID)!;
}

export function isKnifeId(id: unknown): id is KnifeId {
  return typeof id === 'string' && byId.has(id);
}

// ---- damage (all knife types share it, as in CS) ----

export type KnifeAttack = 'primary' | 'secondary';

/**
 * CS-style knife damage: primary slash 40 (25 on a quick follow-up), secondary
 * stab 65; from behind 90 and 180. Armour is not modelled.
 */
export const KNIFE_DAMAGE = {
  primary: 40,
  primaryFollowUp: 25,
  secondary: 65,
  primaryBackstab: 90,
  secondaryBackstab: 180,
} as const;

export const KNIFE_TIMING_MS = {
  primaryInterval: 400,
  /** a primary within this window of the previous one is a follow-up */
  followUpWindow: 500,
  secondaryInterval: 1000,
} as const;

export const KNIFE_RANGE_M = {
  primary: 1.45,
  secondary: 1.2,
} as const;

export function knifeDamage(attack: KnifeAttack, backstab: boolean, followUp: boolean): number {
  if (attack === 'secondary') {
    return backstab ? KNIFE_DAMAGE.secondaryBackstab : KNIFE_DAMAGE.secondary;
  }
  if (backstab) return KNIFE_DAMAGE.primaryBackstab;
  return followUp ? KNIFE_DAMAGE.primaryFollowUp : KNIFE_DAMAGE.primary;
}

/**
 * Backstab when the attacker stands behind the victim: the victim's facing and
 * the attacker-to-victim direction point the same way (dot >= 0.45, the same
 * cone BackstabOpportunity uses for the "backstab ready" cue).
 * Yaw is the camera yaw in radians where forward is (-sin yaw, 0, -cos yaw).
 */
export function isBackstab(
  attackerFeet: readonly [number, number, number],
  victimFeet: readonly [number, number, number],
  victimYawRad: number,
): boolean {
  const dx = victimFeet[0] - attackerFeet[0];
  const dz = victimFeet[2] - attackerFeet[2];
  const len = Math.hypot(dx, dz);
  if (len < 1e-4) return false;
  const fx = -Math.sin(victimYawRad);
  const fz = -Math.cos(victimYawRad);
  return (dx / len) * fx + (dz / len) * fz >= 0.45;
}
