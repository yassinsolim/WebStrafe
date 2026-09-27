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
import type { FireView } from '../network/MultiplayerTransport';
import { InterpolationBuffer } from '../netcode/InterpolationBuffer';
import { RemoteTimeline } from '../netcode/RemoteTimeline';
import {
  addPlayerEyeDetails,
  applyKnifeIdlePose,
  attachKnifeModel,
  buildArmRig,
  loadKnifeMesh,
  type ArmRig,
} from './playerRig';

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
  buffer: InterpolationBuffer;
  /** timeline key: entity id plus its authority clock */
  clockKey: string | null;
  /** source-clock time of the pose shown last frame, for lag compensation */
  renderedSourceT: number | null;
  /** visual-only offset that eases out a mispredicted extrapolation */
  correction: Vector3;
  lastMode: 'interp' | 'extrap' | 'hold' | null;
}

/** how fast a leftover extrapolation error fades, 1/s */
const CORRECTION_DECAY_RATE = 10;
/** errors bigger than this are resets, snap instead of gliding */
const MAX_CORRECTION_M = 3;

const MODEL_PATHS: Record<PlayerModel, string> = {
  terrorist: '/playermodels/terrorist.glb',
  counterterrorist: '/playermodels/counterterrorist.glb',
};

const MODEL_YAW_OFFSET = Math.PI;
const SWING_DURATION_SEC = 0.28;
/** only used for rows without timestamps (older servers/peers) */
export const REMOTE_POSITION_SMOOTHING_RATE = 14;

const gltfLoader = new GLTFLoader();

export class RemotePlayersRenderer {
  public readonly root = new Group();

  private readonly templateRoots = new Map<PlayerModel, Object3D>();
  private knifeTemplate: Object3D | null = null;
  private readonly actors = new Map<string, RemotePlayerActor>();
  private readonly timeline = new RemoteTimeline();
  private loaded = false;

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

  public update(dt: number, localNowMs = performance.now()): void {
    const smoothing = 1 - Math.exp(-dt * REMOTE_POSITION_SMOOTHING_RATE);
    const nowSec = localNowMs * 0.001;
    this.timeline.update(dt * 1000);

    for (const actor of this.actors.values()) {
      const renderT = actor.clockKey ? this.timeline.renderTime(actor.clockKey, localNowMs) : null;
      const sampled = renderT === null ? null : actor.buffer.sampleAt(renderT);
      if (sampled) {
        // coming back from extrapolation lands on the real path somewhere
        // else; keep showing where we were and bleed the gap out
        if (sampled.mode === 'interp' && actor.lastMode && actor.lastMode !== 'interp') {
          actor.correction.set(
            actor.displayPosition.x - sampled.position[0],
            actor.displayPosition.y - sampled.position[1],
            actor.displayPosition.z - sampled.position[2],
          );
          if (actor.correction.length() > MAX_CORRECTION_M) actor.correction.set(0, 0, 0);
        }
        actor.lastMode = sampled.mode;
        actor.correction.multiplyScalar(Math.exp(-dt * CORRECTION_DECAY_RATE));
        actor.displayPosition
          .set(sampled.position[0], sampled.position[1], sampled.position[2])
          .add(actor.correction);
        actor.displayYaw = sampled.yaw;
        actor.renderedSourceT = sampled.sourceT;
      } else {
        actor.displayPosition.lerp(actor.targetPosition, smoothing);
        actor.displayYaw = lerpAngle(actor.displayYaw, actor.targetYaw, smoothing);
        actor.renderedSourceT = null;
      }
      actor.group.position.copy(actor.displayPosition);
      actor.group.rotation.set(0, actor.displayYaw + MODEL_YAW_OFFSET, 0);

      if (actor.swingTimer > 0) {
        actor.swingTimer = Math.max(0, actor.swingTimer - dt);
      }
      this.applyRigPose(actor, nowSec);
    }
  }

  public applySnapshot(
    players: MultiplayerSnapshotPlayer[],
    localId: string | null,
    receivedAtMs = performance.now(),
  ): void {
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
      if (typeof player.t === 'number' && Number.isFinite(player.t)) {
        const clockKey = `${player.clock ?? 'server'}|${player.id}`;
        if (actor.clockKey !== clockKey) {
          if (actor.clockKey) this.timeline.forget(actor.clockKey);
          actor.clockKey = clockKey;
          actor.buffer.clear();
        }
        const accepted = actor.buffer.push({
          t: player.t,
          position: [player.position[0], player.position[1], player.position[2]],
          velocity: [player.velocity[0], player.velocity[1], player.velocity[2]],
          yaw: player.yaw,
          pitch: player.pitch,
        });
        // only fresh samples feed the clock, a repeated row would read as jitter
        if (accepted) this.timeline.observe(clockKey, player.t, receivedAtMs);
      }
    }

    for (const [id, actor] of this.actors) {
      if (visibleIds.has(id)) {
        continue;
      }
      this.root.remove(actor.group);
      this.actors.delete(id);
      if (actor.clockKey) this.timeline.forget(actor.clockKey);
    }
  }

  /**
   * What the local player is looking at right now, per remote, in each
   * remote's authority clock. The authority rewinds every target to exactly
   * this time when resolving a shot.
   */
  public getFireView(): FireView {
    const targets: Record<string, number> = {};
    let observedAtMs: number | undefined;
    for (const actor of this.actors.values()) {
      if (actor.renderedSourceT === null) continue;
      targets[actor.id] = actor.renderedSourceT;
      if (actor.clockKey?.startsWith('server|')) {
        observedAtMs = Math.max(observedAtMs ?? -Infinity, actor.renderedSourceT);
      }
    }
    return { targets, observedAtMs };
  }

  /**
   * Where each remote is drawn this frame (feet and body yaw). The local knife
   * predicts hits against exactly this, the same poses getFireView() reports.
   */
  public getDisplayedPlayers(): Array<{ id: string; position: Vector3; yaw: number }> {
    const out: Array<{ id: string; position: Vector3; yaw: number }> = [];
    for (const actor of this.actors.values()) {
      out.push({ id: actor.id, position: actor.displayPosition.clone(), yaw: actor.displayYaw });
    }
    return out;
  }

  /** Presentation delay currently applied to a remote, in ms (for the debug hud). */
  public getPresentationDelayMs(playerId: string): number | null {
    const actor = this.actors.get(playerId);
    return actor?.clockKey ? this.timeline.delayMs(actor.clockKey) : null;
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
      buffer: new InterpolationBuffer(),
      clockKey: null,
      renderedSourceT: null,
      correction: new Vector3(),
      lastMode: null,
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
      attachKnifeModel(rig.rightWeaponHand, this.knifeTemplate);
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

    // Base stance: the exact same knife-hold the menu hero uses, so every player
    // in the world reads as gripping the knife the way the character preview
    // does (both arms in, blade out front) instead of the old splayed stance.
    applyKnifeIdlePose(rig);

    // A subtle breath so remotes are not perfectly frozen, phase-offset per id.
    const breath = Math.sin(nowSec * 1.1 + actor.idlePhase) * 0.02;
    composeOptional(rig.spineUpper, breath * 0.5, 0, 0);
    composeOptional(rig.head, breath * 0.25, Math.sin(nowSec * 1.6 + actor.idlePhase) * 0.03, 0);

    // Attack swing layered on top of the idle grip on the knife (right) arm.
    const swingAlpha = actor.swingTimer > 0 ? 1 - actor.swingTimer / SWING_DURATION_SEC : 0;
    const swingCurve = swingAlpha > 0 ? Math.sin(Math.PI * MathUtils.clamp(swingAlpha, 0, 1)) : 0;
    if (swingCurve > 0) {
      const dir = actor.swingKind === 'secondary' ? -1 : 1;
      composeLocal(rig.rightUpper, -0.34 * swingCurve, 0.2 * swingCurve * dir, 0.06 * swingCurve);
      composeLocal(rig.rightLower, -0.42 * swingCurve, 0.16 * swingCurve * dir, 0);
      composeLocal(rig.rightHand, 0.12 * swingCurve, -0.16 * swingCurve, 0.24 * swingCurve * dir);
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

  private async loadTemplate(model: PlayerModel): Promise<[PlayerModel, Object3D]> {
    const gltf = await gltfLoader.loadAsync(MODEL_PATHS[model]);
    const root = gltf.scene;
    root.name = `RemoteModelTemplate:${model}`;
    root.updateWorldMatrix(true, true);

    normalizeTemplateToPlayerHeight(root);
    addPlayerEyeDetails(root);

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
    return loadKnifeMesh(gltfLoader);
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

const composeEuler = new Euler(0, 0, 0, 'XYZ');
const composeQuat = new Quaternion();

/** Multiplies a local-space Euler rotation onto a bone's current quaternion. */
function composeLocal(bone: Bone, x: number, y: number, z: number): void {
  composeEuler.set(x, y, z, 'XYZ');
  composeQuat.setFromEuler(composeEuler);
  bone.quaternion.multiply(composeQuat).normalize();
}

function composeOptional(bone: Bone | null, x: number, y: number, z: number): void {
  if (bone) {
    composeLocal(bone, x, y, z);
  }
}

function lerpAngle(current: number, target: number, alpha: number): number {
  const delta = MathUtils.euclideanModulo(target - current + Math.PI, Math.PI * 2) - Math.PI;
  return current + delta * alpha;
}
