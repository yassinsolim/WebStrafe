import { Vector3 } from 'three';

/** A deliberately narrower visual cone than the player's desktop camera. */
export const BOT_VISION_HALF_FOV_RAD = (55 * Math.PI) / 180;
/** Keeps natural one-bot shots inside the desktop player's view. */
export const BOT_ENCOUNTER_HALF_FOV_RAD = (48 * Math.PI) / 180;

export interface BotPerception {
  /** Stable identity is required so changing targets restarts reaction state. */
  targetId?: string | null;
  /** Visible position or the last position actually seen; never a hidden live position. */
  targetFeet: Vector3 | null;
  /** True only when both the visual cone and map line of sight accept the target. */
  targetVisible?: boolean;
}

export interface BotTargetCandidate {
  id: string;
  feet: Vector3;
  alive: boolean;
  /** Current camera orientation, when supplied by an authoritative transport. */
  viewYawRad?: number;
  viewPitchRad?: number;
}

export interface BotObservation {
  observer: Vector3;
  yawRad: number;
  candidates: readonly BotTargetCandidate[];
  hasLineOfSight(targetFeet: Vector3, candidate: BotTargetCandidate): boolean;
  /**
   * Optional encounter gate for a newly selected target. Existing targets keep
   * using the bot's own FOV + LOS, so looking away cannot make an engaged bot
   * inert.
   */
  canAcquire?(candidate: BotTargetCandidate): boolean;
}

/** Normalizes an angle to (-π, π]. */
export function wrapBotAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** Horizontal visual-cone check shared by acquisition and reaction timing. */
export function isWithinBotVisualFov(
  observer: Vector3,
  yawRad: number,
  targetFeet: Vector3,
): boolean {
  const dx = targetFeet.x - observer.x;
  const dz = targetFeet.z - observer.z;
  if (Math.hypot(dx, dz) < 1e-5) return true;
  const targetYaw = Math.atan2(-dx, -dz);
  return Math.abs(wrapBotAngle(targetYaw - yawRad)) <= BOT_VISION_HALF_FOV_RAD;
}

/**
 * True when a bot's upper body is inside the target player's view cone.
 * Orientation is optional so non-network callers retain the old behavior.
 */
export function isBotWithinTargetView(
  candidate: BotTargetCandidate,
  botFeet: Vector3,
): boolean {
  if (
    !Number.isFinite(candidate.viewYawRad)
    || !Number.isFinite(candidate.viewPitchRad)
  ) {
    return true;
  }

  const targetEye = candidate.feet.clone().add(new Vector3(0, 1.75, 0));
  const botChest = botFeet.clone().add(new Vector3(0, 1.2, 0));
  const towardBot = botChest.sub(targetEye);
  if (towardBot.lengthSq() < 1e-8) return true;
  towardBot.normalize();

  const yaw = candidate.viewYawRad as number;
  const pitch = candidate.viewPitchRad as number;
  const cosPitch = Math.cos(pitch);
  const viewForward = new Vector3(
    -Math.sin(yaw) * cosPitch,
    Math.sin(pitch),
    -Math.cos(yaw) * cosPitch,
  );
  return viewForward.dot(towardBot) >= Math.cos(BOT_ENCOUNTER_HALF_FOV_RAD);
}

/**
 * Stateful visual memory for one bot. Exact target coordinates are copied only
 * after a FOV + LOS observation. While hidden, decisions receive the last seen
 * position rather than the candidate's continuously changing true position.
 */
export class BotTargetMemory {
  private targetId: string | null = null;
  private readonly lastSeenFeet = new Vector3();
  private hasLastSeen = false;

  public observe(observation: BotObservation): BotPerception {
    const visible: Array<{ candidate: BotTargetCandidate; distanceSq: number }> = [];
    let currentAlive = false;

    for (const candidate of observation.candidates) {
      if (!candidate.alive) continue;
      if (candidate.id === this.targetId) currentAlive = true;
      const alreadyTracked = candidate.id === this.targetId;
      if (
        !isWithinBotVisualFov(observation.observer, observation.yawRad, candidate.feet)
        || !observation.hasLineOfSight(candidate.feet, candidate)
        || (!alreadyTracked && observation.canAcquire?.(candidate) === false)
      ) {
        continue;
      }
      visible.push({
        candidate,
        distanceSq: candidate.feet.distanceToSquared(observation.observer),
      });
    }

    visible.sort((a, b) => a.distanceSq - b.distanceSq);
    const current = visible.find(({ candidate }) => candidate.id === this.targetId);
    // Retain a visible target unless another is materially closer. This avoids
    // identity jitter while still permitting a natural, testable target switch.
    const selected =
      current && (!visible[0] || visible[0].distanceSq >= current.distanceSq * 0.7)
        ? current
        : visible[0];

    if (selected) {
      this.targetId = selected.candidate.id;
      this.lastSeenFeet.copy(selected.candidate.feet);
      this.hasLastSeen = true;
      return {
        targetId: this.targetId,
        targetFeet: this.lastSeenFeet.clone(),
        targetVisible: true,
      };
    }

    if (this.targetId && currentAlive && this.hasLastSeen) {
      return {
        targetId: this.targetId,
        targetFeet: this.lastSeenFeet.clone(),
        targetVisible: false,
      };
    }

    this.clear();
    return { targetId: null, targetFeet: null, targetVisible: false };
  }

  public clear(): void {
    this.targetId = null;
    this.hasLastSeen = false;
    this.lastSeenFeet.set(0, 0, 0);
  }
}
