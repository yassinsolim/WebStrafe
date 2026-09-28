import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { MovementController } from '../MovementController';
import { defaultCvars } from '../cvars';
import type { MoveInput } from '../types';
import type { CollisionAdapter } from '../../world/CollisionWorld';
import { emptyWorld, flatWorld, headingYaw, horizontalSpeed } from './testWorlds';

const DT = 1 / 128;
// 30 u/s
const W = defaultCvars.sv_air_max_wishspeed;
// applyLookDelta turns 0.0022 rad per count at sensitivity 1
const RAD_PER_COUNT = 0.0022;

const strafe = (sideMove: number, forwardMove = 0, jumpHeld = true): MoveInput => ({
  forwardMove,
  sideMove,
  jumpPressed: false,
  jumpHeld,
});

/** most one tick can add when wishdir is perpendicular: sqrt(v^2 + W^2) - v */
const maxTickGain = (v: number) => Math.hypot(v, W) - v;

/** on the floor at yaw 0 (looking down -z) already moving forward at `speed` */
function runnerAt(speed: number): MovementController {
  const mc = new MovementController();
  mc.reset(new Vector3(0, 0, 0), 0);
  mc.setVelocity(new Vector3(0, 0, -speed));
  return mc;
}

/**
 * ticks until `jumps` jumps have finished, i.e. until jump `jumps + 1` takes off,
 * and returns the takeoff speed of every jump (the last one is the landing speed
 * of jump `jumps`).
 */
function runJumps(
  mc: MovementController,
  world: CollisionAdapter,
  jumps: number,
  beforeTick: (mc: MovementController) => MoveInput,
): { takeoffs: number[]; ticks: number } {
  const takeoffs: number[] = [];
  let ticks = 0;
  let chain = mc.getStrafeStats().chain;
  while (takeoffs.length < jumps + 1) {
    mc.tick(DT, beforeTick(mc), world);
    ticks += 1;
    const stats = mc.getStrafeStats();
    if (stats.chain !== chain && stats.current) {
      takeoffs.push(stats.current.takeoffSpeed);
    }
    chain = stats.chain;
    if (ticks > 5000) {
      throw new Error('chain never finished');
    }
  }
  return { takeoffs, ticks };
}

describe('air strafing with the 30 u/s air wishspeed cap', () => {
  it('a strafe key with a fixed view cannot push the speed along wishdir past 0.762 m/s', () => {
    const world = emptyWorld();
    const mc = new MovementController();
    // yaw 0 looks down -z, so D pushes +x, perpendicular to the velocity
    mc.reset(new Vector3(0, 50, 0), 0);
    mc.setVelocity(new Vector3(0, 0, -9.5));
    const wishDir = new Vector3(1, 0, 0);

    for (let i = 0; i < 128; i += 1) {
      mc.tick(DT, strafe(1, 0, false), world);
      expect(mc.getVelocity().dot(wishDir)).toBeLessThanOrEqual(W + 1e-9);
    }

    // first tick adds W sideways, after that addspeed is 0 forever. with the full 9.5 m/s
    // wishspeed in addspeed this would climb to 9.5 sideways, about 13.4 m/s total
    const speed = horizontalSpeed(mc.getVelocity());
    expect(speed).toBeCloseTo(Math.hypot(9.5, W), 9);
    expect(speed - 9.5).toBeLessThan(0.031);
  });

  it('holding the strafe key along the way you already move adds nothing', () => {
    const world = emptyWorld();
    const mc = new MovementController();
    mc.reset(new Vector3(0, 50, 0), 0);
    mc.setVelocity(new Vector3(6, 0, 0));
    for (let i = 0; i < 160; i += 1) {
      mc.tick(DT, strafe(1, 0, false), world);
    }
    expect(horizontalSpeed(mc.getVelocity())).toBe(6);
  });

  it('turning in sync with the strafe key gains exactly what the source formula says', () => {
    // the view is put on the velocity heading before every tick, so D's wishdir is exactly
    // perpendicular: addspeed = W - v.wishdir = W, and accelspeed = 150 * 9.5 / 128 = 11.1
    // gets clamped to it. every air tick then gives |v'| = sqrt(|v|^2 + W^2).
    const world = flatWorld();
    const mc = runnerAt(9.5);
    // speeds[i] is the speed going into tick i
    const speeds: number[] = [];

    const { takeoffs } = runJumps(mc, world, 1, (m) => {
      m.setView(headingYaw(m.getVelocity()), 0);
      speeds.push(horizontalSpeed(m.getVelocity()));
      return strafe(1);
    });
    // the last tick run was jump 2's takeoff, everything before it is jump 1
    const airTicks = mc.getStrafeStats().last!.airTicks;
    expect(airTicks).toBe(96);
    expect(speeds).toHaveLength(airTicks + 1);

    for (let i = 0; i < airTicks; i += 1) {
      expect(speeds[i + 1] - speeds[i]).toBeCloseTo(maxTickGain(speeds[i]), 9);
    }
    // 9.5 -> sqrt(9.5^2 + 96 * 0.762^2) = 12.08 m/s in one jump
    expect(takeoffs[1]).toBeCloseTo(Math.sqrt(9.5 ** 2 + airTicks * W * W), 9);
    expect(takeoffs[1]).toBeCloseTo(12.083, 3);
  });

  it('a steady mouse turn with the key never beats the formula but gets most of it', () => {
    // 0.06 rad/tick is about 0.75x the ideal atan(W/v) at 9.5 m/s, so wishdir is only near
    // perpendicular and each tick's gain has to stay under sqrt(v^2 + W^2) - v
    const world = flatWorld();
    const mc = runnerAt(9.5);
    const turnCounts = 0.06 / RAD_PER_COUNT;
    const speeds: number[] = [];

    const { takeoffs } = runJumps(mc, world, 1, (m) => {
      speeds.push(horizontalSpeed(m.getVelocity()));
      m.applyLookDelta(turnCounts, 0, 1);
      return strafe(1);
    });

    expect(speeds).toHaveLength(97);
    for (let i = 0; i + 1 < speeds.length; i += 1) {
      const gain = speeds[i + 1] - speeds[i];
      expect(gain).toBeGreaterThan(0);
      expect(gain).toBeLessThanOrEqual(maxTickGain(speeds[i]) + 1e-12);
    }
    const ideal = Math.sqrt(9.5 ** 2 + 96 * W * W) - 9.5;
    const gained = takeoffs[1] - takeoffs[0];
    expect(gained).toBeLessThan(ideal);
    expect(gained).toBeGreaterThan(ideal * 0.85);
  });

  it('turning against the strafe key gains nothing', () => {
    const world = flatWorld();
    const mc = runnerAt(9.5);
    // hold D but turn left (negative counts), about 80 degrees over the jump. keep turning
    // past ~180 degrees and wishdir ends up on the far side moving away from the velocity,
    // which is backwards strafing and gains again, same as in source.
    const turnCounts = -0.02 / RAD_PER_COUNT;
    const { takeoffs } = runJumps(mc, world, 1, (m) => {
      m.applyLookDelta(turnCounts, 0, 1);
      return strafe(1);
    });
    // at most one settling tick of gain while wishdir swings in front of the velocity
    expect(takeoffs[1] - takeoffs[0]).toBeLessThanOrEqual(maxTickGain(9.5) + 1e-9);
    expect(mc.getStrafeStats().last!.sync).toBe(0);
  });

  it('W only in the air never goes past the takeoff speed', () => {
    const world = flatWorld();
    const mc = new MovementController();
    mc.reset(new Vector3(0, 0, 0), 0);
    for (let i = 0; i < 200; i += 1) {
      mc.tick(DT, strafe(0, 1, false), world);
    }
    const takeoff = horizontalSpeed(mc.getVelocity());
    expect(takeoff).toBeCloseTo(defaultCvars.sv_maxspeed, 6);

    mc.tick(DT, { forwardMove: 1, sideMove: 0, jumpPressed: true, jumpHeld: true }, world);
    let airTicks = 1;
    while (!mc.getDebugState().grounded) {
      expect(horizontalSpeed(mc.getVelocity())).toBeLessThanOrEqual(takeoff + 1e-9);
      mc.tick(DT, strafe(0, 1, false), world);
      airTicks += 1;
    }
    expect(airTicks).toBeGreaterThan(60);
  });

  it('W from a standing jump tops out at the air cap, not sv_maxspeed', () => {
    const world = flatWorld();
    const mc = new MovementController();
    mc.reset(new Vector3(0, 0, 0), 0);
    mc.tick(DT, { forwardMove: 1, sideMove: 0, jumpPressed: true, jumpHeld: true }, world);
    let peak = 0;
    while (!mc.getDebugState().grounded) {
      peak = Math.max(peak, horizontalSpeed(mc.getVelocity()));
      mc.tick(DT, strafe(0, 1, false), world);
    }
    expect(peak).toBeCloseTo(W, 9);
  });

  it('10 perfect autobhop jumps from 9.5 m/s end where the math says, and no turning stays put', () => {
    // derivation:
    // - with wishdir perpendicular every air tick, |v|^2 grows by exactly W^2 = 0.762^2 per
    //   tick (see the test above).
    // - autobhop jumps on the landing tick, and the jump tick runs air accel, so the chain
    //   has no ground ticks and no friction at all.
    // - air ticks per jump P come from the arc: vy0 = 7.67 (301.99 u/s), g = 20.32 (800 u/s^2),
    //   dt = 1/128. gravity is split in halves around the move, so after k ticks the feet are
    //   on the exact parabola y_k = vy0 k dt - g (k dt)^2 / 2, and the landing snap (feet
    //   within 0.08 m) first catches it at k = 96 (y_95 = 0.097, y_96 = 0.038), so P = 96.
    // - v_10 = sqrt(9.5^2 + 10 * 96 * 0.762^2) = sqrt(90.25 + 557.42) = 25.45 m/s.
    // - one tick either way on the landing (P = 95..97) gives the range [25.33, 25.57].
    const world = flatWorld();
    const ideal = runnerAt(9.5);
    const { takeoffs } = runJumps(ideal, world, 10, (m) => {
      m.setView(headingYaw(m.getVelocity()), 0);
      return strafe(1);
    });
    const v10 = takeoffs[10];
    expect(v10).toBeGreaterThan(25.33);
    expect(v10).toBeLessThan(25.57);
    expect(v10).toBeCloseTo(Math.sqrt(9.5 ** 2 + 960 * W * W), 6);
    expect(ideal.getStrafeStats().chain).toBe(11);

    // same chain, same key, view never moves: one tick of gain on jump 1 and then nothing
    const still = runnerAt(9.5);
    const flat = runJumps(still, world, 10, () => strafe(1));
    expect(flat.takeoffs[10]).toBeCloseTo(Math.hypot(9.5, W), 9);
    expect(flat.takeoffs[10] - 9.5).toBeLessThan(0.031);
  });
});
