import type { RunSplit } from './RunTimer';
import { ticksToMs } from './RunTimer';

/** "+1.204" / "-0.380", tenths of a second are what surfers read at a glance */
export function formatDelta(ms: number): string {
  const sign = ms < 0 ? '-' : '+';
  const abs = Math.abs(ms);
  const seconds = Math.floor(abs / 1000);
  const rest = Math.floor(abs % 1000).toString().padStart(3, '0');
  if (seconds >= 60) {
    return `${sign}${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}.${rest}`;
  }
  return `${sign}${seconds}.${rest}`;
}

/** ms against the reference split for the same checkpoint, null when the reference never reached it */
export function splitDeltaMs(split: RunSplit, reference: readonly RunSplit[] | null): number | null {
  const ref = reference?.find((s) => s.stage === split.stage);
  return ref ? ticksToMs(split.ticks) - ticksToMs(ref.ticks) : null;
}
