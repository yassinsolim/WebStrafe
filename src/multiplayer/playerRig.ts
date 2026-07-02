import {
  Bone,
  Box3,
  Euler,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

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
  leftUpper: Bone | null;
  leftLower: Bone | null;
  leftHand: Bone | null;
  rightClavicle: Bone | null;
  leftClavicle: Bone | null;
  spineMid: Bone | null;
  spineUpper: Bone | null;
  neck: Bone | null;
  head: Bone | null;
  /** Right-hand finger joints (index/middle/ring/pinky, joints 0-2) for the menu fist grip. */
  rightFingers: Bone[];
  /** Right-hand thumb joints (0-2) for the menu fist grip. */
  rightThumb: Bone[];

  rightUpperBase: Quaternion;
  rightLowerBase: Quaternion;
  rightHandBase: Quaternion;
  leftUpperBase: Quaternion | null;
  leftLowerBase: Quaternion | null;
  leftHandBase: Quaternion | null;
  rightClavicleBase: Quaternion | null;
  leftClavicleBase: Quaternion | null;
  spineMidBase: Quaternion | null;
  spineUpperBase: Quaternion | null;
  neckBase: Quaternion | null;
  headBase: Quaternion | null;
  rightFingerBases: Quaternion[];
  rightThumbBases: Quaternion[];
}

const KNIFE_MODEL_PATH = '/viewmodels/knife/knife.glb';

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
const MENU_KNIFE_GRIP_POSITION = new Vector3(0.0228, 0.0098, 0.0252);

const offsetQuat = new Quaternion();
const offsetEuler = new Euler(0, 0, 0, 'XYZ');

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

  const rightUpper = pickBone('arm_upper_r');
  const rightLower = pickBone('arm_lower_r');
  const rightHand = pickBone('weapon_hand_r') ?? pickBone('hand_r');
  if (!rightUpper || !rightLower || !rightHand) {
    return null;
  }

  const leftUpper = pickBone('arm_upper_l');
  const leftLower = pickBone('arm_lower_l');
  const leftHand = pickBone('weapon_hand_l') ?? pickBone('hand_l');
  const rightClavicle = pickBone('clavicle_r');
  const leftClavicle = pickBone('clavicle_l');
  const spineMid = pickBone('spine_2') ?? pickBone('spine_1');
  const spineUpper = pickBone('spine_3') ?? pickBone('spine_2');
  const neck = pickBone('neck_0') ?? pickBone('neck');
  const head = pickBone('head_0') ?? pickBone('head');

  // Right-hand finger joints for the menu-only fist grip: index/middle/ring/pinky
  // joints 0-2 (curled uniformly) plus the thumb joints 0-2 (curled separately).
  // Excludes the metacarpal (meta) and terminal (_end) bones.
  const rightFingers: Bone[] = [];
  const rightThumb: Bone[] = [];
  for (const bone of bones) {
    const name = bone.name.toLowerCase();
    if (name.includes('_end') || name.includes('meta')) {
      continue;
    }
    if (/finger_(index|middle|ring|pinky)_[012]_r_/.test(name)) {
      rightFingers.push(bone);
    } else if (/finger_thumb_[012]_r_/.test(name)) {
      rightThumb.push(bone);
    }
  }

  return {
    rightUpper,
    rightLower,
    rightHand,
    leftUpper,
    leftLower,
    leftHand,
    rightClavicle,
    leftClavicle,
    spineMid,
    spineUpper,
    neck,
    head,
    rightFingers,
    rightThumb,

    rightUpperBase: rightUpper.quaternion.clone(),
    rightLowerBase: rightLower.quaternion.clone(),
    rightHandBase: rightHand.quaternion.clone(),
    leftUpperBase: leftUpper?.quaternion.clone() ?? null,
    leftLowerBase: leftLower?.quaternion.clone() ?? null,
    leftHandBase: leftHand?.quaternion.clone() ?? null,
    rightClavicleBase: rightClavicle?.quaternion.clone() ?? null,
    leftClavicleBase: leftClavicle?.quaternion.clone() ?? null,
    spineMidBase: spineMid?.quaternion.clone() ?? null,
    spineUpperBase: spineUpper?.quaternion.clone() ?? null,
    neckBase: neck?.quaternion.clone() ?? null,
    headBase: head?.quaternion.clone() ?? null,
    rightFingerBases: rightFingers.map((bone) => bone.quaternion.clone()),
    rightThumbBases: rightThumb.map((bone) => bone.quaternion.clone()),
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
 * and slightly forward at belt height on its own side. Reads well through the
 * full side-to-side yaw sway. Deterministic and menu-only — the in-game renderer
 * keeps its own animated stance in RemotePlayersRenderer.applyRigPose.
 */
export function applyKnifeIdlePose(rig: ArmRig): void {
  applyOptional(rig.spineMid, rig.spineMidBase, 0.05, 0, 0.02);
  applyOptional(rig.spineUpper, rig.spineUpperBase, 0.09, 0.02, 0.03);
  applyOptional(rig.neck, rig.neckBase, -0.02, 0, 0);
  applyOptional(rig.head, rig.headBase, -0.03, 0.02, 0);
  applyOptional(rig.rightClavicle, rig.rightClavicleBase, 0.16, -0.2, 0.12);
  applyOptional(rig.leftClavicle, rig.leftClavicleBase, 0.14, 0.14, -0.06);

  // Right knife arm: extended forward with the elbow tucked so the knife sits out
  // in front a little above the waist; the wrist is rolled so the blade points
  // forward and inward, angled across the body toward the centreline.
  applyBoneOffset(rig.rightUpper, rig.rightUpperBase, -0.04, 0.138, 0.564);
  applyBoneOffset(rig.rightLower, rig.rightLowerBase, -0.065, -0.025, 0.791);
  applyBoneOffset(rig.rightHand, rig.rightHandBase, -0.446, 0.69, 0.924);

  // Right hand: curl the fingers and thumb into a tight cylinder grip that wraps
  // the knife handle seated in the palm. The knuckles roll over the top of the
  // handle while the mid and tip joints close hard around and under it, so the
  // fingers visibly hug the wooden grip instead of clenching into a featureless
  // ball beside it. This only closes the fingers around the knife (which rides
  // the sibling weapon-hand bone) and never moves the blade.
  const fingerCurl = [0.72, 0.98, 1.02]; // knuckle, middle, tip joints
  for (let i = 0; i < rig.rightFingers.length; i++) {
    applyBoneOffset(rig.rightFingers[i], rig.rightFingerBases[i], 0, 0, fingerCurl[i % 3]);
  }
  const thumbCurl = [0.5, 0.66, 0.66]; // base, middle, tip joints
  for (let i = 0; i < rig.rightThumb.length; i++) {
    applyBoneOffset(rig.rightThumb[i], rig.rightThumbBases[i], 0, 0, thumbCurl[Math.min(i, thumbCurl.length - 1)]);
  }

  // Seat the knife deeper in the palm and slid up to the balance point below the
  // guard for the static menu pose only. attachKnifeModel keeps the in-game
  // offset (gameplay is viewed at a distance with an open hand and no finger
  // curl); here the fingers close, so re-seating the knife into the finger-curl
  // pocket makes the fist grip the handle convincingly — without touching the
  // in-game third-person hold.
  const menuKnife = rig.rightHand.getObjectByName('RemoteKnifeModel');
  if (menuKnife) {
    menuKnife.position.copy(MENU_KNIFE_GRIP_POSITION);
  }

  // Left support hand: relaxed and slightly forward at belt height on its own
  // side (a loose guard that reads naturally through the yaw sway).
  applyOptional(rig.leftUpper, rig.leftUpperBase, 0.021, -0.099, 0.411);
  applyOptional(rig.leftLower, rig.leftLowerBase, -0.067, -0.062, 1.031);
  applyOptional(rig.leftHand, rig.leftHandBase, 0, 0, 0);
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
 * Loads the knife GLB and extracts a normalised knife mesh template ready to
 * clone onto a hand bone. Returns null if the model or its knife mesh is missing.
 */
export async function loadKnifeMesh(loader: GLTFLoader): Promise<Object3D | null> {
  try {
    const gltf = await loader.loadAsync(KNIFE_MODEL_PATH);
    let knifeMesh: Mesh | null = null;
    gltf.scene.traverse((child) => {
      if (knifeMesh || !(child instanceof Mesh)) {
        return;
      }
      const name = child.name.toLowerCase();
      if (!name.includes('knife') || name.includes('arm') || name.includes('hand')) {
        return;
      }
      knifeMesh = child;
    });

    if (!knifeMesh) {
      return null;
    }

    const knife = (knifeMesh as Object3D).clone(true);
    knife.name = 'RemoteKnifeTemplate';
    normalizeKnifeTemplate(knife);
    knife.traverse((child: Object3D) => {
      if (!(child instanceof Mesh)) {
        return;
      }
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        const withMap = material as MeshStandardMaterial;
        if (withMap.map) {
          withMap.map.colorSpace = SRGBColorSpace;
        }
        material.depthWrite = true;
        material.depthTest = true;
        material.needsUpdate = true;
      }
      child.castShadow = false;
      child.receiveShadow = false;
      child.frustumCulled = false;
    });

    return knife;
  } catch {
    return null;
  }
}
