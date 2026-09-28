import type { AimWeaponId } from './Inaccuracy';

/**
 * Per-shot recoil. Angle and magnitude numbers are CS2's scripts/weapons.vdata
 * (SteamTracking/GameTracking-CS2 @ 10f3693, 2026-09-23).
 */
export interface RecoilProfile {
  /** m_flRecoilAngle, degrees off straight up */
  angleDeg: number;
  /** m_flRecoilAngleVariance, random +- degrees (the horizontal drift) */
  angleVarianceDeg: number;
  /** m_flRecoilMagnitude, applied as aim punch velocity in degrees per second */
  magnitude: number;
  /** m_flRecoilMagnitudeVariance, random +- */
  magnitudeVariance: number;
}

export const RECOIL_PROFILES: Readonly<Record<AimWeaponId, RecoilProfile>> = {
  deagle: { angleDeg: 0, angleVarianceDeg: 60, magnitude: 48.2, magnitudeVariance: 18 },
  // unscoped values; the shot unscopes anyway and the design wants a heavy
  // kick (cs2 scoped is 25 +- 2)
  awp: { angleDeg: 0, angleVarianceDeg: 20, magnitude: 78, magnitudeVariance: 15 },
};

/**
 * cs:go convar defaults for the punch model. How the recoil magnitude feeds
 * the punch and how the view punch extra is applied are our reading of the
 * behaviour (the original Recoil() is not public).
 */
export const RECOIL_TUNING = {
  /** weapon_recoil_scale: bullets follow punch x this */
  recoilScale: 2,
  /** view_recoil_tracking: the camera shows this share of the bullet punch */
  viewTracking: 0.45,
  /** weapon_recoil_decay2_exp */
  decayExp: 8,
  /** weapon_recoil_decay2_lin, degrees per second */
  decayLinDegPerSec: 18,
  /** weapon_recoil_vel_decay */
  velocityDecay: 4.5,
  /** weapon_recoil_view_punch_extra: visual-only kick per unit of magnitude */
  viewPunchExtra: 0.055,
  /** view_punch_decay */
  viewPunchDecay: 18,
} as const;

/** pitch up and yaw left, radians */
export interface PunchAngles {
  pitch: number;
  yaw: number;
}

const DEG = Math.PI / 180;

/**
 * CS-style aim punch. Each shot adds punch velocity in a random direction
 * around straight up; the punch integrates that velocity and decays back to
 * zero (exponential plus linear), while the velocity itself decays. Bullets
 * go where the punch points (x recoil scale); the camera shows a share of it
 * plus a short visual-only kick. Nothing here touches the player's real view
 * angles, so the view always settles back where the player aimed.
 */
export class Recoil {
  // degrees, like the source model
  private punchPitch = 0;
  private punchYaw = 0;
  private velocityPitch = 0;
  private velocityYaw = 0;
  private viewPitch = 0;
  private viewYaw = 0;

  constructor(private readonly random: () => number = Math.random) {}

  kick(profile: RecoilProfile): void {
    const angle = (profile.angleDeg + (this.random() * 2 - 1) * profile.angleVarianceDeg) * DEG;
    const magnitude = Math.max(0, profile.magnitude + (this.random() * 2 - 1) * profile.magnitudeVariance);
    const up = Math.cos(angle) * magnitude;
    const side = Math.sin(angle) * magnitude;
    this.velocityPitch += up;
    this.velocityYaw += side;
    this.viewPitch += up * RECOIL_TUNING.viewPunchExtra;
    this.viewYaw += side * RECOIL_TUNING.viewPunchExtra;
  }

  tick(dtSec: number): void {
    const dt = Math.max(0, dtSec);
    if (dt === 0) return;
    // hybrid decay of the punch angle
    const keep = Math.exp(-RECOIL_TUNING.decayExp * dt);
    this.punchPitch *= keep;
    this.punchYaw *= keep;
    const magnitude = Math.hypot(this.punchPitch, this.punchYaw);
    const linear = RECOIL_TUNING.decayLinDegPerSec * dt;
    if (magnitude > linear) {
      const scale = 1 - linear / magnitude;
      this.punchPitch *= scale;
      this.punchYaw *= scale;
    } else {
      this.punchPitch = 0;
      this.punchYaw = 0;
    }
    // integrate the velocity half before and half after its own decay
    this.punchPitch += this.velocityPitch * dt * 0.5;
    this.punchYaw += this.velocityYaw * dt * 0.5;
    const velocityKeep = Math.exp(-RECOIL_TUNING.velocityDecay * dt);
    this.velocityPitch *= velocityKeep;
    this.velocityYaw *= velocityKeep;
    this.punchPitch += this.velocityPitch * dt * 0.5;
    this.punchYaw += this.velocityYaw * dt * 0.5;

    const viewKeep = Math.exp(-RECOIL_TUNING.viewPunchDecay * dt);
    this.viewPitch *= viewKeep;
    this.viewYaw *= viewKeep;
  }

  /** where the next bullet goes relative to the view angles */
  getAimOffset(): PunchAngles {
    return {
      pitch: this.punchPitch * RECOIL_TUNING.recoilScale * DEG,
      yaw: this.punchYaw * RECOIL_TUNING.recoilScale * DEG,
    };
  }

  /** camera offset this frame (visual only) */
  getViewOffset(): PunchAngles {
    const tracked = RECOIL_TUNING.recoilScale * RECOIL_TUNING.viewTracking;
    return {
      pitch: (this.viewPitch + this.punchPitch * tracked) * DEG,
      yaw: (this.viewYaw + this.punchYaw * tracked) * DEG,
    };
  }

  isSettled(): boolean {
    return Math.abs(this.punchPitch) + Math.abs(this.punchYaw) < 1e-4
      && Math.abs(this.velocityPitch) + Math.abs(this.velocityYaw) < 1e-3
      && Math.abs(this.viewPitch) + Math.abs(this.viewYaw) < 1e-4;
  }

  reset(): void {
    this.punchPitch = 0;
    this.punchYaw = 0;
    this.velocityPitch = 0;
    this.velocityYaw = 0;
    this.viewPitch = 0;
    this.viewYaw = 0;
  }
}
