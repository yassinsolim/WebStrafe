/**
 * Client-side prediction bookkeeping for a server-authoritative simulation.
 *
 * The client simulates its own inputs immediately and records (tick, input,
 * resulting state). When the authority acknowledges tick N with its state, we
 * compare against what we predicted for N. If they differ beyond a tolerance
 * we roll back to the authoritative state and replay every input after N,
 * which lands us on the corrected present without waiting a round trip.
 */
export interface PredictedFrame<I, S> {
  tick: number;
  input: I;
  state: S;
}

export interface ReconcileOptions<I, S> {
  /** apply one input to a state, returns the next state (must be deterministic) */
  replay: (state: S, input: I, tick: number) => S;
  /** scalar distance between two states, e.g. metres of position error */
  error: (predicted: S, authoritative: S) => number;
  /** errors at or below this are float noise, not a misprediction */
  tolerance: number;
}

export interface ReconcileResult<S> {
  corrected: boolean;
  /** distance between prediction and authority at the acked tick */
  error: number;
  /** the new present state after replay (only when corrected) */
  state: S | null;
  replayedTicks: number;
}

export class PredictionLedger<I, S> {
  private readonly frames: PredictedFrame<I, S>[] = [];

  constructor(private readonly capacity = 512) {}

  record(tick: number, input: I, state: S): void {
    const last = this.frames.at(-1);
    if (last && tick <= last.tick) {
      // a reset or rollback rewrote history; drop the stale future
      while (this.frames.length > 0 && this.frames[this.frames.length - 1].tick >= tick) {
        this.frames.pop();
      }
    }
    this.frames.push({ tick, input, state });
    if (this.frames.length > this.capacity) {
      this.frames.splice(0, this.frames.length - this.capacity);
    }
  }

  /** Inputs the authority hasn't acknowledged yet, oldest first (for resending). */
  pendingInputs(afterTick: number): PredictedFrame<I, S>[] {
    return this.frames.filter((frame) => frame.tick > afterTick);
  }

  size(): number {
    return this.frames.length;
  }

  reconcile(ackTick: number, authoritative: S, options: ReconcileOptions<I, S>): ReconcileResult<S> {
    // everything up to the ack is settled
    const index = this.frames.findIndex((frame) => frame.tick === ackTick);
    if (index < 0) {
      // too old or never predicted: trust the authority outright
      const newer = this.frames.filter((frame) => frame.tick > ackTick);
      if (newer.length === 0) {
        this.frames.length = 0;
        return { corrected: false, error: 0, state: null, replayedTicks: 0 };
      }
      return this.replayFrom(authoritative, newer, Infinity, options);
    }
    const predicted = this.frames[index];
    const error = options.error(predicted.state, authoritative);
    const newer = this.frames.slice(index + 1);
    this.frames.splice(0, index + 1);
    if (error <= options.tolerance) {
      return { corrected: false, error, state: null, replayedTicks: 0 };
    }
    return this.replayFrom(authoritative, newer, error, options);
  }

  private replayFrom(
    authoritative: S,
    newer: PredictedFrame<I, S>[],
    error: number,
    options: ReconcileOptions<I, S>,
  ): ReconcileResult<S> {
    let state = authoritative;
    for (const frame of newer) {
      state = options.replay(state, frame.input, frame.tick);
      frame.state = state;
    }
    this.frames.length = 0;
    this.frames.push(...newer);
    return { corrected: true, error, state, replayedTicks: newer.length };
  }
}

/**
 * Hides a correction visually: the camera/model keeps an offset equal to the
 * snap and bleeds it out over ~100 ms, while the simulation is already exact.
 */
export class ErrorSmoother {
  readonly offset: [number, number, number] = [0, 0, 0];

  constructor(private readonly decayPerSecond = 12, private readonly snapDistance = 2) {}

  /** `delta` = old displayed position minus corrected position */
  add(delta: [number, number, number]): void {
    const next: [number, number, number] = [
      this.offset[0] + delta[0],
      this.offset[1] + delta[1],
      this.offset[2] + delta[2],
    ];
    if (Math.hypot(next[0], next[1], next[2]) > this.snapDistance) {
      this.offset[0] = 0;
      this.offset[1] = 0;
      this.offset[2] = 0;
      return;
    }
    this.offset[0] = next[0];
    this.offset[1] = next[1];
    this.offset[2] = next[2];
  }

  update(dtSeconds: number): void {
    const k = Math.exp(-dtSeconds * this.decayPerSecond);
    this.offset[0] *= k;
    this.offset[1] *= k;
    this.offset[2] *= k;
  }
}
