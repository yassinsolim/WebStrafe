/**
 * drops the render resolution when frames run slow and brings it back when
 * there's headroom, so weak gpus stay playable instead of stuttering.
 * works on the rAF frame time, averaged over one-second windows. a vsynced
 * frame rate never goes past the display's, so climbing back counts a window
 * as good once it runs near the best rate seen (the refresh rate) or past
 * `highFps`; a climb that drops again soon doubles the wait before the next.
 */
export interface AdaptiveResolutionOptions {
  /** lowest scale it will go to */
  minScale?: number;
  /** below this fps it steps down */
  lowFps?: number;
  /** above this fps (for `raiseAfter` windows in a row) it steps up */
  highFps?: number;
  raiseAfter?: number;
  step?: number;
  windowMs?: number;
}

export class AdaptiveResolution {
  private scale = 1;
  private windowSum = 0;
  private windowFrames = 0;
  private goodWindows = 0;
  /** best window rate so far, about the display refresh rate */
  private peakFps = 0;
  /** windows since the last climb, -1 when there hasn't been one */
  private sinceRaise = -1;
  private wait: number;
  private readonly minScale: number;
  private lowFps: number;
  private highFps: number;
  private readonly raiseAfter: number;
  private readonly step: number;
  private readonly windowMs: number;

  constructor(options: AdaptiveResolutionOptions = {}) {
    this.minScale = options.minScale ?? 0.5;
    this.lowFps = options.lowFps ?? 55;
    this.highFps = options.highFps ?? 90;
    this.raiseAfter = options.raiseAfter ?? 3;
    this.step = options.step ?? 0.15;
    this.windowMs = options.windowMs ?? 1000;
    this.wait = this.raiseAfter;
  }

  /** test hook: move the step-down and step-up thresholds */
  setThresholds(lowFps: number, highFps = lowFps * 1.6): void {
    this.lowFps = lowFps;
    this.highFps = highFps;
  }

  getScale(): number {
    return this.scale;
  }

  reset(): void {
    this.scale = 1;
    this.windowSum = 0;
    this.windowFrames = 0;
    this.goodWindows = 0;
    this.sinceRaise = -1;
    this.wait = this.raiseAfter;
  }

  /** feed one frame time; returns true when the scale changed */
  sample(frameMs: number): boolean {
    // ignore tab switches and loading stalls, they aren't gpu load
    if (!(frameMs > 0) || frameMs > 250) return false;
    this.windowSum += frameMs;
    this.windowFrames += 1;
    if (this.windowSum < this.windowMs) return false;
    const fps = (1000 * this.windowFrames) / this.windowSum;
    this.windowSum = 0;
    this.windowFrames = 0;
    this.peakFps = Math.max(this.peakFps, fps);
    if (this.sinceRaise >= 0) this.sinceRaise += 1;
    if (fps < this.lowFps && this.scale > this.minScale) {
      // the last climb didn't hold: wait twice as long before the next
      if (this.sinceRaise >= 0 && this.sinceRaise <= 5) this.wait = Math.min(64, this.wait * 2);
      this.sinceRaise = -1;
      this.scale = Math.max(this.minScale, round(this.scale - this.step));
      this.goodWindows = 0;
      return true;
    }
    if (this.sinceRaise > 30 && this.scale >= 1) {
      // held full resolution for a while: a later dip starts with the short wait again
      this.sinceRaise = -1;
      this.wait = this.raiseAfter;
    }
    const good = fps > Math.min(this.highFps, Math.max(this.lowFps + 2, this.peakFps * 0.95));
    if (good && this.scale < 1) {
      this.goodWindows += 1;
      if (this.goodWindows >= this.wait) {
        this.goodWindows = 0;
        this.sinceRaise = 0;
        this.scale = Math.min(1, round(this.scale + this.step / 2));
        return true;
      }
    } else {
      this.goodWindows = 0;
    }
    return false;
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
