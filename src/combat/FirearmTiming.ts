export type FirearmId = 'deagle' | 'awp';

export interface FirearmTiming {
  /** Measured source-asset action duration, retained as an asset contract. */
  authoredFireClipMs: number;
  /** Effective visible fire duration. Must finish before another legal shot. */
  firePlaybackMs: number;
  /** Server/client firing cooldown. */
  fireIntervalMs: number;
  /** Measured source-asset reload duration and mechanical refill time. */
  reloadMs: number;
}

/**
 * One timing contract shared by gameplay and viewmodel playback.
 *
 * Deagle's authored 430 ms recoil cannot be restarted at its 225 ms cadence,
 * so its baked-unit accent remains 190 ms while procedural recovery carries the
 * readable tail. AWP's former 1.4 s baked-unit displacement looked like a held
 * pose; its accent now settles in 400 ms with the heavier procedural curve.
 * Reloads use the measured authored durations without drift.
 */
export const FIREARM_TIMINGS: Readonly<Record<FirearmId, FirearmTiming>> = {
  deagle: {
    authoredFireClipMs: 430,
    firePlaybackMs: 190,
    fireIntervalMs: 225,
    reloadMs: 3330,
  },
  awp: {
    authoredFireClipMs: 1467,
    firePlaybackMs: 400,
    fireIntervalMs: 1500,
    reloadMs: 3450,
  },
};

export function clipPlaybackRate(sourceDurationSeconds: number, targetDurationMs: number): number {
  if (!Number.isFinite(sourceDurationSeconds) || sourceDurationSeconds <= 0) {
    throw new Error('Animation source duration must be positive and finite');
  }
  if (!Number.isFinite(targetDurationMs) || targetDurationMs <= 0) {
    throw new Error('Animation target duration must be positive and finite');
  }
  return sourceDurationSeconds / (targetDurationMs / 1000);
}
