import { Mesh, MeshBasicMaterial, Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX_DECALS, ImpactDecals } from '../ImpactDecals';

const decalsIn = (scene: Scene) =>
  scene.children.filter((child) => child.userData.effectType === 'decal') as Mesh[];

describe('ImpactDecals', () => {
  it('lays a small quad flat on the surface, facing out along the normal', () => {
    const scene = new Scene();
    const decals = new ImpactDecals(scene, { random: () => 0.25 });
    decals.spawn(new Vector3(1, 2, 3), new Vector3(0, 0, 1), 0.07, 0);
    const [hole] = decalsIn(scene);
    expect(hole).toBeDefined();
    expect(hole.position.z).toBeGreaterThan(3);
    expect(hole.position.z - 3).toBeLessThan(0.01);
    expect(hole.scale.x).toBeCloseTo(0.07, 9);
    const facing = new Vector3(0, 0, 1).applyQuaternion(hole.quaternion);
    expect(facing.distanceTo(new Vector3(0, 0, 1))).toBeLessThan(1e-9);

    decals.spawn(new Vector3(), new Vector3(1, 0, 0), 0.07, 0);
    const wall = decalsIn(scene)[1];
    expect(new Vector3(0, 0, 1).applyQuaternion(wall.quaternion).x).toBeCloseTo(1, 9);
    decals.dispose();
  });

  it('keeps at most 64 holes and reuses the oldest', () => {
    const scene = new Scene();
    const decals = new ImpactDecals(scene);
    for (let i = 0; i < DEFAULT_MAX_DECALS + 6; i += 1) {
      decals.spawn(new Vector3(i, 0, 0), new Vector3(0, 1, 0), 0.07, i);
    }
    expect(decals.getActiveCount()).toBe(DEFAULT_MAX_DECALS);
    expect(decalsIn(scene)).toHaveLength(DEFAULT_MAX_DECALS);
    const xs = decalsIn(scene).map((mesh) => Math.round(mesh.position.x));
    // the first six were recycled for the newest six
    expect(Math.min(...xs)).toBe(6);
    expect(Math.max(...xs)).toBe(DEFAULT_MAX_DECALS + 5);
    decals.dispose();
  });

  it('holds, fades out and then leaves the scene', () => {
    const scene = new Scene();
    const decals = new ImpactDecals(scene, { holdMs: 1000, fadeMs: 500 });
    decals.spawn(new Vector3(), new Vector3(0, 1, 0), 0.07, 0);
    const material = decalsIn(scene)[0].material as MeshBasicMaterial;
    decals.update(900);
    expect(material.opacity).toBe(1);
    decals.update(1250);
    expect(material.opacity).toBeCloseTo(0.5, 6);
    decals.update(1500);
    expect(decalsIn(scene)).toHaveLength(0);
    expect(decals.getActiveCount()).toBe(0);
  });

  it('ignores bad input and clears on demand', () => {
    const scene = new Scene();
    const decals = new ImpactDecals(scene);
    decals.spawn(new Vector3(Number.NaN, 0, 0), new Vector3(0, 1, 0), 0.07, 0);
    decals.spawn(new Vector3(), new Vector3(), 0.07, 0);
    expect(decals.getActiveCount()).toBe(0);
    decals.spawn(new Vector3(), new Vector3(0, 1, 0), 0.07, 0);
    decals.clear();
    expect(scene.children).toHaveLength(0);
    decals.dispose();
  });
});
