import {
  Color,
  Material,
  Mesh,
  Object3D,
  Scene,
  Sprite,
  Vector3,
} from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  CombatEffects,
  REMOTE_SHOT_EFFECTS,
  SHOT_EFFECT_PROFILES,
} from '../CombatEffects';
import { TracerRibbon } from '../effects/TracerRibbon';
import { ParticleBurst } from '../effects/ParticleBurst';
import { createSeededRandom } from '../Inaccuracy';

const find = (scene: Object3D, type: string) =>
  scene.children.find((child) => child.userData.effectType === type);

describe('CombatEffects', () => {
  it('draws thin, bright tracers that cross 40 m in a couple of frames', () => {
    for (const weaponId of ['deagle', 'awp'] as const) {
      const scene = new Scene();
      const effects = new CombatEffects(scene);
      effects.spawnShot({
        weaponId,
        from: new Vector3(0, 1, 0),
        to: new Vector3(0, 1, -40),
        nowMs: 0,
      });
      const tracer = find(scene, 'tracer');
      expect(tracer).toBeInstanceOf(TracerRibbon);
      const ribbon = tracer as TracerRibbon;
      const profile = SHOT_EFFECT_PROFILES[weaponId];
      // the streak grows with range so the first frame reaches from the gun towards the target
      expect(ribbon.userData.segmentLength).toBeGreaterThanOrEqual(profile.tracerLength);
      expect(ribbon.userData.segmentLength).toBeLessThanOrEqual(profile.tracerMaxLength);
      expect(ribbon.getTail().z).toBeCloseTo(-0, 6);
      // a thin core: centimetres wide at most, bloom does the glow
      expect(ribbon.material.uniforms.width.value).toBeLessThan(0.02);
      // hdr core so the bloom pass lights it up
      expect((ribbon.material.uniforms.coreColor.value as Color).r).toBeGreaterThan(3);
      expect(ribbon.material.depthTest).toBe(true);
      // the round reaches 40 m in well under 40 ms
      expect(ribbon.userData.travelMs).toBeLessThan(40);
      effects.update(ribbon.userData.travelMs * 0.5);
      expect(ribbon.getHead().z).toBeLessThan(-10);
      expect(ribbon.getHead().distanceTo(ribbon.getTail())).toBeLessThanOrEqual(ribbon.userData.segmentLength + 1e-6);
      // once the tail has passed the endpoint the streak is gone
      effects.update(ribbon.userData.travelMs + (ribbon.userData.segmentLength / profile.tracerSpeed) * 1000 + 5);
      expect(ribbon.getIntensity()).toBe(0);
      effects.dispose();
      expect(scene.children).toHaveLength(0);
    }
  });

  it('leaves a fading heat trail behind the awp round only', () => {
    const scene = new Scene();
    const effects = new CombatEffects(scene);
    effects.spawnShot({ weaponId: 'awp', from: new Vector3(0, 1, 0), to: new Vector3(0, 1, -60), nowMs: 0 });
    effects.spawnShot({ weaponId: 'deagle', from: new Vector3(0, 1, 0), to: new Vector3(0, 1, -60), nowMs: 0 });
    const [awp, deagle] = scene.children.filter((child) => child.userData.effectType === 'tracer') as TracerRibbon[];
    const wake = awp.children.find((child) => child.userData.effectType === 'tracer-wake') as TracerRibbon;
    expect(wake).toBeInstanceOf(TracerRibbon);
    expect(deagle.children).toHaveLength(0);
    effects.update(120);
    const early = wake.getIntensity();
    expect(early).toBeGreaterThan(0.3);
    effects.update(400);
    expect(wake.getIntensity()).toBeLessThan(early);
    effects.update(SHOT_EFFECT_PROFILES.awp.wakeMs);
    expect(scene.children.filter((child) => child.userData.effectType === 'tracer')).toHaveLength(0);
    effects.dispose();
  });

  it('moves a remote round to its endpoint in exactly its travel time', () => {
    const scene = new Scene();
    const effects = new CombatEffects(scene);
    effects.spawnShot({
      weaponId: 'deagle',
      from: new Vector3(0, 1, 0),
      to: new Vector3(0, 1, -100),
      nowMs: 0,
      remote: true,
    });
    const tracer = find(scene, 'tracer') as TracerRibbon;
    expect(tracer.userData.segmentLength).toBeCloseTo(REMOTE_SHOT_EFFECTS.deagle.tracerLength, 5);
    effects.update(REMOTE_SHOT_EFFECTS.deagle.travelMs / 2);
    expect(tracer.getHead().z).toBeCloseTo(-50, 3);
    effects.update(REMOTE_SHOT_EFFECTS.deagle.travelMs);
    expect(tracer.getHead().z).toBeCloseTo(-100, 3);
    // the muzzle flash outlives the flight but not the tracer
    expect(REMOTE_SHOT_EFFECTS.deagle.muzzleMs).toBeLessThan(REMOTE_SHOT_EFFECTS.deagle.tracerMs);
    effects.update(REMOTE_SHOT_EFFECTS.deagle.tracerMs - 1);
    expect(effects.getActiveCount()).toBe(1);
    effects.update(REMOTE_SHOT_EFFECTS.deagle.tracerMs);
    expect(effects.getActiveCount()).toBe(0);
  });

  it('keeps a remote endpoint cue visible through a fatal-shot death transition', () => {
    const scene = new Scene();
    const effects = new CombatEffects(scene);
    effects.spawnShot({
      weaponId: 'deagle',
      from: new Vector3(0, 1.5, -20),
      to: new Vector3(0, 1.2, -0.34),
      impactNormal: new Vector3(0, 0, -1),
      nowMs: 1000,
      remote: true,
      fatal: true,
    });

    expect(effects.getActiveCount()).toBe(3);
    expect(find(scene, 'impact')).toBeUndefined();
    const glow = find(scene, 'impact-glow');
    expect(glow).toBeInstanceOf(Sprite);
    expect(glow?.visible).toBe(false);
    expect(glow?.position.z).toBeLessThan(-0.34);
    expect(glow?.scale.x).toBeLessThanOrEqual(0.09);
    expect((glow as Sprite).material.depthTest).toBe(true);

    // A health/death event follows the shot in the same transport turn. The
    // causative round survives, while old/local effects would be removed.
    effects.clearForDeath(1010);
    expect(effects.getActiveCount()).toBe(3);
    effects.update(1000 + REMOTE_SHOT_EFFECTS.deagle.travelMs - 1);
    expect(glow?.visible).toBe(false);
    effects.update(1000 + REMOTE_SHOT_EFFECTS.deagle.travelMs);
    expect(glow?.visible).toBe(true);
    effects.update(1000 + REMOTE_SHOT_EFFECTS.deagle.fatalTracerMs);
    expect(effects.getActiveCount()).toBe(1);
    expect(glow?.visible).toBe(true);
    const impactExpiry =
      1000
      + REMOTE_SHOT_EFFECTS.deagle.travelMs
      + REMOTE_SHOT_EFFECTS.deagle.fatalImpactMs;
    effects.update(impactExpiry - 1);
    expect(effects.getActiveCount()).toBe(1);
    effects.update(impactExpiry);
    expect(effects.getActiveCount()).toBe(0);
    expect(scene.children).toHaveLength(0);
  });

  it('clears a scheduled remote arrival cue before respawn renders it', () => {
    const scene = new Scene();
    const effects = new CombatEffects(scene);
    effects.spawnShot({
      weaponId: 'awp',
      from: new Vector3(0, 1.5, -20),
      to: new Vector3(0, 1.2, -0.34),
      impactNormal: new Vector3(0, 0, -1),
      nowMs: 500,
      remote: true,
    });

    expect(effects.getActiveCount()).toBe(3);
    effects.clear();
    expect(effects.getActiveCount()).toBe(0);
    expect(scene.children).toHaveLength(0);
    effects.update(1000);
    expect(scene.children).toHaveLength(0);
  });

  it('expires muzzle, tracer, and impact effects deterministically', () => {
    const scene = new Scene();
    const effects = new CombatEffects(scene);
    effects.spawnShot({
      weaponId: 'deagle',
      from: new Vector3(0, 1, 0),
      to: new Vector3(0, 0, -20),
      impactNormal: new Vector3(0, 1, 0),
      nowMs: 100,
    });

    expect(effects.getActiveCount()).toBe(3);
    expect(scene.children.map((child) => child.userData.effectType).sort()).toEqual([
      'impact',
      'muzzle',
      'tracer',
    ]);

    effects.update(100 + SHOT_EFFECT_PROFILES.deagle.flashMs);
    expect(effects.getActiveCount()).toBe(2);
    effects.update(100 + SHOT_EFFECT_PROFILES.deagle.tracerMs);
    expect(effects.getActiveCount()).toBe(1);
    effects.update(100 + SHOT_EFFECT_PROFILES.deagle.impactMs);
    expect(effects.getActiveCount()).toBe(0);
    expect(scene.children).toHaveLength(0);
  });

  it.each(['deagle', 'awp'] as const)(
    'keeps the %s muzzle flash and impact on screen for four 60 Hz frames',
    (weaponId) => {
      const scene = new Scene();
      const layer = new Object3D();
      const effects = new CombatEffects(scene, layer);
      const nowMs = 1000;
      effects.spawnShot({
        weaponId,
        from: new Vector3(0, 1, 0),
        to: new Vector3(0, 1, -40),
        impactNormal: new Vector3(0, 0, 1),
        nowMs,
      });
      const impact = find(scene, 'impact') as Sprite;
      const muzzle = layer.children[0];
      for (let frame = 0; frame < 4; frame += 1) {
        effects.update(nowMs + frame * (1000 / 60));
        expect(impact.visible).toBe(true);
        expect(muzzle.visible).toBe(true);
        expect(impact.material.opacity).toBeGreaterThan(0.4);
      }
      effects.update(nowMs + SHOT_EFFECT_PROFILES[weaponId].flashMs);
      expect(layer.children).toHaveLength(0);
      effects.update(nowMs + SHOT_EFFECT_PROFILES[weaponId].impactMs);
      expect(find(scene, 'impact')).toBeUndefined();
      effects.dispose();
    },
  );

  it('disposes tracer and impact resources when transient feedback is cleared', () => {
    const scene = new Scene();
    const effects = new CombatEffects(scene);
    effects.spawnShot({
      weaponId: 'awp',
      from: new Vector3(0, 1, 0),
      to: new Vector3(0, 1, -40),
      impactNormal: new Vector3(0, 0, 1),
      nowMs: 0,
    });
    const tracer = find(scene, 'tracer') as TracerRibbon;
    const impact = find(scene, 'impact') as Sprite;
    const tracerMaterialDispose = vi.spyOn(tracer.material, 'dispose');
    const impactMaterialDispose = vi.spyOn(impact.material as Material, 'dispose');

    effects.clear();

    expect(tracerMaterialDispose).toHaveBeenCalledOnce();
    expect(impactMaterialDispose).toHaveBeenCalledOnce();
    expect(effects.getActiveCount()).toBe(0);
    expect(scene.children).toHaveLength(0);
    effects.dispose();
  });

  it('grows far impact flashes a little so they read, with a hard cap', () => {
    const scene = new Scene();
    const effects = new CombatEffects(scene);
    for (const z of [-5, -40, -400]) {
      effects.spawnShot({
        weaponId: 'deagle',
        from: new Vector3(0, 1, 0),
        to: new Vector3(0, 1, z),
        impactNormal: new Vector3(0, 0, 1),
        nowMs: 0,
      });
    }
    const flashes = scene.children.filter((child) => child.userData.effectType === 'impact') as Sprite[];
    const sizes = flashes.map((flash) => flash.scale.x);
    expect(sizes[0]).toBeCloseTo(SHOT_EFFECT_PROFILES.deagle.impactScale, 6);
    expect(sizes[1]).toBeGreaterThan(sizes[0]);
    expect(sizes[2]).toBeLessThanOrEqual(0.42);
    expect(flashes.every((flash) => flash.material.depthTest)).toBe(true);
    effects.dispose();
  });

  it('throws off sparks from metal, chips from stone and no sparks from sand', () => {
    const spawn = (surface: 'metal' | 'stone' | 'sand') => {
      const scene = new Scene();
      const effects = new CombatEffects(scene, null, {
        impactEffects: true,
        random: createSeededRandom(4),
        resolveSurface: () => surface,
      });
      effects.spawnShot({
        weaponId: 'deagle',
        from: new Vector3(0, 1, 0),
        to: new Vector3(0, 1, -8),
        impactNormal: new Vector3(0, 0, 1),
        impactKind: 'world',
        nowMs: 0,
      });
      const count = (type: string) => (find(scene, type) as ParticleBurst | undefined)?.geometry.instanceCount ?? 0;
      const decal = find(scene, 'decal');
      const result = { sparks: count('impact-sparks'), debris: count('impact-debris'), dust: count('impact-dust'), decal: decal?.userData.surface };
      effects.dispose();
      return result;
    };
    const metal = spawn('metal');
    const stone = spawn('stone');
    const sand = spawn('sand');
    expect(metal.sparks).toBeGreaterThan(stone.sparks);
    expect(stone.debris).toBeGreaterThan(0);
    expect(metal.debris).toBe(0);
    expect(sand.sparks).toBe(0);
    expect(sand.dust).toBeGreaterThan(stone.dust);
    expect([metal.decal, stone.decal, sand.decal]).toEqual(['metal', 'stone', 'sand']);
  });

  it('holds impact particles back until a remote round arrives', () => {
    const scene = new Scene();
    const effects = new CombatEffects(scene, null, { impactEffects: true, random: createSeededRandom(5) });
    effects.spawnShot({
      weaponId: 'awp',
      from: new Vector3(0, 1, 0),
      to: new Vector3(0, 1, -30),
      impactNormal: new Vector3(0, 0, 1),
      impactKind: 'world',
      nowMs: 0,
      remote: true,
    });
    effects.update(1);
    const sparks = find(scene, 'impact-sparks')!;
    expect(sparks.visible).toBe(false);
    effects.update(REMOTE_SHOT_EFFECTS.awp.travelMs);
    expect(sparks.visible).toBe(true);
    effects.dispose();
  });

  it('scales particle counts with the quality preset', () => {
    const count = (density: number) => {
      const scene = new Scene();
      const effects = new CombatEffects(scene, null, { impactEffects: true, random: createSeededRandom(6), resolveSurface: () => 'metal' });
      effects.setQuality({ effectDensity: density } as never);
      effects.spawnDust(new Vector3(), new Vector3(0, 1, 0), 0, 'metal');
      const sparks = (find(scene, 'impact-sparks') as ParticleBurst).geometry.instanceCount;
      effects.dispose();
      return sparks;
    };
    expect(count(0.5)).toBeLessThan(count(1));
  });

  it('clears repeated shots without leaving scene objects', () => {
    const scene = new Scene();
    const effects = new CombatEffects(scene);
    for (let index = 0; index < 5; index += 1) {
      effects.spawnShot({
        weaponId: index % 2 === 0 ? 'deagle' : 'awp',
        from: new Vector3(index, 1, 0),
        to: new Vector3(index, 1, -30),
        nowMs: index * 20,
      });
    }

    expect(effects.getActiveCount()).toBe(10);
    effects.clear();
    expect(effects.getActiveCount()).toBe(0);
    expect(scene.children).toHaveLength(0);
    effects.clear();
  });

  it('owns local muzzle feedback in the viewmodel layer and disposes it there', () => {
    const scene = new Scene();
    const viewmodelLayer = new Object3D();
    const onFlash = vi.fn();
    const effects = new CombatEffects(scene, viewmodelLayer, { onLocalMuzzleFlash: onFlash });
    effects.spawnShot({
      weaponId: 'deagle',
      from: new Vector3(0.18, 1.44, -0.58),
      to: new Vector3(0, 1, -8),
      impactNormal: new Vector3(0, 0, 1),
      nowMs: 50,
    });

    expect(scene.children.map((child) => child.userData.effectType).sort())
      .toEqual(['impact', 'tracer']);
    const muzzle = viewmodelLayer.children[0];
    expect(muzzle.userData.effectType).toBe('muzzle');
    const sprites = muzzle.children as Sprite[];
    expect(sprites.every((sprite) => sprite.material.depthTest)).toBe(true);
    // hdr flash so bloom blows it out for a frame
    expect(Math.max(...sprites.map((sprite) => sprite.material.color.r))).toBeGreaterThan(3);
    expect(muzzle.position.z).toBeGreaterThan(-1);
    expect(onFlash).toHaveBeenCalledWith('deagle');

    effects.dispose();
    expect(scene.children).toHaveLength(0);
    expect(viewmodelLayer.children).toHaveLength(0);
  });

  it('starts a local tracer at the drawn muzzle when one is given', () => {
    const scene = new Scene();
    const origin = new Vector3(0.3, 0.8, -0.9);
    const effects = new CombatEffects(scene, null, { getLocalTracerOrigin: () => origin });
    effects.spawnShot({ weaponId: 'deagle', from: new Vector3(0, 1, 0), to: new Vector3(0, 1, -40), nowMs: 0 });
    const tracer = find(scene, 'tracer') as TracerRibbon;
    expect(tracer.getTail().distanceTo(origin)).toBeLessThan(1e-6);
    effects.dispose();
  });

  it('never leaves a mesh with a non depth tested material', () => {
    const scene = new Scene();
    const effects = new CombatEffects(scene, null, { impactEffects: true, random: createSeededRandom(7) });
    effects.spawnShot({
      weaponId: 'awp',
      from: new Vector3(0, 1, 0),
      to: new Vector3(0, 1, -12),
      impactNormal: new Vector3(0, 0, 1),
      impactKind: 'world',
      nowMs: 0,
    });
    const materials: Material[] = [];
    scene.traverse((object) => {
      if (object instanceof Mesh || object instanceof Sprite) {
        materials.push(...(Array.isArray(object.material) ? object.material : [object.material]));
      }
    });
    expect(materials.length).toBeGreaterThan(4);
    expect(materials.every((material) => material.depthTest)).toBe(true);
    effects.dispose();
  });
});
