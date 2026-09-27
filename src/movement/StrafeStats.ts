import type { MovementMode } from './types';

/** consecutive ground ticks without a jump before the bhop chain resets */
export const CHAIN_BREAK_GROUND_TICKS = 2;

const YAW_EPS = 1e-9;
const SPEED_EPS = 1e-9;

/**
 * stats for one jump. a jump starts on the takeoff tick (the tick the jump
 * impulse is applied) and ends on the first tick that starts on walkable ground
 * without jumping (landing) or on the next takeoff, whichever comes first.
 * speeds are horizontal, in m/s.
 */
export interface JumpStats {
  /** 1-based index of this jump in the current chain */
  jump: number;
  /** horizontal speed going into the takeoff tick, before that tick's air accel */
  takeoffSpeed: number;
  /** takeoffSpeed minus the previous jump's takeoffSpeed in this chain, 0 on jump 1 */
  gain: number;
  /**
   * 0..100. only air ticks where the view yaw changed are measured (fps under
   * the 128 hz tick rate leaves some ticks with no new mouse input, those
   * shouldn't read as desync). a measured tick is in sync when a strafe key is
   * held, the yaw turned toward it (right with D, left with A) and horizontal
   * speed went up during the tick. sync = in sync ticks / measured ticks * 100,
   * or 0 when nothing was measured. air ticks are ticks simulated with air
   * accel, including the takeoff tick; surf ticks are skipped.
   */
  sync: number;
  /**
   * strafe segments: +1 each time sideMove's sign switches to a new side during
   * the jump, and the first side held counts as strafe 1. so A, D, A is 3, and
   * letting go of A and pressing A again is still 1.
   */
  strafes: number;
  /** highest horizontal speed at the end of any tick in the jump */
  maxSpeed: number;
  /** air ticks so far (takeoff tick included, surf ticks not) */
  airTicks: number;
}

/**
 * what MovementController.getStrafeStats() returns, a plain object safe to keep.
 * `chain` is how many jumps are in the current chain (0 after it resets),
 * `current` is the jump in progress with live values (null on the ground), and
 * `last` is the most recent finished jump (null until one finishes).
 */
export interface StrafeStats {
  chain: number;
  current: JumpStats | null;
  last: JumpStats | null;
}

export interface StrafeTickSample {
  /** mode the tick accelerated in, after the jump check */
  mode: MovementMode;
  jumped: boolean;
  speedBefore: number;
  speedAfter: number;
  /** view yaw change since the previous tick in radians, positive turns left */
  yawDelta: number;
  sideMove: number;
}

interface JumpInProgress extends JumpStats {
  turnTicks: number;
  syncTicks: number;
  side: number;
}

/**
 * presentation only: it looks at what each tick did and never feeds back into
 * the simulation, so none of this lives in MovementSnapshot.
 */
export class StrafeStatsTracker {
  private chain = 0;
  private current: JumpInProgress | null = null;
  private last: JumpStats | null = null;
  private lastTakeoffSpeed: number | null = null;
  private groundTicks = 0;
  private prevJumped = false;

  public reset(): void {
    this.chain = 0;
    this.current = null;
    this.last = null;
    this.lastTakeoffSpeed = null;
    this.groundTicks = 0;
    this.prevJumped = false;
  }

  public record(sample: StrafeTickSample): void {
    if (sample.jumped) {
      // surf grace can re-apply the impulse a few ticks in a row, that's still one jump
      if (!this.prevJumped) {
        this.takeoff(sample.speedBefore);
      }
      this.groundTicks = 0;
    } else if (sample.mode === 'ground') {
      this.finishJump();
      this.groundTicks += 1;
      if (this.groundTicks > CHAIN_BREAK_GROUND_TICKS) {
        this.chain = 0;
        this.lastTakeoffSpeed = null;
      }
    } else {
      this.groundTicks = 0;
    }
    this.prevJumped = sample.jumped;

    if (this.current && sample.mode === 'air') {
      this.measureAirTick(this.current, sample);
    }
  }

  public getStats(): StrafeStats {
    return {
      chain: this.chain,
      current: this.current ? publicJump(this.current) : null,
      last: this.last ? { ...this.last } : null,
    };
  }

  private takeoff(speed: number): void {
    this.finishJump();
    this.chain += 1;
    const gain = this.lastTakeoffSpeed === null ? 0 : speed - this.lastTakeoffSpeed;
    this.lastTakeoffSpeed = speed;
    this.current = {
      jump: this.chain,
      takeoffSpeed: speed,
      gain,
      sync: 0,
      strafes: 0,
      maxSpeed: speed,
      airTicks: 0,
      turnTicks: 0,
      syncTicks: 0,
      side: 0,
    };
  }

  private finishJump(): void {
    if (this.current) {
      this.last = publicJump(this.current);
      this.current = null;
    }
  }

  private measureAirTick(jump: JumpInProgress, sample: StrafeTickSample): void {
    jump.airTicks += 1;
    jump.maxSpeed = Math.max(jump.maxSpeed, sample.speedAfter);

    const side = Math.sign(sample.sideMove);
    if (side !== 0 && side !== jump.side) {
      jump.strafes += 1;
      jump.side = side;
    }

    if (Math.abs(sample.yawDelta) > YAW_EPS) {
      jump.turnTicks += 1;
      // yaw goes down when turning right, so right strafe (+1) wants a negative delta
      const turnedWithKey = side !== 0 && Math.sign(sample.yawDelta) === -side;
      if (turnedWithKey && sample.speedAfter - sample.speedBefore > SPEED_EPS) {
        jump.syncTicks += 1;
      }
    }
    jump.sync = jump.turnTicks > 0 ? (jump.syncTicks / jump.turnTicks) * 100 : 0;
  }
}

function publicJump(jump: JumpInProgress): JumpStats {
  return {
    jump: jump.jump,
    takeoffSpeed: jump.takeoffSpeed,
    gain: jump.gain,
    sync: jump.sync,
    strafes: jump.strafes,
    maxSpeed: jump.maxSpeed,
    airTicks: jump.airTicks,
  };
}
