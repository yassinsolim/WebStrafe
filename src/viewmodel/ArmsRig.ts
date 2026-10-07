import { Mesh, Object3D, Quaternion, SkinnedMesh, Vector3 } from 'three';
import { sharedGltfLoader } from '../assets/gltfLoader';
import { frameFromYZ, signedAngleAbout, solveTwoBone } from './ik';
import type { HandPose } from './handPoses';

export type Side = 'l' | 'r';

export const ARMS_URL = '/viewmodels/v2/arms.glb';

const DIGITS = ['index', 'middle', 'ring', 'pinky', 'thumb'] as const;
type Digit = (typeof DIGITS)[number];

// thumb axes measured on the right hand (docs/assets/arms.md), left mirrors by
// keeping x and negating y and z
const THUMB_AXES_R = [
  new Vector3(0.387, 0, 0.922).normalize(),
  new Vector3(-0.439, 0, 0.898).normalize(),
  new Vector3(0.807, 0, 0.59).normalize(),
];
const THUMB_AXES_L = THUMB_AXES_R.map((axis) => new Vector3(axis.x, -axis.y, -axis.z));
const CURL_AXIS = new Vector3(-1, 0, 0);
const SPREAD_AXIS_R = new Vector3(0, 0, 1);
const SPREAD_AXIS_L = new Vector3(0, 0, -1);
const DEG = Math.PI / 180;

interface ArmBones {
  upperarm: Object3D;
  forearm: Object3D;
  twist: Object3D;
  hand: Object3D;
  digits: Record<Digit, [Object3D, Object3D, Object3D]>;
  digitRest: Record<Digit, [Quaternion, Quaternion, Quaternion]>;
  visible: boolean;
}

const vS = new Vector3();
const vE = new Vector3();
const vW = new Vector3();
const vYu = new Vector3();
const vYf = new Vector3();
const vZu = new Vector3();
const vX = new Vector3();
const vZf = new Vector3();
const vHandZ = new Vector3();
const qU = new Quaternion();
const qF = new Quaternion();
const qT = new Quaternion();
const qParent = new Quaternion();
const qDelta = new Quaternion();
const vTmp = new Vector3();

export type DigitBones = Record<Digit, [Object3D, Object3D, Object3D]>;
export type DigitRest = Record<Digit, [Quaternion, Quaternion, Quaternion]>;
export const DIGIT_NAMES = DIGITS;

/** finger spread in degrees at the first knuckle, + toward the index side */
export type DigitSpread = Partial<Record<'index' | 'middle' | 'ring' | 'pinky', number>>;

/** curls every finger and thumb bone to `pose` on top of its rest rotation */
export function applyDigitPose(digits: DigitBones, rest: DigitRest, side: Side, pose: HandPose, spread?: DigitSpread): void {
  const thumbAxes = side === 'r' ? THUMB_AXES_R : THUMB_AXES_L;
  for (const digit of DIGITS) {
    const bones = digits[digit];
    const restQ = rest[digit];
    const angles = pose[digit];
    for (let i = 0; i < 3; i += 1) {
      const axis = digit === 'thumb' ? thumbAxes[i] : CURL_AXIS;
      qDelta.setFromAxisAngle(axis, angles[i] * DEG);
      bones[i].quaternion.copy(restQ[i]);
      const s = i === 0 && digit !== 'thumb' ? spread?.[digit] : undefined;
      if (s) bones[i].quaternion.multiply(qT.setFromAxisAngle(side === 'r' ? SPREAD_AXIS_R : SPREAD_AXIS_L, s * DEG));
      bones[i].quaternion.multiply(qDelta);
    }
  }
}

/**
 * the one shared first-person arms rig. every weapon and knife drives the same
 * gloves, sleeves and watch through two bone ik on each arm, a forearm twist
 * bone that takes most of the wrist roll, and finger curl poses.
 */
export class ArmsRig {
  public readonly root: Object3D;
  private readonly arms: Record<Side, ArmBones>;
  private readonly watchHands: { hour: Object3D | null; minute: Object3D | null; second: Object3D | null };

  public static async load(url = ARMS_URL): Promise<ArmsRig> {
    const gltf = await sharedGltfLoader().loadAsync(url);
    return new ArmsRig(gltf.scene);
  }

  constructor(scene: Object3D) {
    this.root = scene;
    this.root.name = 'ViewmodelArms';
    scene.traverse((node) => {
      if ((node as SkinnedMesh).isSkinnedMesh || (node as Mesh).isMesh) {
        // bones move far from the bind pose, the bind-time bounds are useless
        node.frustumCulled = false;
      }
    });
    this.arms = { l: this.findArm(scene, 'l'), r: this.findArm(scene, 'r') };
    this.watchHands = {
      hour: scene.getObjectByName('watch_hand_hour') ?? null,
      minute: scene.getObjectByName('watch_hand_minute') ?? null,
      second: scene.getObjectByName('watch_hand_second') ?? null,
    };
  }

  public setArmVisible(side: Side, visible: boolean): void {
    const arm = this.arms[side];
    if (arm.visible === visible) {
      return;
    }
    arm.visible = visible;
    // zero scale on the upper arm collapses every vertex skinned to that chain
    arm.upperarm.scale.setScalar(visible ? 1 : 1e-4);
  }

  public isArmVisible(side: Side): boolean {
    return this.arms[side].visible;
  }

  /**
   * puts the wrist (the `hand` bone head) at `wrist` with the hand bone frame
   * `handRot`, both in world space. the elbow bends toward `pole`. the forearm
   * twist bone takes `twistShare` of the roll between forearm and hand.
   */
  public solveArm(side: Side, wrist: Vector3, handRot: Quaternion, pole: Vector3, twistShare = 0.8): void {
    const arm = this.arms[side];
    arm.upperarm.getWorldPosition(vS);
    arm.forearm.getWorldPosition(vE);
    arm.hand.getWorldPosition(vW);
    const lenA = vS.distanceTo(vE);
    const lenB = vE.distanceTo(vW);
    if (lenA < 1e-6 || lenB < 1e-6) {
      return;
    }
    solveTwoBone(vS, wrist, pole, lenA, lenB, vE, vW);

    vYu.subVectors(vE, vS).normalize();
    vYf.subVectors(vW, vE).normalize();
    // the forearm folds toward the upper arm's -Z (palm side), so +Z points at the elbow tip
    vZu.copy(vYf).addScaledVector(vYu, -vYf.dot(vYu)).negate();
    if (vZu.lengthSq() < 1e-8) {
      vTmp.subVectors(pole, vS);
      vZu.copy(vTmp).addScaledVector(vYu, -vTmp.dot(vYu));
    }
    frameFromYZ(vYu, vZu, qU);
    vX.set(1, 0, 0).applyQuaternion(qU);
    vZf.crossVectors(vX, vYf);
    frameFromYZ(vYf, vZf, qF);

    // roll between the forearm frame and the target hand, measured about the forearm axis
    vHandZ.set(0, 0, 1).applyQuaternion(handRot);
    vZf.set(0, 0, 1).applyQuaternion(qF);
    const roll = signedAngleAbout(vZf, vHandZ, vYf);
    qDelta.setFromAxisAngle(vYf, roll * twistShare);
    qT.copy(qDelta).multiply(qF);

    this.setWorldRotation(arm.upperarm, qU);
    this.setWorldRotation(arm.forearm, qF);
    this.setWorldRotation(arm.twist, qT);
    this.setWorldRotation(arm.hand, handRot);
  }

  public applyHandPose(side: Side, pose: HandPose, spread?: DigitSpread): void {
    const arm = this.arms[side];
    applyDigitPose(arm.digits, arm.digitRest, side, pose, spread);
  }

  /** watch hands show `date` local time; the second hand ticks */
  public updateWatch(date: Date): void {
    const ms = date.getMilliseconds();
    const s = date.getSeconds();
    const m = date.getMinutes() + s / 60;
    const h = (date.getHours() % 12) + m / 60;
    // a quartz tick: the hand snaps over the first 60 ms of each second
    const tick = Math.min(1, ms / 60);
    const clockwise = -2 * Math.PI;
    if (this.watchHands.hour) this.watchHands.hour.rotation.y = clockwise * (h / 12);
    if (this.watchHands.minute) this.watchHands.minute.rotation.y = clockwise * (m / 60);
    if (this.watchHands.second) this.watchHands.second.rotation.y = clockwise * ((s - 1 + tick) / 60);
  }

  public getDigits(side: Side): DigitBones {
    return this.arms[side].digits;
  }

  public getHandBone(side: Side): Object3D {
    return this.arms[side].hand;
  }

  /** the elbow end of the arm (tools) */
  public getForearmBone(side: Side): Object3D {
    return this.arms[side].forearm;
  }

  private setWorldRotation(bone: Object3D, rotation: Quaternion): void {
    const parent = bone.parent;
    if (parent) {
      parent.getWorldQuaternion(qParent);
      bone.quaternion.copy(qParent.invert().multiply(rotation));
    } else {
      bone.quaternion.copy(rotation);
    }
    bone.updateMatrixWorld(true);
  }

  private findArm(scene: Object3D, side: Side): ArmBones {
    const get = (name: string): Object3D => {
      const node = scene.getObjectByName(`${name}_${side}`);
      if (!node) {
        throw new Error(`arms rig is missing ${name}_${side}`);
      }
      return node;
    };
    const digits = {} as ArmBones['digits'];
    const digitRest = {} as ArmBones['digitRest'];
    for (const digit of DIGITS) {
      const bones = [get(`${digit}_01`), get(`${digit}_02`), get(`${digit}_03`)] as [Object3D, Object3D, Object3D];
      digits[digit] = bones;
      digitRest[digit] = bones.map((bone) => bone.quaternion.clone()) as [Quaternion, Quaternion, Quaternion];
    }
    return {
      upperarm: get('upperarm'),
      forearm: get('forearm'),
      twist: get('forearm_twist'),
      hand: get('hand'),
      digits,
      digitRest,
      visible: true,
    };
  }
}
