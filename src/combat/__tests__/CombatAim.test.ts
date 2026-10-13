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

  it('keeps the deagle cone closed after a shot while retaining recoil', () => {
    const aim = new CombatAim(createSeededRandom(2));
    aim.setWeapon('deagle', 0);
    tickFor(aim, 0.1);
    aim.onShotFired(0);
    expect(aim.getInaccuracyRadians()).toBe(0);
    expect(aim.getViewPunch().pitch).toBeGreaterThan(0);
  });

  it.each(['deagle', 'awp'] as const)('%s has zero spread through repeated airborne bhops and shots', weapon => {
    const aim = new CombatAim(createSeededRandom(17));
    aim.setWeapon(weapon, 0);
    const motion = [
      still,
      { ...still, velocity: { x: 25, y: 0, z: -30 } },
      { ...still, velocity: { x: 25, y: 5.4, z: -30 }, grounded: false },
      { ...still, velocity: { x: 25, y: 0, z: -30 }, grounded: false },
      { ...still, velocity: { x: 25, y: -12, z: -30 }, grounded: false },
      { ...still, velocity: { x: 25, y: 0, z: -30 } },
    ];
    for (let cycle = 0; cycle < 3; cycle += 1) {
      if (weapon === 'awp') aim.toggleScope(cycle * 2000, ready);
      for (const state of motion) {
        tickFor(aim, 0.1, state);
        expect(aim.getInaccuracyRadians()).toBe(0);
        const punch = aim.recoil.getAimOffset();
        const expected = aimDirection(0.7 + punch.yaw, -0.2 + punch.pitch);
        const output = new Vector3();
        expect(aim.shotDirection(0.7, -0.2, output)).toBe(output);
        expect(output.distanceTo(expected)).toBeLessThan(1e-12);
        expect(aim.shotDirection(0.7, -0.2).distanceTo(output)).toBeLessThan(1e-12);
        aim.onShotFired(cycle * 2000);
      }
    }
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
    tickFor(aim, TICK);
    expect(aim.getInaccuracyRadians()).toBe(0);
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
