import { describe, expect, it } from 'vitest';
import {
  CLEAN_REENTRY_IDLE_MS,
  shouldResetCombatEntry,
} from '../CombatEntryPolicy';

describe('shouldResetCombatEntry', () => {
  it('always permits an authoritative clean entry for a dead player', () => {
    expect(shouldResetCombatEntry({
      alive: false,
      pausedAtMs: 9_999,
      lastCombatAtMs: 9_999,
      nowMs: 10_000,
    })).toBe(true);
  });

  it('does not turn a quick mid-fight menu pause into a heal', () => {
    expect(shouldResetCombatEntry({
      alive: true,
      pausedAtMs: 10_000,
      lastCombatAtMs: 10_100,
      nowMs: 10_100 + CLEAN_REENTRY_IDLE_MS - 1,
    })).toBe(false);
  });

  it('allows a clean re-entry only after pause and combat are both stale', () => {
    expect(shouldResetCombatEntry({
      alive: true,
      pausedAtMs: 1_000,
      lastCombatAtMs: 2_000,
      nowMs: 2_000 + CLEAN_REENTRY_IDLE_MS,
    })).toBe(true);
  });
});
