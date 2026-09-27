import { KNIFE_TIMING_MS, type KnifeAttack } from './knives';

/**
 * CS knife attack timing (source weapon_knife.cpp, SwingOrStab). A slash locks
 * the next slash for 0.4 s (0.5 s when it hit) and the stab for 0.5 s. A stab
 * locks both attacks for 1.0 s (1.1 s when it hit). A slash that comes within
 * the follow-up window after the slash cooldown ran out deals follow-up damage.
 *
 * Pure and clock agnostic: the server feeds it authority time, the client its
 * own frame time, so both sides gate attacks with the same rules.
 */
export class KnifeController {
  private nextPrimaryAtMs = Number.NEGATIVE_INFINITY;
  private nextSecondaryAtMs = Number.NEGATIVE_INFINITY;

  canAttack(kind: KnifeAttack, nowMs: number): boolean {
    return nowMs >= this.getNextAttackAtMs(kind);
  }

  getNextAttackAtMs(kind: KnifeAttack): number {
    return kind === 'primary' ? this.nextPrimaryAtMs : this.nextSecondaryAtMs;
  }

  /** true when a slash at `nowMs` would deal the reduced follow-up damage */
  isFollowUp(nowMs: number): boolean {
    return nowMs < this.nextPrimaryAtMs + KNIFE_TIMING_MS.followUpWindow;
  }

  /** records an accepted attack once it is known whether it connected */
  commit(kind: KnifeAttack, nowMs: number, hit: boolean): void {
    if (kind === 'primary') {
      this.nextPrimaryAtMs = nowMs + (hit ? KNIFE_TIMING_MS.primaryIntervalHit : KNIFE_TIMING_MS.primaryInterval);
      this.nextSecondaryAtMs = nowMs + KNIFE_TIMING_MS.secondaryAfterPrimary;
      return;
    }
    const lock = hit ? KNIFE_TIMING_MS.secondaryIntervalHit : KNIFE_TIMING_MS.secondaryInterval;
    this.nextPrimaryAtMs = nowMs + lock;
    this.nextSecondaryAtMs = nowMs + lock;
  }

  reset(): void {
    this.nextPrimaryAtMs = Number.NEGATIVE_INFINITY;
    this.nextSecondaryAtMs = Number.NEGATIVE_INFINITY;
  }
}
