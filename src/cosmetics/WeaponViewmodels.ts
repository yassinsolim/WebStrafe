import {
  AnimationMixer,
  Box3,
  Group,
  LoopOnce,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SRGBColorSpace,
  Vector3,
  type AnimationAction,
  type AnimationClip,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FIREARM_TIMINGS, type FirearmId } from '../combat/FirearmTiming';
import {
  attachViewmodelWatch,
  findViewmodelNode,
  loadAuthoredViewmodelWatch,
  type ViewmodelWatchAssetLoader,
  type ViewmodelWatchConfig,
} from './ViewmodelWatch';

export type GunId = FirearmId;
type PresentationAction = 'idle' | 'equip' | 'fire' | 'reload';

interface GunConfig {
  url: string;
  targetDiagonal: number;
  position: [number, number, number];
  rotation: [number, number, number];
  /** Materials whose mesh bounds preserve the confirmed authored weapon scale. */
  scaleReferenceMaterials?: readonly string[];
  handScale?: {
    boneNames: readonly string[];
    factor: number;
  };
  watch?: ViewmodelWatchConfig;
}

const CONFIGS: Record<GunId, GunConfig> = {
  deagle: {
    url: '/viewmodels/deagle/deagle.glb',
    targetDiagonal: 0.55,
    position: [0.16, -0.28, -0.8],
    // Reverse the complete clasped pose around camera Y. The tiny residual yaw
    // preserves slide readability while the muzzle and sights converge forward.
    rotation: [0.015, Math.PI - 0.08, -0.015],
    scaleReferenceMaterials: ['MainBody', 'Slide'],
  },
  awp: {
    url: '/viewmodels/awp/awp.glb',
    targetDiagonal: 0.82,
    position: [0.18, -0.2, -0.88],
    rotation: [0, 0.03, 0],
    scaleReferenceMaterials: ['Body'],
    handScale: {
      boneNames: ['Wrist.L', 'Wrist.R'],
      factor: 1.22,
    },
    watch: {
      boneName: 'Wrist.L',
      position: [0, 0.015, 0],
      rotation: [Math.PI, Math.PI, 0],
      scale: 5.8,
    },
  },
};

interface ScaledHandBone {
  object: Object3D;
  baseScale: Vector3;
  factor: number;
}

interface GunInstance {
  id: GunId;
  mount: Group;
  model: Object3D;
  reloadMixer: AnimationMixer;
  reloadAction: AnimationAction;
  reloadClip: AnimationClip;
  scaledHandBones: ScaledHandBone[];
  action: PresentationAction;
  actionTime: number;
  actionDuration: number;
}

interface ViewmodelAsset {
  scene: Object3D;
  animations?: AnimationClip[];
}

export interface WeaponViewmodelLoader {
  loadAsync(url: string): Promise<ViewmodelAsset>;
}

export interface WeaponViewmodelPresentationState {
  active: GunId | null;
  visible: GunId | null;
  loaded: readonly GunId[];
  action: PresentationAction | null;
}

/**
 * Loads compact production GLBs built from the licensed source files. Each GLB
 * contains the real textured weapon, two-hand rig, magazine, and authored reload
 * clip; playback is sampled against authoritative combat timing.
 */
export class WeaponViewmodels {
  public readonly root = new Group();
  private readonly loader: WeaponViewmodelLoader;
  private readonly watchAssetLoader: ViewmodelWatchAssetLoader;
  private readonly guns = new Map<GunId, GunInstance>();
  private readonly loads = new Map<GunId, Promise<void>>();
  private active: GunId | null = null;
  private inspectProgress = 0;
  private inspectWeight = 0;

  constructor(
    loader: WeaponViewmodelLoader = new GLTFLoader(),
    watchAssetLoader: ViewmodelWatchAssetLoader = loadAuthoredViewmodelWatch,
  ) {
    this.loader = loader;
    this.watchAssetLoader = watchAssetLoader;
    this.root.name = 'WeaponViewmodels';
  }

  public async load(): Promise<void> {
    await Promise.all((Object.keys(CONFIGS) as GunId[]).map((id) => this.loadGunOnce(id)));
  }

  private loadGunOnce(id: GunId): Promise<void> {
    const existing = this.loads.get(id);
    if (existing) return existing;
    const pending = this.loadGun(id).catch((error: unknown) => {
      if (this.loads.get(id) === pending) this.loads.delete(id);
      throw error;
    });
    this.loads.set(id, pending);
    return pending;
  }

  private async loadGun(id: GunId): Promise<void> {
    const config = CONFIGS[id];
    const [asset, authoredWatch] = await Promise.all([
      this.loader.loadAsync(config.url),
      config.watch ? this.watchAssetLoader() : Promise.resolve(null),
    ]);
    const model = asset.scene;
    model.name = `${id}:authored-presentation`;
    const reloadClip = this.resolveReloadClip(id, asset.animations ?? []);
    const reloadMixer = new AnimationMixer(model);
    const reloadAction = reloadMixer.clipAction(reloadClip);
    reloadAction.loop = LoopOnce;
    reloadAction.clampWhenFinished = true;
    reloadAction.enabled = true;
    reloadAction.play();
    reloadAction.time = 0;
    reloadMixer.update(0);

    model.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.normalizeMaterials(mesh);
    });

    const bounds = this.getScaleBounds(model, config);
    if (bounds.isEmpty()) {
      throw new Error(`[Combat] ${id} production viewmodel contains no visible geometry`);
    }
    const diagonal = bounds.getSize(new Vector3()).length();
    if (!Number.isFinite(diagonal) || diagonal <= 1e-6) {
      throw new Error(`[Combat] ${id} production viewmodel has invalid bounds`);
    }
    const center = bounds.getCenter(new Vector3());
    model.position.sub(center);
    if (config.watch && authoredWatch) {
      attachViewmodelWatch(model, id, config.watch, authoredWatch);
    }
    const scaledHandBones = this.resolveScaledHandBones(id, model, config);

    const source = new Group();
    source.name = `${id}:source-pivot`;
    source.scale.setScalar(config.targetDiagonal / diagonal);
    source.rotation.set(...config.rotation);
    source.add(model);

    const mount = new Group();
    mount.name = `gun:${id}`;
    mount.add(source);
    mount.visible = false;
    this.root.add(mount);

    const instance: GunInstance = {
      id,
      mount,
      model,
      reloadMixer,
      reloadAction,
      reloadClip,
      scaledHandBones,
      action: 'idle',
      actionTime: 0,
      actionDuration: 0,
    };
    this.guns.set(id, instance);
    this.applyPose(instance, config);

    // The latest requested weapon owns visibility even when the two GLBs resolve
    // out of order. A stale completion never exposes itself.
    if (this.active === id) {
      mount.visible = true;
      this.startAction(instance, 'equip', 0.42);
    }
  }

  private resolveReloadClip(id: GunId, clips: readonly AnimationClip[]): AnimationClip {
    const named = clips.find((clip) => clip.name.toLowerCase().includes('reload'));
    const clip = named ?? (clips.length === 1 ? clips[0] : null);
    if (!clip || !Number.isFinite(clip.duration) || clip.duration <= 0) {
      throw new Error(`[Combat] ${id} production viewmodel has no valid reload clip`);
    }
    return clip;
  }

  private normalizeMaterials(mesh: Mesh): void {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const standard = material as MeshStandardMaterial;
      if (standard.map) standard.map.colorSpace = SRGBColorSpace;
      standard.depthTest = true;
      standard.depthWrite = true;
      standard.needsUpdate = true;
    }
  }

  private getScaleBounds(model: Object3D, config: GunConfig): Box3 {
    if (!config.scaleReferenceMaterials?.length) {
      return new Box3().setFromObject(model);
    }
    const bounds = new Box3();
    model.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (materials.some((material) => config.scaleReferenceMaterials?.includes(material.name))) {
        bounds.union(new Box3().setFromObject(mesh));
      }
    });
    return bounds.isEmpty() ? new Box3().setFromObject(model) : bounds;
  }

  private resolveScaledHandBones(
    id: GunId,
    model: Object3D,
    config: GunConfig,
  ): ScaledHandBone[] {
    const handScale = config.handScale;
    if (!handScale) {
      return [];
    }
    return handScale.boneNames.map((name) => {
      const object = findViewmodelNode(model, name);
      if (!object) {
        throw new Error(`[Combat] ${id} production viewmodel is missing hand bone ${name}`);
      }
      return {
        object,
        baseScale: object.scale.clone(),
        factor: handScale.factor,
      };
    });
  }

  public show(id: GunId | null): void {
    this.active = id;
    this.inspectProgress = 0;
    this.inspectWeight = 0;
    for (const [gunId, instance] of this.guns) {
      const visible = gunId === id;
      instance.mount.visible = visible;
      if (!visible) {
        instance.action = 'idle';
        instance.actionTime = 0;
        instance.actionDuration = 0;
        this.applyPose(instance, CONFIGS[gunId]);
      }
    }
    const instance = id ? this.guns.get(id) : null;
    if (instance) this.startAction(instance, 'equip', 0.42);
  }

  public getPresentationState(): WeaponViewmodelPresentationState {
    const ids = Object.keys(CONFIGS) as GunId[];
    const instance = this.active ? this.guns.get(this.active) : null;
    return {
      active: this.active,
      visible:
        this.root.visible && instance?.mount.visible
          ? this.active
          : null,
      loaded: ids.filter((id) => this.guns.has(id)),
      action: instance?.action ?? null,
    };
  }

  public triggerFire(): void {
    const instance = this.active ? this.guns.get(this.active) : null;
    if (!instance) return;
    this.startAction(
      instance,
      'fire',
      FIREARM_TIMINGS[instance.id].firePlaybackMs / 1000,
    );
  }

  public triggerReload(): void {
    const instance = this.active ? this.guns.get(this.active) : null;
    if (!instance) return;
    this.startAction(
      instance,
      'reload',
      FIREARM_TIMINGS[instance.id].reloadMs / 1000,
    );
  }

  public setInspectPose(progress: number, weight: number): void {
    const instance = this.active ? this.guns.get(this.active) : null;
    if (!instance || instance.action !== 'idle') {
      this.inspectProgress = 0;
      this.inspectWeight = 0;
      return;
    }
    this.inspectProgress = Math.min(1, Math.max(0, progress));
    this.inspectWeight = Math.min(1, Math.max(0, weight));
    this.applyPose(instance, CONFIGS[instance.id]);
  }

  private startAction(
    instance: GunInstance,
    action: PresentationAction,
    duration: number,
  ): void {
    this.inspectProgress = 0;
    this.inspectWeight = 0;
    instance.action = action;
    instance.actionTime = 0;
    instance.actionDuration = duration;
    this.applyPose(instance, CONFIGS[instance.id]);
  }

  public update(dt: number): void {
    const instance = this.active ? this.guns.get(this.active) : null;
    if (!instance?.mount.visible) return;
    if (instance.action !== 'idle') {
      instance.actionTime = Math.min(
        instance.actionDuration,
        instance.actionTime + Math.max(0, dt),
      );
      if (instance.actionTime >= instance.actionDuration) {
        instance.action = 'idle';
        instance.actionTime = 0;
        instance.actionDuration = 0;
      }
    }
    this.applyPose(instance, CONFIGS[instance.id]);
  }

  private applyPose(instance: GunInstance, config: GunConfig): void {
    let x = config.position[0];
    let y = config.position[1];
    let z = config.position[2];
    let pitch = 0;
    let yaw = 0;
    let roll = 0;
    const progress =
      instance.actionDuration > 0
        ? Math.min(1, instance.actionTime / instance.actionDuration)
        : 0;

    if (instance.action === 'equip') {
      const remaining = (1 - progress) ** 3;
      x += 0.12 * remaining;
      y -= 0.2 * remaining;
      z += 0.08 * remaining;
      roll += (instance.id === 'awp' ? -0.18 : 0.18) * remaining;
    } else if (instance.action === 'fire') {
      const attackRatio = instance.id === 'awp' ? 0.18 : 0.14;
      const impulse = progress <= attackRatio
        ? 1 - (1 - progress / attackRatio) ** 3
        : Math.cos(
            ((progress - attackRatio) / (1 - attackRatio)) * Math.PI * 0.5,
          ) ** 1.45;
      z += (instance.id === 'awp' ? 0.075 : 0.045) * impulse;
      pitch -= (instance.id === 'awp' ? 0.095 : 0.065) * impulse;
      roll += (instance.id === 'awp' ? -0.018 : 0.028) * impulse;
    }

    if (instance.action === 'idle' && this.inspectWeight > 0) {
      const sideReveal = Math.sin(this.inspectProgress * Math.PI * 2) * this.inspectWeight;
      const isAwp = instance.id === 'awp';
      x -= (isAwp ? 0.035 : 0.05) * sideReveal;
      y += (isAwp ? 0.09 : 0.13) * this.inspectWeight;
      z += (isAwp ? 0.14 : 0.18) * this.inspectWeight;
      pitch -= (isAwp ? 0.08 : 0.13) * this.inspectWeight;
      yaw += (isAwp ? 0.3 : 0.52) * sideReveal;
      roll -= (isAwp ? 0.1 : 0.18) * sideReveal;
    }

    instance.mount.position.set(x, y, z);
    instance.mount.rotation.set(pitch, yaw, roll);
    this.applyReloadPose(instance, instance.action === 'reload' ? progress : 0);
  }

  private applyReloadPose(instance: GunInstance, progress: number): void {
    instance.reloadAction.time = instance.reloadClip.duration * Math.max(0, Math.min(1, progress));
    instance.reloadMixer.update(0);
    for (const hand of instance.scaledHandBones) {
      hand.object.scale.copy(hand.baseScale).multiplyScalar(hand.factor);
    }
  }
}
