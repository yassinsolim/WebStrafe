/**
 * surf run timer that counts fixed simulation ticks instead of wall time, so a
 * frame hitch, a slow tab or a pause can't change a run's time. the game loop
 * calls step() once per movement tick with whether the feet are in the start
 * zone, then feeds checkpoint and finish events.
 */

export const RUN_TICK_RATE = 128;

/** leaving the start zone faster than this gets the horizontal speed clamped */
export const PRESPEED_CAP_FACTOR = 1.2;

export type RunPhase = 'idle' | 'ready' | 'running' | 'finished';

export interface RunSplit {
  /** checkpoint stage label from meta.json */
  stage: number;
  ticks: number;
}

export interface FinishedRun {
  ticks: number;
  timeMs: number;
  /** one per checkpoint stage, in order */
  splits: RunSplit[];
  /** false when the run can't go on the boards (still counts as a local pb) */
  ranked: boolean;
  unrankedReason: string | null;
  /** true when pvp was on at any point during the run */
  pvp: boolean;
}

export function ticksToMs(ticks: number): number {
  return Math.round((ticks * 1000) / RUN_TICK_RATE);
}

/**
 * stage durations from cumulative splits. stages are numbered 1..n+1 by order:
 * stage 1 runs from the start to the first checkpoint, the last one ends at the
 * finish (maps label their checkpoints differently, this keeps boards uniform).
 */
export function stageTimes(splits: readonly RunSplit[], totalTicks: number): Array<{ stage: number; ticks: number }> {
  const out: Array<{ stage: number; ticks: number }> = [];
  let prevTicks = 0;
  for (const split of splits) {
    out.push({ stage: out.length + 1, ticks: split.ticks - prevTicks });
    prevTicks = split.ticks;
  }
  out.push({ stage: out.length + 1, ticks: totalTicks - prevTicks });
  return out;
}

export class RunTimer {
  private phaseValue: RunPhase = 'idle';
  private tickCount = 0;
  private splitList: RunSplit[] = [];
  private unranked: string | null = null;
  private pvpUsed = false;
  private result: FinishedRun | null = null;

  /**
   * @param stages checkpoint stage numbers the map has. a finish that skipped
   *   any of them is kept as a pb but not ranked.
   */
  constructor(private readonly stages: readonly number[] = []) {}

  get phase(): RunPhase {
    return this.phaseValue;
  }

  get ticks(): number {
    return this.tickCount;
  }

  get splits(): readonly RunSplit[] {
    return this.splitList;
  }

  get finished(): FinishedRun | null {
    return this.result;
  }

  /** returns true on the tick the player leaves the start zone (the caller caps prespeed then) */
  step(inStartZone: boolean, pvpOn: boolean): boolean {
    if (inStartZone) {
      this.arm(pvpOn);
      return false;
    }
    if (this.phaseValue === 'ready') {
      this.phaseValue = 'running';
      this.tickCount = 1;
      this.pvpUsed ||= pvpOn;
      return true;
    }
    if (this.phaseValue === 'running') {
      this.tickCount += 1;
      this.pvpUsed ||= pvpOn;
    }
    return false;
  }

  /** first entry into each checkpoint records a split, re-entering (or going backwards) does nothing */
  checkpoint(stage: number): RunSplit | null {
    if (this.phaseValue !== 'running') return null;
    if (this.stages.length > 0 && !this.stages.includes(stage)) return null;
    const last = this.splitList.at(-1)?.stage ?? -Infinity;
    if (stage <= last) return null;
    const split = { stage, ticks: this.tickCount };
    this.splitList.push(split);
    return split;
  }

  finish(): FinishedRun | null {
    if (this.phaseValue !== 'running') return null;
    const reached = new Set(this.splitList.map((s) => s.stage));
    const missed = this.stages.filter((s) => !reached.has(s));
    const reason = this.unranked ?? (missed.length > 0 ? `missed stage ${missed[0]}` : null);
    this.result = {
      ticks: this.tickCount,
      timeMs: ticksToMs(this.tickCount),
      splits: this.splitList.map((s) => ({ ...s })),
      ranked: reason === null,
      unrankedReason: reason,
      pvp: this.pvpUsed,
    };
    this.phaseValue = 'finished';
    return this.result;
  }

  /** keeps the run going but marks it pb only (for example a mid-run respawn) */
  invalidate(reason: string): void {
    if (this.phaseValue === 'running' && this.unranked === null) {
      this.unranked = reason;
    }
  }

  /** drops the current run, the next start zone entry arms a fresh one */
  cancel(): void {
    this.phaseValue = 'idle';
    this.tickCount = 0;
    this.splitList = [];
    this.unranked = null;
    this.pvpUsed = false;
    this.result = null;
  }

  elapsedMs(): number {
    return ticksToMs(this.tickCount);
  }

  private arm(pvpOn: boolean): void {
    this.cancel();
    this.phaseValue = 'ready';
    this.pvpUsed = pvpOn;
  }
}
