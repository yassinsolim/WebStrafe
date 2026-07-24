import { DataTexture, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { computeBotSpawnCandidate } from '../../combat/BotSpawn';
import { CollisionWorld } from '../../world/CollisionWorld';
import { createMovementTestScene } from '../MovementTestScene';

describe('MovementTestScene textures', () => {
  it('provides complete RGBA data for the checker texture upload', () => {
    const { root } = createMovementTestScene();
    const mappedMesh = root.children.find(
      (child): child is Mesh =>
        child instanceof Mesh &&
        child.material instanceof MeshStandardMaterial &&
        child.material.map instanceof DataTexture,
    );

    expect(mappedMesh).toBeDefined();
    const texture = (mappedMesh!.material as MeshStandardMaterial).map as DataTexture;
    const { data, width, height } = texture.image;
    expect(data).toHaveLength(width * height * 4);
    expect(Array.from(data as Uint8Array).filter((_, index) => index % 4 === 3)).toEqual(
      Array(width * height).fill(255),
    );
  });

  it('places its authored spawn directly on the training floor', () => {
    const { root, spawn } = createMovementTestScene();
    const world = new CollisionWorld();
    world.setCollisionFromRoot(root);
    const ground = world.queryGround(spawn, { radius: 0.42, height: 1.8 }, 0.2);
    expect(spawn.toArray()).toEqual([0, 0.04, 56]);
    expect(ground).not.toBeNull();
    expect(ground!.distance).toBeLessThan(0.1);
    expect(ground!.normal.y).toBeGreaterThan(0.99);
  });

  it('provides a clear firing lane plus genuine cover and peek LOS', () => {
    const { root, spawn } = createMovementTestScene();
    const world = new CollisionWorld();
    world.setCollisionFromRoot(root);
    const botFeet = computeBotSpawnCandidate(spawn, 0, 0, 1);
    const botGround = world.raycastGeometry(
      botFeet.clone().add(new Vector3(0, 4, 0)),
      new Vector3(0, -1, 0),
      8,
    );
    expect(botGround).not.toBeNull();
    botFeet.y = botGround!.point.y + 0.04;

    const botChest = botFeet.clone().add(new Vector3(0, 1.2, 0));
    const spawnEye = spawn.clone().add(new Vector3(0, 1.6, 0));
    const hiddenEye = spawnEye.clone().setX(-3.4);
    const peekEye = spawnEye.clone().setX(1.5);
    expect(world.segmentIntersectsGeometry(spawnEye, botChest)).toBe(false);
    expect(world.segmentIntersectsGeometry(hiddenEye, botChest)).toBe(true);
    expect(world.segmentIntersectsGeometry(peekEye, botChest)).toBe(false);

    expect(root.getObjectByName('FirearmBackstop')).toBeDefined();
    expect(root.getObjectByName('TrainingFloor')).toBeDefined();
    expect(root.getObjectByName('PeekCover')).toBeDefined();
    expect(root.getObjectByName('BotStagingPad')).toBeDefined();
    expect(root.getObjectByName('BodyAimReference')).toBeDefined();
    expect(root.getObjectByName('HeadAimReference')).toBeDefined();
  });
});
