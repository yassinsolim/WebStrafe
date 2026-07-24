import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { computeBotSpawnCandidate } from './BotManager';
import { loadHeadlessMap } from './mapCollision';

// Loads the real surf map collision (public/maps/surf_skyworld_x/collision.glb) in Node.
describe('loadHeadlessMap (real surf collision)', () => {
  it('loads collision geometry and resolves a spawn', async () => {
    const map = await loadHeadlessMap('surf_skyworld_x');
    expect(map).not.toBeNull();
    expect(map!.world.hasCollision()).toBe(true);
    expect(Number.isFinite(map!.spawn.position.y)).toBe(true);
  }, 30000);

  it('caches: a second load returns the same instance', async () => {
    const a = await loadHeadlessMap('surf_skyworld_x');
    const b = await loadHeadlessMap('surf_skyworld_x');
    expect(a).toBe(b);
  }, 30000);

  it('builds real, non-empty collision geometry', async () => {
    const map = await loadHeadlessMap('surf_skyworld_x');
    expect(map).not.toBeNull();
    const mesh = map!.world.getCollisionMesh();
    expect(mesh).not.toBeNull();
    const position = mesh!.geometry.getAttribute('position');
    expect(position).toBeDefined();
    expect(position.count).toBeGreaterThan(1000);
  }, 30000);

  it('resolves a spawn inside the map bounding box', async () => {
    const map = await loadHeadlessMap('surf_skyworld_x');
    expect(map).not.toBeNull();
    const mesh = map!.world.getCollisionMesh();
    mesh!.geometry.computeBoundingBox();
    const box = mesh!.geometry.boundingBox!;
    const s = map!.spawn.position;
    expect(s.x).toBeGreaterThanOrEqual(box.min.x - 1);
    expect(s.x).toBeLessThanOrEqual(box.max.x + 1);
    expect(s.z).toBeGreaterThanOrEqual(box.min.z - 1);
    expect(s.z).toBeLessThanOrEqual(box.max.z + 1);
  }, 30000);

  it('matches browser scale and seats the player on collision', async () => {
    const map = await loadHeadlessMap('surf_skyworld_x');
    expect(map).not.toBeNull();
    const mesh = map!.world.getCollisionMesh();
    mesh!.geometry.computeBoundingBox();
    expect(mesh!.geometry.boundingBox!.max.y).toBeGreaterThan(180);
    const ground = map!.world.queryGround(
      map!.spawn.position,
      { radius: 0.42, height: 1.8 },
      0.2,
    );
    expect(ground).not.toBeNull();
    expect(ground!.distance).toBeLessThan(0.1);
    expect(ground!.normal.y).toBeGreaterThan(0.9);
  }, 30000);

  it('stages one bot on visible reachable ground ahead of the surf spawn', async () => {
    const map = await loadHeadlessMap('surf_skyworld_x');
    expect(map).not.toBeNull();
    const candidate = computeBotSpawnCandidate(
      map!.spawn.position,
      map!.spawn.yawDeg,
      0,
      1,
    );
    const ground = map!.world.raycastGeometry(
      candidate.clone().add(new Vector3(0, 12, 0)),
      new Vector3(0, -1, 0),
      64,
    );
    expect(ground).not.toBeNull();
    expect(Math.abs(ground!.point.y - map!.spawn.position.y)).toBeLessThan(4);
    expect(ground!.normal.y).toBeGreaterThan(0.9);
    expect(map!.world.segmentIntersectsGeometry(
      map!.spawn.position.clone().add(new Vector3(0, 1.4, 0)),
      ground!.point.clone().add(new Vector3(0, 1.4, 0)),
    )).toBe(false);
  }, 30000);

  it('shares the authored Movement Test Scene lane, cover, and peek LOS', async () => {
    const map = await loadHeadlessMap('movement_test_scene');
    expect(map).not.toBeNull();
    expect(map!.spawn.position.z).toBeCloseTo(56, 3);
    const botFeet = computeBotSpawnCandidate(
      map!.spawn.position,
      map!.spawn.yawDeg,
      0,
      1,
    );
    const ground = map!.world.raycastGeometry(
      botFeet.clone().add(new Vector3(0, 4, 0)),
      new Vector3(0, -1, 0),
      8,
    );
    expect(ground).not.toBeNull();
    botFeet.y = ground!.point.y + 0.04;

    const botChest = botFeet.clone().add(new Vector3(0, 1.2, 0));
    const spawnEye = map!.spawn.position.clone().add(new Vector3(0, 1.6, 0));
    expect(map!.world.segmentIntersectsGeometry(spawnEye, botChest)).toBe(false);
    expect(
      map!.world.segmentIntersectsGeometry(
        spawnEye.clone().setX(-3.4),
        botChest,
      ),
    ).toBe(true);
    expect(
      map!.world.segmentIntersectsGeometry(
        spawnEye.clone().setX(1.5),
        botChest,
      ),
    ).toBe(false);
  }, 30000);

  it('returns null for an unknown / invalid map id', async () => {
    expect(await loadHeadlessMap('does-not-exist')).toBeNull();
    expect(await loadHeadlessMap('../etc/passwd')).toBeNull();
  }, 30000);
});
