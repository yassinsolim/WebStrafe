import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { MovementController } from '../MovementController';
import { defaultCvars } from '../cvars';
import type { MoveInput } from '../types';
import { flatWorld, headingYaw, horizontalSpeed, lowCeilingWorld } from './testWorlds';

const DT = 1 / 128;
const STAND = { height: 1.76, eye: 1.6 };
const CROUCH = { height: 1.32, eye: 1.12 };
const HULL_DROP = STAND.height - CROUCH.height;
// ceil(0.12 s * 128 Hz)
const DUCK_TICKS = 16;
const W = defaultCvars.sv_air_max_wishspeed;

const move = (opts: Partial<MoveInput> = {}): MoveInput => ({
  forwardMove: 0,
  sideMove: 0,
  jumpPressed: false,
  jumpHeld: false,
  ...opts,
});

describe('crouch', () => {
  it('ducks over about 0.12 s on the ground with the feet planted, and back', () => {
    const world = flatWorld();
    const mc = new MovementController();
    mc.reset(new Vector3(0, 0, 0), 0);

    mc.tick(DT, move({ crouchHeld: true }), world);
    expect(mc.getDuckAmount()).toBeCloseTo(DT / 0.12, 12);
    let ticks = 1;
    while (mc.getDuckAmount() < 1) {
      mc.tick(DT, move({ crouchHeld: true }), world);
      ticks += 1;
    }
    expect(ticks).toBe(DUCK_TICKS);
    expect(mc.getFeetPosition().y).toBe(0);
    expect(mc.getEyeHeight()).toBeCloseTo(CROUCH.eye, 12);
    expect(mc.getCameraPosition().y).toBeCloseTo(CROUCH.eye, 12);

    for (let i = 0; i < DUCK_TICKS; i += 1) {
      mc.tick(DT, move(), world);
    }
    expect(mc.getDuckAmount()).toBe(0);
    expect(mc.getCameraPosition().y).toBeCloseTo(STAND.eye, 12);
    // spawn checks keep using the standing hull
    expect(mc.capsule.height).toBe(STAND.height);
  });

  it('crouched ground speed tops out at 34% of sv_maxspeed, and friction gets you there', () => {
    const world = flatWorld();
    const cap = 0.34 * defaultCvars.sv_maxspeed;

    // duck first, then walk: accel can't take you past the cap
    const walker = new MovementController();
    walker.reset(new Vector3(0, 0, 0), 0);
    for (let i = 0; i < DUCK_TICKS; i += 1) {
      walker.tick(DT, move({ crouchHeld: true }), world);
    }
    let peak = 0;
    for (let i = 0; i < 256; i += 1) {
      walker.tick(DT, move({ forwardMove: 1, crouchHeld: true }), world);
      peak = Math.max(peak, horizontalSpeed(walker.getVelocity()));
    }
    expect(peak).toBeLessThanOrEqual(cap + 1e-9);
    expect(horizontalSpeed(walker.getVelocity())).toBeCloseTo(cap, 3);

    // running at 9.5 then ducking slows down over a few ticks, no instant clamp
    const runner = new MovementController();
    runner.reset(new Vector3(0, 0, 0), 0);
    runner.setVelocity(new Vector3(0, 0, -defaultCvars.sv_maxspeed));
    runner.tick(DT, move({ forwardMove: 1, crouchHeld: true }), world);
    expect(horizontalSpeed(runner.getVelocity())).toBeGreaterThan(9);
    for (let i = 0; i < 128; i += 1) {
      runner.tick(DT, move({ forwardMove: 1, crouchHeld: true }), world);
    }
    expect(horizontalSpeed(runner.getVelocity())).toBeCloseTo(cap, 2);
  });

  it('ducking mid-jump pulls the feet up by the hull difference', () => {
    const world = flatWorld();
    const peakOf = (duck: boolean) => {
      const mc = new MovementController();
      mc.reset(new Vector3(0, 0, 0), 0);
      mc.tick(DT, move({ jumpPressed: true, jumpHeld: true, crouchHeld: duck }), world);
      let peak = mc.getFeetPosition().y;
      for (let i = 0; i < 60; i += 1) {
        mc.tick(DT, move({ crouchHeld: duck }), world);
        peak = Math.max(peak, mc.getFeetPosition().y);
      }
      return { peak, camera: mc.getCameraPosition().y, feet: mc.getFeetPosition().y };
    };
    const normal = peakOf(false);
    const ducked = peakOf(true);
    expect(ducked.peak - normal.peak).toBeCloseTo(HULL_DROP, 9);
    // the head stays put, the camera only drops by the eye/hull mismatch (0.48 - 0.44)
    expect(normal.camera - ducked.camera).toBeCloseTo(STAND.eye - CROUCH.eye - HULL_DROP, 9);
  });

  it('standing up in the air drops the feet back down when there is room', () => {
    const world = flatWorld();
    const mc = new MovementController();
    mc.reset(new Vector3(0, 0, 0), 0);
    mc.tick(DT, move({ jumpPressed: true, jumpHeld: true, crouchHeld: true }), world);
    for (let i = 0; i < 30; i += 1) {
      mc.tick(DT, move({ crouchHeld: true }), world);
    }
    const headBefore = mc.getFeetPosition().y + CROUCH.height;
    const vy = mc.getVelocity().y;
    mc.tick(DT, move(), world);
    expect(mc.getDuckAmount()).toBe(0);
    // same head height after the swap, minus one tick of the jump arc (half-step gravity)
    const headAfter = mc.getFeetPosition().y + STAND.height;
    expect(headAfter - headBefore).toBeCloseTo((vy - defaultCvars.sv_gravity * DT * 0.5) * DT, 9);
  });

  it('standing up right above the floor waits for the landing', () => {
    const world = flatWorld();
    const mc = new MovementController();
    mc.reset(new Vector3(0, 0, 0), 0);
    mc.tick(DT, move({ jumpPressed: true, jumpHeld: true, crouchHeld: true }), world);
    // fall until the feet are within a hull drop of the floor
    while (!(mc.getVelocity().y < 0 && mc.getFeetPosition().y < HULL_DROP * 0.5)) {
      mc.tick(DT, move({ crouchHeld: true }), world);
    }
    let landed = false;
    for (let i = 0; i < 60; i += 1) {
      mc.tick(DT, move(), world);
      expect(mc.getFeetPosition().y).toBeGreaterThanOrEqual(0);
      if (!landed && mc.getDebugState().grounded) {
        landed = true;
        expect(mc.getDuckAmount()).toBe(1);
      }
    }
    expect(landed).toBe(true);
    expect(mc.getDuckAmount()).toBe(0);
    expect(mc.getFeetPosition().y).toBe(0);
  });

  it('cannot stand up under a low ceiling, stands once clear of it', () => {
    const ceiling = 1.5;
    const world = lowCeilingWorld(ceiling, 2, 6);
    const mc = new MovementController();
    // yaw -90 looks down +x toward the slab
    mc.reset(new Vector3(0, 0, 0), -90);
    for (let i = 0; i < DUCK_TICKS; i += 1) {
      mc.tick(DT, move({ crouchHeld: true }), world);
    }
    while (mc.getFeetPosition().x < 3) {
      mc.tick(DT, move({ forwardMove: 1, crouchHeld: true }), world);
    }

    // let go of crouch under the slab: the hull may only grow until the head touches
    let lowestDuck = 1;
    while (mc.getFeetPosition().x - mc.capsule.radius < 6) {
      mc.tick(DT, move({ forwardMove: 1 }), world);
      const duck = mc.getDuckAmount();
      lowestDuck = Math.min(lowestDuck, duck);
      const hullTop = mc.getFeetPosition().y + STAND.height - HULL_DROP * duck;
      expect(hullTop).toBeLessThan(ceiling);
    }
    expect(lowestDuck).toBeGreaterThan((STAND.height - ceiling) / HULL_DROP);

    for (let i = 0; i < DUCK_TICKS; i += 1) {
      mc.tick(DT, move({ forwardMove: 1 }), world);
    }
    expect(mc.getDuckAmount()).toBe(0);
  });

  it('does not change air strafing, only ground speed', () => {
    // perfect strafe from 9.5 with crouch held from the takeoff tick: every air tick
    // still adds exactly W^2 to v^2, the jump just lasts longer since the feet start higher
    const world = flatWorld();
    const mc = new MovementController();
    mc.reset(new Vector3(0, 0, 0), 0);
    mc.setVelocity(new Vector3(0, 0, -9.5));
    let chain = 0;
    let landingSpeed = 0;
    for (let i = 0; i < 400 && landingSpeed === 0; i += 1) {
      mc.setView(headingYaw(mc.getVelocity()), 0);
      mc.tick(DT, move({ sideMove: 1, jumpHeld: true, crouchHeld: true }), world);
      const stats = mc.getStrafeStats();
      if (stats.chain === 2 && chain === 1) {
        landingSpeed = stats.current!.takeoffSpeed;
      }
      chain = stats.chain;
    }
    const airTicks = mc.getStrafeStats().last!.airTicks;
    expect(airTicks).toBeGreaterThan(70);
    expect(landingSpeed).toBeCloseTo(Math.sqrt(9.5 ** 2 + airTicks * W * W), 9);
  });

  it('crouch state is part of the snapshot, so replays match mid-duck', () => {
    const world = flatWorld();
    const script = (i: number) => move({ forwardMove: 1, crouchHeld: i % 40 < 25, jumpPressed: i === 90, jumpHeld: i === 90 });
    const a = new MovementController();
    a.reset(new Vector3(0, 0, 0), 0);
    for (let i = 0; i < 30; i += 1) {
      a.tick(DT, script(i), world);
    }
    const mid = a.captureState();
    expect(mid.duckAmount).toBeGreaterThan(0);
    expect(mid.duckAmount).toBeLessThan(1);

    const b = new MovementController();
    b.restoreState(mid);
    expect(b.getEyeHeight()).toBe(a.getEyeHeight());
    for (let i = 30; i < 200; i += 1) {
      a.tick(DT, script(i), world);
      b.tick(DT, script(i), world);
    }
    expect(b.captureState()).toEqual(a.captureState());
  });
});
