import { Vector3 } from 'three';
import type { CollisionAdapter } from '../world/CollisionWorld';
import { MovementController } from '../movement/MovementController';
import type { MovementMode } from '../movement/types';

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
  /** Current movement mode from the physics core. Defaults to 'ground'. */
  mode?: MovementMode;
  /** Auto-surf hint from the physics core (which strafe key maintains surf). */
  recommendedStrafe?: 'A' | 'D' | 'NONE';
  /** Horizontal velocity components, used to air-strafe along the ramp. */
  velX?: number;
  velZ?: number;
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
  /**
   * Trigger discipline: a bot fires in short bursts, then holds fire. Together
   * with the wander + reaction delay this keeps bots from being a continuous
   * hitscan stream that melts you the instant you're in view.
   */
  burstDurationSec: number;
  /** How long the bot holds fire between bursts. */
  burstCooldownSec: number;
}

export const DEFAULT_BOT_PARAMS: BotParams = {
  // Deliberately dumbed-down so bots are fun, not an aimbot:
  turnRateRadPerSec: 1.5, // slower tracking — can't snap onto you
  stopDistance: 6,
  stuckSpeed: 0.6,
  engageRange: 600, // only a threat at closer range (was 1500)
  fireAngleTol: 0.05, // ~3 degrees
  reactionDelaySec: 1.6, // slower to open fire (was 0.9)
  aimWanderRad: 0.16, // ~9 degrees of wander — misses a lot (was 3.5)
  burstDurationSec: 0.5, // fire for ~half a second…
  burstCooldownSec: 1.2, // …then hold fire, giving you room to fight back
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

  // Aim error toward the true target — drives the fire decision regardless of
  // how the bot is steering (so it never fires while surfing away from you).
  let yawErr = 0;
  let pitchErr = 0;
  if (horizDist > 1e-3) {
    const desiredYaw = Math.atan2(-ax, -az);
    const desiredPitch = Math.atan2(ay, horizDist);
    yawErr = wrapAngle(desiredYaw - state.yawRad);
    pitchErr = desiredPitch - state.pitchRad;
  }

  const fire =
    dist3D <= params.engageRange
    && Math.abs(yawErr) <= params.fireAngleTol
    && Math.abs(pitchErr) <= params.fireAngleTol;

  const mode = state.mode ?? 'ground';

  let forwardMove = 0;
  let sideMove = 0;
  let yawDelta = 0;
  let pitchDelta = 0;
  let jump = false;

  if (mode === 'surf') {
    // --- On a ramp: actually surf. Real surfers hold one strafe key and keep
    // the view swinging along their velocity, which air-accelerates them along
    // the ramp. We follow the physics core's own auto-surf hint for the strafe
    // key, steer the view along velocity, and bias slightly toward the target so
    // the bot rides the ramp down the map with you.
    const velX = state.velX ?? 0;
    const velZ = state.velZ ?? 0;
    const speed = Math.hypot(velX, velZ);
    const velYaw = speed > 0.5 ? Math.atan2(-velX, -velZ) : state.yawRad;
    const targetYaw = Math.atan2(-ax, -az);
    const towardTarget = wrapAngle(targetYaw - velYaw);
    const desiredYaw = velYaw + Math.max(-0.5, Math.min(0.5, towardTarget)) * 0.3;
    yawDelta = Math.max(-maxTurn, Math.min(maxTurn, wrapAngle(desiredYaw - state.yawRad)));
    pitchDelta = Math.max(-maxTurn, Math.min(maxTurn, -state.pitchRad)); // ease pitch to level

    if (state.recommendedStrafe === 'A') {
      sideMove = -1;
    } else if (state.recommendedStrafe === 'D') {
      sideMove = 1;
    } else {
      const rightX = Math.cos(velYaw);
      const rightZ = -Math.sin(velYaw);
      sideMove = ax * rightX + az * rightZ >= 0 ? 1 : -1;
    }
  } else if (mode === 'air') {
    // --- Free air (between ramps / dropping in): DON'T circle-strafe for speed
    // — that just flings the bot off the map. Face the target and drift toward
    // it with capped air control (only when roughly facing it, so it doesn't
    // sail the wrong way while turning around), like a player dropping in.
    const facing = Math.abs(yawErr) < Math.PI / 2;
    forwardMove = facing ? 1 : 0;
    yawDelta = Math.max(-maxTurn, Math.min(maxTurn, yawErr));
    pitchDelta = Math.max(-maxTurn, Math.min(maxTurn, -state.pitchRad));
  } else {
    // --- Grounded: seek the target and aim at it.
    const facing = Math.abs(yawErr) < Math.PI / 2;
    forwardMove = horizDist > params.stopDistance && facing ? 1 : 0;
    yawDelta = Math.max(-maxTurn, Math.min(maxTurn, yawErr));
    pitchDelta = Math.max(-maxTurn, Math.min(maxTurn, pitchErr));
    jump = state.grounded && forwardMove > 0 && state.horizontalSpeed < params.stuckSpeed;
  }

  return { forwardMove, sideMove, jump, yawDelta, pitchDelta, fire };
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
  /** Trigger discipline: seconds spent in the current burst, and cooldown left. */
  private burstActiveSec = 0;
  private burstCooldownSec = 0;
  /** How long the bot has been plummeting (airborne, little horizontal speed). */
  private fallingSec = 0;

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
    this.burstActiveSec = 0;
    this.burstCooldownSec = 0;
    this.fallingSec = 0;
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

  /**
   * True when the bot has been in free-fall ('air' mode — neither grounded nor
   * surfing a ramp) long enough that it has clearly dropped off the map rather
   * than surfing down it. A genuine surf descent stays in 'surf' mode, so it
   * never trips this; only a bot that sailed off into the void does.
   */
  hasFallenOff(): boolean {
    return this.fallingSec >= BotController.FALL_TIMEOUT_SEC;
  }

  private static readonly FALL_TIMEOUT_SEC = 3;

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
        mode: debug.movementMode,
        recommendedStrafe: debug.recommendedStrafe,
        velX: debug.velocity.x,
        velZ: debug.velocity.z,
      },
      aimPerception,
      this.params,
      dt,
    );

    // Track sustained free-fall: continuous time in 'air' (neither grounded nor
    // surfing a ramp) means the bot has dropped off the map rather than surfing
    // it — a real surf descent stays in 'surf' mode (or only brief air hops
    // between ramps). Reset the timer whenever it touches ground or a ramp.
    const inAir = debug.movementMode === 'air';
    this.fallingSec = inAir ? this.fallingSec + dt : 0;

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

    // Trigger discipline: fire in short bursts with a cooldown in between, so
    // bots don't lay down a continuous hitscan stream. The cooldown ticks down
    // whether or not the bot wants to fire; a burst only accrues while firing.
    if (this.burstCooldownSec > 0) {
      this.burstCooldownSec = Math.max(0, this.burstCooldownSec - dt);
      this.wantsFire = false;
      this.burstActiveSec = 0;
    } else if (this.wantsFire) {
      this.burstActiveSec += dt;
      if (this.burstActiveSec >= this.params.burstDurationSec) {
        // End the burst and start the cooldown.
        this.burstCooldownSec = this.params.burstCooldownSec;
        this.burstActiveSec = 0;
      }
    } else {
      this.burstActiveSec = Math.max(0, this.burstActiveSec - dt);
    }
  }
}
