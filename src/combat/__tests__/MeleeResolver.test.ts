import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { closestSegmentPoints, resolveMeleeHit, type MeleeTarget } from '../MeleeResolver';

const eye = new Vector3(0, 1.6, 0);
const forward = new Vector3(0, 0, -1);

function target(id: string, x: number, z: number): MeleeTarget {
  return { id, feet: new Vector3(x, 0, z), height: 1.76, radius: 0.34 };
}

function sweep(direction = forward, range = 1.45, radius = 0.41) {
  return { origin: eye, direction, range, radius };
}

function yawDir(deg: number): Vector3 {
  const rad = (deg * Math.PI) / 180;
  return new Vector3(-Math.sin(rad), 0, -Math.cos(rad));
}

describe('closestSegmentPoints', () => {
  it('finds the gap between crossing segments', () => {
    const result = closestSegmentPoints(
      new Vector3(-1, 0, 0),
      new Vector3(1, 0, 0),
      new Vector3(0, -1, 1),
      new Vector3(0, 1, 1),
    );
    expect(Math.sqrt(result.distSq)).toBeCloseTo(1, 9);
    expect(result.onA.toArray()).toEqual([0, 0, 0]);
    expect(result.onB.toArray()).toEqual([0, 0, 1]);
  });
});

describe('resolveMeleeHit', () => {
  it('hits a capsule straight ahead and lands on its near surface', () => {
    const hit = resolveMeleeHit(sweep(), [target('a', 0, -1.2)]);
    expect(hit?.targetId).toBe('a');
    expect(hit?.surfaceDistance).toBeCloseTo(1.2 - 0.34, 6);
    expect(hit?.point.z).toBeCloseTo(-(1.2 - 0.34), 6);
  });

  it('misses once the target surface is beyond the range', () => {
    expect(resolveMeleeHit(sweep(), [target('a', 0, -(1.45 + 0.34 + 0.02))])).toBeNull();
    expect(resolveMeleeHit(sweep(), [target('a', 0, -(1.45 + 0.34 - 0.02))])?.targetId).toBe('a');
  });

  it('forgives a slightly off aim like a hull trace but not a wide miss', () => {
    const near = [target('a', 0, -1.3)];
    expect(resolveMeleeHit(sweep(yawDir(25)), near)?.targetId).toBe('a');
    expect(resolveMeleeHit(sweep(yawDir(45)), near)).toBeNull();
  });

  it('never reaches targets behind or beside the attacker', () => {
    // both are inside the sweep radius of the eye, only the facing check rejects them
    expect(resolveMeleeHit(sweep(), [target('behind', 0, 0.6)])).toBeNull();
    expect(resolveMeleeHit(sweep(), [target('side', 0.6, 0)])).toBeNull();
  });

  it('picks the nearest target in the sweep', () => {
    const hit = resolveMeleeHit(sweep(), [target('far', 0, -1.6), target('near', 0.2, -1)]);
    expect(hit?.targetId).toBe('near');
  });

  it('respects world blocking between the eye and the contact point', () => {
    const wallAtZ = -0.5;
    const blocked = (from: Vector3, to: Vector3) =>
      (from.z - wallAtZ) * (to.z - wallAtZ) < 0;
    expect(resolveMeleeHit(sweep(), [target('a', 0, -1.1)], blocked)).toBeNull();
    expect(resolveMeleeHit(sweep(), [target('a', 0, -1.1)], () => false)?.targetId).toBe('a');
  });

  it('keeps the wall check above the floor the victim stands on', () => {
    const floorOnly = (_from: Vector3, to: Vector3) => to.y < 0.05;
    // aimed at the victim's feet, the contact sits on the floor itself
    const down = new Vector3(0, -1.6, -0.56).normalize();
    const hit = resolveMeleeHit(sweep(down), [target('a', 0, -0.9)], floorOnly);
    expect(hit?.targetId).toBe('a');
    expect(hit?.point.y).toBeLessThan(0.05);
  });
});
