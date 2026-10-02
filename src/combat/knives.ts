/**
 * Knife catalog: twelve of the CS2 knife types, each clearly its own shape,
 * under their CS2 type names (plain knife words). Every model is our own,
 * built in Blender (tools/blender/knives) or procedurally (ProceduralKnife.ts),
 * nothing is taken from Valve. `referenceType` is the CS2 type it plays like.
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
  | 'karambit' | 'butterfly' | 'm9_bayonet' | 'talon' | 'skeleton' | 'bayonet'
  | 'flip' | 'stiletto' | 'huntsman' | 'bowie' | 'gut' | 'shadow_daggers';

const STEEL = 0xc9ced6;
const DARK_STEEL = 0x70767f;
const BLACK = 0x1d1f22;
const OLIVE = 0x4a5139;
const TAN = 0x9c7a52;
const WOOD = 0x6b4226;
const ORANGE = 0xff6a2b;

/** the loadout order: the most wanted first */
export const KNIVES: readonly KnifeDef[] = [
  {
    id: 'karambit', name: 'Karambit', referenceType: 'Karambit',
    shape: { profile: 'hawkbill', bladeLength: 0.085, bladeHeight: 0.03, bladeThickness: 0.004, guard: 'none', handle: 'ring', handleLength: 0.095, bladeColor: STEEL, handleColor: BLACK, accentColor: STEEL, fingerRing: true, grind: 'hollow' },
    timing: { drawMs: 1000, inspectMs: 4400 },
  },
  {
    id: 'butterfly', name: 'Butterfly Knife', referenceType: 'Butterfly Knife',
    shape: { profile: 'drop', bladeLength: 0.1, bladeHeight: 0.024, bladeThickness: 0.004, guard: 'none', handle: 'split', handleLength: 0.125, bladeColor: STEEL, handleColor: DARK_STEEL, accentColor: STEEL, mechanism: 'balisong', grind: 'flat' },
    timing: { drawMs: 1300, inspectMs: 4600 },
  },
  {
    id: 'm9_bayonet', name: 'M9 Bayonet', referenceType: 'M9 Bayonet',
    shape: { profile: 'clip', bladeLength: 0.18, bladeHeight: 0.036, bladeThickness: 0.006, serratedSpine: true, guard: 'ring', handle: 'grip', handleLength: 0.125, bladeColor: STEEL, handleColor: OLIVE, accentColor: DARK_STEEL, grind: 'sabre' },
    timing: { drawMs: 1000, inspectMs: 4400 },
  },
  {
    id: 'talon', name: 'Talon Knife', referenceType: 'Talon Knife',
    shape: { profile: 'hawkbill', bladeLength: 0.1, bladeHeight: 0.028, bladeThickness: 0.004, guard: 'bolster', handle: 'scales', handleLength: 0.11, bladeColor: STEEL, handleColor: 0x2f3a4a, accentColor: STEEL, mechanism: 'folder', fingerRing: true, grind: 'hollow' },
    timing: { drawMs: 1000, inspectMs: 4000 },
  },
  {
    id: 'skeleton', name: 'Skeleton Knife', referenceType: 'Skeleton Knife',
    shape: { profile: 'drop', bladeLength: 0.11, bladeHeight: 0.03, bladeThickness: 0.005, guard: 'none', handle: 'skeleton', handleLength: 0.11, bladeColor: STEEL, handleColor: DARK_STEEL, accentColor: ORANGE, grind: 'hollow' },
    timing: { drawMs: 1000, inspectMs: 3600 },
  },
  {
    id: 'bayonet', name: 'Bayonet', referenceType: 'Bayonet',
    shape: { profile: 'spear', bladeLength: 0.2, bladeHeight: 0.032, bladeThickness: 0.006, fuller: true, guard: 'cross', handle: 'grip', handleLength: 0.12, bladeColor: STEEL, handleColor: BLACK, accentColor: DARK_STEEL, grind: 'sabre' },
    timing: { drawMs: 1000, inspectMs: 4200 },
  },
  {
    id: 'flip', name: 'Flip Knife', referenceType: 'Flip Knife',
    shape: { profile: 'drop', bladeLength: 0.1, bladeHeight: 0.028, bladeThickness: 0.004, guard: 'bolster', handle: 'scales', handleLength: 0.11, bladeColor: STEEL, handleColor: BLACK, accentColor: STEEL, mechanism: 'folder', grind: 'hollow' },
    timing: { drawMs: 1000, inspectMs: 3600 },
  },
  {
    id: 'stiletto', name: 'Stiletto Knife', referenceType: 'Stiletto Knife',
    shape: { profile: 'needle', bladeLength: 0.12, bladeHeight: 0.018, bladeThickness: 0.004, guard: 'cross', handle: 'scales', handleLength: 0.12, bladeColor: STEEL, handleColor: BLACK, accentColor: STEEL, mechanism: 'folder', grind: 'flat' },
    timing: { drawMs: 1000, inspectMs: 3600 },
  },
  {
    id: 'huntsman', name: 'Huntsman Knife', referenceType: 'Huntsman Knife',
    shape: { profile: 'clip', bladeLength: 0.16, bladeHeight: 0.038, bladeThickness: 0.006, serratedSpine: true, guard: 'cross', handle: 'grip', handleLength: 0.12, bladeColor: STEEL, handleColor: TAN, accentColor: DARK_STEEL, grind: 'flat' },
    timing: { drawMs: 1000, inspectMs: 4000 },
  },
  {
    id: 'bowie', name: 'Bowie Knife', referenceType: 'Bowie Knife',
    shape: { profile: 'clip', bladeLength: 0.21, bladeHeight: 0.045, bladeThickness: 0.007, guard: 'cross', handle: 'wood', handleLength: 0.12, bladeColor: STEEL, handleColor: WOOD, accentColor: 0xb08d57, grind: 'flat' },
    timing: { drawMs: 1000, inspectMs: 4000 },
  },
  {
    id: 'gut', name: 'Gut Knife', referenceType: 'Gut Knife',
    shape: { profile: 'gut', bladeLength: 0.105, bladeHeight: 0.034, bladeThickness: 0.005, guard: 'none', handle: 'grip', handleLength: 0.1, bladeColor: STEEL, handleColor: BLACK, accentColor: DARK_STEEL, grind: 'flat' },
    timing: { drawMs: 1000, inspectMs: 3400 },
  },
  {
    id: 'shadow_daggers', name: 'Shadow Daggers', referenceType: 'Shadow Daggers',
    shape: { profile: 'spear', bladeLength: 0.075, bladeHeight: 0.03, bladeThickness: 0.004, guard: 'none', handle: 'tee', handleLength: 0.09, bladeColor: DARK_STEEL, handleColor: BLACK, accentColor: STEEL, pair: true, grind: 'flat' },
    timing: { drawMs: 1000, inspectMs: 3400 },
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

// ---- combat (all knife types share it, as in CS) ----
// damage is the cs:go / cs2 knife table (counterstrike fandom wiki and the
// tradeit cs2 stats page agree). timings, ranges and the hull come from the
// source knife code (weapon_knife.cpp, SwingOrStab). 1 unit = 0.0254 m.

export type KnifeAttack = 'primary' | 'secondary';

/**
 * CS-style knife damage: primary slash 40 (25 on a follow-up), secondary stab
 * 65; from behind 90 and 180. A slash backstab is not lethal from full health,
 * same as CS. Armour is not modelled.
 */
export const KNIFE_DAMAGE = {
  primary: 40,
  primaryFollowUp: 25,
  secondary: 65,
  primaryBackstab: 90,
  secondaryBackstab: 180,
} as const;

export const KNIFE_TIMING_MS = {
  /** next slash after a slash that missed (cs 0.4 s) */
  primaryInterval: 400,
  /** next slash after a slash that hit (cs 0.5 s) */
  primaryIntervalHit: 500,
  /** stab lockout after any slash (cs 0.5 s) */
  secondaryAfterPrimary: 500,
  /** both attacks after a stab that missed (cs 1.0 s) */
  secondaryInterval: 1000,
  /** both attacks after a stab that hit (cs 1.1 s) */
  secondaryIntervalHit: 1100,
  /**
   * a slash is a follow-up (25 damage) until this long after the slash
   * cooldown ran out (cs: m_flNextPrimaryAttack + 0.4 s), so steady spam
   * deals 40 then 25s
   */
  followUpWindow: 400,
} as const;

/**
 * Reach from the eye to the target capsule surface. CS traces 48 / 32 units
 * and falls back to a hull sweep, which lands about 1.63 / 1.22 m from the
 * eye to the target box, so these sit close to it.
 */
export const KNIFE_RANGE_M = {
  primary: 1.45,
  secondary: 1.2,
} as const;

/** radius of the swept sphere; cs head_hull is 16 units (0.41 m) wide each side */
export const KNIFE_SWEEP_RADIUS_M = 0.41;

/** everything a melee weapon's swings need: the knife and the katana each have one */
export interface MeleeStats {
  damage: { [K in keyof typeof KNIFE_DAMAGE]: number };
  timing: { [K in keyof typeof KNIFE_TIMING_MS]: number };
  range: { [K in keyof typeof KNIFE_RANGE_M]: number };
  sweepRadius: number;
}

export const KNIFE_MELEE: MeleeStats = {
  damage: KNIFE_DAMAGE,
  timing: KNIFE_TIMING_MS,
  range: KNIFE_RANGE_M,
  sweepRadius: KNIFE_SWEEP_RADIUS_M,
};

/** cs:go backstab: attacker-to-victim direction dot victim forward above 0.475 (cs:s used 0.8) */
export const BACKSTAB_DOT = 0.475;

export function knifeDamage(
  attack: KnifeAttack,
  backstab: boolean,
  followUp: boolean,
  table: MeleeStats['damage'] = KNIFE_DAMAGE,
): number {
  if (attack === 'secondary') {
    return backstab ? table.secondaryBackstab : table.secondary;
  }
  if (backstab) return table.primaryBackstab;
  return followUp ? table.primaryFollowUp : table.primary;
}

/**
 * Backstab when the attacker stands behind the victim: the victim's facing and
 * the attacker-to-victim direction point the same way (dot above
 * {@link BACKSTAB_DOT}, the same cone BackstabOpportunity uses for the
 * "backstab ready" cue).
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
  if (!Number.isFinite(victimYawRad)) return false;
  const fx = -Math.sin(victimYawRad);
  const fz = -Math.cos(victimYawRad);
  return (dx / len) * fx + (dz / len) * fz > BACKSTAB_DOT;
}
