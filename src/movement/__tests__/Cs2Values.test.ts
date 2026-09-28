import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { MovementController } from '../MovementController';
import { defaultCvars, METRES_PER_UNIT } from '../cvars';
import type { MoveInput } from '../types';
import { weaponMaxSpeed } from '../../combat/weapons';
import { flatWorld, horizontalSpeed, lowCeilingWorld } from './testWorlds';

// cs2 values from DumpSource2/convars.txt and scripts/weapons.vdata in
// SteamTracking/GameTracking-CS2, see docs/movement-cs2.md for the links
const U = METRES_PER_UNIT;
const DT = 1 / 128;
const UP = new Vector3(0, 1, 0);

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

  it('a crouch jump peaks 9 u higher, at 66 u (1.676 m)', () => {
    // cs measures 64 to 66 u blocks with a crouch jump against 55 to 57 u without
    const { apex } = jumpArc({ crouchHeld: true });
    expect(apex / U).toBeLessThanOrEqual(66);
    expect(apex / U).toBeGreaterThan(65.99);
  });
});

describe('cs2 crouch', () => {
  it('has the 72 u hull with 64 u eyes, and 46 u eyes crouched', () => {
    const world = flatWorld();
    const mc = new MovementController();
    expect(mc.capsule.height).toBeCloseTo(72 * U, 12);
    expect(mc.eyeHeight).toBeCloseTo(64 * U, 12);
    mc.reset(new Vector3(0, 0, 0), 0);
    expect(mc.getEyeHeight()).toBeCloseTo(64 * U, 12);
    for (let i = 0; i < 32; i += 1) {
      mc.tick(DT, move({ crouchHeld: true }), world);
    }
    expect(mc.getDuckAmount()).toBe(1);
    expect(mc.getEyeHeight()).toBeCloseTo(46 * U, 12);
  });

  it('the crouched hull is 54 u: 2 cm of headroom over it keeps you down, over 72 u you stand', () => {
    const standUpUnder = (ceiling: number) => {
      const world = lowCeilingWorld(ceiling, -5, 5);
      const mc = new MovementController();
      mc.reset(new Vector3(0, 0, 0), 0);
      for (let i = 0; i < 32; i += 1) {
        mc.tick(DT, move({ crouchHeld: true }), world);
      }
      for (let i = 0; i < 32; i += 1) {
        mc.tick(DT, move(), world);
      }
      return mc.getDuckAmount();
    };
    expect(standUpUnder(54 * U + 0.02)).toBe(1);
    expect(standUpUnder(72 * U + 0.02)).toBe(0);
  });

  it('ducking in the air eases the camera down 9 u instead of jumping', () => {
    const world = flatWorld();
    const mc = new MovementController();
    mc.reset(new Vector3(0, 0, 0), 0);
    mc.tick(DT, move({ jumpPressed: true, jumpHeld: true }), world);
    for (let i = 0; i < 10; i += 1) {
      mc.tick(DT, move(), world);
    }
    const cameraBefore = mc.getCameraPosition().y;
    const vy = mc.getVelocity().y;
    mc.tick(DT, move({ crouchHeld: true }), world);
    const arc = (vy - defaultCvars.sv_gravity * DT * 0.5) * DT;
    const easeStep = (18 * U * DT) / 0.12;
    // the feet came up 9 u, the camera only moved by the arc and one easing step
    expect(mc.getCameraPosition().y - cameraBefore).toBeCloseTo(arc - easeStep, 9);
    // and it catches up at the ground duck rate: 9 u in 8 ticks
    for (let i = 0; i < 7; i += 1) {
      mc.tick(DT, move({ crouchHeld: true }), world);
    }
    expect(mc.getEyeHeight()).toBeCloseTo(46 * U, 12);
    expect(mc.captureState().viewEase).toBe(0);
  });
});

describe('cs2 ground movement', () => {
  it('uses cs2 sv_accelerate, sv_friction, sv_stopspeed, sv_maxspeed and the air cap', () => {
    expect(defaultCvars.sv_accelerate).toBe(5.5);
    expect(defaultCvars.sv_friction).toBe(5.2);
    expect(defaultCvars.sv_stopspeed).toBeCloseTo(80 * U, 12);
    expect(defaultCvars.sv_maxspeed).toBeCloseTo(320 * U, 12);
    expect(defaultCvars.sv_air_max_wishspeed).toBeCloseTo(30 * U, 12);
  });

  it('running from a standstill tops out at wishspeed and never passes it', () => {
    const world = flatWorld();
    const mc = new MovementController();
    mc.reset(new Vector3(0, 0, 0), 0);
    let peak = 0;
    for (let i = 0; i < 256; i += 1) {
      mc.tick(DT, move({ forwardMove: 1 }), world);
      peak = Math.max(peak, horizontalSpeed(mc.getVelocity()));
    }
    expect(peak).toBeLessThanOrEqual(defaultCvars.sv_maxspeed + 1e-9);
    expect(horizontalSpeed(mc.getVelocity())).toBeCloseTo(defaultCvars.sv_maxspeed, 9);
  });

  it('brakes at a constant sv_stopspeed * sv_friction below 80 u/s', () => {
    const world = flatWorld();
    const mc = new MovementController();
    mc.reset(new Vector3(0, 0, 0), 0);
    mc.setVelocity(new Vector3(0, 0, -1.5));
    const drop = defaultCvars.sv_stopspeed * defaultCvars.sv_friction * DT;
    mc.tick(DT, move(), world);
    expect(horizontalSpeed(mc.getVelocity())).toBeCloseTo(1.5 - drop, 12);
    let ticks = 1;
    while (horizontalSpeed(mc.getVelocity()) > 0) {
      mc.tick(DT, move(), world);
      ticks += 1;
    }
    expect(ticks).toBe(Math.ceil(1.5 / drop));
  });

  it('a fast landing without a jump bleeds off through friction, not a clamp', () => {
    const world = flatWorld();
    const mc = new MovementController();
    mc.reset(new Vector3(0, 0.3, 0), 0);
    mc.setVelocity(new Vector3(0, -1, -12));
    while (!mc.getDebugState().grounded) {
      mc.tick(DT, move({ forwardMove: 1 }), world);
    }
    expect(horizontalSpeed(mc.getVelocity())).toBeCloseTo(12, 9);
    const k = defaultCvars.sv_friction * DT;
    mc.tick(DT, move({ forwardMove: 1 }), world);
    expect(horizontalSpeed(mc.getVelocity())).toBeCloseTo(12 * (1 - k), 9);
    for (let i = 0; i < 32; i += 1) {
      mc.tick(DT, move({ forwardMove: 1 }), world);
    }
    expect(horizontalSpeed(mc.getVelocity())).toBeCloseTo(defaultCvars.sv_maxspeed, 9);
  });

  it('turning while running stays within 3% of wishspeed', () => {
    // with sv_accelerate only just above sv_friction the best turn each tick still keeps
    // v^2 under (2 a w - a^2) / (1 - (1 - k)^2), a = accel w dt, k = friction dt: 8.35 m/s
    const world = flatWorld();
    const mc = new MovementController();
    const w = defaultCvars.sv_maxspeed;
    const a = defaultCvars.sv_accelerate * w * DT;
    const k = defaultCvars.sv_friction * DT;
    mc.reset(new Vector3(0, 0, 0), 0);
    mc.setVelocity(new Vector3(0, 0, -w));
    let peak = 0;
    for (let i = 0; i < 512; i += 1) {
      const v = mc.getVelocity().setY(0);
      // the widest wishdir angle that still takes the full accel after friction
      const theta = Math.acos(Math.min(1, (w - a) / (v.length() * (1 - k))));
      const wish = v.normalize().applyAxisAngle(UP, -theta);
      // D is (cos yaw, 0, -sin yaw)
      mc.setView(Math.atan2(-wish.z, wish.x), 0);
      mc.tick(DT, move({ sideMove: 1 }), world);
      peak = Math.max(peak, horizontalSpeed(mc.getVelocity()));
    }
    const bound = Math.sqrt((2 * a * w - a * a) / (1 - (1 - k) ** 2));
    expect(peak).toBeGreaterThan(w);
    expect(peak).toBeLessThanOrEqual(bound + 1e-9);
    expect(peak / w).toBeLessThan(1.03);
  });
});

describe('cs2 weapon run speeds', () => {
  /** runs W from a standstill with the weapon cap set, crouched or not, and returns the final and peak speed */
  function runWith(cap: number, crouch = false): { speed: number; peak: number } {
    const world = flatWorld();
    const mc = new MovementController();
    mc.setMaxSpeedCap(cap);
    mc.reset(new Vector3(0, 0, 0), 0);
    for (let i = 0; crouch && i < 32; i += 1) {
      mc.tick(DT, move({ crouchHeld: true }), world);
    }
    let peak = 0;
    for (let i = 0; i < 384; i += 1) {
      mc.tick(DT, move({ forwardMove: 1, crouchHeld: crouch }), world);
      peak = Math.max(peak, horizontalSpeed(mc.getVelocity()));
    }
    return { speed: horizontalSpeed(mc.getVelocity()), peak };
  }

  const cases = [
    ['knife', false, 250],
    ['deagle', false, 230],
    ['awp', false, 200],
    ['awp', true, 100],
  ] as const;

  it.each(cases)('%s (scoped %s) runs at %i u/s', (id, scoped, units) => {
    const { speed, peak } = runWith(weaponMaxSpeed(id, scoped));
    expect(speed).toBeCloseTo(units * U, 9);
    expect(peak).toBeLessThanOrEqual(units * U + 1e-9);
  });

  it.each(cases)('%s (scoped %s) crouch-walks at 0.34 x %i u/s', (id, scoped, units) => {
    // 85 u/s with the knife down to 34 u/s scoped, all reachable against stopspeed friction
    const { speed, peak } = runWith(weaponMaxSpeed(id, scoped), true);
    expect(speed).toBeCloseTo(0.34 * units * U, 9);
    expect(peak).toBeLessThanOrEqual(0.34 * units * U + 1e-9);
  });

  it('sv_maxspeed still caps a weapon that is faster than it', () => {
    const mc = new MovementController();
    mc.setCvar('sv_maxspeed', 200 * U);
    mc.setMaxSpeedCap(weaponMaxSpeed('knife'));
    expect(mc.getMaxSpeed()).toBeCloseTo(200 * U, 12);
  });

  it('scoping in while running slows down through friction, not a snap', () => {
    const world = flatWorld();
    const mc = new MovementController();
    mc.setMaxSpeedCap(weaponMaxSpeed('awp'));
    mc.reset(new Vector3(0, 0, 0), 0);
    for (let i = 0; i < 384; i += 1) {
      mc.tick(DT, move({ forwardMove: 1 }), world);
    }
    mc.setMaxSpeedCap(weaponMaxSpeed('awp', true));
    mc.tick(DT, move({ forwardMove: 1 }), world);
    expect(horizontalSpeed(mc.getVelocity())).toBeCloseTo(200 * U * (1 - defaultCvars.sv_friction * DT), 9);
    for (let i = 0; i < 64; i += 1) {
      mc.tick(DT, move({ forwardMove: 1 }), world);
    }
    expect(horizontalSpeed(mc.getVelocity())).toBeCloseTo(100 * U, 9);
  });

  it('clearing the cap leaves sv_maxspeed, and reset keeps it', () => {
    const mc = new MovementController();
    mc.setMaxSpeedCap(weaponMaxSpeed('deagle'));
    mc.reset(new Vector3(0, 0, 0), 0);
    expect(mc.getMaxSpeed()).toBeCloseTo(230 * U, 12);
    for (const cleared of [Number.POSITIVE_INFINITY, 0, -1, Number.NaN]) {
      mc.setMaxSpeedCap(cleared);
      expect(mc.getMaxSpeed()).toBe(defaultCvars.sv_maxspeed);
    }
  });
});
