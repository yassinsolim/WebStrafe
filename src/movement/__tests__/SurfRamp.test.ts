import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { MovementController } from '../MovementController';
import { defaultCvars } from '../cvars';
import { rampHeight, rampWorld } from './testWorlds';

const DT = 1 / 128;
const W = defaultCvars.sv_air_max_wishspeed;
const G = defaultCvars.sv_gravity;

// rampWorld faces +x, so it rises toward -x. at yaw 0 you look down -z along the
// ramp, D is +x (off the ramp) and A is -x (into it).
function surfAlongRamp(angleDeg: number, yawDeg: number, ticks: number) {
  const world = rampWorld(angleDeg);
  const mc = new MovementController();
  mc.reset(new Vector3(1.5, rampHeight(angleDeg, 1.5) + 0.01, 0), yawDeg);
  mc.setVelocity(new Vector3(0, 0, -8));
  const startY = mc.getFeetPosition().y;
  let surfTicks = 0;
  for (let i = 0; i < ticks; i += 1) {
    mc.tick(DT, { forwardMove: 0, sideMove: -1, jumpPressed: false, jumpHeld: false }, world);
    if (mc.getDebugState().surfing) {
      surfTicks += 1;
    }
  }
  return {
    surfTicks,
    drop: startY - mc.getFeetPosition().y,
    speed: mc.getVelocity().length(),
  };
}

describe.each([55, 60])('surfing a %i degree ramp with the capped air accel', (angle) => {
  it('holding into the ramp while looking down it stays in surf and gains speed from gravity', () => {
    // view turned 10 degrees down the ramp: A adds nothing until you drift far enough down
    // the face, then it holds the line while gravity keeps adding speed
    const run = surfAlongRamp(angle, -10, 128);
    expect(run.surfTicks).toBe(128);
    expect(run.drop).toBeGreaterThan(1);
    expect(run.speed).toBeGreaterThan(11);
    // can't beat gravity work plus one full strafe tick (W^2 in |v|^2) per tick
    expect(run.speed ** 2 - 8 ** 2).toBeLessThanOrEqual(2 * G * run.drop + 128 * W * W);
  });

  it('holding into the ramp while looking straight along it holds your height (source does this too)', () => {
    // wishdir points straight into the face; after the ramp clip what's left pushes up the
    // face, and with sv_airaccelerate that beats gravity's g sin(angle) dt every tick
    const run = surfAlongRamp(angle, 0, 128);
    expect(run.surfTicks).toBe(128);
    expect(run.drop).toBeLessThan(0);
    expect(Math.abs(run.speed - 8)).toBeLessThan(0.2);
  });
});
