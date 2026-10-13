import type { Vector3 } from 'three';
import type { AttackKind } from '../network/types';
import { sampleKeys, type Key } from '../viewmodel/clips';
import { createSpring, dampingFromHalflife, ScalarInertializer, smoothstep, springStep } from '../viewmodel/motion';

/**
 * third person body motion on top of the knife stance: a gait that follows the
 * real ground speed and direction, leans, the chest and head following the aim
 * pitch, a tuck in the air and a dip on landing, and knife attacks with a wind
 * up, a cut and a follow through. pure numbers, frame rate independent;
 * playerRig.applyBodyMotion puts them on the bones.
 */

export interface LegMotion {
  /** thigh swing, radians, negative forward (playerRig's swingBone) */
  swing: number;
  /** thigh swing out to the side, radians, + toward the model's left */
  side: number;
  /** knee bend, radians, positive bends */
  knee: number;
}

export interface BodyMotion {
  /** 0 standing .. 1 at a run on the ground, how much the stride shows */
  move: number;
  /** how much of the stance's own footwork still shows (1 standing, 0 striding or in the air) */
  footwork: number;
  legs: { left: LegMotion; right: LegMotion };
  /** hips turned with the stride about the model's up, radians */
  hipTwist: number;
  /** forward lean (+ forward) and side lean (+ to the model's right), radians */
  lean: number;
  sideLean: number;
  /** where the eyes look, radians (+ up) */
  aimPitch: number;
  /** the free arm's swing against the legs, radians (+ forward) */
  armSwing: number;
  /** the knife arm's attack: local euler offsets on the upper arm, forearm and hand, and the chest turning into it */
  attack: { upper: [number, number, number]; lower: [number, number, number]; hand: [number, number, number]; twist: number };
}

// run speed (6.35 m/s) gives about three steps a second, a walk a little under two
const STRIDE_HZ_MIN = 0.7;
const STRIDE_HZ_PER_MS = 0.13;
const STRIDE_HZ_MAX = 1.55;
const strideHz = (speed: number): number => Math.min(STRIDE_HZ_MAX, STRIDE_HZ_MIN + STRIDE_HZ_PER_MS * speed);
const PITCH_LIMIT = (60 * Math.PI) / 180;
const LAND_HALFLIFE = 0.11;

// a cut: a short pull back, fast across the body, a little past, then back
const SLASH: readonly Key[] = [[0, 0], [0.07, -0.3, 'inOut'], [0.16, 1, 'in'], [0.22, 1.08, 'out'], [0.44, 0, 'inOut']];
// a stab: drawn back further, driven in, held a moment, recovered
const THRUST: readonly Key[] = [[0, 0], [0.16, -0.45, 'inOut'], [0.28, 1, 'in'], [0.36, 1], [0.62, 0, 'inOut']];
const ATTACK_S: Readonly<Record<AttackKind, number>> = { primary: 0.44, secondary: 0.62 };
// how far each part goes at full swing (the knife arm's old swing), and when:
// the chest leads and the hand trails, so the cut whips through
const MIX = {
  upper: [-0.34, 0.2, 0.06],
  lower: [-0.42, 0.16, 0],
  hand: [0.12, -0.16, 0.24],
  twist: 0.22,
} as const;
const LAG = { twist: -0.02, upper: 0, lower: 0.015, hand: 0.03 } as const;
const ATTACK_HALFLIFE = 0.05;
// channels: upper xyz, lower xyz, hand xyz, chest twist
const CHANNELS = 10;

export class BodyMotionState {
  public readonly out: BodyMotion = {
    move: 0,
    footwork: 1,
    legs: { left: { swing: 0, side: 0, knee: 0 }, right: { swing: 0, side: 0, knee: 0 } },
    hipTwist: 0,
    lean: 0,
    sideLean: 0,
    aimPitch: 0,
    armSwing: 0,
    attack: { upper: [0, 0, 0], lower: [0, 0, 0], hand: [0, 0, 0], twist: 0 },
  };

  private phase: number;
  private readonly speed = createSpring();
  /** which way it moves in the model's frame (forward and left fractions), smoothed */
  private readonly heading = createSpring(1);
  private readonly lateral = createSpring();
  private readonly lean = createSpring();
  private readonly side = createSpring();
  private readonly air = createSpring();
  private readonly land = createSpring();
  private readonly pitch = createSpring();
  private prevVy = 0;
  private airborne = false;

  private attackKind: AttackKind | null = null;
  private attackTime = 0;
  /** primaries alternate forehand and backhand */
  private slashSide = -1;
  private readonly attackBlend = Array.from({ length: CHANNELS }, () => new ScalarInertializer());
  private readonly attackValue = new Array<number>(CHANNELS).fill(0);
  private readonly attackVelocity = new Array<number>(CHANNELS).fill(0);

  constructor(phase = 0) {
    this.phase = phase;
  }

  /** a new attack starts from wherever the arm is and however it is moving */
  public triggerAttack(kind: AttackKind): void {
    this.attackKind = kind;
    this.attackTime = 0;
    if (kind === 'primary') this.slashSide = -this.slashSide;
    for (let i = 0; i < CHANNELS; i += 1) {
      const target = this.attackChannel(i, 0);
      const targetVelocity = (this.attackChannel(i, 1 / 240) - target) * 240;
      this.attackBlend[i].begin(this.attackValue[i], this.attackVelocity[i], target, targetVelocity);
    }
  }

  /**
   * one frame. `velocity` world space m/s, `yaw` the player's view yaw (0 looks
   * down -z), `pitch` + up. `grounded` when known, else guessed from the
   * vertical speed
   */
  public step(dt: number, velocity: Vector3, yaw: number, pitch: number, grounded?: boolean): BodyMotion {
    const out = this.out;
    const step = Math.max(0, dt);
    // the model faces +z with its left side at +x; the player looks along (-sin yaw, -cos yaw)
    const forward = -velocity.x * Math.sin(yaw) - velocity.z * Math.cos(yaw);
    const left = -velocity.x * Math.cos(yaw) + velocity.z * Math.sin(yaw);
    const speed = Math.hypot(velocity.x, velocity.z);
    const hzBefore = strideHz(Math.max(0, this.speed.x));
    springStep(this.speed, speed, 0.1, step);
    springStep(this.heading, speed > 0.2 ? forward / speed : 1, 0.12, step);
    springStep(this.lateral, speed > 0.2 ? left / speed : 0, 0.12, step);
    const s = Math.max(0, this.speed.x);

    const inAir = grounded === undefined ? Math.abs(velocity.y) > 1.2 : !grounded;
    if (this.airborne && !inAir && this.prevVy < -4) {
      const impact = Math.min(1, -this.prevVy / 12);
      this.land.v += impact * (dampingFromHalflife(LAND_HALFLIFE) / 2) * Math.E;
    }
    this.airborne = inAir;
    this.prevVy = velocity.y;
    springStep(this.air, inAir ? 1 : 0, 0.08, step);
    springStep(this.land, 0, LAND_HALFLIFE, step);
    const air = Math.min(1, Math.max(0, this.air.x));
    const land = Math.max(0, this.land.x);

    // the stride: faster and longer with speed, only with feet on the ground
    const gait = smoothstep(0.15, 1.2, s) * (1 - air);
    out.move = Math.min(1, s / 6.35) * (1 - air);
    out.footwork = 1 - Math.max(gait, air);
    // trapezoid, so the stride lands in step whatever the frame rate
    this.phase = (this.phase + step * Math.PI * (hzBefore + strideHz(s))) % (2 * Math.PI * 64);
    const amplitude = Math.min(0.55, 0.1 + 0.075 * s) * gait;
    const kneeLift = Math.min(1, 0.12 + 0.13 * s) * gait;
    // walking backwards swings the other way, strafing steps across
    const h = this.heading.x;
    const direction = h * 0.65 + 0.35 * Math.tanh(h * 4);
    const across = 0.5 * amplitude * Math.max(-1, Math.min(1, this.lateral.x));
    for (const [leg, offset] of [[out.legs.left, 0], [out.legs.right, Math.PI]] as const) {
      const phi = this.phase + offset;
      leg.swing = -amplitude * direction * Math.sin(phi) - 0.35 * air;
      leg.side = across * Math.sin(phi);
      leg.knee = kneeLift * Math.max(0, Math.cos(phi)) ** 1.5 + 0.08 * gait + 0.75 * air + 0.3 * land;
    }
    out.hipTwist = 0.12 * (amplitude / 0.55) * direction * Math.sin(this.phase);
    out.armSwing = 0.45 * out.legs.left.swing * (1 - air) + 0.2 * air;

    springStep(this.lean, Math.max(-0.06, Math.min(0.1, (0.1 * forward) / 6.35)) * (1 - air), 0.15, step);
    springStep(this.side, Math.max(-0.08, Math.min(0.08, (-0.08 * left) / 6.35)) * (1 - air), 0.15, step);
    out.lean = this.lean.x + 0.12 * land;
    out.sideLean = this.side.x;
    springStep(this.pitch, Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch)), 0.06, step);
    out.aimPitch = this.pitch.x;

    this.stepAttack(step);
    return out;
  }

  private stepAttack(dt: number): void {
    if (this.attackKind) {
      this.attackTime += dt;
      if (this.attackTime >= ATTACK_S[this.attackKind] + Math.max(...Object.values(LAG))) this.attackKind = null;
    }
    const a = this.out.attack;
    for (let i = 0; i < CHANNELS; i += 1) {
      this.attackBlend[i].update(ATTACK_HALFLIFE, dt);
      const value = this.attackChannel(i, this.attackTime) + this.attackBlend[i].offset();
      if (dt > 0) this.attackVelocity[i] = (value - this.attackValue[i]) / dt;
      this.attackValue[i] = value;
    }
    for (let k = 0; k < 3; k += 1) {
      a.upper[k] = this.attackValue[k];
      a.lower[k] = this.attackValue[3 + k];
      a.hand[k] = this.attackValue[6 + k];
    }
    a.twist = this.attackValue[9];
  }

  /** what the current attack asks of a channel at `t` (0 with no attack) */
  private attackChannel(i: number, t: number): number {
    const kind = this.attackKind;
    if (!kind) return 0;
    const curve = kind === 'primary' ? SLASH : THRUST;
    // the stab mirrors the cut's arm, like the old swing
    const side = kind === 'primary' ? this.slashSide : -1;
    if (i === 9) return sampleKeys(curve, t - LAG.twist) * MIX.twist * side;
    const part = i < 3 ? 'upper' : i < 6 ? 'lower' : 'hand';
    const axis = i % 3;
    const mix = MIX[part][axis];
    // the sideways parts of the swing follow the side it cuts to
    const sided = (part === 'hand' && axis === 2) || (part !== 'hand' && axis === 1);
    return sampleKeys(curve, t - LAG[part]) * mix * (sided ? side : 1);
  }
}
