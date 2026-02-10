import {
  Bone,
  Box3,
  BoxGeometry,
  Euler,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AttackKind, MultiplayerSnapshotPlayer, PlayerModel } from '../network/types';

interface ArmRig {
  rightUpper: Bone;
  rightLower: Bone;
  rightHand: Bone;
  leftUpper: Bone | null;
  leftLower: Bone | null;
  leftHand: Bone | null;
  rightUpperBase: Quaternion;
  rightLowerBase: Quaternion;
  rightHandBase: Quaternion;
  leftUpperBase: Quaternion | null;
  leftLowerBase: Quaternion | null;
  leftHandBase: Quaternion | null;
}

interface RemotePlayerActor {
  id: string;
  model: PlayerModel;
  group: Group;
  targetPosition: Vector3;
  displayPosition: Vector3;
  targetYaw: number;
  displayYaw: number;
  rig: ArmRig | null;
  swingTimer: number;
  swingKind: AttackKind;
  idlePhase: number;
}

const MODEL_PATHS: Record<PlayerModel, string> = {
  terrorist: '/playermodels/terrorist.glb',
  counterterrorist: '/playermodels/counterterrorist.glb',
};

const MODEL_YAW_OFFSET = Math.PI;
const SWING_DURATION_SEC = 0.28;
const RIGHT_HAND_BASE_LOCAL = new Vector3(0.2, 1.28, 0.34);
const LEFT_HAND_BASE_LOCAL = new Vector3(-0.17, 1.24, 0.23);

const gltfLoader = new GLTFLoader();

export class RemotePlayersRenderer {
  public readonly root = new Group();

  private readonly templateRoots = new Map<PlayerModel, Object3D>();
  private readonly actors = new Map<string, RemotePlayerActor>();
  private loaded = false;

  private readonly tempOffsetQuat = new Quaternion();
  private readonly tempEuler = new Euler(0, 0, 0, 'XYZ');
  private readonly tempVecA = new Vector3();
  private readonly tempVecB = new Vector3();
  private readonly tempVecC = new Vector3();
  private readonly tempQuatA = new Quaternion();
  private readonly tempQuatB = new Quaternion();
  private readonly tempQuatC = new Quaternion();

  constructor() {
    this.root.name = 'RemotePlayersRoot';
  }

  public async load(): Promise<void> {
    const models = await Promise.all([
      this.loadTemplate('terrorist'),
      this.loadTemplate('counterterrorist'),
    ]);

    for (const [model, root] of models) {
      this.templateRoots.set(model, root);
    }

    this.loaded = true;
  }

  public update(dt: number): void {
    const smoothing = 1 - Math.exp(-dt * 14);
    const nowSec = performance.now() * 0.001;

    for (const actor of this.actors.values()) {
      actor.displayPosition.lerp(actor.targetPosition, smoothing);
      actor.group.position.copy(actor.displayPosition);

      actor.displayYaw = lerpAngle(actor.displayYaw, actor.targetYaw, smoothing);
      actor.group.rotation.set(0, actor.displayYaw + MODEL_YAW_OFFSET, 0);

      if (actor.swingTimer > 0) {
        actor.swingTimer = Math.max(0, actor.swingTimer - dt);
      }
      this.applyRigPose(actor, nowSec);
    }
  }

  public applySnapshot(players: MultiplayerSnapshotPlayer[], localId: string | null): void {
    const visibleIds = new Set<string>();

    for (const player of players) {
      if (localId && player.id === localId) {
        continue;
      }
      visibleIds.add(player.id);

      let actor = this.actors.get(player.id);
      if (!actor) {
        actor = this.createActor(player.id, player.model, player.position, player.yaw);
        this.actors.set(player.id, actor);
        this.root.add(actor.group);
      }

      if (actor.model !== player.model) {
        this.root.remove(actor.group);
        const replacement = this.createActor(player.id, player.model, player.position, player.yaw);
        this.actors.set(player.id, replacement);
        this.root.add(replacement.group);
        actor = replacement;
      }

      actor.targetPosition.set(player.position[0], player.position[1], player.position[2]);
      actor.targetYaw = player.yaw;
    }

    for (const [id, actor] of this.actors) {
      if (visibleIds.has(id)) {
        continue;
      }
      this.root.remove(actor.group);
      this.actors.delete(id);
    }
  }

  public triggerAttack(playerId: string, kind: AttackKind): void {
    const actor = this.actors.get(playerId);
    if (!actor) {
      return;
    }
    actor.swingKind = kind;
    actor.swingTimer = SWING_DURATION_SEC;
  }

  private createActor(
    id: string,
    model: PlayerModel,
    position: [number, number, number],
    yaw: number,
  ): RemotePlayerActor {
    const group = new Group();
    group.name = `RemotePlayer:${id}`;

    const { root, rig } = this.instantiateModel(model);
    group.add(root);

    const displayPosition = new Vector3(position[0], position[1], position[2]);
    group.position.copy(displayPosition);
    group.rotation.set(0, yaw + MODEL_YAW_OFFSET, 0);

    const actor: RemotePlayerActor = {
      id,
      model,
      group,
      targetPosition: displayPosition.clone(),
      displayPosition,
      targetYaw: yaw,
      displayYaw: yaw,
      rig,
      swingTimer: 0,
      swingKind: 'primary',
      idlePhase: hashToPhase(id),
    };

    this.applyRigPose(actor, performance.now() * 0.001);
    return actor;
  }

  private instantiateModel(model: PlayerModel): { root: Object3D; rig: ArmRig | null } {
    if (!this.loaded) {
      const fallback = this.makeFallbackPlaceholder(model);
      return { root: fallback, rig: null };
    }

    const template = this.templateRoots.get(model);
    if (!template) {
      const fallback = this.makeFallbackPlaceholder(model);
      return { root: fallback, rig: null };
    }

    const clone = cloneSkeleton(template);
    const rig = buildArmRig(clone);
    if (rig) {
      attachKnifeProxy(rig.rightHand);
    }

    return {
      root: clone,
      rig,
    };
  }

  private applyRigPose(actor: RemotePlayerActor, nowSec: number): void {
    const rig = actor.rig;
    if (!rig) {
      return;
    }

    rig.rightUpper.quaternion.copy(rig.rightUpperBase);
    rig.rightLower.quaternion.copy(rig.rightLowerBase);
    rig.rightHand.quaternion.copy(rig.rightHandBase);
    if (rig.leftUpper && rig.leftUpperBase) {
      rig.leftUpper.quaternion.copy(rig.leftUpperBase);
    }
    if (rig.leftLower && rig.leftLowerBase) {
      rig.leftLower.quaternion.copy(rig.leftLowerBase);
    }
    if (rig.leftHand && rig.leftHandBase) {
      rig.leftHand.quaternion.copy(rig.leftHandBase);
    }

    const idleWave = Math.sin(nowSec * 2.2 + actor.idlePhase) * 0.03;
    const idleBreath = Math.sin(nowSec * 1.4 + actor.idlePhase * 0.7) * 0.025;

    const swingAlpha = actor.swingTimer > 0 ? 1 - actor.swingTimer / SWING_DURATION_SEC : 0;
    const swingCurve = swingAlpha > 0 ? Math.sin(Math.PI * MathUtils.clamp(swingAlpha, 0, 1)) : 0;
    const swingDir = actor.swingKind === 'secondary' ? -1 : 1;

    this.tempVecA
      .copy(RIGHT_HAND_BASE_LOCAL)
      .add(new Vector3(idleWave * 0.4, idleBreath * 0.6, idleBreath * 0.8))
      .add(new Vector3(0.24 * swingCurve * swingDir, 0.11 * swingCurve, 0.22 * swingCurve));

    this.tempVecB
      .copy(LEFT_HAND_BASE_LOCAL)
      .add(new Vector3(-idleWave * 0.3, idleBreath * 0.45, idleBreath * 0.4));

    const rightTargetWorld = actor.group.localToWorld(this.tempVecA.clone());
    const leftTargetWorld = actor.group.localToWorld(this.tempVecB.clone());

    this.solveArmCcd(rig.rightUpper, rig.rightLower, rig.rightHand, rightTargetWorld);
    if (rig.leftUpper && rig.leftLower && rig.leftHand) {
      this.solveArmCcd(rig.leftUpper, rig.leftLower, rig.leftHand, leftTargetWorld);
    }

    this.applyHandGripOffset(
      rig.rightHand,
      rig.rightHandBase,
      0.45 + 0.36 * swingCurve * swingDir,
      -0.18 - 0.2 * swingCurve,
      0.26 + 0.72 * swingCurve,
    );
    if (rig.leftHand && rig.leftHandBase) {
      this.applyHandGripOffset(rig.leftHand, rig.leftHandBase, 0.28, 0.08, -0.32);
    }
  }

  private solveArmCcd(upper: Bone, lower: Bone, hand: Bone, targetWorld: Vector3): void {
    const chain = [lower, upper];

    for (let iter = 0; iter < 6; iter += 1) {
      for (const bone of chain) {
        bone.updateWorldMatrix(true, false);
        hand.updateWorldMatrix(true, false);

        bone.getWorldPosition(this.tempVecA);
        hand.getWorldPosition(this.tempVecB);

        const toEffector = this.tempVecB.sub(this.tempVecA);
        const toTarget = this.tempVecC.copy(targetWorld).sub(this.tempVecA);
        if (toEffector.lengthSq() < 1e-9 || toTarget.lengthSq() < 1e-9) {
          continue;
        }

        toEffector.normalize();
        toTarget.normalize();
        this.tempQuatA.setFromUnitVectors(toEffector, toTarget);

        bone.getWorldQuaternion(this.tempQuatB);
        if (bone.parent) {
          bone.parent.getWorldQuaternion(this.tempQuatC);
        } else {
          this.tempQuatC.identity();
        }

        const newWorld = this.tempQuatA.multiply(this.tempQuatB).normalize();
        const parentInv = this.tempQuatC.invert();
        bone.quaternion.copy(parentInv.multiply(newWorld)).normalize();
      }
    }
  }

  private applyHandGripOffset(bone: Bone, base: Quaternion, x: number, y: number, z: number): void {
    this.tempEuler.set(x, y, z, 'XYZ');
    this.tempOffsetQuat.setFromEuler(this.tempEuler);
    bone.quaternion.copy(base).multiply(this.tempOffsetQuat).normalize();
  }

  private async loadTemplate(model: PlayerModel): Promise<[PlayerModel, Object3D]> {
    const gltf = await gltfLoader.loadAsync(MODEL_PATHS[model]);
    const root = gltf.scene;
    root.name = `RemoteModelTemplate:${model}`;
    root.updateWorldMatrix(true, true);

    normalizeTemplateToPlayerHeight(root);

    root.traverse((child) => {
      if (!(child instanceof Mesh)) {
        return;
      }
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        material.depthWrite = true;
        material.depthTest = true;
        material.needsUpdate = true;
      }
      child.castShadow = false;
      child.receiveShadow = false;
      child.frustumCulled = false;
    });

    return [model, root];
  }

  private makeFallbackPlaceholder(model: PlayerModel): Object3D {
    const color = model === 'terrorist' ? 0x9d5c3a : 0x4a6e8a;
    const mesh = new Mesh(new BoxGeometry(0.45, 1.78, 0.28), new MeshStandardMaterial({ color }));
    const placeholder = new Group();
    mesh.position.y = 0.89;
    placeholder.add(mesh);
    return placeholder;
  }
}

function buildArmRig(root: Object3D): ArmRig | null {
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

  return {
    rightUpper,
    rightLower,
    rightHand,
    leftUpper,
    leftLower,
    leftHand,
    rightUpperBase: rightUpper.quaternion.clone(),
    rightLowerBase: rightLower.quaternion.clone(),
    rightHandBase: rightHand.quaternion.clone(),
    leftUpperBase: leftUpper?.quaternion.clone() ?? null,
    leftLowerBase: leftLower?.quaternion.clone() ?? null,
    leftHandBase: leftHand?.quaternion.clone() ?? null,
  };
}

function attachKnifeProxy(handBone: Bone): void {
  if (handBone.getObjectByName('RemoteKnifeProxy')) {
    return;
  }

  const knifeRoot = new Group();
  knifeRoot.name = 'RemoteKnifeProxy';

  const handle = new Mesh(
    new BoxGeometry(0.022, 0.1, 0.022),
    new MeshStandardMaterial({ color: 0x171717, roughness: 0.8, metalness: 0.2 }),
  );
  const blade = new Mesh(
    new BoxGeometry(0.012, 0.19, 0.03),
    new MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.25, metalness: 0.8 }),
  );

  handle.position.set(0, -0.04, 0);
  blade.position.set(0, 0.08, 0.002);
  knifeRoot.position.set(0.035, -0.02, -0.03);
  knifeRoot.rotation.set(1.65, 0.24, 0.1);

  knifeRoot.add(handle, blade);
  handBone.add(knifeRoot);
}

function normalizeTemplateToPlayerHeight(root: Object3D): void {
  const bounds = new Box3().setFromObject(root);
  if (bounds.isEmpty()) {
    return;
  }

  const size = bounds.getSize(new Vector3());
  const height = Math.max(0.0001, size.y);
  const scale = 1.78 / height;
  root.scale.setScalar(scale);
  root.updateWorldMatrix(true, true);

  const adjustedBounds = new Box3().setFromObject(root);
  root.position.y -= adjustedBounds.min.y;
}

function hashToPhase(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295 * Math.PI * 2;
}

function lerpAngle(current: number, target: number, alpha: number): number {
  const delta = MathUtils.euclideanModulo(target - current + Math.PI, Math.PI * 2) - Math.PI;
  return current + delta * alpha;
}
