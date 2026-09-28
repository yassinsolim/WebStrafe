import { describe, expect, it } from 'vitest';
import { RUN_TICK_RATE, RunTimer, stageTimes, ticksToMs } from '../RunTimer';

function run(timer: RunTimer, ticks: number, pvp = false): void {
  for (let i = 0; i < ticks; i += 1) timer.step(false, pvp);
}

describe('RunTimer', () => {
  it('holds at zero in the start zone and starts counting ticks on exit', () => {
    const timer = new RunTimer();
    for (let i = 0; i < 50; i += 1) expect(timer.step(true, false)).toBe(false);
    expect(timer.phase).toBe('ready');
    expect(timer.ticks).toBe(0);
    expect(timer.step(false, false)).toBe(true);
    run(timer, RUN_TICK_RATE - 1);
    expect(timer.ticks).toBe(RUN_TICK_RATE);
    expect(timer.elapsedMs()).toBe(1000);
  });

  it('does not run before the player has been in the start zone', () => {
    const timer = new RunTimer();
    run(timer, 100);
    expect(timer.phase).toBe('idle');
    expect(timer.finish()).toBeNull();
  });

  it('records one split per stage in order and ranks a complete run', () => {
    const timer = new RunTimer([2, 3]);
    timer.step(true, false);
    run(timer, 256);
    expect(timer.checkpoint(2)).toEqual({ stage: 2, ticks: 256 });
    expect(timer.checkpoint(2)).toBeNull();
    run(timer, 128);
    expect(timer.checkpoint(3)).toEqual({ stage: 3, ticks: 384 });
    run(timer, 64);
    const done = timer.finish()!;
    expect(done).toMatchObject({ ticks: 448, timeMs: 3500, ranked: true, unrankedReason: null, pvp: false });
    expect(stageTimes(done.splits, done.ticks)).toEqual([
      { stage: 1, ticks: 256 },
      { stage: 2, ticks: 128 },
      { stage: 3, ticks: 64 },
    ]);
  });

  it('handles maps that label their first checkpoint stage 1', () => {
    const timer = new RunTimer([1, 2]);
    timer.step(true, false);
    run(timer, 20);
    expect(timer.checkpoint(1)).toEqual({ stage: 1, ticks: 20 });
    expect(timer.checkpoint(7)).toBeNull();
    run(timer, 20);
    timer.checkpoint(2);
    const done = timer.finish()!;
    expect(done.ranked).toBe(true);
    expect(stageTimes(done.splits, done.ticks).map((s) => s.stage)).toEqual([1, 2, 3]);
    expect(timer.phase).toBe('finished');
    expect(timer.finish()).toBeNull();
  });

  it('keeps a run that skipped a stage as pb only', () => {
    const timer = new RunTimer([2, 3]);
    timer.step(true, false);
    run(timer, 10);
    timer.checkpoint(3);
    const done = timer.finish()!;
    expect(done.ranked).toBe(false);
    expect(done.unrankedReason).toBe('missed stage 2');
  });

  it('re-entering the start zone restarts the run', () => {
    const timer = new RunTimer([2]);
    timer.step(true, false);
    run(timer, 500);
    timer.checkpoint(2);
    timer.step(true, false);
    expect(timer.ticks).toBe(0);
    expect(timer.splits).toEqual([]);
    expect(timer.phase).toBe('ready');
  });

  it('flags pvp use and invalidation without stopping the clock', () => {
    const timer = new RunTimer();
    timer.step(true, false);
    run(timer, 10, false);
    run(timer, 1, true);
    timer.invalidate('respawned');
    run(timer, 5);
    const done = timer.finish()!;
    expect(done.ticks).toBe(16);
    expect(done.pvp).toBe(true);
    expect(done.ranked).toBe(false);
    expect(done.unrankedReason).toBe('respawned');
  });

  it('converts ticks to rounded ms at 128 Hz', () => {
    expect(ticksToMs(1)).toBe(8);
    expect(ticksToMs(128 * 60)).toBe(60_000);
  });
});
