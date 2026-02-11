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
  SRGBColorSpace,
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
const REMOTE_KNIFE_MODEL_PATH = '/viewmodels/knife/knife.glb';

const MODEL_YAW_OFFSET = Math.PI;
const SWING_DURATION_SEC = 0.28;

const gltfLoader = new GLTFLoader();

export class RemotePlayersRenderer {
  public readonly root = new Group();

  private readonly templateRoots = new Map<PlayerModel, Object3D>();
  private knifeTemplate: Object3D | null = null;
  private readonly actors = new Map<string, RemotePlayerActor>();
  private loaded = false;

  private readonly tempOffsetQuat = new Quaternion();
  private readonly tempEuler = new Euler(0, 0, 0, 'XYZ');

  constructor() {
    this.root.name = 'RemotePlayersRoot';
  }

  public async load(): Promise<void> {
    const [models, knifeTemplate] = await Promise.all([
      Promise.all([
      this.loadTemplate('terrorist'),
      this.loadTemplate('counterterrorist'),
      ]),
      this.loadKnifeTemplate(),
    ]);

    for (const [model, root] of models) {
      this.templateRoots.set(model, root);
    }
    this.knifeTemplate = knifeTemplate;

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

  public getPlayerModel(playerId: string): PlayerModel | null {
    return this.actors.get(playerId)?.model ?? null;
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
      attachKnifeModel(rig.rightHand, this.knifeTemplate);
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

    this.resetRigToBase(rig);

    const idleWave = Math.sin(nowSec * 1.55 + actor.idlePhase) * 0.02;
    const idleBreath = Math.sin(nowSec * 1.0 + actor.idlePhase * 0.5) * 0.016;

    const swingAlpha = actor.swingTimer > 0 ? 1 - actor.swingTimer / SWING_DURATION_SEC : 0;
    const swingCurve = swingAlpha > 0 ? Math.sin(Math.PI * MathUtils.clamp(swingAlpha, 0, 1)) : 0;
    const swingDir = actor.swingKind === 'secondary' ? -1 : 1;

    // Keep a compact combat silhouette without forcing leg/pelvis warping.
    this.applyOptionalBoneOffset(rig.spineMid, rig.spineMidBase, 0.055 + idleBreath * 0.14, 0, 0);
    this.applyOptionalBoneOffset(rig.spineUpper, rig.spineUpperBase, 0.1 + idleBreath * 0.2, idleWave * 0.04, 0);
    this.applyOptionalBoneOffset(rig.neck, rig.neckBase, -0.025, idleWave * 0.06, 0);
    this.applyOptionalBoneOffset(rig.head, rig.headBase, -0.04 + idleBreath * 0.1, idleWave * 0.08, 0);
    this.applyOptionalBoneOffset(rig.rightClavicle, rig.rightClavicleBase, 0.16, -0.24, 0.16);
    this.applyOptionalBoneOffset(rig.leftClavicle, rig.leftClavicleBase, 0.14, 0.2, -0.08);

    // Right knife arm: forward and bent.
    this.applyBoneOffset(
      rig.rightUpper,
      rig.rightUpperBase,
      -1.22 - 0.3 * swingCurve,
      -0.46 + 0.2 * swingCurve * swingDir,
      0.2 + 0.08 * swingCurve,
    );
    this.applyBoneOffset(
      rig.rightLower,
      rig.rightLowerBase,
      -1.22 - 0.36 * swingCurve,
      0.2 + 0.16 * swingCurve * swingDir,
      -0.06,
    );
    this.applyBoneOffset(
      rig.rightHand,
      rig.rightHandBase,
      0.02 + 0.12 * swingCurve,
      -0.94 - 0.16 * swingCurve,
      -0.1 + 0.24 * swingCurve * swingDir,
    );

    // Left support arm: guarded, not flared behind body.
    if (rig.leftUpper && rig.leftUpperBase) {
      this.applyBoneOffset(
        rig.leftUpper,
        rig.leftUpperBase,
        -0.86 + idleBreath * 0.1,
        0.2 - idleWave * 0.06,
        -0.14,
      );
    }
    if (rig.leftLower && rig.leftLowerBase) {
      this.applyBoneOffset(
        rig.leftLower,
        rig.leftLowerBase,
        -1.1 + idleBreath * 0.08,
        -0.2,
        0.04,
      );
    }
    if (rig.leftHand && rig.leftHandBase) {
      this.applyBoneOffset(
        rig.leftHand,
        rig.leftHandBase,
        0.04,
        0.1,
        -0.14,
      );
    }
  }

  private resetRigToBase(rig: ArmRig): void {
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
    if (rig.rightClavicle && rig.rightClavicleBase) {
      rig.rightClavicle.quaternion.copy(rig.rightClavicleBase);
    }
    if (rig.leftClavicle && rig.leftClavicleBase) {
      rig.leftClavicle.quaternion.copy(rig.leftClavicleBase);
    }
    if (rig.spineMid && rig.spineMidBase) {
      rig.spineMid.quaternion.copy(rig.spineMidBase);
    }
    if (rig.spineUpper && rig.spineUpperBase) {
      rig.spineUpper.quaternion.copy(rig.spineUpperBase);
    }
    if (rig.neck && rig.neckBase) {
      rig.neck.quaternion.copy(rig.neckBase);
    }
    if (rig.head && rig.headBase) {
      rig.head.quaternion.copy(rig.headBase);
    }
  }

  private applyBoneOffset(bone: Bone, base: Quaternion, x: number, y: number, z: number): void {
    this.tempEuler.set(x, y, z, 'XYZ');
    this.tempOffsetQuat.setFromEuler(this.tempEuler);
    bone.quaternion.copy(base).multiply(this.tempOffsetQuat).normalize();
  }

  private applyOptionalBoneOffset(
    bone: Bone | null,
    base: Quaternion | null,
    x: number,
    y: number,
    z: number,
  ): void {
    if (!bone || !base) {
      return;
    }
    this.applyBoneOffset(bone, base, x, y, z);
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

  private async loadKnifeTemplate(): Promise<Object3D | null> {
    try {
      const gltf = await gltfLoader.loadAsync(REMOTE_KNIFE_MODEL_PATH);
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

function attachKnifeModel(handBone: Bone, knifeTemplate: Object3D | null): void {
  if (handBone.getObjectByName('RemoteKnifeModel')) {
    return;
  }
  if (!knifeTemplate) {
    return;
  }

  const knife = knifeTemplate.clone(true);
  knife.name = 'RemoteKnifeModel';
  knife.position.set(0.013, -0.01, -0.02);
  knife.rotation.set(1.08, -0.72, -0.38);
  handBone.add(knife);
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

function normalizeKnifeTemplate(root: Object3D): void {
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
