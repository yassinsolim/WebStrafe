import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  FIREARM_RECOIL_PROFILES,
  ViewmodelRenderer,
} from '../ViewmodelRenderer';
import type { GunId } from '../WeaponViewmodels';

const worldCamera = new PerspectiveCamera();
const still = new Vector3();
const noLook = { x: 0, y: 0 };

function recoilAt(weaponId: GunId, seconds: number): ViewmodelRenderer {
  const renderer = new ViewmodelRenderer(68, 16 / 9);
  renderer.setFirearm(weaponId);
  renderer.addFireKick(weaponId);
  renderer.update(seconds, worldCamera, still, noLook);
  return renderer;
}

describe('ViewmodelRenderer firearm recoil', () => {
  it('gives Deagle and AWP distinct fast-onset kick silhouettes', () => {
    const deagle = recoilAt('deagle', 1 / 60);
    const awp = recoilAt('awp', 1 / 60);

    expect(deagle.motionPos.z).toBeGreaterThan(0.025);
    expect(awp.motionPos.z).toBeGreaterThan(deagle.motionPos.z);
    expect(Math.abs(awp.motionRot.x)).toBeGreaterThan(Math.abs(deagle.motionRot.x));
    expect(deagle.motionRot.z).toBeGreaterThan(0);
    expect(awp.motionRot.z).toBeLessThan(0);
  });

  it('keeps recoil visible across capture latency and recovers at exact boundaries', () => {
    const deagleAt250 = recoilAt('deagle', 0.25);
    const awpAt250 = recoilAt('awp', 0.25);
    expect(deagleAt250.motionPos.z).toBeGreaterThan(0.008);
    expect(awpAt250.motionPos.z).toBeGreaterThan(0.025);

    const deagleDone = recoilAt(
      'deagle',
      FIREARM_RECOIL_PROFILES.deagle.durationSec,
    );
    const awpStillRecovering = recoilAt(
      'awp',
      FIREARM_RECOIL_PROFILES.deagle.durationSec,
    );
    expect(deagleDone.motionPos.z).toBe(0);
    expect(deagleDone.motionRot.x).toBe(0);
    expect(awpStillRecovering.motionPos.z).toBeGreaterThan(0);

    const awpDone = recoilAt('awp', FIREARM_RECOIL_PROFILES.awp.durationSec);
    expect(awpDone.motionPos.z).toBe(0);
    expect(awpDone.motionRot.x).toBe(0);
  });

  it('preserves the established firearm sway response outside 60 FPS', () => {
    const renderer = new ViewmodelRenderer(68, 16 / 9);
    renderer.setFirearm('deagle');
    renderer.update(1 / 30, worldCamera, still, { x: 100, y: 0 });

    expect(renderer.motionPos.x).toBeCloseTo(-100 * 0.00022 * 0.82 * 0.14, 12);
    expect(renderer.motionRot.y).toBeCloseTo(-100 * 0.0002 * 0.78 * 0.12, 12);
  });

  it('clears recoil on weapon transfer and explicit combat cleanup', () => {
    const renderer = recoilAt('deagle', 1 / 60);
    expect(renderer.motionPos.z).toBeGreaterThan(0);

    renderer.setFirearm('awp');
    renderer.update(1 / 60, worldCamera, still, noLook);
    expect(renderer.motionPos.z).toBe(0);
    expect(renderer.motionRot.z).toBe(0);

    renderer.addFireKick('awp');
    renderer.update(1 / 60, worldCamera, still, noLook);
    expect(renderer.motionPos.z).toBeGreaterThan(0);
    renderer.clearFirearmTransient();
    renderer.update(1 / 60, worldCamera, still, noLook);
    expect(renderer.motionPos.z).toBe(0);
    expect(renderer.motionRot.x).toBe(0);
  });

  it('exposes each magazine well without over-lifting the long AWP rig', () => {
    const reloadAtMidpoint = (weaponId: GunId): ViewmodelRenderer => {
      const renderer = new ViewmodelRenderer(68, 16 / 9);
      renderer.setFirearm(weaponId);
      renderer.triggerReload(3000);
      renderer.update(1.5, worldCamera, still, noLook);
      return renderer;
    };
    const deagle = reloadAtMidpoint('deagle');
    const awp = reloadAtMidpoint('awp');

    expect(deagle.motionPos.y).toBeGreaterThan(0.07);
    expect(awp.motionPos.y).toBeGreaterThan(0.01);
    expect(awp.motionPos.y).toBeLessThan(0.02);
    expect(deagle.motionPos.y).toBeGreaterThan(awp.motionPos.y * 4);
    expect(deagle.motionRot.x).toBeGreaterThan(0.1);
    expect(awp.motionRot.x).toBeGreaterThan(0.1);
  });
});


describe('ViewmodelRenderer knife movement', () => {
  it('eases inspect into a readable hold and returns smoothly to idle', () => {
    const renderer = new ViewmodelRenderer(68, 16 / 9);
    renderer.triggerInspect();

    expect(renderer.update(0, worldCamera, still, noLook)).toBe(0);
    const entering = renderer.update(0.24, worldCamera, still, noLook);
    expect(entering).toBeGreaterThan(0);
    expect(entering).toBeLessThan(1);

    expect(renderer.update(0.72, worldCamera, still, noLook)).toBe(1);
    expect(renderer.getInspectProgress()).toBeCloseTo(0.4);
    const returning = renderer.update(1.2, worldCamera, still, noLook);
    expect(returning).toBeGreaterThan(0);
    expect(returning).toBeLessThan(1);
    expect(renderer.update(0.24, worldCamera, still, noLook)).toBe(0);
    expect(renderer.getInspectProgress()).toBe(0);
  });

  it('cancels inspect exactly when a firearm action starts', () => {
    const renderer = new ViewmodelRenderer(68, 16 / 9);
    renderer.setFirearm('deagle');
    renderer.triggerInspect();
    expect(renderer.update(0.6, worldCamera, still, noLook)).toBeGreaterThan(0);

    renderer.addFireKick('deagle');
    expect(renderer.update(0, worldCamera, still, noLook)).toBe(0);
    expect(renderer.getInspectProgress()).toBe(0);
  });

  it('keeps the integrated knife lighter and more agile than either firearm', () => {
    const sample = (weaponId: GunId | null): number => {
      const renderer = new ViewmodelRenderer(68, 16 / 9);
      renderer.setIntegratedMode(true);
      renderer.setMotionScale(0.08);
      renderer.setFirearm(weaponId);
      renderer.update(1 / 60, worldCamera, new Vector3(8, 0, 0), noLook);
      return Math.hypot(renderer.motionPos.x, renderer.motionPos.y);
    };

    const knifeTravel = sample(null);
    expect(knifeTravel).toBeGreaterThan(sample('deagle') * 4.5);
    expect(knifeTravel).toBeGreaterThan(sample('awp') * 6);
  });

  it('adds bounded airborne and landing response and recovers cleanly', () => {
    const renderer = new ViewmodelRenderer(68, 16 / 9);
    renderer.setIntegratedMode(true);
    renderer.setMotionScale(0.08);
    renderer.update(1 / 60, worldCamera, new Vector3(0, 8, 0), noLook);
    expect(renderer.motionPos.y).toBeGreaterThan(0);

    renderer.update(1 / 60, worldCamera, new Vector3(0, -10, 0), noLook);
    renderer.update(1 / 60, worldCamera, still, noLook);
    expect(renderer.motionPos.y).toBeLessThan(-0.007);
    expect(renderer.motionRot.x).toBeGreaterThan(0.02);

    renderer.update(1, worldCamera, still, noLook);
    expect(renderer.motionPos.y).toBe(0);
    expect(renderer.motionRot.x).toBe(0);
  });

  it('clears movement, landing, inspect, and firearm impulses on lifecycle reset', () => {
    const renderer = new ViewmodelRenderer(68, 16 / 9);
    renderer.setFirearm('deagle');
    renderer.addFireKick('deagle');
    renderer.triggerInspect();
    renderer.update(1 / 60, worldCamera, new Vector3(8, -10, 0), { x: 40, y: -30 });
    renderer.update(1 / 60, worldCamera, still, noLook);
    renderer.clearPresentationTransient();

    expect(renderer.motionPos.toArray()).toEqual([0, 0, 0]);
    expect(renderer.motionRot.toArray()).toEqual([0, 0, 0, 'XYZ']);
    renderer.update(1 / 60, worldCamera, still, noLook);
    expect(renderer.motionPos.toArray()).toEqual([0, 0, 0]);
    expect(renderer.motionRot.x).toBe(0);
  });
});
