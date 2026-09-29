import {
  Bone,
  BoxGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import type { PlayerModel } from '../network/types';
import { boneAxisSign, buildSkeleton } from '../characters/skeleton';

/**
 * Original low-poly player models, generated in code (no external assets).
 *
 * The skeleton follows the humanoid naming and joint-axis convention the rest
 * of the game already poses (playerRig.ts): each bone points at its child
 * along local +X (-X on the mirrored right side), the model faces +Z with its
 * left side on +X, and the bind
 * pose is an A-pose. That keeps the knife stance, the menu hero pose and the
 * remote swing animations working unchanged. Segment lengths, proportions and
 * all geometry are our own; armour parts are parented straight to bones, like
 * a rigid action figure, so there are no skin weights to author.
 */

interface Palette {
  cloth: number;
  clothDark: number;
  armour: number;
  skin: number;
  glove: number;
  boot: number;
  accent: number;
  headgear: 'helmet' | 'balaclava';
}

const PALETTES: Record<PlayerModel, Palette> = {
  // desert irregular: tan jacket, olive trousers, orange armband, balaclava + goggles
  terrorist: {
    cloth: 0x9a8062,
    clothDark: 0x4d5238,
    armour: 0x5c4a36,
    skin: 0xc49a7c,
    glove: 0x2a2622,
    boot: 0x3b2f24,
    accent: 0xff6a2b,
    headgear: 'balaclava',
  },
  // tactical unit: navy fatigues, black plate carrier, helmet + visor
  counterterrorist: {
    cloth: 0x2d3a4f,
    clothDark: 0x1f2633,
    armour: 0x16191e,
    skin: 0xb88c6e,
    glove: 0x121417,
    boot: 0x17191c,
    accent: 0x4fa3ff,
    headgear: 'helmet',
  },
};

export const PLAYER_MODEL_HEIGHT = 1.78;
export const PROCEDURAL_PLAYER_MARKER = 'ProceduralPlayer';

/** Builds a fresh, rigged player model for `model` (T or CT). */
export function createPlayerModel(model: PlayerModel): Group {
  const palette = PALETTES[model];
  const root = new Group();
  root.name = `${PROCEDURAL_PLAYER_MARKER}:${model}`;

  const bones = buildSkeleton();
  root.add(bones.get('pelvis')!);
  root.updateMatrixWorld(true);

  const mat = materials(palette);
  const part = (boneName: string, geometry: BufferGeometry, material: Material, worldPos: Vector3, worldQuat?: Quaternion) => {
    const bone = bones.get(boneName)!;
    const mesh = new Mesh(geometry, material);
    mesh.position.copy(worldPos);
    if (worldQuat) mesh.quaternion.copy(worldQuat);
    root.add(mesh);
    mesh.updateMatrixWorld(true);
    bone.attach(mesh);
    return mesh;
  };
  const pos = (name: string) => bones.get(name)!.getWorldPosition(new Vector3());
  const limb = (from: string, to: string, radius: number, material: Material, extend = 0) => {
    const a = pos(from);
    const b = to === '' ? a.clone().add(axisX(bones.get(from)!).multiplyScalar(extend)) : pos(to);
    const dir = b.clone().sub(a);
    const len = Math.max(0.01, dir.length() - radius * 0.6);
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.clone().normalize());
    return part(from, new CapsuleGeometry(radius, len, 4, 10), material, a.clone().lerp(b, 0.5), q);
  };

  // legs and boots
  for (const side of ['l', 'r'] as const) {
    limb(`leg_upper_${side}`, `leg_lower_${side}`, 0.075, mat.clothDark);
    limb(`leg_lower_${side}`, `ankle_${side}`, 0.058, mat.clothDark);
    const ankle = pos(`ankle_${side}`);
    const ball = pos(`ball_${side}`);
    const bootCenter = ankle.clone().lerp(ball, 0.45);
    bootCenter.y = 0.05;
    part(`ankle_${side}`, new BoxGeometry(0.1, 0.1, 0.25), mat.boot, bootCenter);
    // knee pad
    const knee = pos(`leg_lower_${side}`).add(new Vector3(0, 0, 0.055));
    part(`leg_lower_${side}`, new BoxGeometry(0.1, 0.1, 0.035), mat.armour, knee);
  }

  // hips, belt, torso and plate carrier
  const pelvis = pos('pelvis');
  part('pelvis', new BoxGeometry(0.3, 0.16, 0.2), mat.clothDark, pelvis.clone().add(new Vector3(0, -0.02, 0.01)));
  part('pelvis', new BoxGeometry(0.32, 0.045, 0.22), mat.armour, pelvis.clone().add(new Vector3(0, 0.06, 0.012)));
  const s1 = pos('spine_1');
  part('spine_1', new BoxGeometry(0.29, 0.14, 0.19), mat.cloth, s1.clone().add(new Vector3(0, 0.04, 0.012)));
  const s2 = pos('spine_2');
  part('spine_2', new BoxGeometry(0.34, 0.2, 0.22), mat.cloth, s2.clone().add(new Vector3(0, 0.07, 0.01)));
  const s3 = pos('spine_3');
  part('spine_3', new BoxGeometry(0.4, 0.16, 0.23), mat.cloth, s3.clone().add(new Vector3(0, 0.05, 0.015)));
  // vest front and back plates plus pouches
  part('spine_2', new BoxGeometry(0.3, 0.3, 0.05), mat.armour, s2.clone().add(new Vector3(0, 0.08, 0.13)));
  part('spine_2', new BoxGeometry(0.3, 0.3, 0.04), mat.armour, s2.clone().add(new Vector3(0, 0.08, -0.115)));
  for (const x of [-0.09, 0, 0.09]) {
    part('spine_2', new BoxGeometry(0.075, 0.085, 0.045), mat.armourLight, s2.clone().add(new Vector3(x, -0.02, 0.17)));
  }

  // neck, head and headgear
  limb('neck_0', 'head_0', 0.058, palette.headgear === 'balaclava' ? mat.clothDark : mat.skin);
  // collar hides where the neck meets the vest
  part('spine_3', new CylinderGeometry(0.085, 0.1, 0.06, 14), mat.cloth, pos('neck_0').add(new Vector3(0, 0.01, 0.005)));
  const head = pos('head_0');
  const headCenter = head.clone().add(new Vector3(0, 0.055, 0.02));
  const skull = part('head_0', new SphereGeometry(0.105, 16, 12), palette.headgear === 'balaclava' ? mat.clothDark : mat.skin, headCenter);
  skull.scale.set(0.9, 1.05, 1);
  if (palette.headgear === 'helmet') {
    const helmet = part('head_0', new SphereGeometry(0.122, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), mat.armour, headCenter.clone().add(new Vector3(0, 0.025, -0.005)));
    helmet.scale.set(0.95, 0.95, 1.02);
    part('head_0', new BoxGeometry(0.19, 0.055, 0.03), mat.visor, headCenter.clone().add(new Vector3(0, 0.015, 0.1)));
    part('head_0', new BoxGeometry(0.03, 0.03, 0.03), mat.accent, headCenter.clone().add(new Vector3(0.09, 0.07, 0.04)));
  } else {
    // goggles band and lenses over the balaclava, beanie on top
    part('head_0', new BoxGeometry(0.2, 0.04, 0.03), mat.armour, headCenter.clone().add(new Vector3(0, 0.02, 0.095)));
    for (const x of [-0.042, 0.042]) {
      part('head_0', new CylinderGeometry(0.026, 0.026, 0.02, 12).rotateX(Math.PI / 2), mat.visor, headCenter.clone().add(new Vector3(x, 0.02, 0.108)));
    }
    const beanie = part('head_0', new SphereGeometry(0.112, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.45), mat.cloth, headCenter.clone().add(new Vector3(0, 0.03, 0)));
    beanie.scale.set(0.92, 0.95, 1);
  }

  // shoulders, arms, gloves
  for (const side of ['l', 'r'] as const) {
    const shoulder = pos(`arm_upper_${side}`);
    part(`clavicle_${side}`, new SphereGeometry(0.07, 10, 8), mat.cloth, shoulder);
    limb(`arm_upper_${side}`, `arm_lower_${side}`, 0.056, mat.cloth);
    limb(`arm_lower_${side}`, `hand_${side}`, 0.047, mat.cloth);
    const hand = bones.get(`hand_${side}`)!;
    const handPos = pos(`hand_${side}`).add(axisX(hand).multiplyScalar(0.045));
    const handQuat = hand.getWorldQuaternion(new Quaternion());
    part(`hand_${side}`, new BoxGeometry(0.095, 0.035, 0.08), mat.glove, handPos, handQuat);
    // armband on the upper arm
    const band = pos(`arm_upper_${side}`).lerp(pos(`arm_lower_${side}`), 0.35);
    const bandQuat = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), pos(`arm_lower_${side}`).sub(pos(`arm_upper_${side}`)).normalize());
    part(`arm_upper_${side}`, new CylinderGeometry(0.06, 0.06, 0.04, 12), mat.accent, band, bandQuat);
  }

  root.traverse((child) => {
    if (child instanceof Mesh) {
      child.castShadow = false;
      child.receiveShadow = false;
    }
  });
  root.userData.proceduralPlayer = model;
  return root;
}

function axisX(bone: Bone): Vector3 {
  const name = bone.name.replace(/_\d+$/, '');
  return new Vector3(boneAxisSign(name), 0, 0).applyQuaternion(bone.getWorldQuaternion(new Quaternion()));
}

function materials(p: Palette) {
  const std = (color: number, roughness = 0.8, metalness = 0.05) =>
    new MeshStandardMaterial({ color, roughness, metalness });
  return {
    cloth: std(p.cloth),
    clothDark: std(p.clothDark),
    armour: std(p.armour, 0.6, 0.15),
    armourLight: std(lighten(p.armour, 0.18), 0.7, 0.1),
    skin: std(p.skin, 0.65, 0),
    glove: std(p.glove, 0.7, 0.05),
    boot: std(p.boot, 0.75, 0.05),
    accent: std(p.accent, 0.5, 0.1),
    visor: std(0x0d1117, 0.15, 0.6),
  };
}

function lighten(color: number, amount: number): number {
  const r = Math.min(255, ((color >> 16) & 0xff) + 255 * amount);
  const g = Math.min(255, ((color >> 8) & 0xff) + 255 * amount);
  const b = Math.min(255, (color & 0xff) + 255 * amount);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}
