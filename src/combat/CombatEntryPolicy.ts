/**
 * A quick pointer-lock pause must never become a mid-fight heal. A player may
 * receive a clean authoritative re-entry only after both the menu pause and
 * their latest combat activity have been quiet for this interval.
 */
export const CLEAN_REENTRY_IDLE_MS = 8_000;

export interface CombatEntryState {
  alive: boolean;
  pausedAtMs: number | null;
  lastCombatAtMs: number;
  nowMs: number;
}

export function shouldResetCombatEntry(state: CombatEntryState): boolean {
  if (!state.alive) {
    return true;
  }
  if (state.pausedAtMs === null) {
    return false;
  }
  const quietSinceMs = Math.max(state.pausedAtMs, state.lastCombatAtMs);
  return state.nowMs - quietSinceMs >= CLEAN_REENTRY_IDLE_MS;
}
