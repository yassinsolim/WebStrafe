import type { Vector3 } from 'three';
import type { GunId } from '../cosmetics/WeaponViewmodels';
import type { CollisionWorld } from '../world/CollisionWorld';
import type { CombatEffects } from './CombatEffects';
import { presentFirearmShot } from './FirearmShotFeedback';
import type { FireResult, WeaponController } from './WeaponController';

export interface LocalFirearmShotContext {
  weapon: Pick<WeaponController, 'tryFire'>;
  effects: CombatEffects;
  collisionWorld: Pick<CollisionWorld, 'raycastGeometry'>;
  onPresented(weaponId: GunId): void;
}

export interface LocalFirearmShotRequest {
  origin: Vector3;
  direction: Vector3;
  cameraUp: Vector3;
  nowMs: number;
}

export interface LocalFirearmShotResult extends FireResult {
  feedbackPresented: boolean;
  magazineEmptied: boolean;
}

/**
 * Couples accepted local ammo state to world/viewmodel feedback. This keeps the
 * native input path from consuming a firearm round without scheduling its
 * muzzle, tracer, impact, and recoil presentation in the same frame.
 */
export function fireLocalWeapon(
  context: LocalFirearmShotContext,
  request: LocalFirearmShotRequest,
): LocalFirearmShotResult {
  const result = context.weapon.tryFire(request.nowMs);
  if (!result.fired || (result.weapon.id !== 'deagle' && result.weapon.id !== 'awp')) {
    return { ...result, feedbackPresented: false, magazineEmptied: false };
  }

  const weaponId = result.weapon.id;
  const feedbackPresented = presentFirearmShot(
    {
      effects: context.effects,
      collisionWorld: context.collisionWorld,
    },
    {
      weaponId,
      origin: request.origin,
      direction: request.direction,
      cameraUp: request.cameraUp,
      nowMs: request.nowMs,
      local: true,
    },
  );
  if (!feedbackPresented) {
    throw new Error(`[Combat] accepted ${weaponId} shot without local feedback`);
  }
  context.onPresented(weaponId);
  return {
    ...result,
    feedbackPresented: true,
    magazineEmptied: result.ammoRemaining === 0,
  };
}
