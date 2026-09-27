import type { WeaponDef } from '../../combat/weapons';

export type MapType = 'surf' | 'bhop' | 'aim' | 'training' | 'practice';

export const MAP_TYPE_LABEL: Record<MapType, string> = {
  surf: 'Surf',
  bhop: 'Bhop',
  aim: 'Aim',
  training: 'Training',
  practice: 'Practice',
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
