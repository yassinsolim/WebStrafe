import { Box3, BoxGeometry, Group, Mesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CollisionWorld } from '../CollisionWorld';
import { groundResolvedSpawn, resolveSpawn } from '../SpawnResolver';
import type { MapMeta } from '../types';

const capsule = { radius: 0.42, height: 1.8 };
const baseMeta: MapMeta = {
  id: 'test',
  name: 'Test',
  author: 'WebStrafe',
  source: 'local',
  license: 'test',
};

function makeTallThinWorld(): { root: Group; world: CollisionWorld } {
  const root = new Group();
  const floor = new Mesh(new BoxGeometry(20, 0.1, 20));
  const boundsTower = new Mesh(new BoxGeometry(0.1, 100, 0.1));
  boundsTower.position.set(9, 50, 9);
  root.add(floor, boundsTower);
  const world = new CollisionWorld();
  world.setCollisionFromRoot(root);
  return { root, world };
}

describe('groundResolvedSpawn', () => {
  it('ray-seats a bounds fallback on thin ground after a long drop', () => {
    const { root, world } = makeTallThinWorld();
    const raw = resolveSpawn(baseMeta, root);
    expect(raw.position.y).toBeGreaterThan(100);

    const spawn = groundResolvedSpawn(
      raw,
      new Box3().setFromObject(root),
      world,
      capsule,
    );
    expect(spawn.position.y).toBeCloseTo(0.09, 2);
    expect(world.queryGround(spawn.position, capsule, 0.2)?.distance).toBeLessThan(0.1);
  });

  it('preserves yaw while grounding an authored spawn', () => {
    const { root, world } = makeTallThinWorld();
    const raw = resolveSpawn({
      ...baseMeta,
      spawns: [{ position: [2, 4, 2], yawDeg: 225 }],
    }, root);
    const spawn = groundResolvedSpawn(
      raw,
      new Box3().setFromObject(root),
      world,
      capsule,
    );
    expect(spawn.position).toEqual(new Vector3(2, spawn.position.y, 2));
    expect(spawn.position.y).toBeCloseTo(0.09, 2);
    expect(spawn.yawDeg).toBe(225);
  });
});
