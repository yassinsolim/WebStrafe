import { describe, expect, it } from 'vitest';
import type { KillFeedEntry } from '../../combat/KillFeed';
import {
  ammoView,
  formatPing,
  killfeedLineView,
  killfeedSignature,
  ordinal,
  pingLevel,
  scoreSummary,
} from '../hud/hudFormat';
import { ScoreboardTally } from '../hud/ScoreboardTally';

const entry = (overrides: Partial<KillFeedEntry> = {}): KillFeedEntry => ({
  killer: 'Nova',
  victim: 'kestrel',
  weaponId: 'awp',
  headshot: false,
  createdAtMs: 1000,
  ...overrides,
});

describe('ordinal', () => {
  it('handles the teens and the usual suffixes', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th',
    ]);
  });
});

describe('ping', () => {
  it('labels bots and unknown pings instead of guessing', () => {
    expect(formatPing(null, true)).toBe('BOT');
    expect(formatPing(null, false)).toBe('n/a');
    expect(formatPing(Number.NaN, false)).toBe('n/a');
    expect(formatPing(31.6, false)).toBe('32');
  });

  it('buckets ping into levels', () => {
    expect(pingLevel(null)).toBe('none');
    expect(pingLevel(20)).toBe('good');
    expect(pingLevel(90)).toBe('ok');
    expect(pingLevel(200)).toBe('bad');
  });
});

describe('killfeed lines', () => {
  it('marks local kills and local deaths', () => {
    const kill = killfeedLineView(entry({ killer: 'me', killerIsLocal: true, headshot: true }), 1500, 6000, 700);
    expect(kill).toMatchObject({ isLocalKill: true, isLocalDeath: false, headshot: true, icon: 'awp', weaponLabel: 'AWP' });
    const death = killfeedLineView(entry({ victim: 'me', victimIsLocal: true, weaponId: 'deagle' }), 1500, 6000, 700);
    expect(death).toMatchObject({ isLocalKill: false, isLocalDeath: true, icon: 'deagle', weaponLabel: 'Deagle' });
  });

  it('treats a local suicide as a self kill, not a kill', () => {
    const view = killfeedLineView(entry({ killer: 'me', victim: 'me', killerIsLocal: true, victimIsLocal: true }), 1500, 6000, 700);
    expect(view).toMatchObject({ selfKill: true, isLocalKill: false, isLocalDeath: false });
  });

  it('uses the knife icon for any melee or unknown weapon', () => {
    expect(killfeedLineView(entry({ weaponId: 'knife' }), 1500, 6000, 700).icon).toBe('knife');
    expect(killfeedLineView(entry({ weaponId: 'world' }), 1500, 6000, 700).icon).toBe('knife');
  });

  it('starts fading in the last stretch of its life and the signature changes with it', () => {
    const fresh = killfeedSignature([entry()], 1500, 6000, 700);
    const fading = killfeedSignature([entry()], 1000 + 5400, 6000, 700);
    expect(killfeedLineView(entry(), 1000 + 5400, 6000, 700).fading).toBe(true);
    expect(killfeedLineView(entry(), 1000 + 5200, 6000, 700).fading).toBe(false);
    expect(fresh).not.toBe(fading);
    expect(killfeedSignature([entry()], 1600, 6000, 700)).toBe(fresh);
  });
});

describe('score summary', () => {
  const players = [
    { id: 'me', name: 'Yassin' },
    { id: 'bot:1', name: 'Nova' },
    { id: 'p2', name: 'kestrel' },
  ];

  it('places you behind a better rival and counts everyone', () => {
    const tally = new ScoreboardTally();
    for (let i = 0; i < 3; i += 1) tally.recordDeath({ killerId: 'bot:1', victimId: 'p2' });
    tally.recordDeath({ killerId: 'me', victimId: 'p2' });
    tally.recordDeath({ killerId: 'p2', victimId: 'me' });
    const summary = scoreSummary(tally.rows(players, 'me'), tally.getScore('me'), 'me');
    expect(summary).toEqual({
      kills: 1,
      deaths: 1,
      place: 2,
      playerCount: 3,
      rival: { name: 'Nova', kills: 3, isBot: true },
      leading: false,
    });
  });

  it('leads only with strictly more kills, and shares places on ties', () => {
    const tally = new ScoreboardTally();
    tally.recordDeath({ killerId: 'me', victimId: 'p2' });
    tally.recordDeath({ killerId: 'bot:1', victimId: 'p2' });
    const tied = scoreSummary(tally.rows(players, 'me'), tally.getScore('me'), 'me');
    expect(tied).toMatchObject({ place: 1, leading: false });
    tally.recordDeath({ killerId: 'me', victimId: 'bot:1' });
    const ahead = scoreSummary(tally.rows(players, 'me'), tally.getScore('me'), 'me');
    expect(ahead).toMatchObject({ place: 1, leading: true, rival: { name: 'Nova', kills: 1 } });
  });

  it('works before the first snapshot lists you', () => {
    const summary = scoreSummary([], { kills: 0, deaths: 0 }, 'me');
    expect(summary).toEqual({ kills: 0, deaths: 0, place: 1, playerCount: 1, rival: null, leading: false });
  });
});

describe('ammo view', () => {
  it('reports melee without numbers', () => {
    expect(ammoView(Number.POSITIVE_INFINITY, 0, false, true)).toMatchObject({ state: 'melee', count: '' });
  });

  it('walks through ok, low, empty and reloading', () => {
    expect(ammoView(7, 7, false, false)).toMatchObject({ state: 'ok', count: '7', unlimitedReserve: true, hint: '' });
    expect(ammoView(2, 7, false, false).state).toBe('low');
    expect(ammoView(0, 7, false, false)).toMatchObject({ state: 'empty', hint: 'Press R to reload' });
    expect(ammoView(0, 7, true, false)).toMatchObject({ state: 'reloading', hint: 'Reloading' });
    // one round left in a 10 round awp magazine is low, three is too
    expect(ammoView(3, 10, false, false).state).toBe('low');
    expect(ammoView(4, 10, false, false).state).toBe('ok');
  });
});
