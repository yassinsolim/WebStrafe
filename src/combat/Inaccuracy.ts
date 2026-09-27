import { Vector3 } from 'three';

/** Firearms that carry a CS accuracy model. The knife has none. */
export type AimWeaponId = 'awp' | 'deagle';

/**
 * One weapon mode's accuracy, in radians. Numbers are CS2's
 * scripts/weapons.vdata (SteamTracking/GameTracking-CS2 @ 10f3693,
 * 2026-09-23) unless a comment marks them as ours.
 */
export interface InaccuracyProfile {
  /** m_flSpread: second random circle added to every shot */
  spread: number;
  /** m_flInaccuracyStand: floor on the ground */
  stand: number;
  /** m_flInaccuracyJump: extra floor while airborne */
  jump: number;
  /** m_flInaccuracyLand: added per unit/s of landing speed */
  landPerUnitSpeed: number;
  /** m_flInaccuracyFire: added by each shot */
  fire: number;
  /** m_flInaccuracyMove: added at 95% of max speed */
  move: number;
  /** m_flInaccuracyJumpInitial: vertical speed term at take-off speed */
  jumpInitial: number;
  /** seconds for 90% of a penalty to decay on the ground */
  recoveryTimeSec: number;
  /** same, in the air (cs uses the crouch recovery time x4) */
  airRecoveryTimeSec: number;
}

const AWP_UNSCOPED: InaccuracyProfile = {
  spread: 0.0002,
  stand: 0.0808,
  jump: 0.13383,
  landPerUnitSpeed: 0.000307,
  fire: 0.05385,
  move: 0.17648,
  jumpInitial: 0.17286,
  // ours: the design wants scoped accuracy to settle in about 0.3 s after
  // zooming (the unscoped penalty decays into the scoped floor). cs2 uses
  // 0.34539 s, which settles in roughly 0.45 s.
  recoveryTimeSec: 0.25,
  airRecoveryTimeSec: 0.24671 * 4,
};

export const INACCURACY_PROFILES: Readonly<{
  deagle: InaccuracyProfile;
  awp: InaccuracyProfile;
  awpScoped: InaccuracyProfile;
}> = {
  deagle: {
    spread: 0.002,
    stand: 0.0042,
    jump: 0.04055,
    landPerUnitSpeed: 0.000043,
    fire: 0.07223,
    move: 0.0481,
    jumpInitial: 0.54882,
    // ours: per-shot inaccuracy recovers in about 0.4 s (docs/revamp-plan.md
    // section 5). cs2 uses 0.8112 s.
    recoveryTimeSec: 0.4,
    airRecoveryTimeSec: 0.449927 * 4,
  },
  awp: AWP_UNSCOPED,
  // cs2 "alt" (scoped) values; the rest is shared with unscoped
  awpScoped: {
    ...AWP_UNSCOPED,
    stand: 0.002,
    landPerUnitSpeed: 0.0001,
  },
};

/** cs: movement inaccuracy starts at 34% of max speed (CS_PLAYER_SPEED_DUCK_MODIFIER) */
export const MOVE_INACCURACY_START = 0.34;
/** and is complete at 95% of it */
export const MOVE_INACCURACY_FULL = 0.95;
/** cs MOVEMENT_CURVE01_EXPONENT: a steep ramp right past the threshold */
export const MOVE_INACCURACY_EXPONENT = 0.25;
/** source units are inches; cs landing penalties are per unit/s */
export const METRES_PER_UNIT = 0.0254;

export interface AimMotion {
  /** horizontal speed, m/s */
  horizontalSpeed: number;
  /** vertical velocity, m/s, positive up */
  verticalSpeed: number;
  grounded: boolean;
  /** max ground speed the move ramp is measured against, m/s (sv_maxspeed) */
  maxSpeed: number;
  /** jump take-off speed, m/s (sv_jump_impulse) */
  jumpImpulse: number;
}

export interface SpreadOffset {
  /** tangent-plane offset to the right, ~radians */
  x: number;
  /** tangent-plane offset up, ~radians */
  y: number;
}

const STILL: AimMotion = {
  horizontalSpeed: 0,
  verticalSpeed: 0,
  grounded: true,
  maxSpeed: 1,
  jumpImpulse: 1,
};

/**
 * CS-style accuracy for the local player's gun, advanced on the fixed tick.
 *
 * - A penalty that sits at the stance floor (stand, or stand + jump in the
 *   air), jumps by `fire` per shot and by `land` x fall speed on landing, and
 *   decays back to the floor exponentially (90% per recovery time).
 * - On top of that, a movement term that is zero up to 34% of max speed and
 *   ramps steeply to full at 95%, and in the air a vertical speed term that is
 *   worst at take-off and zero near the apex.
 * - Shots sample the cone like CS: a random radius in [0, inaccuracy] at a
 *   random angle, plus a second circle of radius `spread`.
 *
 * Deterministic for a given random source.
 */
export class Inaccuracy {
  private weapon: AimWeaponId | null = null;
  private scoped = false;
  private penalty = 0;
  private motion: AimMotion = { ...STILL };
  private wasGrounded = true;
  private lastAirVerticalSpeed = 0;

  constructor(private readonly random: () => number = Math.random) {}

  getWeapon(): AimWeaponId | null {
    return this.weapon;
  }

  /** switching guns starts the new one at its current floor */
  setWeapon(weapon: AimWeaponId | null): void {
    if (weapon === this.weapon) return;
    this.weapon = weapon;
    this.scoped = false;
    const profile = this.profile();
    this.penalty = profile ? this.floor(profile) : 0;
  }

  /** scoped only means something for the AWP */
  setScoped(scoped: boolean): void {
    this.scoped = scoped && this.weapon === 'awp';
  }

  isScoped(): boolean {
    return this.scoped;
  }

  tick(dtSec: number, motion: AimMotion): void {
    this.motion = { ...motion };
    const landed = motion.grounded && !this.wasGrounded;
    if (!motion.grounded) this.lastAirVerticalSpeed = motion.verticalSpeed;
    this.wasGrounded = motion.grounded;

    const profile = this.profile();
    if (!profile) return;
    if (landed) {
      const fallUnitsPerSec = Math.max(0, -this.lastAirVerticalSpeed) / METRES_PER_UNIT;
      this.penalty += profile.landPerUnitSpeed * fallUnitsPerSec;
    }
    const floor = this.floor(profile);
    if (floor > this.penalty) {
      this.penalty = floor;
      return;
    }
    const recovery = motion.grounded ? profile.recoveryTimeSec : profile.airRecoveryTimeSec;
    const keep = Math.exp((-Math.max(0, dtSec) * Math.LN10) / Math.max(1e-3, recovery));
    this.penalty = floor + (this.penalty - floor) * keep;
  }

  /** a shot was fired: the next one is worse until it recovers */
  onShot(): void {
    const profile = this.profile();
    if (profile) this.penalty += profile.fire;
  }

  /**
   * Current cone radius (spread + inaccuracy), radians. This is what a
   * crosshair should open to; 0 for the knife.
   */
  getInaccuracyRadians(): number {
    const profile = this.profile();
    return profile ? profile.spread + this.currentInaccuracy(profile) : 0;
  }

  /** offset for the next shot, drawn the way cs draws it */
  sampleSpread(): SpreadOffset {
    const profile = this.profile();
    if (!profile) return { x: 0, y: 0 };
    const inaccuracy = this.currentInaccuracy(profile);
    const theta0 = this.random() * Math.PI * 2;
    const radius0 = this.random() * inaccuracy;
    const theta1 = this.random() * Math.PI * 2;
    const radius1 = this.random() * profile.spread;
    return {
      x: radius0 * Math.cos(theta0) + radius1 * Math.cos(theta1),
      y: radius0 * Math.sin(theta0) + radius1 * Math.sin(theta1),
    };
  }

  /** fresh life: floor accuracy, no pending landing */
  reset(): void {
    this.scoped = false;
    this.motion = { ...STILL };
    this.wasGrounded = true;
    this.lastAirVerticalSpeed = 0;
    const profile = this.profile();
    this.penalty = profile ? this.floor(profile) : 0;
  }

  private currentInaccuracy(profile: InaccuracyProfile): number {
    let value = this.penalty;
    const motion = this.motion;
    const maxSpeed = Math.max(1e-6, motion.maxSpeed);
    const moveRamp = clamp01(
      (motion.horizontalSpeed - maxSpeed * MOVE_INACCURACY_START)
      / (maxSpeed * (MOVE_INACCURACY_FULL - MOVE_INACCURACY_START)),
    );
    if (moveRamp > 0) {
      value += moveRamp ** MOVE_INACCURACY_EXPONENT * profile.move;
    }
    if (!motion.grounded) {
      // sqrt makes it snap accurate near the apex; never worse than 2x take-off
      const sqrtTakeOff = Math.sqrt(Math.max(1e-6, motion.jumpImpulse));
      const sqrtVertical = Math.sqrt(Math.abs(motion.verticalSpeed));
      const air = ((sqrtVertical - sqrtTakeOff * 0.25) / (sqrtTakeOff * 0.75)) * profile.jumpInitial;
      value += Math.min(2 * profile.jumpInitial, Math.max(0, air));
    }
    return value;
  }

  private floor(profile: InaccuracyProfile): number {
    return this.motion.grounded ? profile.stand : profile.stand + profile.jump;
  }

  private profile(): InaccuracyProfile | null {
    if (this.weapon === 'deagle') return INACCURACY_PROFILES.deagle;
    if (this.weapon === 'awp') {
      return this.scoped ? INACCURACY_PROFILES.awpScoped : INACCURACY_PROFILES.awp;
    }
    return null;
  }
}

/**
 * Aim direction for camera yaw/pitch (forward = (-sin yaw cos pitch,
 * sin pitch, -cos yaw cos pitch)) with a tangent-plane offset, the way cs
 * builds a bullet direction: forward + x * right + y * up, normalized.
 */
export function aimDirection(
  yawRad: number,
  pitchRad: number,
  offset: SpreadOffset = { x: 0, y: 0 },
  out = new Vector3(),
): Vector3 {
  const sinYaw = Math.sin(yawRad);
  const cosYaw = Math.cos(yawRad);
  const sinPitch = Math.sin(pitchRad);
  const cosPitch = Math.cos(pitchRad);
  out.set(
    -sinYaw * cosPitch + offset.x * cosYaw + offset.y * sinYaw * sinPitch,
    sinPitch + offset.y * cosPitch,
    -cosYaw * cosPitch - offset.x * sinYaw + offset.y * cosYaw * sinPitch,
  );
  return out.normalize();
}

/** small seeded generator (mulberry32) for deterministic spread in tests and replays */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
