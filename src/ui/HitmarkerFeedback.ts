export type HitmarkerKind = 'normal' | 'headshot' | 'kill';
export type HitmarkerTrigger = HitmarkerKind | 'lethal-headshot';

export interface HitmarkerSnapshot {
  active: boolean;
  kind: HitmarkerKind;
  sequence: number;
  chainCount: number;
  expiresAtMs: number;
  queuedKind: HitmarkerKind | null;
  phaseEndsAtMs: number;
}

const DURATION_MS: Readonly<Record<HitmarkerKind, number>> = {
  normal: 520,
  headshot: 620,
  kill: 720,
};
export const LETHAL_HEADSHOT_PHASE_MS = 480;

export interface HitConfirmationPlan {
  visual: HitmarkerTrigger;
  audio: HitmarkerKind;
}

/** Maps one authoritative hit to exactly one audio cue and its visual sequence. */
export function planHitConfirmation(
  hitbox: 'body' | 'head',
  killed: boolean,
): HitConfirmationPlan {
  if (hitbox === 'head' && killed) {
    return { visual: 'lethal-headshot', audio: 'headshot' };
  }
  const kind: HitmarkerKind = hitbox === 'head' ? 'headshot' : killed ? 'kill' : 'normal';
  return { visual: kind, audio: kind };
}

/** Deterministic state machine used by the DOM HUD and unit tests. */
export class HitmarkerFeedback {
  private snapshot: HitmarkerSnapshot = {
    active: false,
    kind: 'normal',
    sequence: 0,
    chainCount: 0,
    expiresAtMs: 0,
    queuedKind: null,
    phaseEndsAtMs: 0,
  };

  public trigger(trigger: HitmarkerTrigger, nowMs: number): HitmarkerSnapshot {
    const chained = this.snapshot.active && nowMs < this.snapshot.expiresAtMs;
    const lethalHeadshot = trigger === 'lethal-headshot';
    const kind: HitmarkerKind = lethalHeadshot ? 'headshot' : trigger;
    const phaseEndsAtMs = nowMs
      + (lethalHeadshot ? LETHAL_HEADSHOT_PHASE_MS : DURATION_MS[kind]);
    this.snapshot = {
      active: true,
      kind,
      sequence: this.snapshot.sequence + 1,
      chainCount: chained ? Math.min(3, this.snapshot.chainCount + 1) : 1,
      expiresAtMs: lethalHeadshot
        ? phaseEndsAtMs + DURATION_MS.kill
        : phaseEndsAtMs,
      queuedKind: lethalHeadshot ? 'kill' : null,
      phaseEndsAtMs,
    };
    return this.get(nowMs);
  }

  public get(nowMs: number): HitmarkerSnapshot {
    if (!this.snapshot.active) {
      return { ...this.snapshot };
    }
    if (nowMs >= this.snapshot.expiresAtMs) {
      this.snapshot = {
        ...this.snapshot,
        active: false,
        chainCount: 0,
        queuedKind: null,
        phaseEndsAtMs: this.snapshot.expiresAtMs,
      };
    } else if (
      this.snapshot.queuedKind !== null
      && nowMs >= this.snapshot.phaseEndsAtMs
    ) {
      this.snapshot = {
        ...this.snapshot,
        kind: this.snapshot.queuedKind,
        queuedKind: null,
        phaseEndsAtMs: this.snapshot.expiresAtMs,
        sequence: this.snapshot.sequence + 1,
      };
    }
    return { ...this.snapshot };
  }

  public clear(): HitmarkerSnapshot {
    this.snapshot = {
      active: false,
      kind: 'normal',
      sequence: this.snapshot.sequence + 1,
      chainCount: 0,
      expiresAtMs: 0,
      queuedKind: null,
      phaseEndsAtMs: 0,
    };
    return { ...this.snapshot };
  }
}
