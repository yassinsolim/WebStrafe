import {
  Bone,
  Box3,
  CircleGeometry,
  Euler,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getKnife } from '../combat/knives';
import { buildProceduralKnife, KNIFE_NODES } from '../cosmetics/ProceduralKnife';
import { signedAngleAbout } from '../viewmodel/ik';

/**
 * Shared player-model rigging: locating the arm bones, attaching a knife to the
 * right hand, and posing the arms into the combat "knife hold" stance. Used both
 * by the in-game {@link RemotePlayersRenderer} (animated) and the main-menu
 * character preview (static). Both share the same attach + arm stance; the menu
 * additionally closes the fingers and seats the knife a touch deeper in the palm
 * (see {@link applyKnifeIdlePose}), which the in-game renderer never applies.
 */
export interface ArmRig {
  rightUpper: Bone;
  rightLower: Bone;
  rightHand: Bone;
  rightWeaponHand: Bone;
  leftUpper: Bone | null;
  leftLower: Bone | null;
  leftHand: Bone | null;
  rightClavicle: Bone | null;
  leftClavicle: Bone | null;
  /** hips (the skeleton root on the armored characters), for the menu idle's weight shift */
  pelvis: Bone | null;
  spineMid: Bone | null;
  spineUpper: Bone | null;
  neck: Bone | null;
  head: Bone | null;
  /** Right-hand finger joints (index/middle/ring/pinky, joints 0-2) for the menu fist grip. */
  rightFingers: Bone[];
  /** Right-hand thumb joints (0-2) for the menu fist grip. */
  rightThumb: Bone[];
  /** left-hand finger and thumb joints (mpfb hands only) for a relaxed support hand */
  leftFingers: Bone[];
  leftThumb: Bone[];
  /** mpfb finger bones (armored characters): per-finger grip tables instead of the legacy uniform curl */
  mpfbHands: boolean;
  /** thigh, shin and foot per side with their bind rotations, for the stance's footwork */
  legs: Record<'left' | 'right', LegBones | null> | null;

  rightUpperBase: Quaternion;
  rightLowerBase: Quaternion;
  rightHandBase: Quaternion;
  rightWeaponHandBase: Quaternion;
  leftUpperBase: Quaternion | null;
  leftLowerBase: Quaternion | null;
  leftHandBase: Quaternion | null;
  rightClavicleBase: Quaternion | null;
  leftClavicleBase: Quaternion | null;
  pelvisBase: Quaternion | null;
  spineMidBase: Quaternion | null;
  spineUpperBase: Quaternion | null;
  neckBase: Quaternion | null;
  headBase: Quaternion | null;
  rightFingerBases: Quaternion[];
  rightThumbBases: Quaternion[];
  leftFingerBases: Quaternion[];
  leftThumbBases: Quaternion[];
}

export interface LegBones {
  upper: Bone;
  lower: Bone;
  foot: Bone;
  upperBase: Quaternion;
  lowerBase: Quaternion;
  footBase: Quaternion;
}

// mpfb hands, radians about each joint's curl axis (local +z), knuckle to tip.
// right: closed around the knife handle; left: a relaxed support hand.
// rows follow the traversal order: index, middle, ring, pinky.
const DEG = Math.PI / 180;
const MPFB_FIST = [[62, 88, 58], [70, 92, 60], [74, 92, 58], [78, 90, 55]].map((r) => r.map((d) => d * DEG));
const MPFB_FIST_THUMB = [18, 38, 32].map((d) => d * DEG);
const MPFB_RELAXED = [[22, 34, 20], [26, 38, 22], [30, 40, 22], [34, 42, 22]].map((r) => r.map((d) => d * DEG));
const MPFB_RELAXED_THUMB = [6, 14, 10].map((d) => d * DEG);

const THIRD_PERSON_KNIFE = 'bayonet';

/**
 * Knife child-offset (relative to the right weapon-hand bone) for the static
 * menu hero pose only. The menu closes the fingers into a fist, so the knife
 * seats deeper in the palm / finger-curl pocket than the in-game default set in
 * {@link attachKnifeModel}. It slides the knife up its handle so the fist grips
 * right at the guard (leaving almost no bare wooden handle exposed between the
 * fist and the guard) and seats it up into the palm so the pommel tucks under
 * the fist rather than dangling below it — reading as a proper hammer-grip
 * knife-fight hold from the third-person menu camera. Applied by
 * {@link applyKnifeIdlePose} so the in-game third-person hold is never affected.
 */
const MENU_KNIFE_GRIP_POSITION = new Vector3(0.04, 0.02, 0.0252);
const MENU_KNIFE_GRIP_ROTATION = new Euler(1.18, -0.58, 0.75, 'XYZ');
const EYE_DETAIL_MARKER = 'PlayerEyeDetails';
const EYE_DETAIL_OFFSET = 0.013;
const EYE_SCLERA_RADIUS = 0.012;
const EYE_IRIS_RADIUS = 0.0105;
const EYE_PUPIL_RADIUS = 0.0045;
const EYE_CATCHLIGHT_RADIUS = 0.0009;

const offsetQuat = new Quaternion();
const offsetEuler = new Euler(0, 0, 0, 'XYZ');
const handGripQuat = new Quaternion();
const weaponGripQuat = new Quaternion();

/**
 * Adds life-size, light-reactive iris details to exposed player-model eye bones.
 * The counter-terrorist model uses opaque gas-mask lenses, so it is left untouched.
 */
export function addPlayerEyeDetails(root: Object3D): number {
  const existing = root.getObjectByName(EYE_DETAIL_MARKER);
  if (existing) {
    return Number(existing.userData.eyeCount ?? 0);
  }

  let hasMaskLenses = false;
  const eyeBones: Bone[] = [];
  root.traverse((child) => {
    if (child instanceof Bone && /^eyeball_[lr]_/.test(child.name.toLowerCase())) {
      eyeBones.push(child);
    }
    if (!(child instanceof Mesh)) {
      return;
    }
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    hasMaskLenses ||= materials.some((material) => material.name.toLowerCase().includes('lenses'));
  });

  const marker = new Group();
  marker.name = EYE_DETAIL_MARKER;
  root.add(marker);
  if (hasMaskLenses) {
    marker.userData.eyeCount = 0;
    return 0;
  }

  for (const [index, eyeBone] of eyeBones.entries()) {
    const detail = new Group();
    detail.name = `PlayerEyeDetail:${index}`;
    const localForward = new Vector3(0, 1, 0)
      .applyQuaternion(eyeBone.quaternion.clone().invert())
      .normalize();
    detail.position.copy(localForward).multiplyScalar(EYE_DETAIL_OFFSET);
    detail.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), localForward);

    const sclera = new Mesh(
      new CircleGeometry(EYE_SCLERA_RADIUS, 24),
      new MeshStandardMaterial({
        color: 0xb09b8e,
        emissive: 0x181310,
        emissiveIntensity: 0.12,
        roughness: 0.72,
        metalness: 0,
      }),
    );
    sclera.name = 'PlayerEyeSclera';
    sclera.scale.set(1.18, 0.66, 1);

    const iris = new Mesh(
      new CircleGeometry(EYE_IRIS_RADIUS, 24),
      new MeshStandardMaterial({
        color: 0x536b52,
        emissive: 0x10150f,
        emissiveIntensity: 0.18,
        roughness: 0.5,
        metalness: 0,
      }),
    );
    iris.name = 'PlayerEyeIris';
    iris.position.z = 0.00016;
    iris.scale.y = 0.86;

    const pupil = new Mesh(
      new CircleGeometry(EYE_PUPIL_RADIUS, 20),
      new MeshStandardMaterial({
        color: 0x0b0b09,
        roughness: 0.4,
        metalness: 0,
      }),
    );
    pupil.name = 'PlayerEyePupil';
    pupil.position.z = 0.00032;

    const catchlight = new Mesh(
      new CircleGeometry(EYE_CATCHLIGHT_RADIUS, 12),
      new MeshStandardMaterial({
        color: 0xc8c2b5,
        roughness: 0.2,
        metalness: 0,
      }),
    );
    catchlight.name = 'PlayerEyeCatchlight';
    catchlight.position.set(-0.00135, 0.0014, 0.00048);

    detail.add(sclera, iris, pupil, catchlight);
    eyeBone.add(detail);
  }

  marker.userData.eyeCount = eyeBones.length;
  return eyeBones.length;
}

/** Locates the arm/spine bones of a player model and captures their bind pose. */
export function buildArmRig(root: Object3D): ArmRig | null {
  const bones: Bone[] = [];
  root.traverse((child) => {
    if (child instanceof Bone) {
      bones.push(child);
    }
  });

  const pickBone = (token: string, options?: { allowTwist?: boolean; allowEnd?: boolean }): Bone | null => {
    const allowTwist = options?.allowTwist ?? false;
    const allowEnd = options?.allowEnd ?? false;
    return bones.find((bone) => {
      const name = bone.name.toLowerCase();
      if (!name.includes(token)) {
        return false;
      }
      if (!allowTwist && name.includes('twist')) {
        return false;
      }
      if (!allowEnd && name.includes('_end')) {
        return false;
      }
      return true;
    }) ?? null;
  };

  const pickAnatomicalHand = (side: 'l' | 'r'): Bone | null => (
    bones.find((bone) => {
      const name = bone.name.toLowerCase();
      return name.includes(`hand_${side}`) && !name.includes('weapon_hand');
    }) ?? null
  );

  const rightUpper = pickBone('arm_upper_r');
  const rightLower = pickBone('arm_lower_r');
  const rightHand = pickAnatomicalHand('r') ?? pickBone('weapon_hand_r');
  if (!rightUpper || !rightLower || !rightHand) {
    return null;
  }
  const rightWeaponHand = pickBone('weapon_hand_r') ?? rightHand;

  const leftUpper = pickBone('arm_upper_l');
  const leftLower = pickBone('arm_lower_l');
  const leftHand = pickAnatomicalHand('l') ?? pickBone('weapon_hand_l');
  const rightClavicle = pickBone('clavicle_r');
  const leftClavicle = pickBone('clavicle_l');
  const pelvis = pickBone('pelvis');
  const spineMid = pickBone('spine_2') ?? pickBone('spine_1');
  const spineUpper = pickBone('spine_3') ?? pickBone('spine_2');
  const neck = pickBone('neck_0') ?? pickBone('neck');
  const head = pickBone('head_0') ?? pickBone('head');

  // Right-hand finger joints for the menu-only fist grip: index/middle/ring/pinky
  // joints 0-2 (curled uniformly) plus the thumb joints 0-2 (curled separately).
  // Excludes the metacarpal (meta) and terminal (_end) bones.
  const rightFingers: Bone[] = [];
  const rightThumb: Bone[] = [];
  const leftFingers: Bone[] = [];
  const leftThumb: Bone[] = [];
  let hasMeta = false;
  for (const bone of bones) {
    const name = bone.name.toLowerCase();
    if (name.includes('meta')) hasMeta = true;
    if (name.includes('_end') || name.includes('meta')) {
      continue;
    }
    if (/finger_(index|middle|ring|pinky)_[012]_r_/.test(name)) {
      rightFingers.push(bone);
    } else if (/finger_thumb_[012]_r_/.test(name)) {
      rightThumb.push(bone);
    } else if (/finger_(index|middle|ring|pinky)_[012]_l_/.test(name)) {
      leftFingers.push(bone);
    } else if (/finger_thumb_[012]_l_/.test(name)) {
      leftThumb.push(bone);
    }
  }
  const mpfbHands = !hasMeta && rightFingers.length === 12 && leftFingers.length === 12;
  const leg = (side: 'l' | 'r'): LegBones | null => {
    const upper = pickBone(`leg_upper_${side}`);
    const lower = pickBone(`leg_lower_${side}`);
    const foot = pickBone(`ankle_${side}`);
    if (!upper || !lower || !foot) return null;
    return { upper, lower, foot, upperBase: upper.quaternion.clone(), lowerBase: lower.quaternion.clone(), footBase: foot.quaternion.clone() };
  };
  const legs = { left: leg('l'), right: leg('r') };

  return {
    rightUpper,
    rightLower,
    rightHand,
    rightWeaponHand,
    leftUpper,
    leftLower,
    leftHand,
    rightClavicle,
    leftClavicle,
    pelvis,
    spineMid,
    spineUpper,
    neck,
    head,
    rightFingers,
    rightThumb,
    leftFingers,
    leftThumb,
    mpfbHands,
    legs,

    rightUpperBase: rightUpper.quaternion.clone(),
    rightLowerBase: rightLower.quaternion.clone(),
    rightHandBase: rightHand.quaternion.clone(),
    rightWeaponHandBase: rightWeaponHand.quaternion.clone(),
    leftUpperBase: leftUpper?.quaternion.clone() ?? null,
    leftLowerBase: leftLower?.quaternion.clone() ?? null,
    leftHandBase: leftHand?.quaternion.clone() ?? null,
    rightClavicleBase: rightClavicle?.quaternion.clone() ?? null,
    leftClavicleBase: leftClavicle?.quaternion.clone() ?? null,
    pelvisBase: pelvis?.quaternion.clone() ?? null,
    spineMidBase: spineMid?.quaternion.clone() ?? null,
    spineUpperBase: spineUpper?.quaternion.clone() ?? null,
    neckBase: neck?.quaternion.clone() ?? null,
    headBase: head?.quaternion.clone() ?? null,
    rightFingerBases: rightFingers.map((bone) => bone.quaternion.clone()),
    rightThumbBases: rightThumb.map((bone) => bone.quaternion.clone()),
    leftFingerBases: leftFingers.map((bone) => bone.quaternion.clone()),
    leftThumbBases: leftThumb.map((bone) => bone.quaternion.clone()),
  };
}

/** Composes a local Euler offset onto a bone's base rotation. */
export function applyBoneOffset(bone: Bone, base: Quaternion, x: number, y: number, z: number): void {
  offsetEuler.set(x, y, z, 'XYZ');
  offsetQuat.setFromEuler(offsetEuler);
  bone.quaternion.copy(base).multiply(offsetQuat).normalize();
}

function applyOptional(bone: Bone | null, base: Quaternion | null, x: number, y: number, z: number): void {
  if (bone && base) {
    applyBoneOffset(bone, base, x, y, z);
  }
}

/**
 * Poses the arms into a static combat knife stance for the menu hero, matching
 * the classic CS terrorist knife-ready idle: the knife arm is held out in front
 * of the body a little above the waist with the fingers wrapped around the
 * handle in a cylinder grip, and the blade angled inward across the body (toward
 * the centreline) rather than splayed outward, while the off-hand rests relaxed
 * and slightly forward at belt height on its own side. Reads well through a
 * restrained breathing cycle. Deterministic and menu-only — the in-game
 * renderer keeps its own animated stance in RemotePlayersRenderer.applyRigPose.
 */
export function applyKnifeIdlePose(rig: ArmRig, breath = 0): void {
  const inhale = Math.max(-1, Math.min(1, breath));
  applyOptional(rig.spineMid, rig.spineMidBase, 0.05 + inhale * 0.006, 0, 0.02);
  applyOptional(rig.spineUpper, rig.spineUpperBase, 0.09 + inhale * 0.011, 0.02, 0.03);
  applyOptional(rig.neck, rig.neckBase, -0.02 - inhale * 0.002, 0, 0);
  applyOptional(rig.head, rig.headBase, -0.03 - inhale * 0.003, 0.02, 0);
  applyOptional(rig.rightClavicle, rig.rightClavicleBase, 0.16 + inhale * 0.005, -0.2, 0.12);
  applyOptional(rig.leftClavicle, rig.leftClavicleBase, 0.14 + inhale * 0.005, 0.14, -0.06);

  // Right knife arm: extended forward with the elbow tucked so the knife sits out
  // in front a little above the waist; the wrist is rolled so the blade points
  // forward and inward, angled across the body toward the centreline.
  applyBoneOffset(rig.rightUpper, rig.rightUpperBase, -0.04 + inhale * 0.004, 0.138, 0.564);
  applyBoneOffset(rig.rightLower, rig.rightLowerBase, -0.065 + inhale * 0.003, -0.025, 0.791);
  offsetEuler.set(-0.12, 0.08, 0.22, 'XYZ');
  handGripQuat.setFromEuler(offsetEuler);
  rig.rightHand.quaternion.copy(rig.rightHandBase).multiply(handGripQuat).normalize();
  if (rig.mpfbHands) {
    // armored characters: a relaxed fighting stance aimed in model space, elbow
    // by the ribs and the knife out low in front, instead of both forearms held
    // straight out
    aimBone(rig.rightUpper, STANCE.rightUpper.x, STANCE.rightUpper.y + inhale * 0.01, STANCE.rightUpper.z);
    aimBone(rig.rightLower, STANCE.rightLower.x, STANCE.rightLower.y + inhale * 0.01, STANCE.rightLower.z);
  }

  // Keep the weapon helper stable while the anatomical wrist closes around it.
  // The menu-only knife rotation below then follows the fist/palm channel rather
  // than preserving the in-game horizontal blade.
  offsetEuler.set(-0.446, 0.69, 0.924, 'XYZ');
  weaponGripQuat.setFromEuler(offsetEuler);
  rig.rightWeaponHand.quaternion
    .copy(handGripQuat)
    .invert()
    .multiply(rig.rightWeaponHandBase)
    .multiply(weaponGripQuat)
    .normalize();

  // Right hand: rotate the anatomical wrist, then curl the fingers and thumb
  // around the weapon helper that follows it.
  // the knife handle seated in the palm. The knuckles roll over the top of the
  // handle while the mid and tip joints close hard around and under it, so the
  // fingers visibly hug the wooden grip instead of clenching into a featureless
  // ball beside it. This only closes the fingers around the knife (which rides
  // the sibling weapon-hand bone) and never moves the blade.
  if (rig.mpfbHands) {
    curlHand(rig.rightFingers, rig.rightFingerBases, rig.rightThumb, rig.rightThumbBases, MPFB_FIST, MPFB_FIST_THUMB);
    curlHand(rig.leftFingers, rig.leftFingerBases, rig.leftThumb, rig.leftThumbBases, MPFB_RELAXED, MPFB_RELAXED_THUMB);
  } else {
    const fingerCurl = [0.72, 0.98, 1.02]; // knuckle, middle, tip joints
    for (let i = 0; i < rig.rightFingers.length; i++) {
      applyBoneOffset(rig.rightFingers[i], rig.rightFingerBases[i], 0, 0, fingerCurl[i % 3]);
    }
    const thumbCurl = [0.5, 0.66, 0.66]; // base, middle, tip joints
    for (let i = 0; i < rig.rightThumb.length; i++) {
      applyBoneOffset(rig.rightThumb[i], rig.rightThumbBases[i], 0, 0, thumbCurl[Math.min(i, thumbCurl.length - 1)]);
    }
  }

  // Seat the knife deeper in the palm and slid up to the balance point below the
  // guard for the static menu pose only. attachKnifeModel keeps the in-game
  // offset (gameplay is viewed at a distance with an open hand and no finger
  // curl); here the fingers close, so re-seating the knife into the finger-curl
  // pocket makes the fist grip the handle convincingly — without touching the
  // in-game third-person hold.
  const menuKnife = rig.rightWeaponHand.getObjectByName('RemoteKnifeModel');
  if (menuKnife) {
    menuKnife.position.copy(MENU_KNIFE_GRIP_POSITION);
    menuKnife.rotation.copy(MENU_KNIFE_GRIP_ROTATION);
  }

  // Left support hand: relaxed and slightly forward at belt height on its own
  // side, with only the restrained breathing offsets above keeping it alive.
  applyOptional(rig.leftUpper, rig.leftUpperBase, 0.021 + inhale * 0.005, -0.099, 0.411);
  applyOptional(rig.leftLower, rig.leftLowerBase, -0.067 + inhale * 0.004, -0.062, 1.031);
  applyOptional(rig.leftHand, rig.leftHandBase, 0, 0, 0);

  if (rig.mpfbHands) {
    // left hand up in a loose guard in front of the chest, elbow down
    if (rig.leftUpper) aimBone(rig.leftUpper, STANCE.leftUpper.x, STANCE.leftUpper.y + inhale * 0.01, STANCE.leftUpper.z);
    if (rig.leftLower) aimBone(rig.leftLower, STANCE.leftLower.x, STANCE.leftLower.y + inhale * 0.01, STANCE.leftLower.z);
    if (rig.leftHand) aimBone(rig.leftHand, STANCE.leftHand.x, STANCE.leftHand.y, STANCE.leftHand.z);
    // turn the fist so the blade points forward and a little up, across the body
    if (menuKnife) aimKnife(rig.rightHand, menuKnife, STANCE.rightHand, STANCE.blade);
    // weight on the back foot, the left a short step ahead, knees soft
    for (const [leg, swing, knee] of [[rig.legs?.left, -0.16, 0.14], [rig.legs?.right, 0.1, 0.12]] as const) {
      if (!leg) continue;
      leg.upper.quaternion.copy(leg.upperBase);
      leg.lower.quaternion.copy(leg.lowerBase);
      leg.foot.quaternion.copy(leg.footBase);
      swingBone(leg.upper, swing - knee * 0.5);
      swingBone(leg.lower, knee);
      // keep the sole flat
      swingBone(leg.foot, -(swing + knee * 0.5));
    }
  }
}

/**
 * the menu's idle: relaxed and sure of itself. weight on the right leg with the
 * left knee easy, shoulders down, the knife hanging low at the side in a loose
 * fist with the blade forward along the thigh and the free hand relaxed. it
 * breathes, shifts its weight, looks around now and then, and every so often
 * brings the knife up and twirls it before letting it hang again. `t` is
 * seconds; `phase` offsets the cycles so two characters don't move in step.
 * rigs without mpfb hands keep the combat stance.
 */
export function applyMenuIdlePose(rig: ArmRig, t: number, phase = 0): void {
  const breath = Math.sin(((t + phase) / 4.4) * Math.PI * 2);
  if (!rig.mpfbHands) {
    applyKnifeIdlePose(rig, breath);
    return;
  }
  const time = t + phase;
  const sway = Math.sin((time / 9.3) * Math.PI * 2);
  const look = 0.07 * Math.sin((time / 13.1) * Math.PI * 2 + 1.2) + 0.025 * Math.sin((time / 5.3) * Math.PI * 2);
  const knife = rig.rightWeaponHand.getObjectByName('RemoteKnifeModel') ?? null;
  const f = knife ? menuFlourish(time) : { up: 0, spin: 0, loosen: 0, glance: 0 };

  // contrapposto: the hips tip up over the straight right leg and turn the
  // knife side a little toward the camera, the shoulders tip the other way
  const tilt = 0.035 + 0.01 * sway;
  if (rig.pelvis && rig.pelvisBase) {
    rig.pelvis.quaternion.copy(rig.pelvisBase);
    turnBone(rig.pelvis, AXIS_Z, -tilt);
    turnBone(rig.pelvis, AXIS_Y, -0.08);
  }

  // chest up, shoulders down and back, the weight shift rocking the spine a touch
  applyOptional(rig.spineMid, rig.spineMidBase, 0.01 + breath * 0.008, 0.02 * sway, 0.012 * sway);
  applyOptional(rig.spineUpper, rig.spineUpperBase, -0.025 + breath * 0.012, 0.03 + 0.015 * sway, -0.008 * sway);
  if (rig.spineMid) turnBone(rig.spineMid, AXIS_Z, tilt * 1.5);
  applyOptional(rig.neck, rig.neckBase, 0.02 + f.glance * 0.08, look * 0.4, 0);
  applyOptional(rig.head, rig.headBase, 0.01 + f.glance * 0.12 - breath * 0.004, look - f.glance * 0.08, 0.02 * sway);
  if (rig.neck) turnBone(rig.neck, AXIS_Z, -tilt * 0.3);
  applyOptional(rig.rightClavicle, rig.rightClavicleBase, breath * 0.01, 0.05, -0.04);
  applyOptional(rig.leftClavicle, rig.leftClavicleBase, breath * 0.01, -0.05, 0.04);
  rig.rightUpper.quaternion.copy(rig.rightUpperBase);
  rig.rightLower.quaternion.copy(rig.rightLowerBase);
  rig.rightHand.quaternion.copy(rig.rightHandBase);
  // the weapon helper sits in the fist exactly as in the stance, so the knife seat is the same
  offsetEuler.set(-0.12, 0.08, 0.22, 'XYZ');
  handGripQuat.setFromEuler(offsetEuler);
  offsetEuler.set(-0.446, 0.69, 0.924, 'XYZ');
  weaponGripQuat.setFromEuler(offsetEuler);
  rig.rightWeaponHand.quaternion.copy(handGripQuat).invert().multiply(rig.rightWeaponHandBase).multiply(weaponGripQuat).normalize();
  applyOptional(rig.leftUpper, rig.leftUpperBase, 0, 0, 0);
  applyOptional(rig.leftLower, rig.leftLowerBase, 0, 0, 0);
  applyOptional(rig.leftHand, rig.leftHandBase, 0, 0, 0);

  // knife arm: hanging with the elbow soft, or up in front of the hip for the twirl
  const up = f.up;
  // ring knives (reverse grip, claw under the little finger) bring the forearm forward so the claw hangs in view
  const pose = knife?.userData.reverseGrip === true ? MENU_RING : MENU;
  aimBlend(rig.rightUpper, MENU.rightUpper, MENU.rightUpperUp, up, breath * 0.01);
  aimBlend(rig.rightLower, pose.rightLower, MENU.rightLowerUp, up, breath * 0.01);
  if (knife) {
    // the menu seat for the knife, with the twirl undone while the fist is aimed
    knife.position.copy(MENU_KNIFE_GRIP_POSITION);
    knife.rotation.copy(MENU_KNIFE_GRIP_ROTATION);
    const turn = knife.children[0];
    if (turn) turn.rotation.z = Math.PI / 2;
    aimKnife(rig.rightHand, knife, blendDir(pose.rightHand, pose.rightHandUp, up, blendTmp), blendDir(pose.blade, pose.bladeUp, up, blendTmp3));
    // the knife turns once round the grip in the loosened fingers
    if (turn) turn.rotation.z = Math.PI / 2 + f.spin * Math.PI * 2;
  } else {
    aimBone(rig.rightHand, MENU.rightHand.x, MENU.rightHand.y, MENU.rightHand.z);
  }
  blendTable(knife ? MPFB_FIST : MPFB_RELAXED, MPFB_RELAXED, f.loosen, menuFingers);
  blendTable([knife ? MPFB_FIST_THUMB : MPFB_RELAXED_THUMB], [MPFB_RELAXED_THUMB], f.loosen, menuThumb);
  curlHand(rig.rightFingers, rig.rightFingerBases, rig.rightThumb, rig.rightThumbBases, menuFingers, menuThumb[0]);

  // free arm hanging loose, the fingers easing open and shut now and then
  if (rig.leftUpper) aimBone(rig.leftUpper, MENU.leftUpper.x, MENU.leftUpper.y + breath * 0.01, MENU.leftUpper.z);
  if (rig.leftLower) aimBone(rig.leftLower, MENU.leftLower.x, MENU.leftLower.y, MENU.leftLower.z + 0.03 * sway);
  if (rig.leftHand) aimBone(rig.leftHand, MENU.leftHand.x, MENU.leftHand.y, MENU.leftHand.z);
  const flex = 1 + 0.25 * Math.max(0, Math.sin((time / 6.1) * Math.PI * 2)) ** 4;
  blendTable(MPFB_RELAXED, MPFB_RELAXED, 0, menuFingers);
  for (const row of menuFingers) for (let i = 0; i < row.length; i += 1) row[i] *= flex;
  curlHand(rig.leftFingers, rig.leftFingerBases, rig.leftThumb, rig.leftThumbBases, menuFingers, MPFB_RELAXED_THUMB);

  // weight on the right leg, the left knee easy and its foot a little ahead on
  // its ball, the weight drifting between them with the sway. the legs undo the
  // hip tilt so they stay upright
  for (const [leg, swing, knee, toe] of [[rig.legs?.left, -0.06, 0.3 + 0.05 * sway, 0.1], [rig.legs?.right, 0.02, 0.02, 0]] as const) {
    if (!leg) continue;
    leg.upper.quaternion.copy(leg.upperBase);
    leg.lower.quaternion.copy(leg.lowerBase);
    leg.foot.quaternion.copy(leg.footBase);
    if (rig.pelvis) turnBone(leg.upper, AXIS_Z, tilt);
    swingBone(leg.upper, swing - knee * 0.5);
    swingBone(leg.lower, knee);
    swingBone(leg.foot, toe - (swing + knee * 0.5));
  }
}

// menu idle directions, the model's frame (faces +z, left side +x)
const MENU = {
  // knife arm hanging a little away from the body, the elbow soft
  rightUpper: new Vector3(-0.25, -0.96, 0.07),
  rightLower: new Vector3(-0.12, -0.86, 0.5),
  // the fist hanging on from the forearm, the knife seated as in the stance
  rightHand: new Vector3(-0.12, -0.95, 0.28),
  // so the blade comes out of the thumb side forward and a little out, edge down
  blade: new Vector3(-0.55, -0.25, 0.8),
  // the twirl: forearm up and out to the side, blade up
  rightUpperUp: new Vector3(-0.38, -0.88, 0.28),
  rightLowerUp: new Vector3(-0.3, 0.05, 0.95),
  rightHandUp: new Vector3(-0.22, 0.25, 0.94),
  bladeUp: new Vector3(-0.15, 0.78, 0.6),
  leftUpper: new Vector3(0.22, -0.97, 0.04),
  leftLower: new Vector3(0.13, -0.9, 0.42),
  leftHand: new Vector3(0.1, -0.88, 0.46),
};
// ring knives: forearm forward from the soft elbow, the knuckles turned in
// across the body (thumb up) so the claw hangs under the fist with its flat to
// the front, curving in; for the twirl it spins round the index in the ring
const MENU_RING = {
  rightLower: new Vector3(0.1, -0.35, 0.93),
  rightHand: new Vector3(0.75, -0.25, 0.6),
  blade: new Vector3(0.1, -0.98, 0.15),
  rightHandUp: new Vector3(0.55, 0.05, 0.83),
  bladeUp: new Vector3(0.15, -0.95, 0.25),
};
// one twirl every MENU_FLOURISH_EVERY seconds, MENU_FLOURISH_AT into the cycle
export const MENU_FLOURISH_EVERY = 11;
const MENU_FLOURISH_AT = 4.5;
const menuFingers = MPFB_FIST.map((row) => row.slice());
const menuThumb = [MPFB_FIST_THUMB.slice()];
const blendTmp = new Vector3();
const blendTmp2 = new Vector3();
const blendTmp3 = new Vector3();

/** where the twirl is: arm up (0..1), turns done (0..1), how loose the fingers are, how far the head dips to watch */
export function menuFlourish(t: number): { up: number; spin: number; loosen: number; glance: number } {
  const local = (((t - MENU_FLOURISH_AT) % MENU_FLOURISH_EVERY) + MENU_FLOURISH_EVERY) % MENU_FLOURISH_EVERY;
  const smooth = (a: number, b: number, x: number) => {
    const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return u * u * (3 - 2 * u);
  };
  const up = smooth(0, 0.4, local) * (1 - smooth(1.05, 1.65, local));
  const spin = smooth(0.38, 0.9, local);
  const loosen = Math.sin(Math.PI * Math.min(1, Math.max(0, (local - 0.34) / 0.62))) * 0.85;
  const glance = smooth(0.15, 0.45, local) * (1 - smooth(1.0, 1.5, local));
  return { up, spin: spin >= 1 ? 0 : spin, loosen, glance };
}

function blendDir(a: Vector3, b: Vector3, k: number, out: Vector3): Vector3 {
  return out.copy(a).lerp(b, k).normalize();
}

function aimBlend(bone: Bone, a: Vector3, b: Vector3, k: number, lift: number): void {
  const dir = blendTmp2.copy(a).lerp(b, k).normalize();
  aimBone(bone, dir.x, dir.y + lift, dir.z);
}

function blendTable(a: readonly (readonly number[])[], b: readonly (readonly number[])[], k: number, out: number[][]): void {
  for (let r = 0; r < out.length; r += 1) {
    for (let i = 0; i < out[r].length; i += 1) out[r][i] = a[r][i] + (b[r][i] - a[r][i]) * k;
  }
}

// armored stance, directions in the model's frame (faces +z, left side +x)
const STANCE = {
  rightUpper: new Vector3(-0.3, -0.93, 0.14),
  rightLower: new Vector3(0.1, 0.22, 0.97),
  // wrist cocked down and in from the forearm so the blade leans forward
  rightHand: new Vector3(0.18, -0.35, 0.92),
  leftUpper: new Vector3(0.26, -0.93, 0.2),
  leftLower: new Vector3(-0.15, 0.2, 0.97),
  leftHand: new Vector3(-0.2, 0.1, 0.97),
  blade: new Vector3(0.2, 0.62, 0.76),
};
const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Y = new Vector3(0, 1, 0);
const AXIS_Z = new Vector3(0, 0, 1);
const rollAxis = new Vector3();
const aimFrom = new Vector3();
const aimTo = new Vector3();
const aimQ = new Quaternion();
const aimParent = new Quaternion();
const aimWorld = new Quaternion();
const aimModel = new Quaternion();

/** the model root's world rotation: the first non-bone ancestor of the skeleton */
function modelRotation(bone: Object3D, out: Quaternion): Quaternion {
  let node: Object3D = bone;
  while (node.parent && (node.parent as Bone).isBone) node = node.parent;
  return node.parent ? node.parent.getWorldQuaternion(out) : out.identity();
}

/** applies a world rotation `delta` to a bone on top of its current pose */
function rotateWorld(bone: Object3D, delta: Quaternion): void {
  bone.parent!.updateWorldMatrix(true, false);
  bone.parent!.getWorldQuaternion(aimParent);
  aimWorld.copy(aimParent).multiply(bone.quaternion);
  aimWorld.premultiply(delta);
  bone.quaternion.copy(aimParent.invert().multiply(aimWorld)).normalize();
}

/** turns a bone the shortest way so it points along (x, y, z) in the model's frame */
function aimBone(bone: Bone, x: number, y: number, z: number): void {
  bone.updateWorldMatrix(true, false);
  bone.getWorldQuaternion(aimWorld);
  aimFrom.set(bone.name.includes('_r_') ? -1 : 1, 0, 0).applyQuaternion(aimWorld);
  aimTo.set(x, y, z).normalize().applyQuaternion(modelRotation(bone, aimModel));
  rotateWorld(bone, aimQ.setFromUnitVectors(aimFrom, aimTo));
}

/** lines the hand up with `handDir`, then rolls the fist about it so the blade comes closest to `bladeDir` (model frame) */
function aimKnife(hand: Bone, knife: Object3D, handDir: Vector3, bladeDir: Vector3): void {
  aimBone(hand, handDir.x, handDir.y, handDir.z);
  const grip = knife.getObjectByName(KNIFE_NODES.grip);
  const tip = knife.getObjectByName('socket_tip');
  if (!grip || !tip) return;
  knife.updateWorldMatrix(true, true);
  tip.getWorldPosition(aimFrom);
  aimFrom.sub(grip.getWorldPosition(aimTo)).normalize();
  modelRotation(hand, aimModel);
  aimTo.copy(bladeDir).normalize().applyQuaternion(aimModel);
  const axis = rollAxis.copy(handDir).normalize().applyQuaternion(aimModel);
  rotateWorld(hand, aimQ.setFromAxisAngle(axis, signedAngleAbout(aimFrom, aimTo, axis)));
}

/** swings a leg bone forward (negative) or back about the model's left-right axis */
function swingBone(bone: Bone, angle: number): void {
  turnBone(bone, AXIS_X, angle);
}

/** turns a bone about an axis of the model's frame, on top of its current pose */
function turnBone(bone: Bone, axis: Vector3, angle: number): void {
  aimTo.copy(axis).applyQuaternion(modelRotation(bone, aimModel));
  rotateWorld(bone, aimQ.setFromAxisAngle(aimTo, angle));
}

function curlHand(fingers: Bone[], bases: Quaternion[], thumb: Bone[], thumbBases: Quaternion[], table: number[][], thumbTable: number[]): void {
  for (let i = 0; i < fingers.length; i++) {
    applyBoneOffset(fingers[i], bases[i], 0, 0, table[Math.floor(i / 3)]?.[i % 3] ?? 0);
  }
  for (let i = 0; i < thumb.length; i++) {
    applyBoneOffset(thumb[i], thumbBases[i], 0, 0, thumbTable[i] ?? 0);
  }
}

/** Attaches a knife clone to the right-hand bone (no-op if already attached). */
export function attachKnifeModel(handBone: Bone, knifeTemplate: Object3D | null): void {
  if (handBone.getObjectByName('RemoteKnifeModel')) {
    return;
  }
  if (!knifeTemplate) {
    return;
  }

  const knife = knifeTemplate.clone(true);
  knife.name = 'RemoteKnifeModel';
  // The knife mesh origin sits near the guard, so the grip+butt hang below the
  // bone anchor. Offset the clone so a mid-handle point sits at the hand for the
  // in-game third-person hold (viewed at a distance with an open hand). The
  // static menu pose nudges it a little deeper into the palm in
  // applyKnifeIdlePose once the fingers close.
  knife.position.set(0.039, -0.0034, 0.0602);
  knife.rotation.set(1.18, -0.58, -0.5);
  handBone.add(knife);
}

/** Scales a knife model to a consistent size for hand attachment. */
export function normalizeKnifeTemplate(root: Object3D): void {
  const bounds = new Box3().setFromObject(root);
  if (bounds.isEmpty()) {
    return;
  }

  const size = bounds.getSize(new Vector3());
  const diagonal = Math.max(1e-5, size.length());
  const targetDiagonal = 0.58;
  const scale = targetDiagonal / diagonal;
  root.scale.setScalar(scale);
  root.updateWorldMatrix(true, true);
}

/**
 * builds the third-person knife: the same procedural knife the first-person
 * view uses (a classic fixed blade), wrapped so its grip socket is the origin.
 * the loader argument is kept so callers don't change.
 */
export async function loadKnifeMesh(_loader?: GLTFLoader): Promise<Object3D | null> {
  const knife = buildProceduralKnife(getKnife(THIRD_PERSON_KNIFE));
  const grip = knife.getObjectByName(KNIFE_NODES.grip);
  knife.updateMatrixWorld(true);
  if (grip) {
    knife.position.sub(grip.getWorldPosition(new Vector3()));
  }
  const wrapper = new Group();
  wrapper.name = 'RemoteKnifeTemplate';
  // blade along the hand bone's pointing axis, the same hold the old mesh had
  wrapper.rotation.set(0, 0, Math.PI / 2);
  wrapper.add(knife);
  wrapper.traverse((child) => {
    child.frustumCulled = false;
    if (child instanceof Mesh) {
      child.castShadow = false;
      child.receiveShadow = false;
    }
  });
  const holder = new Group();
  holder.add(wrapper);
  return holder;
}
