import {
  Bone,
  BoxGeometry,
  CircleGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { describe, expect, it } from 'vitest';
import {
  addPlayerEyeDetails,
  applyKnifeIdlePose,
  attachKnifeModel,
  buildArmRig,
} from '../playerRig';

function playerHead(materialName: string): {
  root: Group;
  eyes: [Bone, Bone];
} {
  const root = new Group();
  root.add(new Mesh(
    new BoxGeometry(),
    new MeshStandardMaterial({ name: materialName }),
  ));
  const head = new Bone();
  head.name = 'head_0_08';
  const left = new Bone();
  left.name = 'eyeball_l_09';
  const right = new Bone();
  right.name = 'eyeball_r_010';
  head.add(left, right);
  root.add(head);
  return { root, eyes: [left, right] };
}

describe('addPlayerEyeDetails', () => {
  it('adds forward iris, pupil, and catchlight geometry exactly once', () => {
    const { root, eyes } = playerHead('tm_phoenix_v2_balaclava_varianta');
    expect(addPlayerEyeDetails(root)).toBe(2);
    expect(addPlayerEyeDetails(root)).toBe(2);

    for (const eye of eyes) {
      const detail = eye.children.find((child) => child.name.startsWith('PlayerEyeDetail:'));
      expect(detail?.children.map((child) => child.name)).toEqual([
        'PlayerEyeSclera',
        'PlayerEyeIris',
        'PlayerEyePupil',
        'PlayerEyeCatchlight',
      ]);
      const [sclera, iris, pupil, catchlight] = detail?.children as Mesh<
        CircleGeometry,
        MeshStandardMaterial
      >[];
      expect(sclera.material).toBeInstanceOf(MeshStandardMaterial);
      expect(iris.material).toBeInstanceOf(MeshStandardMaterial);
      expect(pupil.material).toBeInstanceOf(MeshStandardMaterial);
      expect(catchlight.material).toBeInstanceOf(MeshStandardMaterial);
      expect(sclera.geometry.parameters.radius).toBeCloseTo(0.012, 6);
      expect(iris.geometry.parameters.radius).toBeCloseTo(0.0105, 6);
      expect(pupil.geometry.parameters.radius).toBeCloseTo(0.0045, 6);
      expect(catchlight.geometry.parameters.radius).toBeCloseTo(0.0009, 6);
      expect(detail?.position.length()).toBeCloseTo(0.013, 6);
    }
  });

  it('does not place exposed pupils over the counter-terrorist lenses', () => {
    const { root, eyes } = playerHead('ctm_sas_lenses');
    expect(addPlayerEyeDetails(root)).toBe(0);
    expect(eyes.every((eye) => eye.children.length === 0)).toBe(true);
  });
});

describe('menu knife grip', () => {
  it('seats the handle toward the thumb-index channel instead of the knuckle line', () => {
    const root = new Group();
    const upper = new Bone();
    upper.name = 'arm_upper_r_01';
    const lower = new Bone();
    lower.name = 'arm_lower_r_02';
    const hand = new Bone();
    hand.name = 'hand_r_03';
    const weaponHand = new Bone();
    weaponHand.name = 'weapon_hand_r_04';
    upper.add(lower);
    lower.add(hand);
    hand.add(weaponHand);
    root.add(upper);
    const rig = buildArmRig(root);
    expect(rig).not.toBeNull();
    if (!rig) return;

    expect(rig.rightHand).toBe(hand);
    expect(rig.rightWeaponHand).toBe(weaponHand);
    expect(rig.rightWeaponHandBase.equals(weaponHand.quaternion)).toBe(true);
    attachKnifeModel(rig.rightWeaponHand, new Group());
    const knife = weaponHand.getObjectByName('RemoteKnifeModel');
    const gameplayRotationZ = knife?.rotation.z;
    applyKnifeIdlePose(rig);

    expect(knife?.position.toArray()).toEqual([-0.022, -0.009, 0.047]);
    expect(knife?.rotation.toArray().slice(0, 3)).toEqual([1.18, -0.58, 0.75]);
    expect(knife?.rotation.z).toBeGreaterThan((gameplayRotationZ ?? 0) + 1.2);
    expect(hand.quaternion.equals(rig.rightHandBase)).toBe(false);
    expect(knife?.position.x).toBeLessThan(0);
    expect(knife?.position.y).toBeLessThan(0);
  });
});
