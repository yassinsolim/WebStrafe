import {
  CylinderGeometry,
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

describe('CombatEffects', () => {
  it('uses short weapon-specific tracers instead of full-range laser lines', () => {
    for (const weaponId of ['deagle', 'awp'] as const) {
      const scene = new Scene();
      const effects = new CombatEffects(scene);
      effects.spawnShot({
        weaponId,
        from: new Vector3(0, 1, 0),
        to: new Vector3(0, 1, -100),
        nowMs: 10,
      });

      const tracer = scene.children.find((child) => child.userData.effectType === 'tracer');
      expect(tracer).toBeInstanceOf(Mesh);
      if (!(tracer instanceof Mesh)) {
        throw new Error('Expected a mesh tracer');
      }
      expect(tracer.userData.segmentLength).toBeCloseTo(
        SHOT_EFFECT_PROFILES[weaponId].tracerLength,
        5,
      );
      expect(tracer.userData.segmentLength).toBeLessThan(10);
      expect(
        tracer.children.some((child) => child.userData.effectType === 'tracer-tip'),
      ).toBe(true);
      const muzzle = scene.children.find((child) => child.userData.effectType === 'muzzle');
      expect(muzzle).toBeInstanceOf(Sprite);
      if (!(muzzle instanceof Sprite)) {
        throw new Error('Expected a sprite muzzle flash');
      }
      expect(muzzle.material.map).not.toBeNull();
      expect(muzzle.scale.x).toBeLessThan(0.2);
      expect(muzzle.userData.forwardOffset).toBe(0.22);
      expect(effects.getActiveCount()).toBe(2);
      effects.dispose();
      expect(scene.children).toHaveLength(0);
    }
  });

  it('moves a compact, occluded remote tracer instead of drawing a laser', () => {
    const scene = new Scene();
    const effects = new CombatEffects(scene);
    effects.spawnShot({
      weaponId: 'deagle',
      from: new Vector3(0, 1, 0),
      to: new Vector3(0, 1, -100),
      nowMs: 0,
      remote: true,
    });

    const tracer = scene.children.find(
      (child) => child.userData.effectType === 'tracer',
    );
    expect(tracer?.userData.segmentLength).toBeCloseTo(
      REMOTE_SHOT_EFFECTS.deagle.tracerLength,
      5,
    );
    expect(tracer?.userData.segmentLength).toBeLessThan(
      SHOT_EFFECT_PROFILES.deagle.tracerLength,
    );
    expect(tracer?.userData.endpointClearance).toBeGreaterThan(0);
    const tracerGlow = tracer?.children.find(
      (child) => child.userData.effectType === 'tracer-glow',
    );
    expect(tracerGlow).toBeInstanceOf(Sprite);
    expect(tracerGlow?.scale.x).toBeGreaterThan(0.2);
    expect(tracerGlow?.scale.y).toBeGreaterThan(0.4);
    const tracerMesh = tracer as Mesh<CylinderGeometry>;
    expect(tracerMesh.geometry.parameters.radiusTop).toBeCloseTo(0.072, 4);
    const effectMaterials: Material[] = [];
    scene.traverse((object) => {
      const renderable = object as Mesh | Sprite;
      if (!('material' in renderable)) return;
      const materials = Array.isArray(renderable.material)
        ? renderable.material
        : [renderable.material];
      effectMaterials.push(...materials);
    });
    expect(effectMaterials.length).toBeGreaterThan(0);
    expect(effectMaterials.every((material) => material.depthTest)).toBe(true);
    const initialZ = tracer?.position.z ?? 0;
    effects.update(REMOTE_SHOT_EFFECTS.deagle.travelMs);
    expect(tracer?.position.z).toBeLessThan(initialZ);
    expect(effects.getActiveCount()).toBe(1);
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
    expect(
      scene.children.some((child) => child.userData.effectType === 'impact'),
    ).toBe(false);
    const glow = scene.children.find(
      (child) => child.userData.effectType === 'impact-glow',
    );
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
    'keeps %s tracer and impact readable across capture frames, then fades cleanly',
    (weaponId) => {
      const scene = new Scene();
      const effects = new CombatEffects(scene);
      const nowMs = 1000;
      effects.spawnShot({
        weaponId,
        from: new Vector3(0, 1, 0),
        to: new Vector3(0, 1, -40),
        impactNormal: new Vector3(0, 0, 1),
        nowMs,
      });
      const tracer = scene.children.find(
        (child) => child.userData.effectType === 'tracer',
      ) as Mesh;
      const impact = scene.children.find(
        (child) => child.userData.effectType === 'impact',
      ) as Mesh;
      const tracerMaterial = tracer.material as Material & { opacity: number };
      const impactMaterial = impact.material as Material & { opacity: number };

      // Four consecutive 60 Hz frames retain a strong, fully depth-tested read.
      for (let frame = 0; frame < 4; frame += 1) {
        effects.update(nowMs + frame * (1000 / 60));
        expect(tracer.visible).toBe(true);
        expect(impact.visible).toBe(true);
        expect(tracerMaterial.opacity).toBeGreaterThan(0.7);
        expect(impactMaterial.opacity).toBeGreaterThan(0.8);
      }

      // Normal screenshot latency still catches a compact fading tracer and the
      // resolved endpoint, while the flash itself is already gone.
      effects.update(nowMs + 250);
      expect(scene.children.some((child) => child.userData.effectType === 'muzzle')).toBe(false);
      expect(tracerMaterial.opacity).toBeGreaterThan(0.08);
      expect(impactMaterial.opacity).toBeGreaterThan(0.25);

      effects.update(nowMs + SHOT_EFFECT_PROFILES[weaponId].tracerMs);
      expect(scene.children).not.toContain(tracer);
      expect(scene.children).toContain(impact);
      effects.update(nowMs + SHOT_EFFECT_PROFILES[weaponId].impactMs);
      expect(scene.children).toHaveLength(0);
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
    const tracer = scene.children.find(
      (child) => child.userData.effectType === 'tracer',
    ) as Mesh;
    const impact = scene.children.find(
      (child) => child.userData.effectType === 'impact',
    ) as Mesh;
    const tracerGeometryDispose = vi.spyOn(tracer.geometry, 'dispose');
    const tracerMaterialDispose = vi.spyOn(tracer.material as Material, 'dispose');
    const impactGeometryDispose = vi.spyOn(impact.geometry, 'dispose');
    const impactMaterialDispose = vi.spyOn(impact.material as Material, 'dispose');

    effects.clear();

    expect(tracerGeometryDispose).toHaveBeenCalledOnce();
    expect(tracerMaterialDispose).toHaveBeenCalledOnce();
    expect(impactGeometryDispose).toHaveBeenCalledOnce();
    expect(impactMaterialDispose).toHaveBeenCalledOnce();
    expect(effects.getActiveCount()).toBe(0);
    expect(scene.children).toHaveLength(0);
    effects.dispose();
  });

  it('keeps distant local wall impacts readable without unbounded scaling', () => {
    const scene = new Scene();
    const effects = new CombatEffects(scene);
    effects.spawnShot({
      weaponId: 'deagle',
      from: new Vector3(0, 1, 0),
      to: new Vector3(0, 1, -40),
      impactNormal: new Vector3(0, 0, 1),
      nowMs: 0,
    });

    const impact = scene.children.find(
      (child) => child.userData.effectType === 'impact',
    );
    expect(impact).toBeInstanceOf(Mesh);
    if (!(impact instanceof Mesh)) {
      throw new Error('Expected a mesh impact');
    }
    const radius = impact.geometry.boundingSphere?.radius
      ?? (impact.geometry.computeBoundingSphere(), impact.geometry.boundingSphere?.radius);
    expect(radius).toBeCloseTo(0.72, 2);
    expect(radius).toBeLessThanOrEqual(0.8);
    expect(impact.material.depthTest).toBe(true);
    const outline = impact.children.find(
      (child) => child.userData.effectType === 'impact-outline',
    );
    expect(outline).toBeInstanceOf(Mesh);
    expect((outline as Mesh).material).toMatchObject({ depthTest: true });
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
    const effects = new CombatEffects(scene, viewmodelLayer);
    effects.spawnShot({
      weaponId: 'deagle',
      from: new Vector3(0.18, 1.44, -0.58),
      to: new Vector3(0, 1, -8),
      impactNormal: new Vector3(0, 0, 1),
      nowMs: 50,
    });

    expect(scene.children.map((child) => child.userData.effectType).sort())
      .toEqual(['impact', 'tracer']);
    const muzzle = viewmodelLayer.children[0] as Sprite;
    expect(muzzle.userData.effectType).toBe('muzzle');
    expect(muzzle.material.depthTest).toBe(true);
    expect(muzzle.position.z).toBeGreaterThan(-1);

    effects.dispose();
    expect(scene.children).toHaveLength(0);
    expect(viewmodelLayer.children).toHaveLength(0);
  });
});
