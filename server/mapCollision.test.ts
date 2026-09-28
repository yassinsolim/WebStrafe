import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { computeBotSpawnCandidate } from './BotManager';
import { loadHeadlessMap } from './mapCollision';
import { groundBotSpawn } from '../src/combat/BotSpawn';

const SERVER_CAPSULE = { radius: 0.42, height: 1.8 };
const MAPS = ['surf_prismline', 'bhop_emberdrift', 'aim_ochrecut'];

// Loads the shipped collision.glb + meta.json of each original map in Node.
describe.each(MAPS)('loadHeadlessMap(%s)', (mapId) => {
  it('loads collision geometry and seats the spawn on the ground', async () => {
    const map = await loadHeadlessMap(mapId);
    expect(map).not.toBeNull();
    expect(map!.world.hasCollision()).toBe(true);
    const position = map!.world.getCollisionMesh()!.geometry.getAttribute('position');
    expect(position.count).toBeGreaterThan(300);
    const ground = map!.world.queryGround(map!.spawn.position, SERVER_CAPSULE, 0.2);
    expect(ground).not.toBeNull();
    expect(ground!.distance).toBeLessThan(0.1);
    expect(ground!.normal.y).toBeGreaterThan(0.9);
  }, 30000);

  it('caches: a second load returns the same instance', async () => {
    const a = await loadHeadlessMap(mapId);
    const b = await loadHeadlessMap(mapId);
    expect(a).toBe(b);
  }, 30000);

  it('seats every authored spawn inside the collision bounds', async () => {
    const map = await loadHeadlessMap(mapId);
    const mesh = map!.world.getCollisionMesh()!;
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!;
    expect(map!.spawns!.length).toBeGreaterThan(0);
    for (const spawn of map!.spawns!) {
      expect(box.containsPoint(spawn.position)).toBe(true);
      const ground = map!.world.queryGround(spawn.position, SERVER_CAPSULE, 0.2);
      expect(ground?.normal.y ?? 0).toBeGreaterThan(0.9);
    }
  }, 30000);
});

describe('loadHeadlessMap bots', () => {
  it('stages arena bots on the far side, on the ground, facing the players', async () => {
    const map = await loadHeadlessMap('aim_ochrecut');
    expect(map).not.toBeNull();
    const anchor = map!.botAnchor!;
    // side A spawns at three +z, side B at -z
    expect(map!.spawn.position.z).toBeGreaterThan(40);
    expect(anchor.position.z).toBeLessThan(-40);
    for (let i = 0; i < 4; i += 1) {
      const seat = groundBotSpawn(map!.world, computeBotSpawnCandidate(anchor.position, anchor.yawDeg, i, 4));
      expect(Math.abs(seat.y - anchor.position.y)).toBeLessThan(0.5);
      expect(seat.z).toBeLessThan(0);
      const toPlayers = map!.spawn.position.clone().sub(seat).setY(0).normalize();
      expect(toPlayers.z).toBeGreaterThan(0.9);
    }
  }, 30000);

  it('stages bots on the start platform ahead of the spawn on run maps', async () => {
    for (const mapId of ['surf_prismline', 'bhop_emberdrift']) {
      const map = await loadHeadlessMap(mapId);
      expect(map!.botAnchor!.position.distanceTo(map!.spawn.position)).toBeLessThan(1e-6);
      const seat = groundBotSpawn(map!.world, computeBotSpawnCandidate(map!.spawn.position, map!.spawn.yawDeg, 0, 1));
      const ground = map!.world.raycastGeometry(seat.clone().add(new Vector3(0, 2, 0)), new Vector3(0, -1, 0), 4);
      expect(ground, `${mapId} bot seat has ground`).not.toBeNull();
    }
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
