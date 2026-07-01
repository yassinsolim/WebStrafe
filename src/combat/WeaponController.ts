import { getWeapon, isMelee, type WeaponDef, type WeaponId } from './weapons';

export interface FireResult {
  fired: boolean;
  weapon: WeaponDef;
  ammoRemaining: number;
}

/**
 * Client-side weapon state: active weapon, per-weapon ammo, fire cooldown, and
 * reload timing. This drives the local player's shooting feel; the server stays
 * authoritative over damage (see CombatState). Deterministic — all timing is
 * passed in as `nowMs`.
 */
export class WeaponController {
  private active: WeaponId;
  private readonly ammo = new Map<WeaponId, number>();
  private lastFireAtMs: Partial<Record<WeaponId, number>> = {};
  private reloadingUntilMs: number | null = null;
  private reloadingWeapon: WeaponId | null = null;

  constructor(initial: WeaponId = 'knife') {
    this.active = initial;
    for (const id of ['awp', 'deagle', 'knife'] as WeaponId[]) {
      const def = getWeapon(id);
      this.ammo.set(id, isMelee(def) ? Infinity : def.magazine);
    }
  }

  getActive(): WeaponId {
    return this.active;
  }

  getAmmo(id: WeaponId = this.active): number {
    return this.ammo.get(id) ?? 0;
  }

  isReloading(nowMs: number): boolean {
    this.completeReloadIfDue(nowMs);
    return this.reloadingUntilMs !== null;
  }

  equip(id: WeaponId): void {
    if (id === this.active) return;
    this.active = id;
    // Switching weapons cancels an in-progress reload.
    this.reloadingUntilMs = null;
    this.reloadingWeapon = null;
  }

  /**
   * Attempts to fire the active weapon. Succeeds only when off cooldown, not
   * reloading, and with ammo remaining. On success, consumes a round and starts
   * the cooldown.
   */
  tryFire(nowMs: number): FireResult {
    this.completeReloadIfDue(nowMs);
    const weapon = getWeapon(this.active);

    if (this.reloadingUntilMs !== null) {
      return { fired: false, weapon, ammoRemaining: this.getAmmo() };
    }
    const last = this.lastFireAtMs[this.active];
    if (last !== undefined && nowMs - last < weapon.fireIntervalMs) {
      return { fired: false, weapon, ammoRemaining: this.getAmmo() };
    }
    const ammo = this.getAmmo();
    if (ammo <= 0) {
      return { fired: false, weapon, ammoRemaining: 0 };
    }

    this.lastFireAtMs[this.active] = nowMs;
    if (Number.isFinite(ammo)) {
      this.ammo.set(this.active, ammo - 1);
    }
    return { fired: true, weapon, ammoRemaining: this.getAmmo() };
  }

  /** Begins a reload for the active weapon (no-op for melee or a full magazine). */
  reload(nowMs: number): boolean {
    const weapon = getWeapon(this.active);
    if (isMelee(weapon)) return false;
    if (this.reloadingUntilMs !== null) return false;
    if (this.getAmmo() >= weapon.magazine) return false;
    this.reloadingUntilMs = nowMs + weapon.reloadMs;
    this.reloadingWeapon = this.active;
    return true;
  }

  /** Advances time; completes any reload whose timer has elapsed. */
  update(nowMs: number): void {
    this.completeReloadIfDue(nowMs);
  }

  private completeReloadIfDue(nowMs: number): void {
    if (this.reloadingUntilMs === null || this.reloadingWeapon === null) return;
    if (nowMs >= this.reloadingUntilMs) {
      const def = getWeapon(this.reloadingWeapon);
      this.ammo.set(this.reloadingWeapon, def.magazine);
      this.reloadingUntilMs = null;
      this.reloadingWeapon = null;
    }
  }
}
