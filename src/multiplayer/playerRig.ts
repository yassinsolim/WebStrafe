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
 * character preview (static), so both hold the knife identically.
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
}

const KNIFE_MODEL_PATH = '/viewmodels/knife/knife.glb';

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
 * Poses the arms into a static combat knife stance for the menu hero: the knife
 * arm is raised to shoulder height with the forearm up and the blade held high
 * beside the head (the classic CS knife-guard "ready" stance), while the
 * off-hand is bent up across the chest as a guard instead of flaring out. Reads
 * well through the full side-to-side yaw sway. Deterministic and menu-only — the
 * in-game renderer keeps its own animated stance in RemotePlayersRenderer.applyRigPose.
 */
export function applyKnifeIdlePose(rig: ArmRig): void {
  applyOptional(rig.spineMid, rig.spineMidBase, 0.05, 0, 0.02);
  applyOptional(rig.spineUpper, rig.spineUpperBase, 0.09, 0.02, 0.03);
  applyOptional(rig.neck, rig.neckBase, -0.02, 0, 0);
  applyOptional(rig.head, rig.headBase, -0.03, 0.02, 0);
  applyOptional(rig.rightClavicle, rig.rightClavicleBase, 0.16, -0.2, 0.12);
  applyOptional(rig.leftClavicle, rig.leftClavicleBase, 0.14, 0.14, -0.06);

  // Right knife arm: elbow up to shoulder height, forearm vertical, blade up
  // beside the head.
  applyBoneOffset(rig.rightUpper, rig.rightUpperBase, -0.741, 1.254, 0.983);
  applyBoneOffset(rig.rightLower, rig.rightLowerBase, -0.218, 1.059, 0.349);
  applyBoneOffset(rig.rightHand, rig.rightHandBase, 0, 0, 0);

  // Left support arm: forearm bent up across the chest as a guard (no flare).
  applyOptional(rig.leftUpper, rig.leftUpperBase, 0.114, -0.297, 0.728);
  applyOptional(rig.leftLower, rig.leftLowerBase, -0.048, -0.133, 1.559);
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
  knife.position.set(0.013, -0.01, -0.02);
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
