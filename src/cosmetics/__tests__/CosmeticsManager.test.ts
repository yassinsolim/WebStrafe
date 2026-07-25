import {
  AnimationClip,
  Bone,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  MeshStandardMaterial,
  Quaternion,
  QuaternionKeyframeTrack,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';
import {
  CosmeticsManager,
  INTEGRATED_KNIFE_BASE_POSITION,
  taperIntegratedKnifeSleeves,
} from '../CosmeticsManager';

describe('CosmeticsManager knife presentation composition', () => {
  it('preserves inspect motion through animation updates and clears it on reset', () => {
    const root = new Group();
    const manager = new CosmeticsManager(root);
    const knifeRoot = root.getObjectByName('ViewmodelKnifeRoot');
    if (!knifeRoot) {
      throw new Error('Expected the knife presentation root');
    }

    manager.setInspectAlpha(0.5);
    const inspectPosition = knifeRoot.position.clone();
    const inspectRotation = knifeRoot.rotation.clone();
    manager.update(1 / 60);

    expect(knifeRoot.position.toArray()).toEqual(inspectPosition.toArray());
    expect(knifeRoot.rotation.toArray()).toEqual(inspectRotation.toArray());

    manager.resetKnifePresentation();
    expect(knifeRoot.position.toArray()).toEqual([0.11, -0.02, -0.16]);
    expect(knifeRoot.rotation.x).toBeCloseTo(0.06);
    expect(knifeRoot.rotation.y).toBeCloseTo(Math.PI);
    expect(knifeRoot.rotation.z).toBeCloseTo(0.02);
  });

  it('emits one sound event per started animation, including a queued attack', () => {
    const manager = new CosmeticsManager(new Group());
    const internal = manager as unknown as {
      setupKnifeAnimations(
        root: Group,
        clips: AnimationClip[],
        entry: unknown,
      ): void;
    };
    internal.setupKnifeAnimations(
      new Group(),
      [new AnimationClip('all', 1, [])],
      {
        animationBehavior: {
          sourceClip: 'all',
          idleLoopRange: { startSec: 0, endSec: 0.2 },
          mouse1Ranges: [{ startSec: 0.2, endSec: 0.5 }],
          mouse2Ranges: [{ startSec: 0.5, endSec: 0.8 }],
        },
      },
    );

    manager.triggerAttackPrimary();
    manager.triggerAttackSecondary();
    expect(manager.consumeStartedAttack()).toBe('primary');
    expect(manager.consumeStartedAttack()).toBeNull();

    manager.update(0.31);
    expect(manager.consumeStartedAttack()).toBe('secondary');
    expect(manager.consumeStartedAttack()).toBeNull();
  });

  it('blends an authored raised-hand frame with a blade-only reverse grip', () => {
    const root = new Group();
    const manager = new CosmeticsManager(root);
    const knifeRoot = root.getObjectByName('ViewmodelKnifeRoot');
    if (!knifeRoot) {
      throw new Error('Expected the knife presentation root');
    }
    const internal = manager as unknown as {
      usingIntegratedHands: boolean;
      knifeBasePosition: { set(x: number, y: number, z: number): void };
      knifeBaseRotation: { set(x: number, y: number, z: number): void };
      setupKnifeAnimations(
        root: Group,
        clips: AnimationClip[],
        entry: unknown,
      ): void;
    };
    internal.usingIntegratedHands = true;
    internal.knifeBasePosition.set(...INTEGRATED_KNIFE_BASE_POSITION);
    internal.knifeBaseRotation.set(0, Math.PI, 0);
    const knifeModel = new Group();
    const blade = new Group();
    blade.name = 'knife';
    knifeModel.add(blade);
    const raised = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.45);
    internal.setupKnifeAnimations(
      knifeModel,
      [new AnimationClip('all', 4, [new QuaternionKeyframeTrack(
        'knife.quaternion',
        [0, 2.75],
        [0, 0, 0, 1, raised.x, raised.y, raised.z, raised.w],
      )])],
      {
        animationBehavior: {
          sourceClip: 'all',
          idleLoopRange: { startSec: 0, endSec: 1 },
          mouse1Ranges: [{ startSec: 1, endSec: 2 }],
          mouse2Ranges: [{ startSec: 2.5, endSec: 3.5 }],
        },
      },
    );
    manager.update(0);
    const idleBlade = blade.quaternion.clone();

    manager.setBackstabReady(true);
    manager.update(1);

    expect(knifeRoot.position.x).toBeCloseTo(-0.065, 3);
    expect(knifeRoot.position.y).toBeCloseTo(0.04, 3);
    expect(knifeRoot.rotation.z).toBeCloseTo(0);
    expect(knifeRoot.scale.x).toBeGreaterThan(0.55);
    expect(blade.quaternion.angleTo(idleBlade)).toBeGreaterThan(1.5);
  });

  it('tapers upper-arm sleeves without moving wrist-owned geometry', () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([
      1, 0, 0,
      11, 0, 0,
      0, 1, 0,
      2, 0, 0,
      3, 0, 0,
      2, 1, 0,
    ], 3));
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute([
      0, 0, 0, 0,
      2, 0, 0, 0,
      4, 0, 0, 0,
      4, 0, 0, 0,
      4, 0, 0, 0,
      4, 0, 0, 0,
    ], 4));
    geometry.setAttribute('skinWeight', new Float32BufferAttribute([
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0,
    ], 4));
    geometry.setIndex([0, 1, 2, 3, 4, 5]);

    const leftUpperArm = new Bone();
    leftUpperArm.name = 'L_arm_01';
    const leftElbow = new Bone();
    leftElbow.name = 'L_elbow_02';
    leftElbow.position.set(0, 2, 0);
    leftUpperArm.add(leftElbow);
    const rightUpperArm = new Bone();
    rightUpperArm.name = 'R_arm_023';
    rightUpperArm.position.set(10, 0, 0);
    const rightElbow = new Bone();
    rightElbow.name = 'R_elbow_024';
    rightElbow.position.set(0, 2, 0);
    rightUpperArm.add(rightElbow);
    const wrist = new Bone();
    wrist.name = 'L_wrist_03';
    const arms = new SkinnedMesh(
      geometry,
      new MeshStandardMaterial({ name: 'arms' }),
    );
    arms.add(leftUpperArm, rightUpperArm, wrist);
    arms.bind(new Skeleton([
      leftUpperArm,
      leftElbow,
      rightUpperArm,
      rightElbow,
      wrist,
    ]));
    const root = new Group();
    root.add(arms);

    expect(taperIntegratedKnifeSleeves(root)).toBe(2);
    const taperedPositions = arms.geometry.getAttribute('position');
    expect(taperedPositions.getX(0)).toBeCloseTo(0.48);
    expect(taperedPositions.getX(1)).toBeCloseTo(10.48);
    expect(taperedPositions.getX(2)).toBe(0);
    expect(taperedPositions.getY(2)).toBe(1);
    expect(Array.from(arms.geometry.getIndex()?.array ?? []))
      .toEqual([0, 1, 2, 3, 4, 5]);
  });
});
