import type { Vector3 } from 'three';
import { KnifeController } from './KnifeController';
import { KNIFE_RANGE_M, KNIFE_SWEEP_RADIUS_M, type KnifeAttack } from './knives';
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
 * Client-side knife gate with the authority's CS cooldowns. The swing is
 * predicted against what is drawn on screen with the same resolver the server
 * uses, so the longer cooldown after a hit (0.5 / 1.1 s) lines up with the
 * server's; a server hit on a swing we guessed as a miss corrects it.
 */
export class LocalKnife {
  private readonly timing = new KnifeController();
  private last: { kind: KnifeAttack; atMs: number; predictedHit: boolean } | null = null;

  canAttack(kind: KnifeAttack, nowMs: number): boolean {
    return this.timing.canAttack(kind, nowMs);
  }

  tryAttack(kind: KnifeAttack, nowMs: number, swing: LocalKnifeSwing): LocalKnifeResult {
    if (!this.timing.canAttack(kind, nowMs)) {
      return REJECTED;
    }
    const hit = resolveMeleeHit(
      {
        origin: swing.origin,
        direction: swing.direction,
        range: KNIFE_RANGE_M[kind],
        radius: KNIFE_SWEEP_RADIUS_M,
      },
      swing.targets,
      swing.isBlocked,
    );
    this.timing.commit(kind, nowMs, hit !== null);
    this.last = { kind, atMs: nowMs, predictedHit: hit !== null };
    return { accepted: true, predictedHit: hit !== null, predictedTargetId: hit?.targetId ?? null };
  }

  /** the authority confirmed a knife hit from us: re-time the last swing as a hit */
  onServerHit(kind: KnifeAttack): void {
    if (!this.last || this.last.kind !== kind || this.last.predictedHit) {
      return;
    }
    this.last.predictedHit = true;
    this.timing.commit(kind, this.last.atMs, true);
  }

  reset(): void {
    this.timing.reset();
    this.last = null;
  }
}
