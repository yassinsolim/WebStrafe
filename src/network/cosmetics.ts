import { isKnifeId, type KnifeId } from '../combat/knives';

/**
 * optional per-player cosmetics, the one field every transport carries for
 * them (presence in supabase, join/snapshot rows on the ws server). knives and
 * finishes live under `knife`; character and armour choices under `armor`.
 * anything missing or malformed is dropped, never guessed.
 */
export interface KnifeCosmetic {
  id: KnifeId;
  /** finish id from the finish catalog, 'vanilla' when absent */
  finish?: string;
  /** cs style float, 0 (factory new) to 1 (battle-scarred) */
  wear?: number;
  /** pattern seed 0..999 */
  seed?: number;
}

export interface PlayerCosmetics {
  knife?: KnifeCosmetic;
  /** slot -> item id, owned by the character customisation work */
  armor?: Record<string, string>;
}

/** compact wire form */
export interface WireCosmetics {
  k?: string;
  f?: string;
  w?: number;
  s?: number;
  a?: Record<string, string>;
}

const TOKEN = /^[a-z0-9_-]{1,32}$/;
const MAX_ARMOR_SLOTS = 12;

export function encodeCosmetics(c: PlayerCosmetics | null | undefined): WireCosmetics | undefined {
  if (!c) return undefined;
  const out: WireCosmetics = {};
  if (c.knife) {
    out.k = c.knife.id;
    if (c.knife.finish && c.knife.finish !== 'vanilla') out.f = c.knife.finish;
    if (c.knife.wear !== undefined) out.w = Math.round(clamp01(c.knife.wear) * 1000) / 1000;
    if (c.knife.seed !== undefined) out.s = Math.round(c.knife.seed);
  }
  if (c.armor && Object.keys(c.armor).length > 0) out.a = { ...c.armor };
  return Object.keys(out).length > 0 ? out : undefined;
}

export function decodeCosmetics(raw: unknown): PlayerCosmetics | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const w = raw as Record<string, unknown>;
  const out: PlayerCosmetics = {};
  if (isKnifeId(w.k)) {
    const knife: KnifeCosmetic = { id: w.k };
    if (typeof w.f === 'string' && TOKEN.test(w.f)) knife.finish = w.f;
    if (typeof w.w === 'number' && Number.isFinite(w.w)) knife.wear = clamp01(w.w);
    if (typeof w.s === 'number' && Number.isInteger(w.s) && w.s >= 0 && w.s <= 999) knife.seed = w.s;
    out.knife = knife;
  }
  if (w.a && typeof w.a === 'object') {
    const armor: Record<string, string> = {};
    for (const [slot, item] of Object.entries(w.a as Record<string, unknown>).slice(0, MAX_ARMOR_SLOTS)) {
      if (TOKEN.test(slot) && typeof item === 'string' && TOKEN.test(item)) armor[slot] = item;
    }
    if (Object.keys(armor).length > 0) out.armor = armor;
  }
  return out.knife || out.armor ? out : undefined;
}

export function sameCosmetics(a: PlayerCosmetics | undefined, b: PlayerCosmetics | undefined): boolean {
  return JSON.stringify(encodeCosmetics(a) ?? null) === JSON.stringify(encodeCosmetics(b) ?? null);
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
