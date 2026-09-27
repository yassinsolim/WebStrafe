import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CombatAim, type CombatAimMotion } from '../CombatAim';
import { aimDirection, createSeededRandom } from '../Inaccuracy';
import { getWeapon } from '../weapons';

const TICK = 1 / 128;
const still: CombatAimMotion = { velocity: { x: 0, y: 0, z: 0 }, grounded: true, maxSpeed: 9.5, jumpImpulse: 5.4 };
const ready = { reloading: false, alive: true };

function tickFor(aim: CombatAim, seconds: number, motion = still): void {
  for (let t = 0; t < seconds - 1e-9; t += TICK) aim.tick(TICK, motion);
}

const pitchOf = (dir: Vector3) => Math.asin(dir.y);

describe('CombatAim', () => {
  it('has no spread or punch with the knife', () => {
    const aim = new CombatAim(createSeededRandom(1));
    tickFor(aim, 0.2);
    expect(aim.getInaccuracyRadians()).toBe(0);
    const dir = aim.shotDirection(0.3, 0.1);
    expect(dir.distanceTo(aimDirection(0.3, 0.1))).toBeLessThan(1e-12);
  });

  it('puts the current aim punch into the next deagle shot and lets it recover', () => {
    const aim = new CombatAim(() => 0.5);
    aim.setWeapon('deagle', 0);
    tickFor(aim, 0.2);
    const first = aim.shotDirection(0, 0);
    expect(Math.abs(pitchOf(first))).toBeLessThan(0.01);
    aim.onShotFired(0);
    tickFor(aim, 0.1);
    const second = aim.shotDirection(0, 0);
    expect(pitchOf(second)).toBeGreaterThan((1.5 * Math.PI) / 180);
    expect(aim.getViewPunch().pitch).toBeGreaterThan(0);
    // the camera shows less than where the bullet goes, like cs
    expect(aim.getViewPunch().pitch).toBeLessThan(pitchOf(second));
    tickFor(aim, 0.6);
    expect(Math.abs(aim.getViewPunch().pitch)).toBeLessThan(0.001);
  });

  it('opens the deagle cone after a shot', () => {
    const aim = new CombatAim(createSeededRandom(2));
    aim.setWeapon('deagle', 0);
    tickFor(aim, 0.1);
    const before = aim.getInaccuracyRadians();
    aim.onShotFired(0);
    expect(aim.getInaccuracyRadians()).toBeGreaterThan(before * 5);
  });

  it('scopes only with the awp, unscopes on fire and re-scopes after the bolt', () => {
    const aim = new CombatAim(createSeededRandom(3));
    aim.setWeapon('deagle', 0);
    expect(aim.toggleScope(0, ready)).toBe(false);
    aim.setWeapon('awp', 0);
    expect(aim.toggleScope(0, ready)).toBe(true);
    expect(aim.getZoomLevel()).toBe(1);
    tickFor(aim, 0.5);
    expect(aim.getInaccuracyRadians()).toBeLessThan(0.005);

    aim.onShotFired(1000);
    expect(aim.isScoped()).toBe(false);
    // the unscoped floor applies from the next tick, like cs's per-tick update
    tickFor(aim, TICK);
    expect(aim.getInaccuracyRadians()).toBeGreaterThan(0.08);
    const bolt = getWeapon('awp').fireIntervalMs;
    aim.update(1000 + bolt - 1, ready);
    expect(aim.isScoped()).toBe(false);
    aim.update(1000 + bolt, ready);
    expect(aim.getZoomLevel()).toBe(1);
  });

  it('zooms the fov and slows the mouse while scoped, and resets both on a switch', () => {
    const aim = new CombatAim();
    aim.setWeapon('awp', 0);
    aim.toggleScope(0, ready);
    aim.toggleScope(1, ready);
    expect(aim.getFovDeg(90, 1000)).toBeCloseTo(10, 6);
    expect(aim.getSensitivityScale(90)).toBeCloseTo(10 / 90, 6);
    aim.setWeapon('knife', 2000);
    expect(aim.isScoped()).toBe(false);
    expect(aim.getFovDeg(90, 3000)).toBe(90);
    expect(aim.getSensitivityScale(90)).toBe(1);
  });

  it('cancels the scope on reload and clears everything on reset', () => {
    const aim = new CombatAim(() => 0.5);
    aim.setWeapon('awp', 0);
    aim.toggleScope(0, ready);
    aim.onShotFired(10);
    aim.cancelScope(20);
    aim.update(10 + getWeapon('awp').fireIntervalMs, ready);
    expect(aim.isScoped()).toBe(false);
    aim.reset();
    expect(aim.getViewPunch()).toEqual({ pitch: 0, yaw: 0 });
  });
});
