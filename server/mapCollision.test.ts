import { describe, expect, it } from 'vitest';
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

  it('returns null for an unknown / invalid map id', async () => {
    expect(await loadHeadlessMap('does-not-exist')).toBeNull();
    expect(await loadHeadlessMap('../etc/passwd')).toBeNull();
  }, 30000);
});
