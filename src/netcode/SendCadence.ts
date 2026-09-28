/**
 * Decides which fixed sim ticks get sent to the network. Driven by the tick's
 * own timestamp instead of a separate setInterval, so every sent sample lines
 * up with a real simulation step and the rate doesn't alias against the frame
 * loop. Keeps phase (subtracts the interval) so 30 Hz means 30 Hz, not the
 * 18.3 Hz the old reset-to-zero accumulator produced at 128 Hz ticks.
 */
export class SendCadence {
  private nextDueMs = Number.NaN;
  private intervalMs: number;

  constructor(hz: number) {
    this.intervalMs = 1000 / Math.max(0.5, hz);
  }

  setRate(hz: number): void {
    this.intervalMs = 1000 / Math.max(0.5, hz);
  }

  getRate(): number {
    return 1000 / this.intervalMs;
  }

  /** True when the sample at `tMs` should be transmitted. */
  due(tMs: number): boolean {
    if (!Number.isFinite(this.nextDueMs)) {
      this.nextDueMs = tMs + this.intervalMs;
      return true;
    }
    if (tMs + 0.5 < this.nextDueMs) {
      return false;
    }
    this.nextDueMs += this.intervalMs;
    // fell far behind (tab was asleep): resync instead of bursting
    if (tMs - this.nextDueMs > this.intervalMs * 2) {
      this.nextDueMs = tMs + this.intervalMs;
    }
    return true;
  }

  /** Makes the next call to {@link due} return true (state changes that must go out now). */
  flush(): void {
    this.nextDueMs = Number.NaN;
  }
}
