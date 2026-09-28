/** hammer units: 1 u = 1 inch = 0.0254 m */
export const METRES_PER_UNIT = 0.0254;

export function toUnitsPerSecond(metresPerSecond: number): number {
  if (!Number.isFinite(metresPerSecond)) {
    return 0;
  }
  return Math.round(Math.max(0, metresPerSecond) / METRES_PER_UNIT);
}

export type SpeedTrend = 'gain' | 'loss' | 'neutral';

/** green above the last takeoff, red below, white when there is no jump to compare with */
export function speedTrend(currentUps: number, takeoffUps: number | null, toleranceUps = 1): SpeedTrend {
  if (takeoffUps === null || !Number.isFinite(takeoffUps) || !Number.isFinite(currentUps)) {
    return 'neutral';
  }
  const diff = currentUps - takeoffUps;
  if (Math.abs(diff) <= toleranceUps) {
    return 'neutral';
  }
  return diff > 0 ? 'gain' : 'loss';
}

export function formatSignedUnits(ups: number): string {
  const rounded = Math.round(ups);
  if (rounded > 0) return `+${rounded}`;
  if (rounded < 0) return `${rounded}`;
  return '0';
}

/**
 * What the speedometer shows under the speed. Speeds are m/s like the rest
 * of the movement code, converted here.
 */
export interface StrafeStatsInput {
  /** horizontal speed at the last takeoff, m/s */
  takeoffSpeed: number;
  /** speed change over the last jump, m/s, signed */
  gain?: number | null;
  /** share of air time where mouse and strafe keys agreed, 0..100 */
  syncPercent?: number | null;
  jumpCount?: number | null;
}

export interface StrafeStatsView {
  takeoffUps: number;
  gainUps: number | null;
  syncPercent: number | null;
  jumpCount: number | null;
}

/**
 * Accepts whatever movement.getStrafeStats() returns and keeps the fields we
 * understand. Tolerates a few likely names so the hud does not break if the
 * movement side picks slightly different ones. Returns null when there is no
 * usable takeoff speed.
 */
export function normalizeStrafeStats(raw: unknown): StrafeStatsInput | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const src = raw as Record<string, unknown>;
  const takeoff = firstNumber(src, ['takeoffSpeed', 'lastTakeoffSpeed', 'takeoff']);
  if (takeoff === null) {
    return null;
  }
  let sync = firstNumber(src, ['syncPercent', 'syncPct']);
  if (sync === null) {
    const fraction = firstNumber(src, ['sync']);
    sync = fraction === null ? null : fraction <= 1 ? fraction * 100 : fraction;
  }
  return {
    takeoffSpeed: takeoff,
    gain: firstNumber(src, ['gain', 'speedGain', 'lastGain']),
    syncPercent: sync === null ? null : Math.max(0, Math.min(100, sync)),
    jumpCount: firstNumber(src, ['jumpCount', 'jumps']),
  };
}

export function toStrafeStatsView(stats: StrafeStatsInput): StrafeStatsView {
  return {
    takeoffUps: toUnitsPerSecond(stats.takeoffSpeed),
    gainUps: stats.gain === null || stats.gain === undefined || !Number.isFinite(stats.gain)
      ? null
      : Math.round(stats.gain / METRES_PER_UNIT),
    syncPercent: stats.syncPercent === null || stats.syncPercent === undefined ? null : Math.round(stats.syncPercent),
    jumpCount: stats.jumpCount === null || stats.jumpCount === undefined ? null : Math.max(0, Math.round(stats.jumpCount)),
  };
}

/**
 * Fallback takeoff tracking for when the movement code does not provide strafe
 * stats: remembers the speed at each jump and ends the chain once the player
 * has stayed on the ground for a moment.
 */
export class TakeoffTracker {
  private lastTakeoff: number | null = null;
  private previousTakeoff: number | null = null;
  private jumps = 0;
  private groundedFor = 0;

  constructor(private readonly chainResetSec = 0.45) {}

  onJump(horizontalSpeed: number): void {
    this.previousTakeoff = this.lastTakeoff;
    this.lastTakeoff = Math.max(0, horizontalSpeed);
    this.jumps += 1;
    this.groundedFor = 0;
  }

  update(grounded: boolean, dtSec: number): void {
    if (!grounded) {
      this.groundedFor = 0;
      return;
    }
    this.groundedFor += Math.max(0, dtSec);
    if (this.groundedFor >= this.chainResetSec) {
      this.reset();
    }
  }

  reset(): void {
    this.lastTakeoff = null;
    this.previousTakeoff = null;
    this.jumps = 0;
    this.groundedFor = 0;
  }

  /** m/s, null outside a jump chain */
  getTakeoffSpeed(): number | null {
    return this.lastTakeoff;
  }

  getStats(): StrafeStatsInput | null {
    if (this.lastTakeoff === null) {
      return null;
    }
    return {
      takeoffSpeed: this.lastTakeoff,
      gain: this.previousTakeoff === null ? null : this.lastTakeoff - this.previousTakeoff,
      syncPercent: null,
      jumpCount: this.jumps,
    };
  }
}

function firstNumber(src: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = src[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}
