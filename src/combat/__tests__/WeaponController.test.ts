import { describe, expect, it } from 'vitest';
import { WeaponController } from '../WeaponController';
import { getWeapon } from '../weapons';

const deagle = getWeapon('deagle');

describe('WeaponController', () => {
  it('starts with the initial weapon and a full magazine', () => {
    const wc = new WeaponController('deagle');
    expect(wc.getActive()).toBe('deagle');
    expect(wc.getAmmo()).toBe(deagle.magazine);
  });

  it('gives melee weapons infinite ammo', () => {
    const wc = new WeaponController('knife');
    expect(wc.getAmmo()).toBe(Infinity);
  });

  it('fires and consumes a round', () => {
    const wc = new WeaponController('deagle');
    const res = wc.tryFire(1000);
    expect(res.fired).toBe(true);
    expect(wc.getAmmo()).toBe(deagle.magazine - 1);
  });

  it('does not consume ammo for melee', () => {
    const wc = new WeaponController('knife');
    wc.tryFire(1000);
    expect(wc.getAmmo()).toBe(Infinity);
  });

  it('enforces the fire cooldown', () => {
    const wc = new WeaponController('deagle');
    expect(wc.tryFire(1000).fired).toBe(true);
    expect(wc.tryFire(1000 + deagle.fireIntervalMs - 1).fired).toBe(false);
    expect(wc.tryFire(1000 + deagle.fireIntervalMs).fired).toBe(true);
  });

  it('cannot fire with an empty magazine', () => {
    const wc = new WeaponController('deagle');
    let now = 0;
    for (let i = 0; i < deagle.magazine; i++) {
      expect(wc.tryFire(now).fired).toBe(true);
      now += deagle.fireIntervalMs;
    }
    expect(wc.getAmmo()).toBe(0);
    expect(wc.tryFire(now).fired).toBe(false);
  });

  it('reloads after the reload time and refills the magazine', () => {
    const wc = new WeaponController('deagle');
    wc.tryFire(0);
    expect(wc.reload(100)).toBe(true);
    expect(wc.isReloading(100)).toBe(true);
    // Still reloading just before the timer.
    expect(wc.isReloading(100 + deagle.reloadMs - 1)).toBe(true);
    // Completes once elapsed.
    wc.update(100 + deagle.reloadMs);
    expect(wc.isReloading(100 + deagle.reloadMs)).toBe(false);
    expect(wc.getAmmo()).toBe(deagle.magazine);
  });

  it('cannot fire while reloading', () => {
    const wc = new WeaponController('deagle');
    wc.tryFire(0);
    wc.reload(100);
    expect(wc.tryFire(200).fired).toBe(false);
  });

  it('does not reload a full magazine or a melee weapon', () => {
    const full = new WeaponController('deagle');
    expect(full.reload(0)).toBe(false);
    const melee = new WeaponController('knife');
    expect(melee.reload(0)).toBe(false);
  });

  it('tracks ammo independently per weapon', () => {
    const wc = new WeaponController('deagle');
    wc.tryFire(0);
    wc.equip('awp');
    expect(wc.getAmmo('awp')).toBe(getWeapon('awp').magazine);
    expect(wc.getAmmo('deagle')).toBe(deagle.magazine - 1);
  });

  it('cancels an in-progress reload when switching weapons', () => {
    const wc = new WeaponController('deagle');
    wc.tryFire(0);
    wc.reload(100);
    expect(wc.isReloading(200)).toBe(true);
    wc.equip('awp');
    expect(wc.isReloading(200)).toBe(false);
  });
});
