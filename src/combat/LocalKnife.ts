import type { Vector3 } from 'three';
import { KnifeController } from './KnifeController';
import { KNIFE_MELEE, type KnifeAttack, type MeleeStats } from './knives';
import { resolveMeleeHit, type MeleeTarget, type SegmentBlocked } from './MeleeResolver';

export interface LocalKnifeSwing {
  origin: Vector3;
  direction: Vector3;
  /** remote players as they are drawn right now */
  targets: readonly MeleeTarget[];
  isBlocked?: SegmentBlocked;
}

export interface LocalKnifeResult {
  accepted: boolean;
  /** local guess only; the authority decides damage */
  predictedHit: boolean;
  predictedTargetId: string | null;
}

const REJECTED: LocalKnifeResult = { accepted: false, predictedHit: false, predictedTargetId: null };

/**
 * Client-side melee gate with the authority's CS cooldowns, for the knife and
 * the katana (pass the held weapon's stats). The swing is predicted against
 * what is drawn on screen with the same resolver the server uses, so the
 * longer cooldown after a hit lines up with the server's; a server hit on a
 * swing we guessed as a miss corrects it.
 */
export class LocalKnife {
  private readonly timing = new KnifeController();
  private last: { kind: KnifeAttack; atMs: number; predictedHit: boolean; stats: MeleeStats } | null = null;

  canAttack(kind: KnifeAttack, nowMs: number): boolean {
    return this.timing.canAttack(kind, nowMs);
  }

  tryAttack(kind: KnifeAttack, nowMs: number, swing: LocalKnifeSwing, stats: MeleeStats = KNIFE_MELEE): LocalKnifeResult {
    if (!this.timing.canAttack(kind, nowMs)) {
      return REJECTED;
    }
    const hit = resolveMeleeHit(
      {
        origin: swing.origin,
        direction: swing.direction,
        range: stats.range[kind],
        radius: stats.sweepRadius,
      },
      swing.targets,
      swing.isBlocked,
    );
    this.timing.commit(kind, nowMs, hit !== null, stats.timing);
    this.last = { kind, atMs: nowMs, predictedHit: hit !== null, stats };
    return { accepted: true, predictedHit: hit !== null, predictedTargetId: hit?.targetId ?? null };
  }

  /** the authority confirmed a melee hit from us: re-time the last swing as a hit */
  onServerHit(kind: KnifeAttack): void {
    if (!this.last || this.last.kind !== kind || this.last.predictedHit) {
      return;
    }
    this.last.predictedHit = true;
    this.timing.commit(kind, this.last.atMs, true, this.last.stats.timing);
  }

  reset(): void {
    this.timing.reset();
    this.last = null;
  }
}
