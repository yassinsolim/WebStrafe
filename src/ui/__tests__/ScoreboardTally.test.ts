import { describe, expect, it } from 'vitest';
import { ScoreboardTally, isBotId } from '../hud/ScoreboardTally';

const players = [
  { id: 'me', name: 'Yassin' },
  { id: 'bot:1', name: 'Bot Alpha', alive: false },
  { id: 'p2', name: 'Guest' },
];

describe('ScoreboardTally', () => {
  it('counts kills for the killer and deaths for the victim', () => {
    const tally = new ScoreboardTally();
    tally.recordDeath({ killerId: 'me', victimId: 'bot:1' });
    tally.recordDeath({ killerId: 'me', victimId: 'bot:1' });
    tally.recordDeath({ killerId: 'bot:1', victimId: 'me' });
    expect(tally.getScore('me')).toEqual({ kills: 2, deaths: 1 });
    expect(tally.getScore('bot:1')).toEqual({ kills: 1, deaths: 2 });
    expect(tally.getScore('p2')).toEqual({ kills: 0, deaths: 0 });
  });

  it('gives no kill for a suicide or world death', () => {
    const tally = new ScoreboardTally();
    tally.recordDeath({ killerId: 'me', victimId: 'me' });
    tally.recordDeath({ killerId: '', victimId: 'p2' });
    expect(tally.getScore('me')).toEqual({ kills: 0, deaths: 1 });
    expect(tally.getScore('p2')).toEqual({ kills: 0, deaths: 1 });
  });

  it('sorts by kills then deaths and marks the local player and bots', () => {
    const tally = new ScoreboardTally();
    tally.recordDeath({ killerId: 'p2', victimId: 'bot:1' });
    tally.recordDeath({ killerId: 'me', victimId: 'bot:1' });
    tally.recordDeath({ killerId: 'bot:1', victimId: 'p2' });
    const rows = tally.rows(players, 'me', 31.6);
    expect(rows.map((row) => row.id)).toEqual(['me', 'p2', 'bot:1']);
    expect(rows[0]).toMatchObject({ isLocal: true, pingMs: 32, kills: 1, deaths: 0 });
    expect(rows[1]).toMatchObject({ isLocal: false, pingMs: null });
    expect(rows[2]).toMatchObject({ isBot: true, alive: false });
  });

  it('only lists players in the snapshot, once each', () => {
    const tally = new ScoreboardTally();
    tally.recordDeath({ killerId: 'gone', victimId: 'me' });
    const rows = tally.rows([...players, { id: 'me', name: 'dup' }], 'me');
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.id === 'gone')).toBeUndefined();
  });

  it('starts over on reset', () => {
    const tally = new ScoreboardTally();
    tally.recordDeath({ killerId: 'me', victimId: 'p2' });
    tally.reset();
    expect(tally.getScore('me')).toEqual({ kills: 0, deaths: 0 });
  });

  it('recognises bot ids', () => {
    expect(isBotId('bot:3')).toBe(true);
    expect(isBotId('robot')).toBe(false);
  });
});
