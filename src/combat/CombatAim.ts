import { Vector3 } from 'three';
import { aimDirection, type AimWeaponId } from './Inaccuracy';
import { Recoil, RECOIL_PROFILES, type PunchAngles } from './Recoil';
import { DEFAULT_ZOOM_SENSITIVITY_RATIO, ScopeState, type ZoomLevel } from './Scope';
import { getWeapon, type WeaponId } from './weapons';

export interface CombatAimMotion {
  /** player velocity, m/s */
  velocity: { x: number; y: number; z: number };
  grounded: boolean;
  /** the held weapon's max speed (MovementController.getMaxSpeed), m/s */
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
 * Player shots follow view angles plus recoil without random spread, including
 * movement, jumps and unscoped shots. The AWP scope still controls zoom and the
 * bolt cycle. The authority uses the submitted shot direction.
 */
export class CombatAim {
  readonly recoil: Recoil;
  readonly scope = new ScopeState();
  private weapon: WeaponId = 'knife';

  constructor(random: () => number = Math.random) {
    this.recoil = new Recoil(random);
  }

  getWeapon(): WeaponId {
    return this.weapon;
  }

  /** weapon switch: unscopes */
  setWeapon(id: WeaponId, nowMs: number): void {
    if (id === this.weapon) return;
    this.weapon = id;
    this.scope.cancel(nowMs);
  }

  /** fixed tick, after movement */
  tick(dtSec: number, _motion: CombatAimMotion): void {
    this.recoil.tick(dtSec);
  }

  /** per frame: brings the scope back after the bolt cycle */
  update(nowMs: number, context: CombatAimContext): void {
    this.scope.update(nowMs, { awpHeld: this.weapon === 'awp', ...context });
  }

  /** direction of the next shot: view angles plus aim punch */
  shotDirection(yawRad: number, pitchRad: number, out = new Vector3()): Vector3 {
    const punch = this.recoil.getAimOffset();
    return aimDirection(
      yawRad + punch.yaw,
      pitchRad + punch.pitch,
      undefined,
      out,
    );
  }

  /** after an accepted gun shot: recoil kick and awp unscope */
  onShotFired(nowMs: number): void {
    const gun = aimWeapon(this.weapon);
    if (!gun) return;
    this.recoil.kick(RECOIL_PROFILES[gun]);
    if (gun === 'awp') {
      this.scope.onShot(nowMs, getWeapon('awp').fireIntervalMs);
    }
  }

  /** right click with the AWP; false when the zoom did not change */
  toggleScope(nowMs: number, context: CombatAimContext): boolean {
    return this.scope.cycle(nowMs, { awpHeld: this.weapon === 'awp', ...context });
  }

  /** reload, pause or death */
  cancelScope(nowMs: number): void {
    this.scope.cancel(nowMs);
  }

  /** fresh life */
  reset(): void {
    this.scope.reset();
    this.recoil.reset();
  }

  /** camera-only pitch/yaw offset, radians */
  getViewPunch(): PunchAngles {
    return this.recoil.getViewOffset();
  }

  /** player weapons have no random-spread cone */
  getInaccuracyRadians(): number {
    return 0;
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
