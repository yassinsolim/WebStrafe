import { Bone, Quaternion, Vector3 } from 'three';

/**
 * the player skeleton, shared by the armored characters, the old procedural
 * soldiers and the blender build (tools/blender/characters reads rig.json,
 * written from this table by tools/characters/export-rig.ts).
 *
 * convention the pose code relies on (playerRig.ts): each bone points at its
 * child along local +X (-X on the mirrored right side), the model faces +Z
 * with its left side on +X, and the bind pose is an A-pose. the arm chain
 * keeps the orientations the knife stance, the menu pose and the swing were
 * tuned on.
 */
export interface JointSpec {
  name: string;
  parent: string | null;
  /** bind orientation in model space (x, y, z, w) */
  q: [number, number, number, number];
  /** either a model-space offset from the parent (root / branches) or a length along the parent's +X */
  at?: [number, number, number];
  along?: number;
}

// joint positions follow the MPFB2 game_engine rig (anatomical shoulders, spine
// and legs, tools/blender/characters/mpfb_joints.json); the arm chain keeps the
// directions and lengths the stance was tuned on, and every other orientation is
// the old one turned by the smallest rotation that points it at its child.
// branch offsets are relative to the parent joint, in model space
export const BODY_JOINTS: readonly JointSpec[] = [
  { name: 'pelvis', parent: null, q: [0.4032, 0.5809, 0.4032, 0.5809], at: [0, 0.9756, 0.0035] },
  { name: 'spine_0', parent: 'pelvis', q: [0.4032, 0.5809, 0.4032, 0.5809], along: 0.025 },
  { name: 'spine_1', parent: 'spine_0', q: [0.5371, 0.46, 0.5371, 0.46], along: 0.0678 },
  { name: 'spine_2', parent: 'spine_1', q: [0.4662, 0.5316, 0.4662, 0.5316], along: 0.0629 },
  { name: 'spine_3', parent: 'spine_2', q: [0.527, 0.4715, 0.527, 0.4715], along: 0.0635 },
  { name: 'neck_0', parent: 'spine_3', q: [0.5779, 0.4074, 0.5779, 0.4074], along: 0.3542 },
  { name: 'head_0', parent: 'neck_0', q: [0.5, 0.5, 0.5, 0.5], along: 0.1058 },
  { name: 'clavicle_l', parent: 'spine_3', q: [0.711, -0.0419, -0.064, 0.699], at: [0.0235, 0.2757, 0.0524] },
  { name: 'arm_upper_l', parent: 'clavicle_l', q: [0.6895, -0.2721, -0.3286, 0.5854], along: 0.193 },
  { name: 'arm_lower_l', parent: 'arm_upper_l', q: [0.6125, -0.4175, -0.1914, 0.6434], along: 0.27 },
  { name: 'hand_l', parent: 'arm_lower_l', q: [0.8709, -0.4586, 0.1681, 0.0549], along: 0.255 },
  { name: 'weapon_hand_l', parent: 'hand_l', q: [0.4586, 0.8709, -0.0549, 0.1681], along: 0.068 },
  { name: 'clavicle_r', parent: 'spine_3', q: [-0.699, -0.064, 0.0419, 0.711], at: [-0.0235, 0.2757, 0.0524] },
  { name: 'arm_upper_r', parent: 'clavicle_r', q: [-0.5853, -0.3286, 0.2721, 0.6895], along: 0.193 },
  { name: 'arm_lower_r', parent: 'arm_upper_r', q: [-0.6434, -0.1914, 0.4175, 0.6125], along: 0.27 },
  { name: 'hand_r', parent: 'arm_lower_r', q: [-0.0549, 0.1681, 0.4586, 0.8709], along: 0.255 },
  { name: 'weapon_hand_r', parent: 'hand_r', q: [0.1681, 0.0549, 0.8709, -0.4586], along: 0.068 },
  { name: 'leg_upper_l', parent: 'pelvis', q: [0.6008, -0.519, 0.4334, -0.4263], at: [0.1113, -0.0062, -0.0107] },
  { name: 'leg_lower_l', parent: 'leg_upper_l', q: [-0.5854, 0.5328, -0.3964, 0.465], along: 0.4463 },
  { name: 'ankle_l', parent: 'leg_lower_l', q: [0.1319, -0.6696, -0.1942, 0.7047], along: 0.4564 },
  { name: 'ball_l', parent: 'ankle_l', q: [0.0043, -0.6211, 0.0034, 0.7837], along: 0.146 },
  { name: 'leg_upper_r', parent: 'pelvis', q: [0.4263, 0.4334, 0.519, 0.6008], at: [-0.1113, -0.0062, -0.0107] },
  { name: 'leg_lower_r', parent: 'leg_upper_r', q: [0.465, 0.3964, 0.5328, 0.5854], along: 0.4463 },
  { name: 'ankle_r', parent: 'leg_lower_r', q: [0.7047, 0.1942, -0.6696, -0.1319], along: 0.4564 },
  { name: 'ball_r', parent: 'ankle_r', q: [0.7837, -0.0034, -0.6211, -0.0043], along: 0.146 },
];

// cloth chains hang straight down in the bind pose, +X pointing at -Y
const DOWN: [number, number, number, number] = [0, 0, -Math.SQRT1_2, Math.SQRT1_2];

/**
 * extra bones for cloth: `cape_*` hangs from the upper back (cloaks, capes,
 * scarf tails), `tail_*` from the back of the belt (sashes). the class items
 * sway on these; nothing else uses them.
 */
export const CLOTH_JOINTS: readonly JointSpec[] = [
  { name: 'cape_0', parent: 'spine_3', q: DOWN, at: [0, 0.2415, -0.1775] },
  { name: 'cape_1', parent: 'cape_0', q: DOWN, along: 0.2 },
  { name: 'cape_2', parent: 'cape_1', q: DOWN, along: 0.24 },
  { name: 'cape_3', parent: 'cape_2', q: DOWN, along: 0.26 },
  { name: 'tail_0', parent: 'pelvis', q: DOWN, at: [0, 0.0144, -0.1435] },
  { name: 'tail_1', parent: 'tail_0', q: DOWN, along: 0.18 },
  { name: 'tail_2', parent: 'tail_1', q: DOWN, along: 0.2 },
];

/**
 * mpfb2's finger bones (tools/blender/characters/mpfb_fingers.json, with the arms
 * posed into the game's a-pose): three joints per finger, open hand at rest. local
 * +z is mpfb's curl axis, so a positive z rotation closes a finger (playerRig.ts).
 */
export const FINGER_JOINTS: readonly JointSpec[] = [
  { name: 'finger_thumb_0_l', parent: 'hand_l', q: [0.5257, -0.3086, 0.7775, -0.1547], at: [0.0178, -0.0295, 0.0366] },
  { name: 'finger_thumb_1_l', parent: 'finger_thumb_0_l', q: [0.647, -0.3203, 0.6497, -0.2382], at: [-0.0139, -0.0195, 0.0248] },
  { name: 'finger_thumb_2_l', parent: 'finger_thumb_1_l', q: [0.6176, -0.3873, 0.5893, -0.3483], at: [-0.0021, -0.0298, 0.0281] },
  { name: 'finger_index_0_l', parent: 'hand_l', q: [0.8143, -0.5206, 0.2539, -0.0373], at: [0.0606, -0.087, 0.0559] },
  { name: 'finger_index_1_l', parent: 'finger_index_0_l', q: [0.7529, -0.6058, 0.251, -0.0552], at: [0.0096, -0.0255, 0.0107] },
  { name: 'finger_index_2_l', parent: 'finger_index_1_l', q: [0.7112, -0.6498, 0.2612, -0.0615], at: [0.0036, -0.0247, 0.008] },
  { name: 'finger_middle_0_l', parent: 'hand_l', q: [0.808, -0.5775, 0.1029, -0.0544], at: [0.0682, -0.0896, 0.0273] },
  { name: 'finger_middle_1_l', parent: 'finger_middle_0_l', q: [0.7759, -0.6173, 0.1268, -0.0308], at: [0.0118, -0.0361, 0.0037] },
  { name: 'finger_middle_2_l', parent: 'finger_middle_1_l', q: [0.7342, -0.6671, 0.1195, -0.0412], at: [0.0064, -0.03, 0.0047] },
  { name: 'finger_ring_0_l', parent: 'hand_l', q: [0.8162, -0.5727, 0.0119, -0.0754], at: [0.0677, -0.0887, 0.0045] },
  { name: 'finger_ring_1_l', parent: 'finger_ring_0_l', q: [0.7814, -0.6208, 0.0442, -0.0458], at: [0.0115, -0.0316, -0.0024] },
  { name: 'finger_ring_2_l', parent: 'finger_ring_1_l', q: [0.741, -0.6688, 0.0154, -0.0585], at: [0.0063, -0.0275, 0.0002] },
  { name: 'finger_pinky_0_l', parent: 'hand_l', q: [0.7918, -0.6032, -0.0936, -0.0218], at: [0.0598, -0.088, -0.0181] },
  { name: 'finger_pinky_1_l', parent: 'finger_pinky_0_l', q: [0.7416, -0.6659, -0.0811, 0.003], at: [0.0062, -0.0231, -0.0043] },
  { name: 'finger_pinky_2_l', parent: 'finger_pinky_1_l', q: [0.7446, -0.6613, -0.0914, -0.0008], at: [0.0018, -0.0175, -0.0021] },
  { name: 'finger_thumb_0_r', parent: 'hand_r', q: [0.7775, -0.1547, 0.5257, -0.3086], at: [-0.0178, -0.0295, 0.0366] },
  { name: 'finger_thumb_1_r', parent: 'finger_thumb_0_r', q: [0.6497, -0.2382, 0.647, -0.3203], at: [0.0139, -0.0195, 0.0248] },
  { name: 'finger_thumb_2_r', parent: 'finger_thumb_1_r', q: [0.5893, -0.3483, 0.6176, -0.3873], at: [0.0021, -0.0298, 0.0281] },
  { name: 'finger_index_0_r', parent: 'hand_r', q: [-0.2539, 0.0373, -0.8143, 0.5206], at: [-0.0606, -0.087, 0.0559] },
  { name: 'finger_index_1_r', parent: 'finger_index_0_r', q: [-0.251, 0.0552, -0.7529, 0.6058], at: [-0.0096, -0.0255, 0.0107] },
  { name: 'finger_index_2_r', parent: 'finger_index_1_r', q: [-0.2612, 0.0615, -0.7112, 0.6498], at: [-0.0036, -0.0247, 0.008] },
  { name: 'finger_middle_0_r', parent: 'hand_r', q: [-0.1029, 0.0544, -0.808, 0.5775], at: [-0.0682, -0.0896, 0.0273] },
  { name: 'finger_middle_1_r', parent: 'finger_middle_0_r', q: [-0.1268, 0.0308, -0.7759, 0.6173], at: [-0.0118, -0.0361, 0.0037] },
  { name: 'finger_middle_2_r', parent: 'finger_middle_1_r', q: [-0.1195, 0.0412, -0.7342, 0.6671], at: [-0.0064, -0.03, 0.0047] },
  { name: 'finger_ring_0_r', parent: 'hand_r', q: [-0.0119, 0.0754, -0.8162, 0.5727], at: [-0.0677, -0.0887, 0.0045] },
  { name: 'finger_ring_1_r', parent: 'finger_ring_0_r', q: [-0.0442, 0.0458, -0.7814, 0.6208], at: [-0.0115, -0.0316, -0.0024] },
  { name: 'finger_ring_2_r', parent: 'finger_ring_1_r', q: [-0.0154, 0.0585, -0.741, 0.6688], at: [-0.0063, -0.0275, 0.0002] },
  { name: 'finger_pinky_0_r', parent: 'hand_r', q: [0.0936, 0.0218, -0.7918, 0.6032], at: [-0.0598, -0.088, -0.0181] },
  { name: 'finger_pinky_1_r', parent: 'finger_pinky_0_r', q: [0.0811, -0.003, -0.7416, 0.6659], at: [-0.0062, -0.0231, -0.0043] },
  { name: 'finger_pinky_2_r', parent: 'finger_pinky_1_r', q: [0.0914, 0.0008, -0.7446, 0.6613], at: [-0.0018, -0.0175, -0.0021] },
];

export const ALL_JOINTS: readonly JointSpec[] = [...BODY_JOINTS, ...FINGER_JOINTS, ...CLOTH_JOINTS];

/** right-side chains are mirrored: they point at their child along -X */
export function boneAxisSign(name: string): 1 | -1 {
  return name.endsWith('_r') ? -1 : 1;
}

export interface BindJoint {
  name: string;
  parent: string | null;
  position: Vector3;
  quaternion: Quaternion;
}

/** model-space bind transforms of every joint, in table order */
export function bindPose(joints: readonly JointSpec[] = ALL_JOINTS): BindJoint[] {
  const out: BindJoint[] = [];
  const byName = new Map<string, BindJoint>();
  for (const spec of joints) {
    const q = new Quaternion(spec.q[0], spec.q[1], spec.q[2], spec.q[3]).normalize();
    let p: Vector3;
    if (!spec.parent) {
      p = new Vector3(...(spec.at ?? [0, 0, 0]));
    } else {
      const parent = byName.get(spec.parent);
      if (!parent) throw new Error(`joint ${spec.name} comes before its parent ${spec.parent}`);
      if (spec.at) {
        p = parent.position.clone().add(new Vector3(...spec.at));
      } else {
        const dir = new Vector3(boneAxisSign(spec.parent), 0, 0).applyQuaternion(parent.quaternion);
        p = parent.position.clone().addScaledVector(dir, spec.along ?? 0);
      }
    }
    const joint = { name: spec.name, parent: spec.parent, position: p, quaternion: q };
    out.push(joint);
    byName.set(spec.name, joint);
  }
  return out;
}

/**
 * builds the bone hierarchy in its bind pose. bone names get a numbered
 * suffix like other humanoid exports (the rig code matches on the prefix).
 */
export function buildSkeleton(joints: readonly JointSpec[] = BODY_JOINTS): Map<string, Bone> {
  const bones = new Map<string, Bone>();
  const bind = bindPose(joints);
  const byName = new Map(bind.map((j) => [j.name, j]));
  for (const [index, joint] of bind.entries()) {
    const bone = new Bone();
    bone.name = `${joint.name}_${index}`;
    if (joint.parent) {
      const parent = byName.get(joint.parent)!;
      const parentInv = parent.quaternion.clone().invert();
      bone.position.copy(joint.position.clone().sub(parent.position).applyQuaternion(parentInv));
      bone.quaternion.copy(parentInv.multiply(joint.quaternion));
      bones.get(joint.parent)!.add(bone);
    } else {
      bone.position.copy(joint.position);
      bone.quaternion.copy(joint.quaternion);
    }
    bones.set(joint.name, bone);
  }
  return bones;
}

/** the plain joint name of a (possibly suffixed) bone name */
export function jointName(boneName: string): string {
  return boneName.replace(/_\d+$/, '');
}
