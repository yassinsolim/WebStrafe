import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { MovementController } from '../MovementController';
import { defaultCvars, METRES_PER_UNIT } from '../cvars';
import type { MoveInput } from '../types';
import { flatWorld } from './testWorlds';

// cs2 values from DumpSource2/convars.txt and scripts/weapons.vdata in
// SteamTracking/GameTracking-CS2, see docs/movement-cs2.md for the links
const U = METRES_PER_UNIT;
const DT = 1 / 128;

const move = (opts: Partial<MoveInput> = {}): MoveInput => ({
  forwardMove: 0,
  sideMove: 0,
  jumpPressed: false,
  jumpHeld: false,
  ...opts,
});

/** highest the feet get in one jump from a standing start, and the air ticks it took */
function jumpArc(opts: Partial<MoveInput> = {}): { apex: number; airTicks: number } {
  const world = flatWorld();
  const mc = new MovementController();
  mc.reset(new Vector3(0, 0, 0), 0);
  mc.tick(DT, move({ ...opts, jumpPressed: true, jumpHeld: true }), world);
  let apex = mc.getFeetPosition().y;
  let airTicks = 1;
  while (!mc.getDebugState().grounded) {
    mc.tick(DT, move(opts), world);
    apex = Math.max(apex, mc.getFeetPosition().y);
    airTicks += 1;
  }
  return { apex, airTicks };
}

describe('cs2 jump', () => {
  it('uses cs2 sv_gravity 800 and sv_jump_impulse 301.99338, in metres', () => {
    expect(defaultCvars.sv_gravity).toBeCloseTo(800 * U, 12);
    expect(defaultCvars.sv_jump_impulse).toBeCloseTo(301.99338 * U, 12);
  });

  it('peaks at 57 u (1.448 m), the height the impulse is built from', () => {
    // sv_jump_impulse = sqrt(2 * sv_gravity * 57). gravity goes in two halves around the
    // move like source, so only the tick sampling of the apex is lost (under 0.01 u)
    const { apex, airTicks } = jumpArc();
    expect(apex / U).toBeLessThanOrEqual(57);
    expect(apex / U).toBeGreaterThan(56.99);
    // 2 * 301.99 / 800 = 0.755 s in the air, the landing snap catches it on tick 96
    expect(airTicks).toBe(96);
  });
});
