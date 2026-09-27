import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { MovementController } from '../MovementController';
import { defaultCvars } from '../cvars';
import type { MoveInput } from '../types';
import { flatWorld, horizontalSpeed, stepDownWorld } from './testWorlds';

const DT = 1 / 128;
const idle: MoveInput = { forwardMove: 0, sideMove: 0, jumpPressed: false, jumpHeld: false };
const tap: MoveInput = { forwardMove: 0, sideMove: 0, jumpPressed: true, jumpHeld: true };
const hold: MoveInput = { forwardMove: 0, sideMove: 0, jumpPressed: false, jumpHeld: true };

// the ground probe reaches 0.18 m under the feet. inside that band a rising player is
// still in the air (no friction, no re-jump) and a landing puts the feet on the floor,
// not wherever the probe first saw it.
describe('ground contact around jumps', () => {
  it('a tap jump lands back on the floor instead of hovering in the probe band', () => {
    const world = flatWorld();
    const mc = new MovementController();
    mc.reset(new Vector3(0, 0, 0), 0);
    mc.tick(DT, tap, world);
    let landedAt = -1;
    for (let i = 1; i < 200; i += 1) {
      mc.tick(DT, idle, world);
      const debug = mc.getDebugState();
      if (debug.grounded) {
        // grounded always means feet on the floor
        expect(mc.getFeetPosition().y).toBe(0);
        if (landedAt < 0) {
          landedAt = i;
        }
      }
    }
    expect(landedAt).toBeGreaterThan(60);
    expect(mc.getFeetPosition().y).toBe(0);
    expect(mc.getCameraPosition().y).toBeCloseTo(mc.eyeHeight, 9);
  });

  it('rising out of a jump is air: no takeoff friction and one impulse', () => {
    const world = flatWorld();
    const mc = new MovementController();
    mc.reset(new Vector3(0, 0, 0), 0);
    mc.setVelocity(new Vector3(0, 0, -9.5));
    mc.setCvar('sv_autobhop_enabled', false);

    mc.tick(DT, tap, world);
    let vy = mc.getVelocity().y;
    expect(vy).toBeCloseTo(defaultCvars.sv_jump_impulse - defaultCvars.sv_gravity * DT, 9);
    while (!mc.getDebugState().grounded) {
      // jump stays held, but without autobhop only a fresh press may jump again
      mc.tick(DT, hold, world);
      const debug = mc.getDebugState();
      if (!debug.grounded) {
        expect(debug.frictionApplied).toBe(false);
        expect(horizontalSpeed(mc.getVelocity())).toBe(9.5);
        expect(mc.getVelocity().y).toBeLessThan(vy);
        vy = mc.getVelocity().y;
      }
    }
  });

  it('holding jump with autobhop takes off once per landing', () => {
    const world = flatWorld();
    const mc = new MovementController();
    mc.reset(new Vector3(0, 0, 0), 0);
    // a takeoff tick leaves vy at exactly the impulse minus one tick of gravity
    const afterTakeoff = defaultCvars.sv_jump_impulse - defaultCvars.sv_gravity * DT;
    const takeoffTicks: number[] = [];
    for (let i = 0; i < 351; i += 1) {
      mc.tick(DT, hold, world);
      if (Math.abs(mc.getVelocity().y - afterTakeoff) < 1e-12) {
        takeoffTicks.push(i);
      }
    }
    // 70 air ticks per jump, see the chain derivation in AirStrafe.test.ts
    expect(takeoffTicks).toEqual([0, 70, 140, 210, 280, 350]);
  });

  it('walking off a small step settles on the lower floor', () => {
    const world = stepDownWorld(0.15);
    const mc = new MovementController();
    // yaw -90 looks down +x, the step is at x = 0
    mc.reset(new Vector3(-1, 0, 0), -90);
    for (let i = 0; i < 128; i += 1) {
      mc.tick(DT, { ...idle, forwardMove: 1 }, world);
    }
    expect(mc.getFeetPosition().x).toBeGreaterThan(5);
    expect(mc.getFeetPosition().y).toBe(-0.15);
    expect(mc.getDebugState().grounded).toBe(true);
  });
});
