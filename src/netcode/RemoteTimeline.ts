import { SourceClock } from './SourceClock';

/**
 * Tracks one {@link SourceClock} per sender and hands out a smoothed render
 * time for each. The effective "local minus render" offset is slew limited so
 * render time never jumps backwards or skips when the delay estimate changes.
 */
export class RemoteTimeline {
  private readonly clocks = new Map<string, SourceClock>();
  private readonly lead = new Map<string, number>();

  /** max rate the render offset may drift, as a fraction of real time */
  constructor(private readonly slewRate = 0.1, private readonly minDelayMs = 40, private readonly maxDelayMs = 350) {}

  observe(source: string, sourceT: number, localMs: number): void {
    let clock = this.clocks.get(source);
    if (!clock) {
      clock = new SourceClock();
      this.clocks.set(source, clock);
    }
    clock.observe(sourceT, localMs);
  }

  getClock(source: string): SourceClock | undefined {
    return this.clocks.get(source);
  }

  /** Advances slewing; call once per rendered frame. */
  update(frameDtMs: number): void {
    const maxStep = Math.max(0, frameDtMs) * this.slewRate;
    for (const [source, clock] of this.clocks) {
      if (!clock.hasOffset()) continue;
      const target = clock.toLocal(0) + clock.getRecommendedDelayMs(this.minDelayMs, this.maxDelayMs);
      const current = this.lead.get(source);
      if (current === undefined || Math.abs(target - current) > 1000) {
        this.lead.set(source, target);
        continue;
      }
      const delta = target - current;
      this.lead.set(source, current + Math.max(-maxStep, Math.min(maxStep, delta)));
    }
  }

  /** Render time for `source`, in that source's clock. */
  renderTime(source: string, localNowMs: number): number | null {
    const lead = this.lead.get(source);
    if (lead === undefined) {
      const clock = this.clocks.get(source);
      if (!clock?.hasOffset()) return null;
      return clock.toSource(localNowMs) - clock.getRecommendedDelayMs(this.minDelayMs, this.maxDelayMs);
    }
    return localNowMs - lead;
  }

  /** Current presentation delay for `source`, in ms. */
  delayMs(source: string): number {
    const clock = this.clocks.get(source);
    return clock ? clock.getRecommendedDelayMs(this.minDelayMs, this.maxDelayMs) : this.minDelayMs;
  }

  forget(source: string): void {
    this.clocks.delete(source);
    this.lead.delete(source);
  }
}
