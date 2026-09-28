import { describe, expect, it } from 'vitest';
import { Bone, Box3, Mesh, Quaternion, Vector3 } from 'three';
import { createPlayerModel } from '../ProceduralPlayer';
import { applyKnifeIdlePose, attachKnifeModel, buildArmRig } from '../playerRig';
import { RemotePlayersRenderer } from '../RemotePlayersRenderer';

describe('procedural player models', () => {
  for (const model of ['terrorist', 'counterterrorist'] as const) {
    it(`${model}: builds a rig the existing pose code can drive`, () => {
      const root = createPlayerModel(model);
      const rig = buildArmRig(root);
      expect(rig).not.toBeNull();
      for (const bone of [rig!.rightUpper, rig!.rightLower, rig!.rightHand, rig!.rightWeaponHand, rig!.leftUpper, rig!.leftLower, rig!.spineMid, rig!.spineUpper, rig!.neck, rig!.head]) {
        expect(bone).toBeInstanceOf(Bone);
      }
      // rig picked the anatomical hand, not the weapon helper
      expect(rig!.rightHand.name).toMatch(/^hand_r_/);
      expect(rig!.rightWeaponHand.name).toMatch(/^weapon_hand_r_/);

      root.updateMatrixWorld(true);
      const box = new Box3().setFromObject(root);
      const size = box.getSize(new Vector3());
      expect(box.min.y).toBeGreaterThan(-0.05);
      expect(size.y).toBeGreaterThan(1.6);
      expect(size.y).toBeLessThan(1.95);
      let meshes = 0;
      root.traverse((o) => { if (o instanceof Mesh) meshes += 1; });
      expect(meshes).toBeGreaterThan(20);
    });
  }

  it('keeps the joint-axis convention: children sit along +x, mirrored -x on the right', () => {
    const root = createPlayerModel('terrorist');
    root.updateMatrixWorld(true);
    const bones: Bone[] = [];
    root.traverse((o) => { if (o instanceof Bone) bones.push(o); });
    const chains = ['arm_upper_l', 'arm_lower_l', 'arm_upper_r', 'arm_lower_r', 'leg_upper_l', 'leg_lower_r', 'spine_2', 'neck_0'];
    for (const prefix of chains) {
      const bone = bones.find((b) => b.name.startsWith(`${prefix}_`))!;
      const child = bone.children.find((c): c is Bone => c instanceof Bone)!;
      const dir = child.getWorldPosition(new Vector3()).sub(bone.getWorldPosition(new Vector3())).normalize();
      const sign = prefix.endsWith('_r') ? -1 : 1;
      const axis = new Vector3(sign, 0, 0).applyQuaternion(bone.getWorldQuaternion(new Quaternion()));
      expect(dir.dot(axis), prefix).toBeGreaterThan(0.999);
    }
  });

  it('bind pose is an A-pose facing +z (hands low and out, toes forward)', () => {
    const root = createPlayerModel('counterterrorist');
    root.updateMatrixWorld(true);
    const at = (prefix: string) => {
      let found: Bone | null = null;
      root.traverse((o) => { if (!found && o instanceof Bone && o.name.startsWith(`${prefix}_`)) found = o; });
      return (found as unknown as Bone).getWorldPosition(new Vector3());
    };
    expect(at('hand_l').x).toBeGreaterThan(0.3);
    expect(at('hand_r').x).toBeLessThan(-0.3);
    expect(at('hand_l').y).toBeLessThan(at('arm_upper_l').y);
    expect(at('ball_l').z).toBeGreaterThan(at('ankle_l').z);
  });

  it('menu stance and knife attach still work', () => {
    const root = createPlayerModel('terrorist');
    const rig = buildArmRig(root)!;
    const before = rig.rightUpper.quaternion.clone();
    attachKnifeModel(rig.rightWeaponHand, null);
    applyKnifeIdlePose(rig);
    expect(rig.rightUpper.quaternion.angleTo(before)).toBeGreaterThan(0.1);
  });

  it('remote renderer uses the procedural models without fetching assets', async () => {
    const renderer = new RemotePlayersRenderer();
    await renderer.load();
    renderer.applySnapshot([
      { id: 'x', name: 'x', model: 'counterterrorist', position: [0, 0, 0], velocity: [0, 0, 0], yaw: 0, pitch: 0 },
    ], null);
    const actor = renderer.root.getObjectByName('RemotePlayer:x')!;
    let proceduralRoot = false;
    actor.traverse((o) => { if (o.userData.proceduralPlayer === 'counterterrorist') proceduralRoot = true; });
    expect(proceduralRoot).toBe(true);
  });
});
