import { getWeapon, isMelee, WEAPON_IDS, type WeaponDef, type WeaponId } from './weapons';

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
    for (const id of WEAPON_IDS) {
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

  equip(id: WeaponId, nowMs?: number): void {
    if (id === this.active) return;
    // a reload whose timer already ran out is done, even if nobody ticked us since
    if (nowMs !== undefined) this.completeReloadIfDue(nowMs);
    this.active = id;
    // Switching weapons cancels an in-progress reload.
    this.reloadingUntilMs = null;
    this.reloadingWeapon = null;
  }

  /** Restores every magazine and cancels cooldown/reload state on a true respawn. */
  reset(): void {
    for (const id of WEAPON_IDS) {
      const def = getWeapon(id);
      this.ammo.set(id, isMelee(def) ? Infinity : def.magazine);
    }
    this.lastFireAtMs = {};
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

  /**
   * Accepts the shooter's own magazine count for the active weapon when it's
   * higher than ours (a reload we missed or cancelled, or a handoff), capped at
   * a full magazine. Returns true when our copy changed. Fire interval stays
   * ours, so this can't speed up shooting.
   */
  reconcileAmmo(reported: number, nowMs: number): boolean {
    this.completeReloadIfDue(nowMs);
    const weapon = getWeapon(this.active);
    if (isMelee(weapon) || !Number.isFinite(reported)) return false;
    const claimed = Math.min(weapon.magazine, Math.max(0, Math.floor(reported)));
    if (claimed <= this.getAmmo()) return false;
    if (this.reloadingWeapon === this.active) {
      this.reloadingUntilMs = null;
      this.reloadingWeapon = null;
    }
    this.ammo.set(this.active, claimed);
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
