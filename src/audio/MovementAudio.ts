import { footstepIntensity, footstepInterval, landingIntensity } from './audioMath';

export interface MovementAudioSample {
  grounded: boolean;
  surfing: boolean;
  velocity: { x: number; y: number; z: number };
  position: { x: number; y: number; z: number };
}

export type MovementAudioEvent =
  | { kind: 'footstep'; intensity: number; foot: 0 | 1 }
  | { kind: 'jump' }
  | { kind: 'land'; intensity: number; withJump: boolean };

export interface MovementAudioConfig {
  /** below this horizontal speed the player is standing, m/s */
  footstepMinSpeed: number;
  /** downward speed needed for a landing sound, m/s */
  landMinFallSpeed: number;
  /** a jump sets at least this upward speed, m/s */
  jumpMinUpSpeed: number;
  /** and raises vertical speed at least this much in one sample, m/s */
  jumpMinDeltaV: number;
  /** position jumps bigger than this (beyond what velocity explains) are teleports */
  teleportSlack: number;
  /** time from standing still to the first step once moving, s */
  firstStepDelay: number;
}

export const DEFAULT_MOVEMENT_AUDIO_CONFIG: MovementAudioConfig = {
  footstepMinSpeed: 2,
  landMinFallSpeed: 2.2,
  jumpMinUpSpeed: 3,
  jumpMinDeltaV: 2.5,
  teleportSlack: 3,
  firstStepDelay: 0.18,
};

interface PreviousSample {
  grounded: boolean;
  surfing: boolean;
  vy: number;
  speed: number;
  x: number;
  y: number;
  z: number;
}

/**
 * Derives footstep, jump and land events from per-frame movement state.
 * Works on frame samples (not ticks): a bhop that lands and jumps between two
 * frames shows up as a big upward change in vertical speed, which reports the
 * landing and the jump together.
 */
export class MovementAudioTracker {
  private readonly config: MovementAudioConfig;
  private prev: PreviousSample | null = null;
  private stepTimer = 0;
  private foot: 0 | 1 = 0;

  constructor(config: Partial<MovementAudioConfig> = {}) {
    this.config = { ...DEFAULT_MOVEMENT_AUDIO_CONFIG, ...config };
    this.stepTimer = this.firstStepTimer();
  }

  /** forget history, call after respawns and teleports */
  reset(): void {
    this.prev = null;
    this.stepTimer = this.firstStepTimer();
  }

  update(sample: MovementAudioSample, dtSec: number): MovementAudioEvent[] {
    const dt = Math.max(0, Math.min(0.25, Number.isFinite(dtSec) ? dtSec : 0));
    const { x, y, z } = sample.position;
    const vx = sample.velocity.x;
    const vy = sample.velocity.y;
    const vz = sample.velocity.z;
    const horizontal = Math.hypot(vx, vz);
    const speed = Math.hypot(vx, vy, vz);
    const prev = this.prev;
    this.prev = { grounded: sample.grounded, surfing: sample.surfing, vy, speed, x, y, z };
    if (!prev) {
      return [];
    }

    const moved = Math.hypot(x - prev.x, y - prev.y, z - prev.z);
    const explained = Math.max(speed, prev.speed) * dt;
    if (moved > explained + this.config.teleportSlack) {
      this.stepTimer = this.firstStepTimer();
      return [];
    }

    const events: MovementAudioEvent[] = [];
    const wasAirborne = !prev.grounded && !prev.surfing;
    const jumped = !sample.surfing
      && vy >= this.config.jumpMinUpSpeed
      && vy - prev.vy >= this.config.jumpMinDeltaV;

    if (jumped) {
      if (wasAirborne && prev.vy <= -this.config.landMinFallSpeed) {
        events.push({ kind: 'land', intensity: landingIntensity(-prev.vy), withJump: true });
      }
      events.push({ kind: 'jump' });
      this.stepTimer = 0;
    } else if (wasAirborne && sample.grounded && prev.vy <= -this.config.landMinFallSpeed) {
      events.push({ kind: 'land', intensity: landingIntensity(-prev.vy), withJump: false });
      this.stepTimer = 0;
    }

    const onFoot = sample.grounded && !sample.surfing;
    if (onFoot && !jumped && horizontal >= this.config.footstepMinSpeed) {
      this.stepTimer += dt;
      const interval = footstepInterval(horizontal);
      if (this.stepTimer >= interval) {
        this.stepTimer = Math.min(this.stepTimer - interval, interval * 0.5);
        this.foot = this.foot === 0 ? 1 : 0;
        events.push({ kind: 'footstep', intensity: footstepIntensity(horizontal), foot: this.foot });
      }
    } else if (onFoot && !jumped) {
      this.stepTimer = this.firstStepTimer();
    } else if (!onFoot) {
      this.stepTimer = 0;
    }
    return events;
  }

  private firstStepTimer(): number {
    // primed so the first step lands `firstStepDelay` after starting to run
    return Math.max(0, footstepInterval(6.35) - this.config.firstStepDelay);
  }
}
