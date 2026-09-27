import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { MovementController } from '../MovementController';
import { CHAIN_BREAK_GROUND_TICKS, StrafeStatsTracker, type JumpStats } from '../StrafeStats';
import type { MoveInput } from '../types';
import type { CollisionAdapter } from '../../world/CollisionWorld';
import { flatWorld, headingYaw, horizontalSpeed } from './testWorlds';

const DT = 1 / 128;
const RAD_PER_COUNT = 0.0022;

const input = (sideMove: number, jumpHeld: boolean, jumpPressed = false): MoveInput => ({
  forwardMove: 0,
  sideMove,
  jumpPressed,
  jumpHeld,
});

function runnerAt(speed: number): MovementController {
  const mc = new MovementController();
  mc.reset(new Vector3(0, 0, 0), 0);
  mc.setVelocity(new Vector3(0, 0, -speed));
  return mc;
}

/** ticks with autobhop until `jumps` jumps have finished, returns them in order */
function finishJumps(
  mc: MovementController,
  world: CollisionAdapter,
  jumps: number,
  beforeTick: (mc: MovementController, airTick: number) => MoveInput,
): JumpStats[] {
  const done: JumpStats[] = [];
  let last: JumpStats | null = null;
  for (let i = 0; done.length < jumps && i < 5000; i += 1) {
    const current = mc.getStrafeStats().current;
    mc.tick(DT, beforeTick(mc, current?.airTicks ?? 0), world);
    const stats = mc.getStrafeStats();
    // one chain per call here, so a new jump number means a new finished jump
    if (stats.last && stats.last.jump !== last?.jump) {
      done.push(stats.last);
    }
    last = stats.last;
  }
  return done;
}

describe('strafe stats', () => {
  it('reads 100% sync for a perfect zigzag strafe', () => {
    // view on the velocity heading every tick (wishdir exactly perpendicular), D for the
    // first half of the jump and A for the second. on the tick the key flips the mouse
    // is still, like a real direction change, so that tick isn't measured.
    const world = flatWorld();
    const mc = runnerAt(9.5);
    let prevSide = 0;
    const jumps = finishJumps(mc, world, 3, (m, airTick) => {
      const side = airTick % 70 < 35 ? 1 : -1;
      if (side === prevSide || prevSide === 0) {
        m.setView(headingYaw(m.getVelocity()), 0);
      }
      prevSide = side;
      return input(side, true);
    });

    expect(jumps.map((j) => j.jump)).toEqual([1, 2, 3]);
    for (const jump of jumps) {
      expect(jump.sync).toBe(100);
      expect(jump.strafes).toBe(2);
      expect(jump.airTicks).toBe(70);
      expect(jump.maxSpeed).toBeGreaterThan(jump.takeoffSpeed);
    }
    expect(jumps[0].takeoffSpeed).toBe(9.5);
    expect(jumps[0].gain).toBe(0);
    expect(jumps[1].gain).toBeCloseTo(jumps[1].takeoffSpeed - jumps[0].takeoffSpeed, 12);
    expect(jumps[1].gain).toBeGreaterThan(1.8);
    expect(mc.getStrafeStats().chain).toBe(4);
  });

  it('reads 100% for a steady applyLookDelta turn that matches the key', () => {
    const world = flatWorld();
    const mc = runnerAt(9.5);
    const [jump] = finishJumps(mc, world, 1, (m) => {
      m.applyLookDelta(0.05 / RAD_PER_COUNT, 0, 1);
      return input(1, true);
    });
    expect(jump.sync).toBe(100);
    expect(jump.strafes).toBe(1);
  });

  it('reads near 0% sync when the mouse turns against the keys', () => {
    const world = flatWorld();
    const mc = runnerAt(9.5);
    // A with the mouse going right, then D with it going left
    const [jump] = finishJumps(mc, world, 1, (m, airTick) => {
      const side = airTick < 35 ? -1 : 1;
      m.applyLookDelta((-side * 0.02) / RAD_PER_COUNT, 0, 1);
      return input(side, true);
    });
    expect(jump.sync).toBeLessThan(5);
    expect(jump.strafes).toBe(2);
    expect(jump.gain).toBe(0);
  });

  it('does not count ticks without any turning, and a fixed view reads 0', () => {
    const world = flatWorld();
    const mc = runnerAt(9.5);
    const [still] = finishJumps(mc, world, 1, () => input(1, true));
    expect(still.sync).toBe(0);
    expect(still.airTicks).toBe(70);

    // turning on every other tick only (like 64 fps at 128 tick) still reads 100
    const halfRate = runnerAt(9.5);
    let tick = 0;
    const [stepped] = finishJumps(halfRate, world, 1, (m) => {
      if (tick % 2 === 0) {
        m.applyLookDelta(0.08 / RAD_PER_COUNT, 0, 1);
      }
      tick += 1;
      return input(1, true);
    });
    expect(stepped.sync).toBe(100);
  });

  it('counts strafes as direction changes of sideMove', () => {
    const world = flatWorld();
    const mc = runnerAt(9.5);
    // A, nothing, A, D, A: releasing and re-pressing A is still one strafe
    const plan = (airTick: number) => (airTick < 10 ? -1 : airTick < 20 ? 0 : airTick < 30 ? -1 : airTick < 45 ? 1 : -1);
    const [jump] = finishJumps(mc, world, 1, (_m, airTick) => input(plan(airTick), true));
    expect(jump.strafes).toBe(3);
  });

  it('keeps the chain through a late jump and resets it after a few ground ticks', () => {
    const world = flatWorld();
    const mc = runnerAt(9.5);
    mc.setCvar('sv_autobhop_enabled', false);

    const jumpAfterGroundTicks = (groundTicks: number) => {
      mc.tick(DT, input(0, true, true), world);
      while (!mc.getDebugState().grounded) {
        mc.tick(DT, input(0, false), world);
      }
      for (let i = 0; i < groundTicks; i += 1) {
        mc.tick(DT, input(0, false), world);
      }
    };

    jumpAfterGroundTicks(CHAIN_BREAK_GROUND_TICKS);
    expect(mc.getStrafeStats().chain).toBe(1);
    expect(mc.getStrafeStats().current).toBeNull();
    expect(mc.getStrafeStats().last?.jump).toBe(1);

    // took off again after exactly CHAIN_BREAK_GROUND_TICKS friction ticks: same chain
    jumpAfterGroundTicks(CHAIN_BREAK_GROUND_TICKS + 1);
    const second = mc.getStrafeStats().last!;
    expect(second.jump).toBe(2);
    expect(second.gain).toBeLessThan(0);

    // that last wait was one tick too long, so the chain is gone and the next jump is 1 again
    expect(mc.getStrafeStats().chain).toBe(0);
    mc.tick(DT, input(0, true, true), world);
    expect(mc.getStrafeStats().current).toMatchObject({ jump: 1, gain: 0 });
    expect(mc.getStrafeStats().last?.jump).toBe(2);
  });

  it('reset() clears the stats', () => {
    const world = flatWorld();
    const mc = runnerAt(9.5);
    finishJumps(mc, world, 2, () => input(1, true));
    mc.reset(new Vector3(0, 0, 0), 0);
    expect(mc.getStrafeStats()).toEqual({ chain: 0, current: null, last: null });
  });

  it('never feeds back into the simulation', () => {
    const world = flatWorld();
    const script = (i: number): MoveInput => input(Math.floor(i / 30) % 2 === 0 ? 1 : -1, i % 200 < 150);
    const a = runnerAt(9.5);
    for (let i = 0; i < 200; i += 1) {
      a.applyLookDelta(Math.floor(i / 30) % 2 === 0 ? 20 : -20, 0, 1);
      a.tick(DT, script(i), world);
    }
    // b starts from a's physics state with an empty stats history
    const b = new MovementController();
    b.restoreState(a.captureState());
    expect(b.getStrafeStats()).not.toEqual(a.getStrafeStats());

    for (let i = 200; i < 600; i += 1) {
      const turn = Math.floor(i / 30) % 2 === 0 ? 20 : -20;
      a.applyLookDelta(turn, 0, 1);
      b.applyLookDelta(turn, 0, 1);
      a.tick(DT, script(i), world);
      b.tick(DT, script(i), world);
    }
    expect(b.captureState()).toEqual(a.captureState());
    expect(Object.keys(a.captureState()).sort()).toEqual([
      'duckAmount',
      'pitchRad',
      'position',
      'surfContactGraceTicks',
      'surfContactNormal',
      'velocity',
      'yawRad',
    ]);
    expect(horizontalSpeed(a.getVelocity())).toBeGreaterThan(0);
  });

  it('treats a burst of jump ticks as one takeoff', () => {
    const tracker = new StrafeStatsTracker();
    for (let i = 0; i < 3; i += 1) {
      tracker.record({ mode: 'air', jumped: true, speedBefore: 10, speedAfter: 10, yawDelta: 0, sideMove: 0 });
    }
    expect(tracker.getStats().chain).toBe(1);
    expect(tracker.getStats().current?.airTicks).toBe(3);
  });
});
