import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { resolveHit, type TargetCapsule } from '../HitResolver';

function target(id: string, x: number, y: number, z: number): TargetCapsule {
  return { id, feet: new Vector3(x, y, z), height: 1.8, radius: 0.34 };
}

const origin = new Vector3(0, 1, 0); // roughly eye height
const forward = new Vector3(0, 0, -1);

describe('resolveHit', () => {
  it('hits a target directly in the line of fire', () => {
    const hit = resolveHit(origin, forward, 100, [target('t1', 0, 0, -10)]);
    expect(hit).not.toBeNull();
    expect(hit!.targetId).toBe('t1');
    expect(hit!.distance).toBeCloseTo(10, 0);
  });

  it('misses a target off to the side', () => {
    const hit = resolveHit(origin, forward, 100, [target('t1', 5, 0, -10)]);
    expect(hit).toBeNull();
  });

  it('returns the nearest of two in-line targets', () => {
    const hit = resolveHit(origin, forward, 100, [
      target('far', 0, 0, -30),
      target('near', 0, 0, -8),
    ]);
    expect(hit!.targetId).toBe('near');
  });

  it('detects a headshot when aimed at the top of the capsule', () => {
    // Head band is the top 18% of a 1.8-tall capsule at feet y=0 => y in [1.476, 1.8].
    // From eye y=1, aim at head center (~y=1.64) 10 units away: slope ~0.064.
    const t: TargetCapsule = { id: 'h', feet: new Vector3(0, 0, -10), height: 1.8, radius: 0.34 };
    const toHead = new Vector3(0, 1.64 - 1, -10).normalize();
    const hit = resolveHit(new Vector3(0, 1, 0), toHead, 100, [t]);
    expect(hit).not.toBeNull();
    expect(hit!.hitbox).toBe('head');
  });

  it('detects a body shot when aimed at the torso', () => {
    const t: TargetCapsule = { id: 'b', feet: new Vector3(0, 0, -10), height: 1.8, radius: 0.34 };
    const hit = resolveHit(new Vector3(0, 1, 0), forward, 100, [t]);
    expect(hit).not.toBeNull();
    expect(hit!.hitbox).toBe('body');
  });

  it('does not hit targets behind the shooter', () => {
    const hit = resolveHit(origin, forward, 100, [target('behind', 0, 0, 10)]);
    expect(hit).toBeNull();
  });

  it('respects max range', () => {
    const hit = resolveHit(origin, forward, 5, [target('t1', 0, 0, -10)]);
    expect(hit).toBeNull();
  });

  it('is blocked when a wall is closer than the target', () => {
    const wallAt5 = () => 5;
    const hit = resolveHit(origin, forward, 100, [target('t1', 0, 0, -10)], wallAt5);
    expect(hit).toBeNull();
  });

  it('is not blocked when the wall is behind the target', () => {
    const wallAt20 = () => 20;
    const hit = resolveHit(origin, forward, 100, [target('t1', 0, 0, -10)], wallAt20);
    expect(hit).not.toBeNull();
    expect(hit!.targetId).toBe('t1');
  });

  it('is not blocked when there is no wall', () => {
    const noWall = () => null;
    const hit = resolveHit(origin, forward, 100, [target('t1', 0, 0, -10)], noWall);
    expect(hit).not.toBeNull();
  });

  it('returns null for an empty target list', () => {
    expect(resolveHit(origin, forward, 100, [])).toBeNull();
  });
});
