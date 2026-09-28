import { describe, expect, it } from 'vitest';
import { CombatArena } from '../CombatArena';

const eye: [number, number, number] = [0, 1.6, 0];
const ahead: [number, number, number] = [0, 0, -1];

function duel(attackerPvp: boolean, victimPvp: boolean, weapon: 'knife' | 'deagle' = 'knife'): CombatArena {
  const arena = new CombatArena();
  arena.addPlayer('attacker', 'map', weapon);
  arena.addPlayer('victim', 'map', 'knife');
  arena.setPosition('attacker', [0, 0, 0], 'map', 1000, [0, 0, 0], 0);
  arena.setPosition('victim', [0, 0, weapon === 'knife' ? -1.2 : -6], 'map', 1000, [0, 0, 0], Math.PI);
  arena.setPvp('attacker', attackerPvp);
  arena.setPvp('victim', victimPvp);
  return arena;
}

describe('pvp opt-in', () => {
  it('is on by default, so bots and the ws server keep their old behaviour', () => {
    const arena = new CombatArena();
    arena.addPlayer('a', 'map');
    expect(arena.isPvp('a')).toBe(true);
    expect(arena.isPvp('nobody')).toBe(false);
  });

  it.each([
    [true, true, true],
    [true, false, false],
    [false, true, false],
    [false, false, false],
  ])('knife: attacker pvp %s, victim pvp %s -> hit %s', (a, v, hits) => {
    const outcome = duel(a, v).handleMelee('attacker', 'primary', eye, ahead, 1000);
    expect(Boolean(outcome.hit)).toBe(hits);
  });

  it.each([
    [true, true, true],
    [true, false, false],
    [false, true, false],
  ])('deagle: attacker pvp %s, victim pvp %s -> hit %s', (a, v, hits) => {
    const arena = duel(a, v, 'deagle');
    const dir: [number, number, number] = [0, (1.2 - 1.6) / 6, -1];
    const len = Math.hypot(...dir);
    const outcome = arena.handleFire('attacker', eye, [dir[0] / len, dir[1] / len, dir[2] / len], 2000);
    expect(outcome.fired).toBe(true);
    expect(Boolean(outcome.hit)).toBe(hits);
  });

  it('a peaceful player keeps full health through a fight around them', () => {
    const arena = duel(true, false);
    for (let i = 0; i < 5; i += 1) {
      arena.handleMelee('attacker', 'secondary', eye, ahead, 1000 + i * 1200);
    }
    expect(arena.getHealth('victim')).toBe(100);
    expect(arena.isAlive('victim')).toBe(true);
  });
});
