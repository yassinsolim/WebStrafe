import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { CollisionWorld } from '../../world/CollisionWorld';
import { createMovementTestScene } from '../../movement/MovementTestScene';
import {
  BotController,
  DEFAULT_BOT_PARAMS,
  decideBotInput,
  type BotMovementState,
} from '../BotController';

const dt = 1 / 60;

function state(partial: Partial<BotMovementState> = {}): BotMovementState {
  return {
    feet: new Vector3(0, 0, 0),
    yawRad: 0,
    pitchRad: 0,
    horizontalSpeed: 5,
    grounded: true,
    ...partial,
  };
}

describe('decideBotInput', () => {
  it('does not move or turn without a target (but hops if wedged)', () => {
    const idle = decideBotInput(state({ horizontalSpeed: 0 }), { targetFeet: null }, DEFAULT_BOT_PARAMS, dt);
    expect(idle.forwardMove).toBe(0);
    expect(idle.yawDelta).toBe(0);
    expect(idle.jump).toBe(true);

    const idleMoving = decideBotInput(state({ horizontalSpeed: 10 }), { targetFeet: null }, DEFAULT_BOT_PARAMS, dt);
    expect(idleMoving.jump).toBe(false);
  });

  it('advances toward a distant target it is already facing', () => {
    // Bot at origin, yaw 0 => forward = (0,0,-1). Target straight ahead at -Z.
    const d = decideBotInput(state(), { targetFeet: new Vector3(0, 0, -50) }, DEFAULT_BOT_PARAMS, dt);
    expect(d.forwardMove).toBe(1);
    expect(Math.abs(d.yawDelta)).toBeLessThan(1e-6);
  });

  it('stops advancing once within stop distance', () => {
    const d = decideBotInput(state(), { targetFeet: new Vector3(0, 0, -3) }, DEFAULT_BOT_PARAMS, dt);
    expect(d.forwardMove).toBe(0);
  });

  it('turns toward a target to the side, clamped by the turn rate', () => {
    // Target to the bot's left/right; yaw must change but no more than turnRate*dt.
    const d = decideBotInput(state(), { targetFeet: new Vector3(50, 0, 0) }, DEFAULT_BOT_PARAMS, dt);
    expect(Math.abs(d.yawDelta)).toBeGreaterThan(0);
    expect(Math.abs(d.yawDelta)).toBeLessThanOrEqual(DEFAULT_BOT_PARAMS.turnRateRadPerSec * dt + 1e-9);
  });

  it('does not advance while facing away from the target', () => {
    // Target directly behind (at +Z while facing -Z): should turn, not walk forward.
    const d = decideBotInput(state(), { targetFeet: new Vector3(0, 0, 50) }, DEFAULT_BOT_PARAMS, dt);
    expect(d.forwardMove).toBe(0);
    expect(Math.abs(d.yawDelta)).toBeGreaterThan(0);
  });

  it('chooses the shortest turn direction', () => {
    // Target slightly to the right of forward -> negative-ish yaw step, magnitude small.
    const right = decideBotInput(state(), { targetFeet: new Vector3(5, 0, -50) }, DEFAULT_BOT_PARAMS, dt);
    const left = decideBotInput(state(), { targetFeet: new Vector3(-5, 0, -50) }, DEFAULT_BOT_PARAMS, dt);
    expect(Math.sign(right.yawDelta)).toBe(-Math.sign(left.yawDelta));
  });

  it('does not fire until aimed at the target', () => {
    // Target 90 degrees to the side: not aimed, must not fire.
    const unaimed = decideBotInput(state(), { targetFeet: new Vector3(50, 0, 0) }, DEFAULT_BOT_PARAMS, dt);
    expect(unaimed.fire).toBe(false);
  });

  it('fires when aimed at an in-range target', () => {
    // Bot at origin facing -Z (yaw 0). Target straight ahead, close, at eye height.
    const aimed = decideBotInput(
      state({ pitchRad: 0 }),
      { targetFeet: new Vector3(0, -0.4, -30) }, // feet+1.2 ≈ eye(1.6): near-zero pitch
      DEFAULT_BOT_PARAMS,
      dt,
    );
    expect(aimed.fire).toBe(true);
  });

  it('does not fire beyond engage range', () => {
    const far = decideBotInput(
      state(),
      { targetFeet: new Vector3(0, -0.4, -(DEFAULT_BOT_PARAMS.engageRange + 500)) },
      DEFAULT_BOT_PARAMS,
      dt,
    );
    expect(far.fire).toBe(false);
  });

  it('pitches up toward a target that is above the bot', () => {
    // Target well above -> desired pitch > 0 -> positive pitchDelta.
    const d = decideBotInput(state(), { targetFeet: new Vector3(0, 100, -30) }, DEFAULT_BOT_PARAMS, dt);
    expect(d.pitchDelta).toBeGreaterThan(0);
  });

  it('air-strafes (holds a strafe, no forward) instead of walking while surfing', () => {
    const surfD = decideBotInput(
      state({ grounded: false, mode: 'surf', recommendedStrafe: 'D', velX: 8, velZ: 0 }),
      { targetFeet: new Vector3(0, 0, -50) },
      DEFAULT_BOT_PARAMS,
      dt,
    );
    expect(surfD.forwardMove).toBe(0);
    expect(surfD.sideMove).toBe(1); // follows the 'D' auto-surf hint
    expect(surfD.jump).toBe(false); // never jump off the ramp

    const surfA = decideBotInput(
      state({ grounded: false, mode: 'surf', recommendedStrafe: 'A', velX: 8, velZ: 0 }),
      { targetFeet: new Vector3(0, 0, -50) },
      DEFAULT_BOT_PARAMS,
      dt,
    );
    expect(surfA.sideMove).toBe(-1); // follows the 'A' hint
  });

  it('drifts toward the target while free-falling in the air (no runaway strafe)', () => {
    // In open air (not on a ramp) the bot should just face + drift toward the
    // target, NOT circle-strafe for speed (which flings it off the map).
    const d = decideBotInput(
      state({ grounded: false, mode: 'air', recommendedStrafe: 'NONE', velX: 10, velZ: 0, yawRad: 0 }),
      { targetFeet: new Vector3(0, 0, -200) },
      DEFAULT_BOT_PARAMS,
      dt,
    );
    expect(d.forwardMove).toBe(1); // drift toward target
    expect(d.sideMove).toBe(0); // no speed-building strafe in free air
    expect(Math.abs(d.yawDelta)).toBeLessThanOrEqual(DEFAULT_BOT_PARAMS.turnRateRadPerSec * dt + 1e-9);
  });
});

describe('BotController (integrates real physics)', () => {
  function makeWorld(): CollisionWorld {
    const { root } = createMovementTestScene();
    const world = new CollisionWorld();
    world.setCollisionFromRoot(root);
    return world;
  }

  it('moves toward a target over time without leaving the world (no noclip)', () => {
    const world = makeWorld();
    const bot = new BotController(new Vector3(0, 6, 8), 180);
    const target = new Vector3(0, 0, -8);

    const start = bot.getFeet().clone();
    for (let i = 0; i < 240; i += 1) {
      bot.tick(dt, world, { targetFeet: target });
    }
    const end = bot.getFeet();

    // It should have made horizontal progress toward the target...
    const startDist = Math.hypot(target.x - start.x, target.z - start.z);
    const endDist = Math.hypot(target.x - end.x, target.z - end.z);
    expect(endDist).toBeLessThan(startDist);
    // ...and stayed within sane world bounds (never flew off to infinity / noclipped away).
    expect(Number.isFinite(end.x)).toBe(true);
    expect(Math.abs(end.x)).toBeLessThan(1000);
    expect(Math.abs(end.y)).toBeLessThan(1000);
    expect(Math.abs(end.z)).toBeLessThan(1000);
  });

  it('respawn resets position', () => {
    const world = makeWorld();
    const bot = new BotController(new Vector3(0, 6, 8), 180);
    for (let i = 0; i < 30; i += 1) {
      bot.tick(dt, world, { targetFeet: new Vector3(0, 0, -8) });
    }
    bot.respawn(new Vector3(3, 6, 3), 90);
    expect(bot.getFeet().distanceTo(new Vector3(3, 6, 3))).toBeLessThan(1e-6);
  });

  it('fires only in disciplined bursts, not a continuous stream', () => {
    const world = makeWorld();
    // Bot on flat ground with a close, eye-level target dead ahead (yaw 180 =>
    // forward +Z; target at +Z). It should aim and shoot — but in bursts.
    const bot = new BotController(new Vector3(0, 1, 0), 180);
    const target = new Vector3(0, 0.4, 5);

    let firing = 0;
    let idleAfterReaction = 0;
    const ticks = 360; // 6 seconds
    for (let i = 0; i < ticks; i += 1) {
      bot.tick(dt, world, { targetFeet: target });
      const afterReaction = i * dt > DEFAULT_BOT_PARAMS.reactionDelaySec + 0.3;
      if (bot.wantsToFire()) firing += 1;
      else if (afterReaction) idleAfterReaction += 1;
    }

    // It does shoot sometimes…
    expect(firing).toBeGreaterThan(0);
    // …but nowhere near every tick — bursts + cooldown keep the duty cycle low.
    expect(firing / ticks).toBeLessThan(0.5);
    // …and there are plenty of hold-fire ticks after the reaction delay.
    expect(idleAfterReaction).toBeGreaterThan(0);
  });

  it('surfs a ramp (stays on it, keeps speed) instead of instantly falling off', () => {
    const world = makeWorld();
    // Seed on the training surf ramp with a target far along it, like a fleeing
    // player. The surf AI should ride the ramp: spend time surfing, keep speed,
    // and not be flagged as "fallen off".
    const bot = new BotController(new Vector3(6, 10, 2), -90);
    const target = new Vector3(40, 0, 2);

    let maxSpeed = 0;
    for (let i = 0; i < 240; i += 1) {
      bot.tick(dt, world, { targetFeet: target });
      const vel = bot.getVelocity();
      maxSpeed = Math.max(maxSpeed, Math.hypot(vel.x, vel.z));
    }

    // It builds real horizontal speed off the ramp (a face-plant would kill it).
    expect(maxSpeed).toBeGreaterThan(5);
    // And it isn't treated as having fallen off the map (it surfed, didn't plummet).
    expect(bot.hasFallenOff()).toBe(false);
  });
});
