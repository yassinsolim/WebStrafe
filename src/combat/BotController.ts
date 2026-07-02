import { Vector3 } from 'three';
import type { CollisionAdapter } from '../world/CollisionWorld';
import { MovementController } from '../movement/MovementController';

/** applyLookDelta maps deltaX to a yaw change of `-deltaX * 0.0022 * sensitivity`. */
const LOOK_YAW_SCALE = 0.0022;
/** Eye height above feet (matches MovementController.eyeHeight). */
const EYE_HEIGHT = 1.6;
/** Aim at roughly the target's upper body. */
const AIM_HEIGHT = 1.2;

export interface BotPerception {
  /** Feet position of the target to pursue/shoot, or null when there is nothing to chase. */
  targetFeet: Vector3 | null;
}

export interface BotMovementState {
  feet: Vector3;
  yawRad: number;
  pitchRad: number;
  horizontalSpeed: number;
  grounded: boolean;
}

export interface BotDecision {
  forwardMove: number;
  sideMove: number;
  jump: boolean;
  /** Yaw change to apply this tick, in radians (already clamped by turn rate). */
  yawDelta: number;
  /** Pitch change to apply this tick, in radians (already clamped by turn rate). */
  pitchDelta: number;
  /** True when aimed at the target, within range, and clear to shoot. */
  fire: boolean;
}

export interface BotParams {
  /** Max turn speed (rad/s) when facing a target. */
  turnRateRadPerSec: number;
  /** Stop advancing once within this horizontal distance of the target. */
  stopDistance: number;
  /** Below this horizontal speed while grounded, hop to unstick. */
  stuckSpeed: number;
  /** Only shoot when the target is within this 3D distance. */
  engageRange: number;
  /** Only shoot when yaw and pitch aim error are both under this (radians). */
  fireAngleTol: number;
  /**
   * Human-like reaction time: a bot must have kept its target in engage range
   * for at least this long before it is allowed to fire. Prevents the
   * spawn-camping instakill where a freshly spawned bot lands a shot on the
   * very first frame it sees you.
   */
  reactionDelaySec: number;
  /**
   * Angular aim inaccuracy (radians). The bot aims at a point that wanders
   * around the true target within roughly this cone, so it is not a
   * pixel-perfect aimbot: it drifts, over/under-shoots, and misses like a human.
   * The wander is smoothed over time and scales with distance.
   */
  aimWanderRad: number;
}

export const DEFAULT_BOT_PARAMS: BotParams = {
  turnRateRadPerSec: 2.4,
  stopDistance: 6,
  stuckSpeed: 0.6,
  engageRange: 1500,
  fireAngleTol: 0.05, // ~3 degrees
  reactionDelaySec: 0.9,
  aimWanderRad: 0.06, // ~3.5 degrees of wander
};

/** Normalizes an angle to (-π, π]. */
function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** Approximate standard-normal sample (Box–Muller) for bot aim wander. */
function gaussian(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Pure bot AI: given the bot's movement state and what it perceives, decide the
 * movement input, how far to turn (yaw + pitch) this tick, and whether to fire.
 * No physics, no MovementController — fully deterministic and unit-testable.
 */
export function decideBotInput(
  state: BotMovementState,
  perception: BotPerception,
  params: BotParams,
  dt: number,
): BotDecision {
  const maxTurn = params.turnRateRadPerSec * dt;

  if (!perception.targetFeet) {
    const jump = state.grounded && state.horizontalSpeed < params.stuckSpeed;
    return { forwardMove: 0, sideMove: 0, jump, yawDelta: 0, pitchDelta: 0, fire: false };
  }

  // Aim from the bot's eye at the target's upper body.
  const eyeY = state.feet.y + EYE_HEIGHT;
  const ax = perception.targetFeet.x - state.feet.x;
  const ay = perception.targetFeet.y + AIM_HEIGHT - eyeY;
  const az = perception.targetFeet.z - state.feet.z;
  const horizDist = Math.hypot(ax, az);
  const dist3D = Math.hypot(ax, ay, az);

  let yawDelta = 0;
  let pitchDelta = 0;
  let yawErr = 0;
  let pitchErr = 0;
  if (horizDist > 1e-3) {
    // forward = (-sin(yaw)cos(pitch), sin(pitch), -cos(yaw)cos(pitch)).
    const desiredYaw = Math.atan2(-ax, -az);
    const desiredPitch = Math.atan2(ay, horizDist);
    yawErr = wrapAngle(desiredYaw - state.yawRad);
    pitchErr = desiredPitch - state.pitchRad;
    yawDelta = Math.max(-maxTurn, Math.min(maxTurn, yawErr));
    pitchDelta = Math.max(-maxTurn, Math.min(maxTurn, pitchErr));
  }

  const feetDist = Math.hypot(ax, az); // horizontal distance to target feet column
  const facing = Math.abs(yawErr) < Math.PI / 2;
  const forwardMove = feetDist > params.stopDistance && facing ? 1 : 0;
  const jump = state.grounded && forwardMove > 0 && state.horizontalSpeed < params.stuckSpeed;

  const fire =
    dist3D <= params.engageRange
    && Math.abs(yawErr) <= params.fireAngleTol
    && Math.abs(pitchErr) <= params.fireAngleTol;

  return { forwardMove, sideMove: 0, jump, yawDelta, pitchDelta, fire };
}

/**
 * Drives a headless {@link MovementController} with {@link decideBotInput}. Runs
 * server-side against the real map {@link CollisionAdapter}, so bots move on real
 * geometry (and surf ramps under gravity) — they never noclip.
 */
export class BotController {
  private readonly movement = new MovementController();
  private readonly params: BotParams;
  private wantsFire = false;
  private readonly aimTarget = new Vector3();
  private hasAimTarget = false;
  /** How long the current target has been continuously within engage range. */
  private targetSeenSec = 0;
  /** Smoothly-drifting world-space aim offset that makes the bot miss like a human. */
  private readonly aimWander = new Vector3();
  private readonly perturbedTarget = new Vector3();

  constructor(spawn: Vector3, yawDeg = 0, params: BotParams = DEFAULT_BOT_PARAMS) {
    this.params = params;
    this.movement.reset(spawn, yawDeg);
  }

  respawn(spawn: Vector3, yawDeg = 0): void {
    this.movement.reset(spawn, yawDeg);
    this.wantsFire = false;
    this.hasAimTarget = false;
    this.targetSeenSec = 0;
    this.aimWander.set(0, 0, 0);
  }

  getFeet(): Vector3 {
    return this.movement.getFeetPosition();
  }

  getCameraPosition(): Vector3 {
    return this.movement.getCameraPosition();
  }

  getYawRad(): number {
    return this.movement.getYawRad();
  }

  getPitchRad(): number {
    return this.movement.getPitchRad();
  }

  getVelocity(): Vector3 {
    return this.movement.getVelocity();
  }

  getForwardVector(): Vector3 {
    return this.movement.getForwardVector();
  }

  /** True if the last tick decided to shoot (subject to a server LOS check). */
  wantsToFire(): boolean {
    return this.wantsFire;
  }

  /** The world-space point the bot is shooting at (its target's upper body). */
  getAimTarget(): Vector3 | null {
    return this.hasAimTarget ? this.aimTarget.clone() : null;
  }

  /** Advances the bot one fixed step toward (and aiming at) its target. */
  tick(dt: number, world: CollisionAdapter, perception: BotPerception): void {
    const debug = this.movement.getDebugState();
    const horizontalSpeed = Math.hypot(debug.velocity.x, debug.velocity.z);

    // Perturb the aim with a smoothly-drifting offset so the bot is not a
    // pixel-perfect aimbot. The wander is an Ornstein-Uhlenbeck-style random
    // walk (pulled back toward zero) whose amplitude grows with distance, so
    // far targets are genuinely hard for the bot to hit.
    let aimPerception = perception;
    if (perception.targetFeet) {
      const feet = this.movement.getFeetPosition();
      const dist = Math.hypot(
        perception.targetFeet.x - feet.x,
        perception.targetFeet.y - feet.y,
        perception.targetFeet.z - feet.z,
      );
      const amp = Math.tan(this.params.aimWanderRad) * Math.max(dist, 1);
      const pull = Math.exp(-dt * 1.6); // relax toward zero
      this.aimWander.x = this.aimWander.x * pull + gaussian() * amp * (1 - pull);
      this.aimWander.y = this.aimWander.y * pull + gaussian() * amp * 0.5 * (1 - pull);
      this.aimWander.z = this.aimWander.z * pull + gaussian() * amp * (1 - pull);
      this.perturbedTarget.copy(perception.targetFeet).add(this.aimWander);
      aimPerception = { targetFeet: this.perturbedTarget };
    }

    const decision = decideBotInput(
      {
        feet: this.movement.getFeetPosition(),
        yawRad: this.movement.getYawRad(),
        pitchRad: this.movement.getPitchRad(),
        horizontalSpeed,
        grounded: debug.grounded,
      },
      aimPerception,
      this.params,
      dt,
    );

    if (decision.yawDelta !== 0 || decision.pitchDelta !== 0) {
      this.movement.applyLookDelta(
        -decision.yawDelta / LOOK_YAW_SCALE,
        -decision.pitchDelta / LOOK_YAW_SCALE,
        1,
      );
    }
    this.movement.tick(
      dt,
      {
        forwardMove: decision.forwardMove,
        sideMove: decision.sideMove,
        jumpPressed: decision.jump,
        jumpHeld: decision.jump,
      },
      world,
    );

    this.wantsFire = decision.fire;
    if (perception.targetFeet) {
      const tx = perception.targetFeet.x - this.movement.getFeetPosition().x;
      const ty = perception.targetFeet.y + AIM_HEIGHT - (this.movement.getFeetPosition().y + EYE_HEIGHT);
      const tz = perception.targetFeet.z - this.movement.getFeetPosition().z;
      const inRange = Math.hypot(tx, ty, tz) <= this.params.engageRange;
      this.targetSeenSec = inRange ? this.targetSeenSec + dt : 0;
      this.aimTarget.set(
        perception.targetFeet.x,
        perception.targetFeet.y + AIM_HEIGHT,
        perception.targetFeet.z,
      );
      this.hasAimTarget = true;
    } else {
      this.targetSeenSec = 0;
      this.hasAimTarget = false;
    }
    // Hold fire until the target has been in view for the reaction delay, so a
    // just-spawned bot can't headshot you on the first frame.
    if (this.targetSeenSec < this.params.reactionDelaySec) {
      this.wantsFire = false;
    }
  }
}
