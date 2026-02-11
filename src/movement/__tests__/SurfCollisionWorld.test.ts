import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { MovementController } from '../MovementController';
import { createMovementTestScene } from '../MovementTestScene';
import { CollisionWorld } from '../../world/CollisionWorld';

describe('Surf regression against triangle collision world', () => {
  const dt = 1 / 128;

  it('keeps sliding on the steep training ramp instead of stopping dead', () => {
    const { root } = createMovementTestScene();
    const world = new CollisionWorld();
    world.setCollisionFromRoot(root);

    const player = new MovementController();
    player.reset(new Vector3(6, 10, 2), -90);
    player.setVelocity(new Vector3(8, -1, 0));

    let surfTicks = 0;
    let firstSurfTick = -1;
    let minSurfSpeed = Number.POSITIVE_INFINITY;
    let severeDropTicks = 0;

    for (let i = 0; i < 320; i += 1) {
      player.applyLookDelta(-2, 0, 1);
      player.tick(
        dt,
        {
          forwardMove: 0,
          sideMove: -1,
          jumpHeld: false,
          jumpPressed: false,
        },
        world,
      );

      const debug = player.getDebugState();
      if (debug.surfing) {
        surfTicks += 1;
        if (firstSurfTick < 0) {
          firstSurfTick = i;
        }
        minSurfSpeed = Math.min(minSurfSpeed, debug.speed);
      }
      if (debug.collisionSpeedBefore > 2 && debug.collisionSpeedAfter < debug.collisionSpeedBefore * 0.25) {
        severeDropTicks += 1;
      }
    }

    expect(firstSurfTick).toBeGreaterThanOrEqual(0);
    expect(surfTicks).toBeGreaterThan(40);
    expect(minSurfSpeed).toBeGreaterThan(2);
    expect(severeDropTicks).toBeLessThan(4);
  });

  it('does not hard-stop when traversing near surf ramp edges', () => {
    const { root } = createMovementTestScene();
    const world = new CollisionWorld();
    world.setCollisionFromRoot(root);

    const player = new MovementController();
    player.reset(new Vector3(16, 8, 0), -90);
    player.setVelocity(new Vector3(8, -1.5, 0));

    let minSpeed = Number.POSITIVE_INFINITY;
    let severeDropTicks = 0;
    let surfTicks = 0;

    for (let i = 0; i < 260; i += 1) {
      player.applyLookDelta(-2, 0, 1);
      player.tick(
        dt,
        {
          forwardMove: 0,
          sideMove: -1,
          jumpHeld: false,
          jumpPressed: false,
        },
        world,
      );

      const debug = player.getDebugState();
      minSpeed = Math.min(minSpeed, debug.speed);
      if (debug.surfing) {
        surfTicks += 1;
      }
      if (debug.collisionSpeedBefore > 2 && debug.collisionSpeedAfter < debug.collisionSpeedBefore * 0.25) {
        severeDropTicks += 1;
      }
    }

    expect(surfTicks).toBeGreaterThan(20);
    expect(severeDropTicks).toBe(0);
    expect(minSpeed).toBeGreaterThan(2);
  });

  it('keeps sliding past the first ramp lip without sticking to the edge wall', () => {
    const { root } = createMovementTestScene();
    const world = new CollisionWorld();
    world.setCollisionFromRoot(root);

    const player = new MovementController();
    player.reset(new Vector3(13, 9.2, 0), -80);
    player.setVelocity(new Vector3(7.5, -2.2, 0));

    let severeStops = 0;
    let minMovement = Number.POSITIVE_INFINITY;
    let edgeContactTicks = 0;

    for (let i = 0; i < 180; i += 1) {
      const beforePos = player.getFeetPosition();
      player.applyLookDelta(-2, 0, 1);
      player.tick(
        dt,
        {
          forwardMove: 0,
          sideMove: -1,
          jumpHeld: false,
          jumpPressed: false,
        },
        world,
      );

      const debug = player.getDebugState();
      const afterPos = player.getFeetPosition();
      const moved = afterPos.distanceTo(beforePos);
      minMovement = Math.min(minMovement, moved);

      const hitWallLike = Math.abs(debug.lastCollisionNormal.y) < 0.25;
      if (hitWallLike) {
        edgeContactTicks += 1;
      }
      if (hitWallLike && debug.collisionSpeedBefore > 2 && debug.collisionSpeedAfter < debug.collisionSpeedBefore * 0.35) {
        severeStops += 1;
      }
    }

    expect(edgeContactTicks).toBeGreaterThan(3);
    expect(severeStops).toBe(0);
    expect(minMovement).toBeGreaterThan(0.01);
  });
});
