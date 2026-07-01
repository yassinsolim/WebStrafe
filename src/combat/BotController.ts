import { Vector3 } from 'three';
import type { CollisionAdapter } from '../world/CollisionWorld';
import { MovementController } from '../movement/MovementController';

/** applyLookDelta maps deltaX to a yaw change of `-deltaX * 0.0022 * sensitivity`. */
const LOOK_YAW_SCALE = 0.0022;

export interface BotPerception {
  /** Feet position of the target to pursue, or null when there is nothing to chase. */
  targetFeet: Vector3 | null;
}

export interface BotMovementState {
  feet: Vector3;
  yawRad: number;
  horizontalSpeed: number;
  grounded: boolean;
}

export interface BotDecision {
  forwardMove: number;
  sideMove: number;
  jump: boolean;
  /** Yaw change to apply this tick, in radians (already clamped by turn rate). */
  yawDelta: number;
}

export interface BotParams {
  /** Max turn speed (rad/s) when facing a target. */
  turnRateRadPerSec: number;
  /** Stop advancing once within this horizontal distance of the target. */
  stopDistance: number;
  /** Below this horizontal speed while grounded, hop to unstick. */
  stuckSpeed: number;
}

export const DEFAULT_BOT_PARAMS: BotParams = {
  turnRateRadPerSec: 3.2,
  stopDistance: 6,
  stuckSpeed: 0.6,
};

/** Normalizes an angle to (-π, π]. */
function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/**
 * Pure bot AI: given the bot's movement state and what it perceives, decide the
 * movement input and how far to turn this tick. No physics, no MovementController
 * — fully deterministic and unit-testable.
 */
export function decideBotInput(
  state: BotMovementState,
  perception: BotPerception,
  params: BotParams,
  dt: number,
): BotDecision {
  const maxTurn = params.turnRateRadPerSec * dt;

  if (!perception.targetFeet) {
    // Idle: no target. Hop if wedged so we don't sit stuck forever.
    const jump = state.grounded && state.horizontalSpeed < params.stuckSpeed;
    return { forwardMove: 0, sideMove: 0, jump, yawDelta: 0 };
  }

  const dx = perception.targetFeet.x - state.feet.x;
  const dz = perception.targetFeet.z - state.feet.z;
  const dist = Math.hypot(dx, dz);

  let yawDelta = 0;
  if (dist > 1e-3) {
    // forward = (-sin(yaw), -cos(yaw)); solve for the yaw that points at (dx,dz).
    const desiredYaw = Math.atan2(-dx, -dz);
    yawDelta = Math.max(-maxTurn, Math.min(maxTurn, wrapAngle(desiredYaw - state.yawRad)));
  }

  // Advance while roughly facing the target and not already on top of it.
  const facing = Math.abs(wrapAngle(Math.atan2(-dx, -dz) - state.yawRad));
  const forwardMove = dist > params.stopDistance && facing < Math.PI / 2 ? 1 : 0;

  // Anti-stuck hop when grounded but barely moving despite wanting to advance.
  const jump = state.grounded && forwardMove > 0 && state.horizontalSpeed < params.stuckSpeed;

  return { forwardMove, sideMove: 0, jump, yawDelta };
}

/**
 * Drives a headless {@link MovementController} with {@link decideBotInput}. Runs
 * server-side against the real map {@link CollisionAdapter}, so bots move on real
 * geometry (and surf ramps under gravity) — they never noclip.
 */
export class BotController {
  private readonly movement = new MovementController();
  private readonly params: BotParams;

  constructor(spawn: Vector3, yawDeg = 0, params: BotParams = DEFAULT_BOT_PARAMS) {
    this.params = params;
    this.movement.reset(spawn, yawDeg);
  }

  respawn(spawn: Vector3, yawDeg = 0): void {
    this.movement.reset(spawn, yawDeg);
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

  /** Advances the bot one fixed step toward its target. */
  tick(dt: number, world: CollisionAdapter, perception: BotPerception): void {
    const debug = this.movement.getDebugState();
    const horizontalSpeed = Math.hypot(debug.velocity.x, debug.velocity.z);
    const decision = decideBotInput(
      {
        feet: this.movement.getFeetPosition(),
        yawRad: this.movement.getYawRad(),
        horizontalSpeed,
        grounded: debug.grounded,
      },
      perception,
      this.params,
      dt,
    );

    if (decision.yawDelta !== 0) {
      this.movement.applyLookDelta(-decision.yawDelta / LOOK_YAW_SCALE, 0, 1);
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
  }
}
