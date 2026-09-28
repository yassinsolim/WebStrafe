/**
 * drops the render resolution when frames run slow and brings it back when
 * there's headroom, so weak gpus stay playable instead of stuttering.
 * works on the rAF frame time, averaged over one-second windows.
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
    if (fps < this.lowFps && this.scale > this.minScale) {
      this.scale = Math.max(this.minScale, round(this.scale - this.step));
      this.goodWindows = 0;
      return true;
    }
    if (fps > this.highFps && this.scale < 1) {
      this.goodWindows += 1;
      if (this.goodWindows >= this.raiseAfter) {
        this.goodWindows = 0;
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
