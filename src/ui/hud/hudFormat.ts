import type { KillFeedEntry } from '../../combat/KillFeed';
import { weaponDisplayName } from '../menu/menuInfo';
import { weaponIcon, type IconName } from './icons';
import type { ScoreboardRow } from './ScoreboardTally';

/** 1st, 2nd, 3rd, 4th ... 11th, 12th, 13th, 21st */
export function ordinal(n: number): string {
  const value = Math.max(0, Math.round(n));
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) {
    return `${value}th`;
  }
  const suffix = value % 10 === 1 ? 'st' : value % 10 === 2 ? 'nd' : value % 10 === 3 ? 'rd' : 'th';
  return `${value}${suffix}`;
}

export type PingLevel = 'good' | 'ok' | 'bad' | 'none';

export function pingLevel(pingMs: number | null): PingLevel {
  if (pingMs === null || !Number.isFinite(pingMs)) return 'none';
  if (pingMs < 60) return 'good';
  if (pingMs < 120) return 'ok';
  return 'bad';
}

/** scoreboard ping cell: bots have none, remote pings are unknown on this client */
export function formatPing(pingMs: number | null, isBot: boolean): string {
  if (isBot) return 'BOT';
  if (pingMs === null || !Number.isFinite(pingMs)) return 'n/a';
  return String(Math.max(0, Math.round(pingMs)));
}

export interface KillfeedLineView {
  killer: string;
  victim: string;
  icon: IconName;
  weaponLabel: string;
  headshot: boolean;
  /** the local player got the kill */
  isLocalKill: boolean;
  /** the local player died to someone else */
  isLocalDeath: boolean;
  killerIsLocal: boolean;
  victimIsLocal: boolean;
  /** no killer, or the victim killed themselves */
  selfKill: boolean;
  fading: boolean;
}

export function killfeedLineView(entry: KillFeedEntry, nowMs: number, ttlMs: number, fadeMs: number): KillfeedLineView {
  const killerIsLocal = entry.killerIsLocal === true;
  const victimIsLocal = entry.victimIsLocal === true;
  return {
    killer: entry.killer,
    victim: entry.victim,
    icon: weaponIcon(entry.weaponId),
    weaponLabel: weaponDisplayName(entry.weaponId),
    headshot: entry.headshot,
    isLocalKill: killerIsLocal && !victimIsLocal,
    isLocalDeath: victimIsLocal && !killerIsLocal,
    killerIsLocal,
    victimIsLocal,
    selfKill: !entry.killer || (killerIsLocal && victimIsLocal),
    fading: nowMs - entry.createdAtMs > ttlMs - fadeMs,
  };
}

/** one string per render state so the feed only rebuilds when something changed */
export function killfeedSignature(entries: readonly KillFeedEntry[], nowMs: number, ttlMs: number, fadeMs: number): string {
  return entries
    .map((entry) => `${entry.createdAtMs}${nowMs - entry.createdAtMs > ttlMs - fadeMs ? 'f' : ''}`)
    .join(',');
}

export interface ScoreSummary {
  kills: number;
  deaths: number;
  /** 1 based, players tied on kills share a place */
  place: number;
  playerCount: number;
  /** best player that is not you */
  rival: { name: string; kills: number; isBot: boolean } | null;
  /** you have strictly more kills than everyone else */
  leading: boolean;
}

/**
 * Top bar numbers. `rows` is the sorted scoreboard (may miss the local player
 * before the first snapshot), `local` is the local tally.
 */
export function scoreSummary(
  rows: readonly ScoreboardRow[],
  local: { kills: number; deaths: number },
  localId: string | null,
): ScoreSummary {
  const others = rows.filter((row) => !row.isLocal && row.id !== localId);
  const ahead = others.filter((row) => row.kills > local.kills).length;
  const best = others[0] ?? null;
  return {
    kills: local.kills,
    deaths: local.deaths,
    place: ahead + 1,
    playerCount: others.length + 1,
    rival: best ? { name: best.name, kills: best.kills, isBot: best.isBot } : null,
    leading: others.every((row) => row.kills < local.kills) && local.kills > 0,
  };
}

export type AmmoState = 'melee' | 'reloading' | 'empty' | 'low' | 'ok';

export interface AmmoView {
  state: AmmoState;
  count: string;
  magazine: number;
  /** reloads never run out in this mode, so the reserve is unlimited */
  unlimitedReserve: boolean;
  hint: string;
}

export function ammoView(ammo: number, magazine: number, reloading: boolean, melee: boolean): AmmoView {
  if (melee || !Number.isFinite(ammo) || magazine <= 0) {
    return { state: 'melee', count: '', magazine: 0, unlimitedReserve: false, hint: '' };
  }
  const rounds = Math.max(0, Math.round(ammo));
  const low = rounds <= Math.max(1, Math.floor(magazine * 0.3));
  const state: AmmoState = reloading ? 'reloading' : rounds === 0 ? 'empty' : low ? 'low' : 'ok';
  const hint = state === 'reloading' ? 'Reloading' : state === 'empty' ? 'Press R to reload' : '';
  return { state, count: String(rounds), magazine, unlimitedReserve: true, hint };
}
