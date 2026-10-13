import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  FIREARM_RECOIL_PROFILES,
  ViewmodelRenderer,
} from '../ViewmodelRenderer';
import type { FirearmId as GunId } from '../../combat/FirearmTiming';

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

  it('sways the same for the same mouse movement at any frame rate', () => {
    const swayAfter = (fps: number) => {
      const renderer = new ViewmodelRenderer(68, 16 / 9);
      renderer.setFirearm('deagle');
      // 600 px/s to the right for half a second
      for (let i = 0; i < fps / 2; i += 1) renderer.update(1 / fps, worldCamera, still, { x: 600 / fps, y: 0 });
      return [renderer.motionPos.x, renderer.motionRot.y];
    };
    const [x30, yaw30] = swayAfter(30);
    const [x144, yaw144] = swayAfter(144);
    expect(x30).toBeLessThan(-0.001);
    expect(x144).toBeCloseTo(x30, 6);
    expect(yaw144).toBeCloseTo(yaw30, 6);
    // the settled sway matches the old one-frame-at-60 gain
    expect(x30).toBeGreaterThan(-600 / 60 * 0.00022 * 0.82 - 1e-9);
  });

  it('stacks a refire on the kick still recovering instead of snapping it back', () => {
    const renderer = recoilAt('deagle', 0.27);
    const before = renderer.motionPos.z;
    expect(before).toBeGreaterThan(0.01);
    renderer.addFireKick('deagle');
    renderer.update(1 / 240, worldCamera, still, noLook);
    expect(renderer.motionPos.z).toBeGreaterThan(before * 0.98);
    for (let i = 0; i < 20; i += 1) renderer.update(1 / 240, worldCamera, still, noLook);
    expect(renderer.motionPos.z).toBeGreaterThan(before);
    expect(renderer.motionPos.z).toBeLessThanOrEqual(1.35 * FIREARM_RECOIL_PROFILES.deagle.back + 1e-9);
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
    renderer.update(1 / 60, worldCamera, new Vector3(0, 8, 0), noLook, false);
    expect(renderer.motionPos.y).toBeGreaterThan(0);

    renderer.update(1 / 60, worldCamera, new Vector3(0, -10, 0), noLook, false);
    // touching down: the dip builds over a few frames instead of popping in one
    renderer.update(1 / 60, worldCamera, still, noLook, true);
    const first = renderer.motionPos.y;
    let deepest = first;
    let pitch = 0;
    for (let i = 0; i < 12; i += 1) {
      renderer.update(1 / 60, worldCamera, still, noLook, true);
      deepest = Math.min(deepest, renderer.motionPos.y);
      pitch = Math.max(pitch, renderer.motionRot.x);
    }
    expect(first).toBeGreaterThan(deepest * 0.75);
    expect(deepest).toBeLessThan(-0.01);
    expect(deepest).toBeGreaterThan(-0.05);
    expect(pitch).toBeGreaterThan(0.02);

    renderer.update(1, worldCamera, still, noLook, true);
    expect(renderer.motionPos.y).toBe(0);
    expect(renderer.motionRot.x).toBe(0);
  });

  it('only bobs with feet on the ground', () => {
    const travel = (grounded: boolean) => {
      const renderer = new ViewmodelRenderer(68, 16 / 9);
      let most = 0;
      for (let i = 0; i < 120; i += 1) {
        renderer.update(1 / 60, worldCamera, new Vector3(7, 0, 0), noLook, grounded);
        if (i > 60) most = Math.max(most, Math.abs(renderer.motionRot.z));
      }
      return most;
    };
    expect(travel(true)).toBeGreaterThan(0.01);
    expect(travel(false)).toBeLessThan(1e-4);
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
