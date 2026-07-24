import { Vector3 } from 'three';
import type { CollisionAdapter } from '../world/CollisionWorld';
import { MovementController } from '../movement/MovementController';
import type { MovementMode } from '../movement/types';
import {
  isWithinBotVisualFov,
  wrapBotAngle,
  type BotPerception,
} from './BotPerception';

export type { BotPerception } from './BotPerception';

/** applyLookDelta maps deltaX to a yaw change of `-deltaX * 0.0022 * sensitivity`. */
const LOOK_YAW_SCALE = 0.0022;
/** Eye height above feet (matches MovementController.eyeHeight). */
const EYE_HEIGHT = 1.6;
/** Aim at roughly the target's upper body. */
const AIM_HEIGHT = 1.2;
/** First round lands into nearby cover beside the player before follow-up taps. */
const OPENING_WARNING_MISS_LATERAL = 2.4;
/** Keep the two follow-up rounds in the torso capsule, never the head band. */
const OPENING_BODY_AIM_DROP = 0.35;

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
   * Visible staging time before the bot begins tracking or moving. This is
   * separate from reactionDelaySec: players first get a readable settled target,
   * then see the bot acquire them before it can fire.
   */
  acquisitionGraceSec: number;
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
  /** Minimum settle time between committed Deagle taps. */
  tapIntervalSec: number;
}

export const DEFAULT_BOT_PARAMS: BotParams = {
  // Deliberately dumbed-down so bots are fun, not an aimbot:
  turnRateRadPerSec: 1.2, // slower tracking — cannot snap onto a target
  stopDistance: 13,
  stuckSpeed: 0.6,
  engageRange: 110,
  fireAngleTol: 0.05, // ~3 degrees
  acquisitionGraceSec: 0.85,
  reactionDelaySec: 1.4,
  // Correct OU variance makes this a real ~2.6° standard deviation instead of
  // the former tick-rate-dependent fraction of the configured angle.
  aimWanderRad: 0.045,
  // Two deliberate Deagle taps fit in a burst, separated by enough time for
  // visible recoil recovery. The longer pause between bursts keeps the bot a
  // threat without producing a hitscan damage dump.
  burstDurationSec: 1.05,
  burstCooldownSec: 1.5,
  tapIntervalSec: 0.68,
};

/** Approximate standard-normal sample (Box–Muller) for bot aim wander. */
function gaussian(random: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = random();
  while (v === 0) v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Advances a bounded Ornstein-Uhlenbeck aim offset. The innovation term uses
 * sqrt(1 - decay²), giving the same steady-state variance at 30, 60, or 120 Hz.
 */
export function advanceBotAimWander(
  current: Vector3,
  amplitude: number,
  dt: number,
  random: () => number = Math.random,
): Vector3 {
  const safeDt = Math.max(0, dt);
  const decay = Math.exp(-safeDt * 1.6);
  const innovation = Math.sqrt(Math.max(0, 1 - decay * decay));
  const limit = Math.max(0, amplitude) * 2;
  const next = (value: number, scale: number) => Math.max(
    -limit * scale,
    Math.min(
      limit * scale,
      value * decay + gaussian(random) * amplitude * scale * innovation,
    ),
  );
  current.set(
    next(current.x, 1),
    next(current.y, 0.5),
    next(current.z, 1),
  );
  return current;
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
    yawErr = wrapBotAngle(desiredYaw - state.yawRad);
    pitchErr = desiredPitch - state.pitchRad;
  }

  const fire =
    perception.targetVisible !== false
    && dist3D <= params.engageRange
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
    const towardTarget = wrapBotAngle(targetYaw - velYaw);
    const desiredYaw = velYaw + Math.max(-0.5, Math.min(0.5, towardTarget)) * 0.3;
    yawDelta = Math.max(-maxTurn, Math.min(maxTurn, wrapBotAngle(desiredYaw - state.yawRad)));
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
    // Drop into a clear firing lane instead of air-accelerating through the
    // target. Advance only while searching around occluding geometry.
    forwardMove = perception.targetVisible === true ? 0 : facing ? 1 : 0;
    yawDelta = Math.max(-maxTurn, Math.min(maxTurn, yawErr));
    pitchDelta = Math.max(-maxTurn, Math.min(maxTurn, -state.pitchRad));
  } else {
    // --- Grounded: seek the target and aim at it.
    const facing = Math.abs(yawErr) < Math.PI / 2;
    // A visible target is already a valid engagement: hold the staged lane so
    // remote muzzle/tracer feedback remains readable instead of rushing through
    // the player's camera. Seek only when LOS is blocked or unknown.
    forwardMove = perception.targetVisible === true
      ? 0
      : horizDist > params.stopDistance && facing ? 1 : 0;
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
  /** Initial visible hold before tracking starts; reset on a fresh engagement. */
  private acquisitionSeenSec = 0;
  private engagementReleased = false;
  /** Smoothly-drifting world-space aim offset that makes the bot miss like a human. */
  private readonly aimWander = new Vector3();
  private readonly perturbedTarget = new Vector3();
  /** Accepted rounds in this visible engagement; drives the fair opening cadence. */
  private openingShotsFired = 0;
  /** Trigger discipline: seconds spent in the current burst, and cooldown left. */
  private burstActiveSec = 0;
  private burstCooldownSec = 0;
  /** Recoil-settle delay after the arena accepts a Deagle tap. */
  private tapCooldownSec = 0;
  /** How long the bot has been plummeting (airborne, little horizontal speed). */
  private fallingSec = 0;
  /** Stable target identity used to reset reaction and trigger state on switches. */
  private targetId: string | null = null;

  constructor(
    spawn: Vector3,
    yawDeg = 0,
    params: BotParams = DEFAULT_BOT_PARAMS,
    private readonly random: () => number = Math.random,
  ) {
    this.params = params;
    this.movement.reset(spawn, yawDeg);
  }

  respawn(spawn: Vector3, yawDeg = 0): void {
    this.movement.reset(spawn, yawDeg);
    this.resetEngagement();
    this.fallingSec = 0;
  }

  /** Drops all target/reaction/trigger state without disturbing movement. */
  resetEngagement(): void {
    this.wantsFire = false;
    this.hasAimTarget = false;
    this.targetSeenSec = 0;
    this.acquisitionSeenSec = 0;
    this.engagementReleased = false;
    this.openingShotsFired = 0;
    this.aimWander.set(0, 0, 0);
    this.burstActiveSec = 0;
    this.burstCooldownSec = 0;
    this.tapCooldownSec = 0;
    this.targetId = null;
  }

  /** Starts a human-readable recoil-settle delay after an accepted shot. */
  onShotFired(): void {
    this.openingShotsFired += 1;
    this.tapCooldownSec = this.params.tapIntervalSec;
    this.wantsFire = false;
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

  /** Exposes the player-visible first-engagement phase for deterministic parity tests. */
  getEngagementPhase(): 'holding' | 'reacting' | 'engaged' {
    if (!this.engagementReleased) {
      return 'holding';
    }
    return this.targetSeenSec < this.params.reactionDelaySec ? 'reacting' : 'engaged';
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

  private static readonly FALL_TIMEOUT_SEC = 5;

  /** Advances the bot one fixed step toward (and aiming at) its target. */
  tick(dt: number, world: CollisionAdapter, perception: BotPerception): void {
    this.tapCooldownSec = Math.max(0, this.tapCooldownSec - Math.max(0, dt));
    const nextTargetId = perception.targetFeet
      ? perception.targetId ?? '__anonymous-target__'
      : null;
    if (nextTargetId !== this.targetId) {
      this.targetId = nextTargetId;
      this.targetSeenSec = 0;
      this.acquisitionSeenSec = 0;
      this.engagementReleased = false;
      this.openingShotsFired = 0;
      this.aimWander.set(0, 0, 0);
      this.burstActiveSec = 0;
      this.burstCooldownSec = 0;
      this.tapCooldownSec = 0;
      this.wantsFire = false;
    }

    const debug = this.movement.getDebugState();
    const horizontalSpeed = Math.hypot(debug.velocity.x, debug.velocity.z);
    const safeDt = Math.max(0, dt);

    if (!this.engagementReleased) {
      const feet = this.movement.getFeetPosition();
      const acquisitionVisible = perception.targetFeet !== null
        && perception.targetVisible !== false
        && feet.distanceTo(perception.targetFeet) <= this.params.engageRange
        && isWithinBotVisualFov(feet, this.movement.getYawRad(), perception.targetFeet);
      this.acquisitionSeenSec = acquisitionVisible
        ? this.acquisitionSeenSec + safeDt
        : 0;
      if (this.acquisitionSeenSec < this.params.acquisitionGraceSec) {
        // Keep gravity/collision live while visibly staged; this is a finite
        // neutral settle, not a frozen or inspector-only bot.
        this.wantsFire = false;
        this.hasAimTarget = false;
        this.targetSeenSec = 0;
        this.aimWander.multiplyScalar(Math.exp(-safeDt * 3));
        const inAir = debug.movementMode === 'air';
        this.fallingSec = inAir ? this.fallingSec + safeDt : 0;
        this.movement.tick(
          dt,
          {
            forwardMove: 0,
            sideMove: 0,
            jumpPressed: false,
            jumpHeld: false,
          },
          world,
        );
        return;
      }
      this.engagementReleased = true;
    }

    // Each fresh visible engagement opens with one deliberately lateral
    // warning round. In the practice lane it resolves into the orange cover,
    // then two center-mass taps provide a readable nonfatal/fatal sequence.
    // Later rounds return to smooth imperfect wander. Breaking LOS resets this
    // cadence, so a peek always earns the same fair warning.
    let aimPerception = perception;
    if (perception.targetFeet && perception.targetVisible !== false) {
      this.perturbedTarget.copy(perception.targetFeet);
      if (this.openingShotsFired === 0 && perception.targetVisible === true) {
        const feet = this.movement.getFeetPosition();
        const dx = perception.targetFeet.x - feet.x;
        const dz = perception.targetFeet.z - feet.z;
        const horizontalDistance = Math.hypot(dx, dz);
        if (horizontalDistance > 1e-5) {
          this.perturbedTarget.x -= dz / horizontalDistance * OPENING_WARNING_MISS_LATERAL;
          this.perturbedTarget.z += dx / horizontalDistance * OPENING_WARNING_MISS_LATERAL;
        }
        this.aimWander.multiplyScalar(Math.exp(-Math.max(0, dt) * 5));
      } else if (this.openingShotsFired < 3) {
        this.perturbedTarget.y -= OPENING_BODY_AIM_DROP;
        this.aimWander.multiplyScalar(Math.exp(-Math.max(0, dt) * 5));
      } else {
        const feet = this.movement.getFeetPosition();
        const dist = Math.hypot(
          perception.targetFeet.x - feet.x,
          perception.targetFeet.y - feet.y,
          perception.targetFeet.z - feet.z,
        );
        const amp = Math.tan(this.params.aimWanderRad) * Math.max(dist, 1);
        advanceBotAimWander(this.aimWander, amp, dt, this.random);
        this.perturbedTarget.add(this.aimWander);
      }
      aimPerception = { ...perception, targetFeet: this.perturbedTarget };
    } else {
      // Keep pursuing only the remembered point while hidden. Existing visual
      // error decays; no fresh noise or hidden live coordinates enter decisions.
      this.aimWander.multiplyScalar(Math.exp(-Math.max(0, dt) * 3));
      if (perception.targetVisible === false) {
        this.openingShotsFired = 0;
      }
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
      const visible = perception.targetVisible !== false;
      const inFov = isWithinBotVisualFov(
        this.movement.getFeetPosition(),
        this.movement.getYawRad(),
        perception.targetFeet,
      );
      this.targetSeenSec = inRange && visible && inFov
        ? this.targetSeenSec + dt
        : 0;
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

    // Trigger discipline: a burst is a short window containing deliberate taps,
    // followed by a longer cooldown. The tap cooldown is started only after the
    // authoritative arena accepts a shot via onShotFired().
    if (this.burstCooldownSec > 0) {
      this.burstCooldownSec = Math.max(0, this.burstCooldownSec - dt);
      this.wantsFire = false;
      this.burstActiveSec = 0;
    } else if (this.wantsFire) {
      this.burstActiveSec += dt;
      if (this.burstActiveSec >= this.params.burstDurationSec) {
        this.burstCooldownSec = this.params.burstCooldownSec;
        this.burstActiveSec = 0;
        this.wantsFire = false;
      } else if (this.tapCooldownSec > 0) {
        this.wantsFire = false;
      }
    } else {
      this.burstActiveSec = Math.max(0, this.burstActiveSec - dt);
    }
  }
}
