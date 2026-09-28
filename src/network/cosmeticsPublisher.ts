import { sameCosmetics, type PlayerCosmetics } from './cosmetics';

export interface CosmeticsPublisherOptions {
  /** quiet time after the last change before it goes out (sliders, seed scrubbing) */
  debounceMs: number;
  /** never publish two changes closer than this */
  minIntervalMs: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * cosmetics go out on join and when they change, never with the per tick
 * state. a burst of changes (dragging the wear slider, clicking through
 * finishes) collapses into one publish after `debounceMs` of quiet, and two
 * publishes are always at least `minIntervalMs` apart. the transport decides
 * what publishing means (a presence track, a ws message).
 */
export class CosmeticsPublisher {
  private wanted: PlayerCosmetics | null = null;
  private published: PlayerCosmetics | null = null;
  private lastPublishAt = -Infinity;
  private timer: unknown = null;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(
    private readonly publish: (cosmetics: PlayerCosmetics | null) => void,
    private readonly options: CosmeticsPublisherOptions,
  ) {
    this.now = options.now ?? (() => Date.now());
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  /** what the player has picked, possibly not sent yet */
  get current(): PlayerCosmetics | null {
    return this.wanted;
  }

  /** what peers have been told */
  get sent(): PlayerCosmetics | null {
    return this.published;
  }

  /** the player picked something; goes out later, collapsed with any other changes */
  set(cosmetics: PlayerCosmetics | null): void {
    this.wanted = cosmetics;
    if (sameCosmetics(this.wanted ?? undefined, this.published ?? undefined)) {
      this.cancel();
      return;
    }
    this.cancel();
    const at = Math.max(this.now() + this.options.debounceMs, this.lastPublishAt + this.options.minIntervalMs);
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.flush();
    }, Math.max(0, at - this.now()));
  }

  /**
   * joining (or rejoining) a room: the current choice rides the join itself.
   * returns it so the transport can put it in the join payload.
   */
  joined(): PlayerCosmetics | null {
    this.cancel();
    this.published = this.wanted;
    this.lastPublishAt = this.now();
    return this.published;
  }

  /** sends a pending change now if there is one */
  flush(): void {
    this.cancel();
    if (sameCosmetics(this.wanted ?? undefined, this.published ?? undefined)) return;
    this.published = this.wanted;
    this.lastPublishAt = this.now();
    this.publish(this.published);
  }

  dispose(): void {
    this.cancel();
  }

  private cancel(): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }
}
