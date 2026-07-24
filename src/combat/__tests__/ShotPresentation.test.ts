import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { computeWorldMuzzlePosition } from '../ShotPresentation';

describe('computeWorldMuzzlePosition', () => {
  it('places a level remote muzzle forward, right, and below the eye', () => {
    const origin = new Vector3(10, 4, 20);
    const muzzle = computeWorldMuzzlePosition(
      'deagle',
      origin,
      new Vector3(0, 0, -1),
    );

    expect(muzzle).not.toBeNull();
    expect(muzzle?.x).toBeCloseTo(10.18, 6);
    expect(muzzle?.y).toBeCloseTo(3.84, 6);
    expect(muzzle?.z).toBeCloseTo(19.42, 6);
  });

  it('keeps lateral and vertical offsets relative to a pitched remote shot', () => {
    const origin = new Vector3(2, 3, 4);
    const forward = new Vector3(0.2, 0.55, -1).normalize();
    const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize();
    const down = new Vector3().crossVectors(forward, right).normalize();
    const muzzle = computeWorldMuzzlePosition('awp', origin, forward);

    expect(muzzle).not.toBeNull();
    const delta = muzzle?.clone().sub(origin) ?? new Vector3();
    expect(delta.dot(forward)).toBeCloseTo(0.7, 6);
    expect(delta.dot(right)).toBeCloseTo(0.14, 6);
    expect(delta.dot(down)).toBeCloseTo(0.15, 6);
  });

  it('uses a stable fallback basis for near-vertical fire', () => {
    const muzzle = computeWorldMuzzlePosition(
      'deagle',
      new Vector3(),
      new Vector3(0, 1, 0),
    );

    expect(muzzle).not.toBeNull();
    expect(muzzle?.toArray().every(Number.isFinite)).toBe(true);
    expect(muzzle?.length()).toBeGreaterThan(0.5);
  });
});
