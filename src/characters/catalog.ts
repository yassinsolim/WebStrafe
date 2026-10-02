/**
 * everything a player can put on their character: armor pieces per slot,
 * paint finishes, emblems and the swatch palette. ids are stable because they
 * go over the wire (see look.ts), names are only for the ui.
 *
 * all designs are original. the sets are named after plain words on purpose,
 * none of them borrow names or shapes from other games.
 */

export const ARMOR_SLOTS = ['helmet', 'arms', 'chest', 'legs', 'classItem'] as const;
export type ArmorSlot = (typeof ARMOR_SLOTS)[number];

export const ARMOR_SETS = ['strafe', 'anvil', 'vector', 'quill'] as const;
export type ArmorSetId = (typeof ARMOR_SETS)[number];
/** the class item slot can be left empty */
export type ClassItemId = ArmorSetId | 'none';
export type PieceId = ArmorSetId | 'none';

export const SLOT_LABEL: Record<ArmorSlot, string> = {
  helmet: 'Helmet',
  arms: 'Arms',
  chest: 'Chest',
  legs: 'Legs',
  classItem: 'Class item',
};

export interface ArmorSetInfo {
  id: ArmorSetId;
  /** two letters on the wire */
  code: string;
  name: string;
  /** one line for the ui */
  blurb: string;
  pieces: Record<ArmorSlot, string>;
}

export const ARMOR_SET_INFO: Record<ArmorSetId, ArmorSetInfo> = {
  strafe: {
    id: 'strafe',
    code: 'st',
    name: 'Strafe',
    blurb: 'Balanced plates, wraparound visor. The house style.',
    pieces: {
      helmet: 'Strafe Visor',
      arms: 'Strafe Grips',
      chest: 'Strafe Plate',
      legs: 'Strafe Striders',
      classItem: 'Strafe Scarf',
    },
  },
  anvil: {
    id: 'anvil',
    code: 'an',
    name: 'Anvil',
    blurb: 'Heavy slabs, slit visor, big shoulders.',
    pieces: {
      helmet: 'Anvil Helm',
      arms: 'Anvil Gauntlets',
      chest: 'Anvil Cuirass',
      legs: 'Anvil Greaves',
      classItem: 'Anvil Half-Cape',
    },
  },
  vector: {
    id: 'vector',
    code: 've',
    name: 'Vector',
    blurb: 'Light and quiet. Faceplate, wraps and a long cloak.',
    pieces: {
      helmet: 'Vector Faceplate',
      arms: 'Vector Wraps',
      chest: 'Vector Vest',
      legs: 'Vector Treads',
      classItem: 'Vector Cloak',
    },
  },
  quill: {
    id: 'quill',
    code: 'qu',
    name: 'Quill',
    blurb: 'Long coat, tall crest, glowing seams.',
    pieces: {
      helmet: 'Quill Crest',
      arms: 'Quill Cuffs',
      chest: 'Quill Coat',
      legs: 'Quill Leggings',
      classItem: 'Quill Sash',
    },
  },
};

/** display name of whatever sits in a slot */
export function pieceName(slot: ArmorSlot, piece: PieceId): string {
  if (piece === 'none') return 'None';
  return ARMOR_SET_INFO[piece].pieces[slot];
}

/** options the picker shows for a slot, in order */
export function slotOptions(slot: ArmorSlot): PieceId[] {
  return slot === 'classItem' ? [...ARMOR_SETS, 'none'] : [...ARMOR_SETS];
}

export const FINISHES = ['matte', 'satin', 'gloss', 'metallic', 'worn', 'camo'] as const;
export type FinishId = (typeof FINISHES)[number];

export interface FinishInfo {
  id: FinishId;
  code: string;
  name: string;
  /** paint roughness and metalness, the shader adds per slot tweaks on top */
  roughness: number;
  metalness: number;
  /** how much bare metal shows through on worn edges, 0..1 */
  wear: number;
  /** breaks the paint into a disruptive pattern of the three paint colours */
  camo?: boolean;
}

export const FINISH_INFO: Record<FinishId, FinishInfo> = {
  matte: { id: 'matte', code: 'm', name: 'Matte', roughness: 0.82, metalness: 0.02, wear: 0 },
  satin: { id: 'satin', code: 's', name: 'Satin', roughness: 0.64, metalness: 0.02, wear: 0.12 },
  gloss: { id: 'gloss', code: 'g', name: 'Gloss', roughness: 0.3, metalness: 0.02, wear: 0.06 },
  metallic: { id: 'metallic', code: 'x', name: 'Metallic', roughness: 0.34, metalness: 0.88, wear: 0 },
  worn: { id: 'worn', code: 'w', name: 'Worn', roughness: 0.66, metalness: 0.08, wear: 1 },
  camo: { id: 'camo', code: 'c', name: 'Camo', roughness: 0.74, metalness: 0.03, wear: 0.35, camo: true },
};

export const EMBLEMS = [
  'none',
  'chevron',
  'wave',
  'bolt',
  'star',
  'ring',
  'hex',
  'arrow',
  'triad',
  'wing',
  'reticle',
  'crown',
] as const;
export type EmblemId = (typeof EMBLEMS)[number];

export const EMBLEM_INFO: Record<EmblemId, { code: string; name: string }> = {
  none: { code: 'no', name: 'None' },
  chevron: { code: 'cv', name: 'Chevron' },
  wave: { code: 'wv', name: 'Wave' },
  bolt: { code: 'bt', name: 'Bolt' },
  star: { code: 'sr', name: 'Star' },
  ring: { code: 'rg', name: 'Ring' },
  hex: { code: 'hx', name: 'Hex' },
  arrow: { code: 'ar', name: 'Arrow' },
  triad: { code: 'td', name: 'Triad' },
  wing: { code: 'wg', name: 'Wing' },
  reticle: { code: 'rt', name: 'Reticle' },
  crown: { code: 'cr', name: 'Crown' },
};

/** the fixed team light colours; players can't repaint these, so teams stay readable */
export const TEAM_LIGHT = {
  terrorist: '#ff8a2a',
  counterterrorist: '#3aa8ff',
} as const;

/** how the stage the character is drawn in tone maps: the menu stages use aces, the world the map's grade */
export type CharacterToneMap = 'aces' | 'grade';

/** team light glow as the menu stages draw it (TEAM_LIGHT at this strength, then aces) */
export const TEAM_GLOW_STRENGTH = 3.2;

/**
 * the team light in the world. aces turns the bright t orange pale gold, the
 * grade's neutral tone map keeps it orange and washes it to peach, so the world
 * gets a yellower, slightly stronger light that grades to the menu's look
 * (within a few levels on every map's grade). ct already reads the same blue
 */
export const WORLD_TEAM_LIGHT: Record<keyof typeof TEAM_LIGHT, { color: string; strength: number }> = {
  terrorist: { color: '#ffde42', strength: 3.55 },
  counterterrorist: { color: TEAM_LIGHT.counterterrorist, strength: TEAM_GLOW_STRENGTH },
};

export interface Swatch {
  name: string;
  hex: string;
}

/** paint swatches for the colour pickers; any #rrggbb is still allowed */
export const SWATCHES: readonly Swatch[] = [
  { name: 'Bone', hex: '#e4ddcf' },
  { name: 'Ash', hex: '#b9bcc0' },
  { name: 'Steel', hex: '#8a949f' },
  { name: 'Gunmetal', hex: '#4a4f57' },
  { name: 'Graphite', hex: '#2b2e33' },
  { name: 'Void', hex: '#141518' },
  { name: 'Sand', hex: '#c2a67a' },
  { name: 'Khaki', hex: '#8f8161' },
  { name: 'Umber', hex: '#6b4a33' },
  { name: 'Olive', hex: '#556043' },
  { name: 'Moss', hex: '#3d4a2f' },
  { name: 'Sage', hex: '#8fa28a' },
  { name: 'Navy', hex: '#26334a' },
  { name: 'Cobalt', hex: '#2f5fa8' },
  { name: 'Glacier', hex: '#9cc4d8' },
  { name: 'Teal', hex: '#1f8a86' },
  { name: 'Crimson', hex: '#9e2231' },
  { name: 'Rust', hex: '#a4502a' },
  { name: 'Amber', hex: '#e59a2f' },
  { name: 'Gold', hex: '#c9a43c' },
  { name: 'Lime', hex: '#8cc63f' },
  { name: 'Violet', hex: '#5d3f8f' },
  { name: 'Rose', hex: '#c46a82' },
  { name: 'Signal', hex: '#e8e23a' },
];
