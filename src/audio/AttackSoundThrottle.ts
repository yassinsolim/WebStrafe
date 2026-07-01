/**
 * Per-player throttle for remote attack sounds. A remote player (or a bot)
 * sending attacks faster than a human can swing would otherwise machine-gun the
 * knife-swing SFX on every other client. This caps how often each player's
 * attack sound is allowed to play, keyed by player id. Pure and deterministic —
 * time is passed in — so it is unit-testable.
 */
export class AttackSoundThrottle {
  private readonly lastPlayedMs = new Map<string, number>();

  constructor(private readonly minIntervalMs = 110) {}

  /**
   * Returns true if this player's attack sound may play now, recording the time.
   * Returns false (and records nothing) if it is still within the cooldown.
   */
  shouldPlay(playerId: string, nowMs: number): boolean {
    const last = this.lastPlayedMs.get(playerId);
    if (last !== undefined && nowMs - last < this.minIntervalMs) {
      return false;
    }
    this.lastPlayedMs.set(playerId, nowMs);
    return true;
  }

  /** Drops a player's history (e.g. on disconnect) to bound memory. */
  forget(playerId: string): void {
    this.lastPlayedMs.delete(playerId);
  }
}
