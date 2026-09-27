import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { MovementController } from '../../movement/MovementController';
import { createMovementTestScene } from '../../movement/MovementTestScene';
import type { MoveInput, MovementSnapshot } from '../../movement/types';
import { CollisionWorld } from '../../world/CollisionWorld';
import { ErrorSmoother, PredictionLedger } from '../Prediction';

const DT = 1 / 128;

interface TickInput {
  move: MoveInput;
  yaw: number;
  pitch: number;
}

// bhop-ish script: hold forward, strafe back and forth while turning, jump often
function scriptedInput(tick: number): TickInput {
  const strafe = Math.floor(tick / 40) % 2 === 0 ? 1 : -1;
  return {
    move: {
      forwardMove: tick < 60 ? 1 : 0,
      sideMove: tick < 60 ? 0 : strafe,
      jumpPressed: tick % 50 === 0,
      jumpHeld: tick % 50 < 3,
    },
    yaw: Math.PI + strafe * 0.004 * (tick % 40),
    pitch: 0,
  };
}

function makeSim(world: CollisionWorld, spawn: Vector3) {
  const mc = new MovementController();
  mc.reset(spawn, 180);
  const step = (state: MovementSnapshot, input: TickInput): MovementSnapshot => {
    mc.restoreState(state);
    mc.setView(input.yaw, input.pitch);
    mc.tick(DT, input.move, world);
    return mc.captureState();
  };
  return { mc, step };
}

const posError = (a: MovementSnapshot, b: MovementSnapshot) =>
  Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1], a.position[2] - b.position[2]);

describe('prediction + reconciliation on the real movement code', () => {
  const { root, spawn } = createMovementTestScene();
  const world = new CollisionWorld();
  world.setCollisionFromRoot(root);

  function run(perturbAtTick: number | null) {
    const client = makeSim(world, spawn);
    const server = makeSim(world, spawn);
    let clientState = client.mc.captureState();
    let serverState = server.mc.captureState();
    const serverStates: MovementSnapshot[] = [];
    const ledger = new PredictionLedger<TickInput, MovementSnapshot>();
    const latencyTicks = 12;
    let corrections = 0;
    let maxError = 0;

    for (let tick = 1; tick <= 400; tick += 1) {
      const input = scriptedInput(tick);
      clientState = client.step(clientState, input);
      ledger.record(tick, input, clientState);

      serverState = server.step(serverState, input);
      if (tick === perturbAtTick) {
        // something only the server knows about: a knockback from a hit
        serverState = { ...serverState, velocity: [serverState.velocity[0] + 6, serverState.velocity[1] + 3, serverState.velocity[2]] };
      }
      serverStates[tick] = serverState;

      // server acks every 4th tick, arriving `latencyTicks` later
      const ack = tick - latencyTicks;
      if (ack > 0 && ack % 4 === 0) {
        const result = ledger.reconcile(ack, serverStates[ack], {
          replay: (s, i) => client.step(s, i),
          error: posError,
          tolerance: 1e-6,
        });
        if (result.corrected && result.state) {
          corrections += 1;
          maxError = Math.max(maxError, result.error);
          clientState = result.state;
        }
      }
    }
    return { clientState, serverState, corrections, maxError };
  }

  it('is deterministic: with identical inputs the client never corrects', () => {
    const { corrections, clientState, serverState } = run(null);
    expect(corrections).toBe(0);
    expect(posError(clientState, serverState)).toBe(0);
  });

  it('snaps back onto the server path after a server-only knockback', () => {
    const { corrections, clientState, serverState, maxError } = run(150);
    expect(corrections).toBeGreaterThanOrEqual(1);
    expect(maxError).toBeGreaterThan(0.01);
    // after replay the present matches the authority exactly
    expect(posError(clientState, serverState)).toBeLessThan(1e-9);
  });
});

describe('ErrorSmoother', () => {
  it('bleeds a correction out and snaps large ones', () => {
    const smoother = new ErrorSmoother();
    smoother.add([0.5, 0, 0]);
    for (let i = 0; i < 30; i += 1) smoother.update(1 / 128);
    expect(smoother.offset[0]).toBeGreaterThan(0);
    expect(smoother.offset[0]).toBeLessThan(0.5);
    smoother.add([5, 0, 0]);
    expect(smoother.offset[0]).toBe(0);
  });
});
