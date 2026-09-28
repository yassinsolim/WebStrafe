import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Scene, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { CollisionWorld } from '../../world/CollisionWorld';
import type { ShotEvent } from '../../network/MultiplayerTransport';
import { CombatEffects, type ShotEffectRequest } from '../CombatEffects';
import { createRemoteShotHandler, presentFirearmShot } from '../FirearmShotFeedback';
import { createSeededRandom } from '../Inaccuracy';
import { ParticleBurst } from '../effects/ParticleBurst';

const types = (scene: Scene) => scene.children.map((child) => child.userData.effectType).sort();

function wallWorld(z = -5): CollisionWorld {
  const root = new Group();
  const wall = new Mesh(new BoxGeometry(10, 10, 0.2), new MeshBasicMaterial());
  wall.position.set(0, 1, z);
  root.add(wall);
  const world = new CollisionWorld();
  world.setCollisionFromRoot(root);
  return world;
}

describe('CombatEffects impact effects', () => {
  it('puts a bullet hole and a dust puff on world hits', () => {
    const scene = new Scene();
    const effects = new CombatEffects(scene, null, { impactEffects: true, random: createSeededRandom(1) });
    effects.spawnShot({
      weaponId: 'deagle',
      from: new Vector3(0, 1, 0),
      to: new Vector3(0, 1, -5),
      impactNormal: new Vector3(0, 0, 1),
      impactKind: 'world',
      nowMs: 0,
    });
    expect(types(scene)).toEqual([
      'decal',
      'impact',
      'impact-debris',
      'impact-dust',
      'impact-sparks',
      'muzzle',
      'muzzle-smoke',
      'tracer',
    ]);
    expect(effects.getDecalCount()).toBe(1);

    // transient effects expire, the hole stays until its own fade
    effects.update(3000);
    expect(types(scene)).toEqual(['decal']);
    // clear() is for weapon switches and respawns and keeps the holes
    effects.clear();
    expect(effects.getDecalCount()).toBe(1);
    effects.clearDecals();
    expect(scene.children).toHaveLength(0);
    effects.dispose();
  });

  it('puts a blood puff on confirmed player hits and nothing on the wall', () => {
    const scene = new Scene();
    const effects = new CombatEffects(scene, null, { impactEffects: true, random: createSeededRandom(2) });
    effects.spawnShot({
      weaponId: 'awp',
      from: new Vector3(0, 1, 0),
      to: new Vector3(0, 1, -8),
      impactNormal: new Vector3(0, 0, 1),
      impactKind: 'player',
      nowMs: 0,
      remote: true,
    });
    expect(types(scene)).toContain('blood');
    expect(effects.getDecalCount()).toBe(0);
    effects.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('moves dust particles out along the normal over time', () => {
    const scene = new Scene();
    const effects = new CombatEffects(scene, null, { impactEffects: true, random: createSeededRandom(3) });
    effects.spawnDust(new Vector3(0, 0, 0), new Vector3(0, 1, 0), 0);
    const puff = scene.children.find((child) => child.userData.effectType === 'impact-dust') as ParticleBurst;
    expect(puff).toBeInstanceOf(ParticleBurst);
    effects.update(200);
    const count = puff.geometry.instanceCount;
    expect(count).toBeGreaterThan(2);
    const heights = Array.from({ length: count }, (_, i) => puff.particlePosition(i).y);
    expect(Math.min(...heights)).toBeGreaterThan(0);
    effects.dispose();
  });

  it('places the local muzzle flash on the provided socket', () => {
    const scene = new Scene();
    const layer = new Group();
    layer.position.set(10, 0, 0);
    const socket = new Vector3(10.1, -0.05, -0.4);
    const effects = new CombatEffects(scene, layer, { getLocalMuzzleWorldPosition: () => socket });
    effects.spawnShot({ weaponId: 'deagle', from: new Vector3(), to: new Vector3(0, 0, -10), nowMs: 0 });
    const flash = layer.children.find((child) => child.userData.effectType === 'muzzle')!;
    layer.updateWorldMatrix(true, true);
    expect(flash.getWorldPosition(new Vector3()).distanceTo(socket)).toBeLessThan(1e-9);

    const fallback = new CombatEffects(scene, layer, { getLocalMuzzleWorldPosition: () => null });
    fallback.spawnShot({ weaponId: 'deagle', from: new Vector3(), to: new Vector3(0, 0, -10), nowMs: 0 });
    const anchored = layer.children.filter((child) => child.userData.effectType === 'muzzle')[1];
    expect(anchored.position.toArray()).toEqual([0.075, -0.065, -0.46]);
    effects.dispose();
    fallback.dispose();
  });
});

describe('shot presentation impact routing', () => {
  function spy() {
    return { spawnShot: vi.fn<(request: ShotEffectRequest) => void>(), spawnBlood: vi.fn() };
  }

  it('marks a remote wall hit as world and a confirmed player hit as player', () => {
    const effects = spy();
    const collisionWorld = wallWorld(-5);
    presentFirearmShot({ effects, collisionWorld }, {
      weaponId: 'deagle',
      origin: new Vector3(0, 1, 0),
      direction: new Vector3(0, 0, -1),
      nowMs: 0,
      local: false,
      result: 'miss',
      resolvedEndpoint: new Vector3(0, 1, -120),
      resolvedImpactNormal: new Vector3(0, 0, 1),
    });
    expect(effects.spawnShot.mock.calls[0][0].impactKind).toBe('world');

    presentFirearmShot({ effects, collisionWorld }, {
      weaponId: 'deagle',
      origin: new Vector3(0, 1, 0),
      direction: new Vector3(0, 0, -1),
      nowMs: 0,
      local: false,
      result: 'hit',
      resolvedEndpoint: new Vector3(0, 1, -3),
      resolvedImpactNormal: new Vector3(0, 0, 1),
    });
    expect(effects.spawnShot.mock.calls[1][0].impactKind).toBe('player');

    presentFirearmShot({ effects, collisionWorld }, {
      weaponId: 'deagle',
      origin: new Vector3(0, 1, 0),
      direction: new Vector3(0, 0, -1),
      nowMs: 0,
      local: false,
      result: 'hit',
      playerImpact: false,
      resolvedEndpoint: new Vector3(0, 1, -3),
    });
    expect(effects.spawnShot.mock.calls[2][0].impactKind).toBeUndefined();
  });

  it('stops a local round at a drawn player instead of marking the wall behind', () => {
    const effects = spy();
    presentFirearmShot(
      { effects, collisionWorld: wallWorld(-5), playerOcclusion: () => 2.5 },
      {
        weaponId: 'awp',
        origin: new Vector3(0, 1, 0),
        direction: new Vector3(0, 0, -1),
        cameraUp: new Vector3(0, 1, 0),
        nowMs: 0,
        local: true,
      },
    );
    const request = effects.spawnShot.mock.calls[0][0];
    expect(request.to.z).toBeCloseTo(-2.5, 9);
    expect(request.impactKind).toBeUndefined();
    expect(request.impactNormal).toBeUndefined();

    presentFirearmShot(
      { effects, collisionWorld: wallWorld(-5), playerOcclusion: () => null },
      {
        weaponId: 'awp',
        origin: new Vector3(0, 1, 0),
        direction: new Vector3(0, 0, -1),
        cameraUp: new Vector3(0, 1, 0),
        nowMs: 0,
        local: true,
      },
    );
    expect(effects.spawnShot.mock.calls[1][0].impactKind).toBe('world');
  });

  it('adds blood for our confirmed hits and knife hits, never on the local victim', () => {
    const effects = spy();
    const handler = createRemoteShotHandler({
      effects,
      collisionWorld: new CollisionWorld(),
      getLocalPlayerId: () => 'me',
      nowMs: () => 42,
    });
    const base: ShotEvent = {
      sequence: 1,
      result: 'hit',
      playerId: 'me',
      targetId: 'bot:0',
      origin: [0, 1.6, 0],
      dir: [0, 0, -1],
      weaponId: 'deagle',
      endpoint: [0, 1.4, -6],
    };
    handler(base);
    expect(effects.spawnShot).not.toHaveBeenCalled();
    expect(effects.spawnBlood).toHaveBeenCalledTimes(1);
    expect(effects.spawnBlood.mock.calls[0][0].toArray()).toEqual([0, 1.4, -6]);

    handler({ ...base, playerId: 'peer', weaponId: 'knife', endpoint: [0, 1.2, -1] });
    expect(effects.spawnBlood).toHaveBeenCalledTimes(2);

    handler({ ...base, playerId: 'peer', weaponId: 'knife', targetId: 'me' });
    handler({ ...base, result: 'miss' });
    expect(effects.spawnBlood).toHaveBeenCalledTimes(2);
  });
});
