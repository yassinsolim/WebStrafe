import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Scene,
  Vector3,
} from 'three';
import { describe, expect, it, vi } from 'vitest';
import { CollisionWorld } from '../../world/CollisionWorld';
import { CombatEffects, SHOT_EFFECT_PROFILES } from '../CombatEffects';
import { fireLocalWeapon } from '../LocalFirearmShot';
import { WeaponController } from '../WeaponController';

describe('local firearm integration', () => {
  it.each(['deagle', 'awp'] as const)(
    'couples an accepted %s round to visible feedback in the same frame',
    (weaponId) => {
      const worldScene = new Scene();
      const viewmodelLayer = new Group();
      const effects = new CombatEffects(worldScene, viewmodelLayer);
      const collisionWorld = new CollisionWorld();
      const collisionRoot = new Group();
      const floor = new Mesh(
        new BoxGeometry(20, 0.2, 20),
        new MeshBasicMaterial(),
      );
      floor.position.y = -0.1;
      collisionRoot.add(floor);
      collisionWorld.setCollisionFromRoot(collisionRoot);

      const weapon = new WeaponController(weaponId);
      const ammoBefore = weapon.getAmmo();
      const onPresented = vi.fn();
      const nowMs = 1000;
      const result = fireLocalWeapon(
        { weapon, effects, collisionWorld, onPresented },
        {
          origin: new Vector3(0, 1.6, 0),
          direction: new Vector3(0, -0.7, -1).normalize(),
          cameraUp: new Vector3(0, 1, 0),
          nowMs,
        },
      );

      expect(result).toMatchObject({
        fired: true,
        feedbackPresented: true,
        magazineEmptied: false,
        ammoRemaining: ammoBefore - 1,
      });
      expect(onPresented).toHaveBeenCalledOnce();
      expect(onPresented).toHaveBeenCalledWith(weaponId);
      expect(worldScene.children.map((child) => child.userData.effectType).sort())
        .toEqual(['impact', 'tracer']);
      expect(viewmodelLayer.children.map((child) => child.userData.effectType))
        .toEqual(['muzzle']);

      // The birth time is the frame timestamp, so every cue renders immediately
      // and remains present through several consecutive 60 Hz frames.
      for (let frame = 0; frame < 4; frame += 1) {
        effects.update(nowMs + frame * (1000 / 60));
        expect(worldScene.children.every((child) => child.visible)).toBe(true);
        expect(viewmodelLayer.children[0]?.visible).toBe(true);
      }

      effects.update(nowMs + SHOT_EFFECT_PROFILES[weaponId].flashMs);
      expect(viewmodelLayer.children).toHaveLength(0);
      effects.dispose();
      collisionWorld.clear();
      expect(worldScene.children).toHaveLength(0);
    },
  );

  it('reports an accepted last round so the app can start auto-reload', () => {
    const worldScene = new Scene();
    const effects = new CombatEffects(worldScene, new Group());
    const collisionWorld = new CollisionWorld();
    const weapon = new WeaponController('deagle');
    for (let shot = 0; shot < 6; shot += 1) {
      expect(weapon.tryFire(shot * 1000).fired).toBe(true);
    }

    const result = fireLocalWeapon(
      { weapon, effects, collisionWorld, onPresented: vi.fn() },
      {
        origin: new Vector3(0, 1.6, 0),
        direction: new Vector3(0, 0, -1),
        cameraUp: new Vector3(0, 1, 0),
        nowMs: 6000,
      },
    );

    expect(result).toMatchObject({
      fired: true,
      ammoRemaining: 0,
      feedbackPresented: true,
      magazineEmptied: true,
    });
    effects.dispose();
  });
});
