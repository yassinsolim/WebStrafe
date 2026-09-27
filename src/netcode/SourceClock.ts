/**
 * Maps timestamps from a remote clock (the server, or another peer in
 * Supabase mode) onto this client's local monotonic timeline without needing
 * the two wall clocks to agree.
 *
 * offset = min(localReceive - sourceTime) over a sliding window. That minimum is
 * "clock difference + fastest observed one-way latency", so a sample mapped with
 * it lands where it would have arrived on the best path. Late (jittered)
 * arrivals don't move the mapping, which is what makes the timeline smooth.
 */
export class SourceClock {
  private readonly window: number[] = [];
  private offset = Number.NaN;
  private lastSourceT = Number.NaN;
  private intervalEma = Number.NaN;
  private lateness = 0;

  constructor(private readonly windowSize = 96) {}

  observe(sourceT: number, localMs: number): void {
    if (!Number.isFinite(sourceT) || !Number.isFinite(localMs)) {
      return;
    }
    const sampleOffset = localMs - sourceT;
    this.window.push(sampleOffset);
    if (this.window.length > this.windowSize) {
      this.window.shift();
    }
    let min = Infinity;
    for (const value of this.window) {
      if (value < min) min = value;
    }
    // a big jump means the source restarted or its clock stepped; start over
    if (Number.isFinite(this.offset) && Math.abs(min - this.offset) > 2000) {
      this.window.length = 0;
      this.window.push(sampleOffset);
      min = sampleOffset;
      this.intervalEma = Number.NaN;
      this.lastSourceT = Number.NaN;
    }
    this.offset = min;

    const late = sampleOffset - min;
    // decaying peak: reacts fast to spikes, relaxes over ~2 s
    this.lateness = Math.max(late, this.lateness * 0.97);

    if (Number.isFinite(this.lastSourceT) && sourceT > this.lastSourceT) {
      const dt = Math.min(1000, sourceT - this.lastSourceT);
      // a sender waking from 1 Hz keepalives back to full rate: snap, don't
      // spend a second easing the delay down
      this.intervalEma = Number.isFinite(this.intervalEma) && dt > this.intervalEma / 3
        ? this.intervalEma + (dt - this.intervalEma) * 0.1
        : dt;
    }
    if (!Number.isFinite(this.lastSourceT) || sourceT > this.lastSourceT) {
      this.lastSourceT = sourceT;
    }
  }

  hasOffset(): boolean {
    return Number.isFinite(this.offset);
  }

  toLocal(sourceT: number): number {
    return sourceT + (Number.isFinite(this.offset) ? this.offset : 0);
  }

  toSource(localMs: number): number {
    return localMs - (Number.isFinite(this.offset) ? this.offset : 0);
  }

  /** Mean spacing between samples from this source, in ms. */
  getIntervalMs(): number {
    return Number.isFinite(this.intervalEma) ? this.intervalEma : 50;
  }

  /** Recent worst-case lateness beyond the best path, in ms. */
  getJitterMs(): number {
    return this.lateness;
  }

  /**
   * How far behind "now" to render so a newer sample has almost always arrived:
   * one send interval plus the recent jitter peak plus a small margin.
   */
  getRecommendedDelayMs(minMs = 40, maxMs = 350): number {
    const target = this.getIntervalMs() + this.getJitterMs() + 10;
    return Math.min(maxMs, Math.max(minMs, target));
  }
}
