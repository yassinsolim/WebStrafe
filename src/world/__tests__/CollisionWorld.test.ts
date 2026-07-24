import { describe, expect, it } from 'vitest';
import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import { CollisionWorld } from '../CollisionWorld';
import { createMovementTestScene } from '../../movement/MovementTestScene';

// The test scene's main floor is a 2-unit-thick slab spanning x,z in [-110, 110]
// with its top at y = 0.
function makeWorld(): CollisionWorld {
  const { root } = createMovementTestScene();
  const world = new CollisionWorld();
  world.setCollisionFromRoot(root);
  return world;
}

describe('CollisionWorld.segmentIntersectsGeometry (line of sight)', () => {
  it('reports a blocked segment when it passes through the floor', () => {
    const world = makeWorld();
    expect(world.segmentIntersectsGeometry(new Vector3(0, 10, 0), new Vector3(0, -10, 0))).toBe(true);
  });

  it('reports a clear segment in open air above the geometry', () => {
    const world = makeWorld();
    expect(world.segmentIntersectsGeometry(new Vector3(0, 60, 0), new Vector3(0, 60, 80))).toBe(false);
  });

  it('does not report a hit when the wall is beyond the segment end (far clamp)', () => {
    const world = makeWorld();
    // Both endpoints are above the floor; the ray never reaches it.
    expect(world.segmentIntersectsGeometry(new Vector3(0, 10, 0), new Vector3(0, 5, 0))).toBe(false);
  });

  it('detects a thin slab crossed by a long shallow segment (no tunneling)', () => {
    const world = makeWorld();
    // ~210-unit near-horizontal ray that dips from just above the 2-unit floor
    // slab on one side to just below it on the other. A coarse fixed-step sweep
    // can miss this; the exact BVH raycast must catch it.
    const blocked = world.segmentIntersectsGeometry(new Vector3(-105, 1, 0), new Vector3(105, -1, 0));
    expect(blocked).toBe(true);
  });

  it('returns false for a degenerate zero-length segment', () => {
    const world = makeWorld();
    expect(world.segmentIntersectsGeometry(new Vector3(0, 10, 0), new Vector3(0, 10, 0))).toBe(false);
  });
});


describe('CollisionWorld.raycastGeometry', () => {
  it('returns the resolved point, normal, and distance for impact feedback', () => {
    const world = makeWorld();
    const hit = world.raycastGeometry(new Vector3(0, 10, 0), new Vector3(0, -4, 0), 20);

    expect(hit).not.toBeNull();
    expect(hit?.point.y).toBeCloseTo(0, 4);
    expect(hit?.distance).toBeCloseTo(10, 4);
    expect(hit?.normal.length()).toBeCloseTo(1, 6);
  });

  it('honors range and rejects unusable rays', () => {
    const world = makeWorld();
    expect(world.raycastGeometry(new Vector3(0, 10, 0), new Vector3(0, -1, 0), 5)).toBeNull();
    expect(world.raycastGeometry(new Vector3(), new Vector3(), 20)).toBeNull();
    expect(world.raycastGeometry(new Vector3(), new Vector3(0, -1, 0), 0)).toBeNull();
  });

  it('hits back-facing imported floors and orients the impact toward the shot', () => {
    const geometry = new BufferGeometry();
    // Clockwise from above: the authored face normal points down.
    geometry.setAttribute('position', new Float32BufferAttribute([
      -5, 0, -5,
      5, 0, -5,
      0, 0, 5,
    ], 3));
    const world = new CollisionWorld();
    world.setCollisionGeometry(geometry);

    const hit = world.raycastGeometry(
      new Vector3(0, 4, 0),
      new Vector3(0, -1, 0),
      10,
    );

    expect(hit?.point.y).toBeCloseTo(0, 6);
    expect(hit?.normal.x).toBeCloseTo(0, 6);
    expect(hit?.normal.y).toBeCloseTo(1, 6);
    expect(hit?.normal.z).toBeCloseTo(0, 6);
  });
});
