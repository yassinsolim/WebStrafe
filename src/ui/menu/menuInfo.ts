import type { WeaponDef } from '../../combat/weapons';

export type MapType = 'surf' | 'bhop' | 'aim' | 'training' | 'practice';

export const MAP_TYPE_LABEL: Record<MapType, string> = {
  surf: 'Surf',
  bhop: 'Bhop',
  aim: 'Aim',
  training: 'Training',
  practice: 'Practice',
};

/** one line about what you do on each kind of map */
export const MAP_TYPE_BLURB: Record<MapType, string> = {
  surf: 'Ride the ramps from start to finish. Finished runs can go on the leaderboard.',
  bhop: 'Chain hops across the course to the finish. Finished runs can go on the leaderboard.',
  aim: 'An open arena built for gunfights.',
  training: 'A course for practising movement.',
  practice: 'A range for trying out movement and weapons.',
};

/** map type from the usual community prefixes: surf_, bhop_, aim_ */
export function mapTypeFromId(id: string): MapType {
  const lower = id.toLowerCase();
  if (lower.startsWith('surf_')) return 'surf';
  if (lower.startsWith('bhop_')) return 'bhop';
  if (lower.startsWith('aim_')) return 'aim';
  if (lower.startsWith('training_')) return 'training';
  return 'practice';
}

/** timed maps: surf and bhop always, anything else when it has a finish */
export function showsRunTimer(mapId: string, hasFinish: boolean): boolean {
  const type = mapTypeFromId(mapId);
  return type === 'surf' || type === 'bhop' || hasFinish;
}

/** stable 0..359 hue per map id for the placeholder card art */
export function mapHue(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 360;
}

export interface MapPalette {
  /** solid accent for bars, badges and lines */
  accent: string;
  /** translucent version for glows */
  glow: string;
}

// picked from each built-in map's own art
const MAP_PALETTES: Record<string, MapPalette> = {
  surf_prismline: { accent: '#46d5ff', glow: 'rgba(70, 213, 255, 0.34)' },
  bhop_emberdrift: { accent: '#ff6a2b', glow: 'rgba(255, 106, 43, 0.36)' },
  aim_ochrecut: { accent: '#e9a54f', glow: 'rgba(233, 165, 79, 0.34)' },
  movement_test_scene: { accent: '#ffc53d', glow: 'rgba(255, 197, 61, 0.3)' },
};

/** loading screen colours: hand picked for the built-in maps, from the map hue otherwise */
export function mapPalette(id: string): MapPalette {
  const known = MAP_PALETTES[id];
  if (known) {
    return known;
  }
  const hue = mapHue(id);
  return { accent: `hsl(${hue} 85% 62%)`, glow: `hsl(${hue} 85% 55% / 0.32)` };
}

export interface WeaponStatLine {
  label: string;
  value: string;
  /** 0..1 bar fill */
  fraction: number;
}

const STAT_SCALE = {
  damage: 200,
  rpm: 300,
  magazine: 30,
  reloadSec: 5,
};

/** key numbers from weapons.ts for the loadout cards */
export function firearmStats(def: WeaponDef): WeaponStatLine[] {
  const headshot = Math.floor(def.damage * def.headshotMultiplier);
  const rpm = def.fireIntervalMs > 0 ? Math.round(60000 / def.fireIntervalMs) : 0;
  const reloadSec = def.reloadMs / 1000;
  const bar = (value: number, scale: number) => Math.max(0.04, Math.min(1, value / scale));
  return [
    { label: 'Damage', value: String(def.damage), fraction: bar(def.damage, STAT_SCALE.damage) },
    { label: 'Headshot', value: String(headshot), fraction: bar(headshot, STAT_SCALE.damage) },
    { label: 'Fire rate', value: `${rpm} rpm`, fraction: bar(rpm, STAT_SCALE.rpm) },
    { label: 'Magazine', value: String(def.magazine), fraction: bar(def.magazine, STAT_SCALE.magazine) },
    { label: 'Reload', value: `${reloadSec.toFixed(1)} s`, fraction: bar(STAT_SCALE.reloadSec - reloadSec, STAT_SCALE.reloadSec) },
  ];
}

/** display names stay short like the killfeed: AWP, Deagle */
export function weaponDisplayName(weaponId: string, knifeName = 'Knife'): string {
  if (weaponId === 'awp') return 'AWP';
  if (weaponId === 'deagle') return 'Deagle';
  if (weaponId === 'knife') return knifeName;
  return weaponId;
}
