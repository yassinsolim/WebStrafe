export type KnifeAttackPresentation = 'primary' | 'secondary';
export type KnifePresentationPhase = 'idle' | 'equip' | KnifeAttackPresentation;

export interface KnifePresentationSnapshot {
  phase: KnifePresentationPhase;
  progress: number;
  position: readonly [x: number, y: number, z: number];
  rotation: readonly [pitch: number, yaw: number, roll: number];
}

export const KNIFE_EQUIP_DURATION_SEC = 0.34;

const IDLE_SNAPSHOT: KnifePresentationSnapshot = {
  phase: 'idle',
  progress: 1,
  position: [0, 0, 0],
  rotation: [0, 0, 0],
};

/**
 * Deterministic, presentation-only motion layered around the authored knife
 * clips. Every action starts and ends at a neutral delta, so baked animation
 * playback remains authoritative and recovery cannot snap.
 */
export class KnifePresentationMotion {
  private phase: KnifePresentationPhase = 'idle';
  private elapsedSec = 0;
  private durationSec = 0;

  public triggerEquip(durationSec = KNIFE_EQUIP_DURATION_SEC): void {
    this.begin('equip', durationSec);
  }

  public triggerAttack(kind: KnifeAttackPresentation, clipDurationSec: number): void {
    this.begin(kind, clipDurationSec);
  }

  public reset(): void {
    this.phase = 'idle';
    this.elapsedSec = 0;
    this.durationSec = 0;
  }

  public update(dtSec: number): KnifePresentationSnapshot {
    if (this.phase === 'idle') {
      return IDLE_SNAPSHOT;
    }
    const dt = Number.isFinite(dtSec) ? Math.max(0, dtSec) : 0;
    this.elapsedSec = Math.min(this.durationSec, this.elapsedSec + dt);
    if (this.elapsedSec >= this.durationSec) {
      this.reset();
      return IDLE_SNAPSHOT;
    }
    return this.sample();
  }

  public sample(): KnifePresentationSnapshot {
    if (this.phase === 'idle' || this.durationSec <= 0) {
      return IDLE_SNAPSHOT;
    }
    const progress = Math.min(1, this.elapsedSec / this.durationSec);
    if (this.phase === 'equip') {
      const remaining = (1 - progress) ** 3;
      return {
        phase: this.phase,
        progress,
        position: [0.05 * remaining, -0.115 * remaining, 0.055 * remaining],
        rotation: [0.11 * remaining, -0.09 * remaining, 0.17 * remaining],
      };
    }

    const envelope = Math.sin(Math.PI * progress);
    if (this.phase === 'primary') {
      return {
        phase: this.phase,
        progress,
        position: [-0.014 * envelope, -0.01 * envelope, 0.018 * envelope],
        rotation: [-0.024 * envelope, -0.04 * envelope, 0.045 * envelope],
      };
    }
    return {
      phase: this.phase,
      progress,
      position: [0.009 * envelope, -0.019 * envelope, 0.026 * envelope],
      rotation: [-0.04 * envelope, 0.05 * envelope, -0.065 * envelope],
    };
  }

  private begin(phase: Exclude<KnifePresentationPhase, 'idle'>, durationSec: number): void {
    this.phase = phase;
    this.elapsedSec = 0;
    this.durationSec = Number.isFinite(durationSec)
      ? Math.max(1e-3, durationSec)
      : 1e-3;
  }
}
