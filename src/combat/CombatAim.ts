import { Vector3 } from 'three';
import { aimDirection, Inaccuracy, type AimWeaponId } from './Inaccuracy';
import { Recoil, RECOIL_PROFILES, type PunchAngles } from './Recoil';
import { DEFAULT_ZOOM_SENSITIVITY_RATIO, ScopeState, type ZoomLevel } from './Scope';
import { getWeapon, type WeaponId } from './weapons';

export interface CombatAimMotion {
  /** player velocity, m/s */
  velocity: { x: number; y: number; z: number };
  grounded: boolean;
  /** sv_maxspeed, m/s */
  maxSpeed: number;
  /** sv_jump_impulse, m/s */
  jumpImpulse: number;
}

export interface CombatAimContext {
  reloading: boolean;
  alive: boolean;
}

function aimWeapon(id: WeaponId): AimWeaponId | null {
  return id === 'awp' || id === 'deagle' ? id : null;
}

/**
 * The local player's aim for the held weapon: CS spread, aim punch and the
 * AWP scope, advanced on the fixed tick. GameApp asks it for the direction of
 * the next shot (view angles + aim punch + a sampled spread offset), the
 * camera punch, the scoped fov and the sensitivity multiplier. The authority
 * still trusts the direction it is sent.
 */
export class CombatAim {
  readonly inaccuracy: Inaccuracy;
  readonly recoil: Recoil;
  readonly scope = new ScopeState();
  private weapon: WeaponId = 'knife';

  constructor(random: () => number = Math.random) {
    this.inaccuracy = new Inaccuracy(random);
    this.recoil = new Recoil(random);
  }

  getWeapon(): WeaponId {
    return this.weapon;
  }

  /** weapon switch: unscopes and starts the new gun at its accuracy floor */
  setWeapon(id: WeaponId, nowMs: number): void {
    if (id === this.weapon) return;
    this.weapon = id;
    this.scope.cancel(nowMs);
    this.inaccuracy.setWeapon(aimWeapon(id));
  }

  /** fixed tick, after movement */
  tick(dtSec: number, motion: CombatAimMotion): void {
    this.inaccuracy.setScoped(this.scope.isScoped());
    this.inaccuracy.tick(dtSec, {
      horizontalSpeed: Math.hypot(motion.velocity.x, motion.velocity.z),
      verticalSpeed: motion.velocity.y,
      grounded: motion.grounded,
      maxSpeed: motion.maxSpeed,
      jumpImpulse: motion.jumpImpulse,
    });
    this.recoil.tick(dtSec);
  }

  /** per frame: brings the scope back after the bolt cycle */
  update(nowMs: number, context: CombatAimContext): void {
    this.scope.update(nowMs, { awpHeld: this.weapon === 'awp', ...context });
    this.inaccuracy.setScoped(this.scope.isScoped());
  }

  /** direction of the next shot: view angles plus aim punch plus a spread sample */
  shotDirection(yawRad: number, pitchRad: number, out = new Vector3()): Vector3 {
    const punch = this.recoil.getAimOffset();
    return aimDirection(
      yawRad + punch.yaw,
      pitchRad + punch.pitch,
      this.inaccuracy.sampleSpread(),
      out,
    );
  }

  /** after an accepted gun shot: accuracy penalty, recoil kick, awp unscope */
  onShotFired(nowMs: number): void {
    const gun = aimWeapon(this.weapon);
    if (!gun) return;
    this.inaccuracy.onShot();
    this.recoil.kick(RECOIL_PROFILES[gun]);
    if (gun === 'awp') {
      this.scope.onShot(nowMs, getWeapon('awp').fireIntervalMs);
    }
    this.inaccuracy.setScoped(this.scope.isScoped());
  }

  /** right click with the AWP; false when the zoom did not change */
  toggleScope(nowMs: number, context: CombatAimContext): boolean {
    const changed = this.scope.cycle(nowMs, { awpHeld: this.weapon === 'awp', ...context });
    this.inaccuracy.setScoped(this.scope.isScoped());
    return changed;
  }

  /** reload, pause or death */
  cancelScope(nowMs: number): void {
    this.scope.cancel(nowMs);
    this.inaccuracy.setScoped(false);
  }

  /** fresh life */
  reset(): void {
    this.scope.reset();
    this.recoil.reset();
    this.inaccuracy.reset();
  }

  /** camera-only pitch/yaw offset, radians */
  getViewPunch(): PunchAngles {
    return this.recoil.getViewOffset();
  }

  /** current cone radius for the crosshair, radians (0 for the knife) */
  getInaccuracyRadians(): number {
    return this.inaccuracy.getInaccuracyRadians();
  }

  isScoped(): boolean {
    return this.scope.isScoped();
  }

  getZoomLevel(): ZoomLevel {
    return this.scope.getLevel();
  }

  getFovDeg(baseFovDeg: number, nowMs: number): number {
    return this.scope.getFovDeg(baseFovDeg, nowMs);
  }

  getSensitivityScale(baseFovDeg: number, zoomSensitivityRatio = DEFAULT_ZOOM_SENSITIVITY_RATIO): number {
    return this.scope.getSensitivityScale(baseFovDeg, zoomSensitivityRatio);
  }
}
