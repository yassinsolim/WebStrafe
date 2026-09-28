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

  it.each(['deagle', 'awp'] as const)(
    'refills %s exactly at its visible reload completion',
    (weaponId) => {
      const def = getWeapon(weaponId);
      const wc = new WeaponController(weaponId);
      wc.tryFire(0);
      expect(wc.reload(100)).toBe(true);
      wc.update(100 + def.reloadMs - 1);
      expect(wc.getAmmo()).toBe(def.magazine - 1);
      wc.update(100 + def.reloadMs);
      expect(wc.getAmmo()).toBe(def.magazine);
      expect(wc.isReloading(100 + def.reloadMs)).toBe(false);
    },
  );

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

  it('restores every magazine and cancels transient state on respawn', () => {
    const wc = new WeaponController('deagle');
    wc.tryFire(0);
    wc.equip('awp');
    wc.tryFire(1_000);
    wc.reload(1_100);

    wc.reset();

    expect(wc.getActive()).toBe('awp');
    expect(wc.getAmmo('deagle')).toBe(getWeapon('deagle').magazine);
    expect(wc.getAmmo('awp')).toBe(getWeapon('awp').magazine);
    expect(wc.isReloading(1_100)).toBe(false);
    expect(wc.tryFire(1_100).fired).toBe(true);
  });

  describe('reload then weapon switch', () => {
    const empty = (wc: WeaponController, t0: number): number => {
      let t = t0;
      while (wc.getAmmo() > 0) {
        wc.tryFire(t);
        t += deagle.fireIntervalMs;
      }
      return t;
    };

    it('reload, switch, switch back, fire: a reload whose timer ran out survives the switch', () => {
      const wc = new WeaponController('deagle');
      const t = empty(wc, 0);
      wc.reload(t);
      // nobody calls update(); the switch comes well after the reload finished
      const later = t + deagle.reloadMs + 500;
      wc.equip('knife', later);
      wc.equip('deagle', later + 400);
      expect(wc.getAmmo()).toBe(deagle.magazine);
      expect(wc.tryFire(later + 400 + deagle.fireIntervalMs).fired).toBe(true);
    });

    it('a reload interrupted early by a switch stays cancelled', () => {
      const wc = new WeaponController('deagle');
      const t = empty(wc, 0);
      wc.reload(t);
      wc.equip('knife', t + deagle.reloadMs / 2);
      wc.equip('deagle', t + deagle.reloadMs * 2);
      expect(wc.getAmmo()).toBe(0);
      expect(wc.isReloading(t + deagle.reloadMs * 2)).toBe(false);
      expect(wc.tryFire(t + deagle.reloadMs * 2).fired).toBe(false);
    });
  });

  describe('reconcileAmmo', () => {
    it('takes a higher client count, capped at a full magazine, and cancels a stale reload', () => {
      const wc = new WeaponController('deagle');
      let t = 0;
      while (wc.getAmmo() > 0) { wc.tryFire(t); t += deagle.fireIntervalMs; }
      wc.reload(t);
      expect(wc.reconcileAmmo(99, t + 10)).toBe(true);
      expect(wc.getAmmo()).toBe(deagle.magazine);
      expect(wc.isReloading(t + 10)).toBe(false);
    });

    it('never lowers our count and does not skip the fire interval', () => {
      const wc = new WeaponController('deagle');
      expect(wc.tryFire(0).fired).toBe(true);
      expect(wc.reconcileAmmo(2, 1)).toBe(false);
      expect(wc.getAmmo()).toBe(deagle.magazine - 1);
      wc.reconcileAmmo(deagle.magazine, 1);
      expect(wc.tryFire(1).fired).toBe(false);
    });

    it('ignores melee and junk values', () => {
      const knife = new WeaponController('knife');
      expect(knife.reconcileAmmo(3, 0)).toBe(false);
      const wc = new WeaponController('deagle');
      expect(wc.reconcileAmmo(Number.NaN, 0)).toBe(false);
      expect(wc.reconcileAmmo(-4, 0)).toBe(false);
    });
  });
});
