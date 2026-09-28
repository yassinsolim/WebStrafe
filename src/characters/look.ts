import type { PlayerModel } from '../network/types';
import {
  ARMOR_SET_INFO,
  ARMOR_SETS,
  EMBLEM_INFO,
  EMBLEMS,
  FINISH_INFO,
  FINISHES,
  SWATCHES,
  type ArmorSetId,
  type ClassItemId,
  type EmblemId,
  type FinishId,
} from './catalog';

/**
 * one player's cosmetic choices. purely visual: hitboxes, movement and damage
 * never read any of this.
 */
export interface CharacterLook {
  helmet: ArmorSetId;
  arms: ArmorSetId;
  chest: ArmorSetId;
  legs: ArmorSetId;
  classItem: ClassItemId;
  /** '#rrggbb' main paint */
  primary: string;
  /** '#rrggbb' second paint, cloth panels and trims */
  secondary: string;
  /** '#rrggbb' small details and the emblem */
  accent: string;
  finish: FinishId;
  emblem: EmblemId;
  /** callsign printed on the chest, 0..8 of A-Z 0-9 and '-' */
  tag: string;
  /** first-person wristwatch */
  watch: boolean;
}

export const LOOK_WIRE_VERSION = '1';
/** longest wire string we accept, a full v1 look is about 50 chars */
export const MAX_LOOK_WIRE_LENGTH = 96;
export const MAX_TAG_LENGTH = 8;

const DEFAULT_LOOKS: Record<PlayerModel, CharacterLook> = {
  terrorist: {
    helmet: 'strafe',
    arms: 'strafe',
    chest: 'strafe',
    legs: 'strafe',
    classItem: 'strafe',
    primary: '#c2a67a',
    secondary: '#556043',
    accent: '#a4502a',
    finish: 'satin',
    emblem: 'chevron',
    tag: '',
    watch: true,
  },
  counterterrorist: {
    helmet: 'strafe',
    arms: 'strafe',
    chest: 'strafe',
    legs: 'strafe',
    classItem: 'strafe',
    primary: '#26334a',
    secondary: '#8a949f',
    accent: '#2f5fa8',
    finish: 'satin',
    emblem: 'chevron',
    tag: '',
    watch: true,
  },
};

/** the look anyone gets before customizing (and what bad data falls back to) */
export function defaultLook(team: PlayerModel = 'terrorist'): CharacterLook {
  return { ...DEFAULT_LOOKS[team] };
}

const HEX = /^#[0-9a-f]{6}$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value.toLowerCase());
}

/** uppercase, only A-Z 0-9 and '-', spaces become '-', capped at 8 */
export function sanitizeTag(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .toUpperCase()
    .replace(/\s+/g, '-')
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, MAX_TAG_LENGTH);
}

function isSet(value: unknown): value is ArmorSetId {
  return typeof value === 'string' && (ARMOR_SETS as readonly string[]).includes(value);
}

/**
 * coerces anything (stored json, a half-filled object) into a valid look,
 * field by field, so one bad value never throws away the rest
 */
export function sanitizeLook(input: unknown, fallback: CharacterLook = defaultLook()): CharacterLook {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const color = (key: 'primary' | 'secondary' | 'accent'): string =>
    isHexColor(src[key]) ? (src[key] as string).toLowerCase() : fallback[key];
  return {
    helmet: isSet(src.helmet) ? src.helmet : fallback.helmet,
    arms: isSet(src.arms) ? src.arms : fallback.arms,
    chest: isSet(src.chest) ? src.chest : fallback.chest,
    legs: isSet(src.legs) ? src.legs : fallback.legs,
    classItem: src.classItem === 'none' || isSet(src.classItem) ? (src.classItem as ClassItemId) : fallback.classItem,
    primary: color('primary'),
    secondary: color('secondary'),
    accent: color('accent'),
    finish: (FINISHES as readonly string[]).includes(src.finish as string) ? (src.finish as FinishId) : fallback.finish,
    emblem: (EMBLEMS as readonly string[]).includes(src.emblem as string) ? (src.emblem as EmblemId) : fallback.emblem,
    tag: typeof src.tag === 'string' ? sanitizeTag(src.tag) : fallback.tag,
    watch: typeof src.watch === 'boolean' ? src.watch : fallback.watch,
  };
}

export function looksEqual(a: CharacterLook, b: CharacterLook): boolean {
  return encodeLook(a) === encodeLook(b);
}

const SET_BY_CODE = new Map(ARMOR_SETS.map((id) => [ARMOR_SET_INFO[id].code, id]));
const FINISH_BY_CODE = new Map(FINISHES.map((id) => [FINISH_INFO[id].code, id]));
const EMBLEM_BY_CODE = new Map(EMBLEMS.map((id) => [EMBLEM_INFO[id].code, id]));

/**
 * compact wire form for join/presence, about 50 chars:
 *   1.<helmet>.<arms>.<chest>.<legs>.<class>.<primary>.<secondary>.<accent>.<finish>.<emblem>.<watch>.<tag>
 * pieces and emblems are two letters, colours six hex digits, finish one letter.
 */
export function encodeLook(look: CharacterLook): string {
  const set = (id: ArmorSetId) => ARMOR_SET_INFO[id].code;
  return [
    LOOK_WIRE_VERSION,
    set(look.helmet),
    set(look.arms),
    set(look.chest),
    set(look.legs),
    look.classItem === 'none' ? 'no' : set(look.classItem),
    look.primary.slice(1).toLowerCase(),
    look.secondary.slice(1).toLowerCase(),
    look.accent.slice(1).toLowerCase(),
    FINISH_INFO[look.finish].code,
    EMBLEM_INFO[look.emblem].code,
    look.watch ? '1' : '0',
    sanitizeTag(look.tag),
  ].join('.');
}

/**
 * parses a wire look from an untrusted peer. returns null when it isn't a
 * look at all (wrong type, too long, unknown version); otherwise every field
 * that doesn't parse falls back to `fallback`, so a newer client's unknown
 * piece just shows our default piece in that slot
 */
export function decodeLook(wire: unknown, fallback: CharacterLook = defaultLook()): CharacterLook | null {
  if (typeof wire !== 'string' || wire.length === 0 || wire.length > MAX_LOOK_WIRE_LENGTH) {
    return null;
  }
  const parts = wire.split('.');
  if (parts[0] !== LOOK_WIRE_VERSION || parts.length < 12) {
    return null;
  }
  const set = (code: string | undefined, fb: ArmorSetId): ArmorSetId => SET_BY_CODE.get(code ?? '') ?? fb;
  const color = (hex: string | undefined, fb: string): string =>
    hex && /^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex.toLowerCase()}` : fb;
  const classCode = parts[5];
  return {
    helmet: set(parts[1], fallback.helmet),
    arms: set(parts[2], fallback.arms),
    chest: set(parts[3], fallback.chest),
    legs: set(parts[4], fallback.legs),
    classItem: classCode === 'no' ? 'none' : SET_BY_CODE.get(classCode) ?? fallback.classItem,
    primary: color(parts[6], fallback.primary),
    secondary: color(parts[7], fallback.secondary),
    accent: color(parts[8], fallback.accent),
    finish: FINISH_BY_CODE.get(parts[9]) ?? fallback.finish,
    emblem: EMBLEM_BY_CODE.get(parts[10]) ?? fallback.emblem,
    watch: parts[11] === '1' ? true : parts[11] === '0' ? false : fallback.watch,
    // the tag is last so a stray '.' can only ever end up in it
    tag: sanitizeTag(parts.slice(12).join('')),
  };
}

/** a cheap check transports run before storing a peer's look string */
export function isPlausibleLookWire(value: unknown): value is string {
  return (
    typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_LOOK_WIRE_LENGTH
    && /^[0-9A-Za-z.-]+$/.test(value)
  );
}

/** mulberry32, small and deterministic */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// colour schemes that read well together; random looks pick one and shuffle a little
const SCHEMES: ReadonlyArray<[string, string, string]> = [
  ['#c2a67a', '#556043', '#a4502a'],
  ['#26334a', '#8a949f', '#2f5fa8'],
  ['#2b2e33', '#4a4f57', '#1f8a86'],
  ['#e4ddcf', '#8a949f', '#9e2231'],
  ['#4a4f57', '#c9a43c', '#2b2e33'],
  ['#3d4a2f', '#8f8161', '#8cc63f'],
  ['#9e2231', '#141518', '#c9a43c'],
  ['#b9bcc0', '#2b2e33', '#e59a2f'],
  ['#5d3f8f', '#2b2e33', '#9cc4d8'],
  ['#6b4a33', '#c2a67a', '#1f8a86'],
  ['#8fa28a', '#2b2e33', '#e8e23a'],
  ['#9cc4d8', '#26334a', '#c46a82'],
];

/**
 * a random but tasteful look. `seed` makes it repeatable (bots use their id),
 * without one it rolls fresh
 */
export function randomLook(seed?: number | string): CharacterLook {
  const next = rng(
    seed === undefined ? Math.floor(Math.random() * 2 ** 32) : typeof seed === 'string' ? hashString(seed) : seed,
  );
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length) % items.length];
  // mostly one set with a swap or two, fully mixed looks rarely read as a character
  const base = pick(ARMOR_SETS);
  const piece = (): ArmorSetId => (next() < 0.7 ? base : pick(ARMOR_SETS));
  const scheme = pick(SCHEMES);
  const swatch = () => pick(SWATCHES).hex;
  const classRoll = next();
  return {
    helmet: piece(),
    arms: piece(),
    chest: piece(),
    legs: piece(),
    classItem: classRoll < 0.12 ? 'none' : piece(),
    primary: scheme[0],
    secondary: next() < 0.8 ? scheme[1] : swatch(),
    accent: next() < 0.8 ? scheme[2] : swatch(),
    finish: pick(FINISHES),
    emblem: pick(EMBLEMS.filter((id) => id !== 'none')),
    tag: '',
    watch: true,
  };
}

/** bots get a stable look from their id so they don't all dress the same */
export function lookForBot(id: string): CharacterLook {
  return randomLook(`bot|${id}`);
}
