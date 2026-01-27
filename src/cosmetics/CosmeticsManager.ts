import {
  AnimationMixer,
  Box3,
  Group,
  LoopOnce,
  LoopRepeat,
  Material,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector3,
} from 'three';
import type { AnimationAction, AnimationClip } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { applyWearShader } from './WearMaterial';
import type {
  AnimationTimeRange,
  CosmeticModelEntry,
  CosmeticVariant,
  CosmeticsManifest,
  LoadoutSelection,
} from './types';

const gltfLoader = new GLTFLoader();
const textureLoader = new TextureLoader();

export class CosmeticsManager {
  private manifest: CosmeticsManifest | null = null;
  private readonly gloveRoot = new Group();
  private readonly knifeRoot = new Group();
  private readonly textureCache = new Map<string, Promise<Texture>>();

  private currentGloves: Object3D | null = null;
  private currentKnife: Object3D | null = null;

  private knifeMixer: AnimationMixer | null = null;
  private knifeIdleAction: AnimationAction | null = null;
  private knifeAttackAction: AnimationAction | null = null;
  private knifeRangeAction: AnimationAction | null = null;
  private knifeEquipRange: AnimationTimeRange | null = null;
  private knifeIdleRange: AnimationTimeRange | null = null;
  private knifeMouse1Ranges: AnimationTimeRange[] = [];
  private knifeMouse2Ranges: AnimationTimeRange[] = [];
  private attackRangeSelectionMode: 'cycle' | 'random' = 'cycle';
  private activeRange: (AnimationTimeRange & { loop: boolean }) | null = null;
  private queuedAttackLane: 'mouse1' | 'mouse2' | null = null;
  private nextMouse1RangeIndex = 0;
  private nextMouse2RangeIndex = 0;
  private knifeAttackCooldown = 0;
  private activeKnifeClipNames: string[] = [];
  private readonly knifeClipLookup = new Map<string, AnimationClip>();
  private readonly knifeActionLookup = new Map<string, AnimationAction>();
  private viewmodelScale = 1;
  private usingIntegratedHands = false;
  private readonly knifeBasePosition = new Vector3(0.11, -0.02, -0.16);
  private readonly knifeBaseRotation = new Vector3(0.06, Math.PI, 0.02);

  constructor(private readonly root: Group) {
    this.gloveRoot.name = 'ViewmodelGlovesRoot';
    this.knifeRoot.name = 'ViewmodelKnifeRoot';
    this.root.add(this.gloveRoot);
    this.root.add(this.knifeRoot);

    this.gloveRoot.position.set(-0.06, -0.06, -0.1);
    this.gloveRoot.rotation.set(0.03, Math.PI, 0.05);
    this.gloveRoot.scale.setScalar(0.34);

    this.knifeRoot.position.copy(this.knifeBasePosition);
    this.knifeRoot.rotation.set(
      this.knifeBaseRotation.x,
      this.knifeBaseRotation.y,
      this.knifeBaseRotation.z,
    );
    this.knifeRoot.scale.setScalar(1);
  }

  public async loadManifest(): Promise<CosmeticsManifest> {
    const response = await fetch('/cosmetics/manifest.json');
    if (!response.ok) {
      throw new Error(`Failed to load cosmetics manifest: ${response.status}`);
    }
    const manifest = (await response.json()) as CosmeticsManifest;
    this.manifest = manifest;
    return manifest;
  }

  public getManifest(): CosmeticsManifest {
    if (!this.manifest) {
      throw new Error('Cosmetics manifest not loaded.');
    }
    return this.manifest;
  }

  public getDefaultLoadout(): LoadoutSelection {
    const manifest = this.getManifest();
    const gloves = manifest.gloves[0];
    const knife = manifest.knives[0];
    return {
      gloveId: gloves.id,
      gloveVariantId: gloves.variants[0].id,
      knifeId: knife.id,
      knifeVariantId: knife.variants[0].id,
    };
  }

  public getKnifeClipNames(): string[] {
    return [...this.activeKnifeClipNames];
  }

  public setViewmodelScale(scale: number): void {
    const clamped = Math.max(0.25, Math.min(3, scale));
    this.viewmodelScale = clamped;
    this.knifeRoot.scale.setScalar(this.viewmodelScale);
  }

  public usesIntegratedHands(): boolean {
    return this.usingIntegratedHands;
  }

  public async applyLoadout(loadout: LoadoutSelection): Promise<void> {
    const manifest = this.getManifest();

    const glove = manifest.gloves.find((entry) => entry.id === loadout.gloveId) ?? manifest.gloves[0];
    const knife = manifest.knives.find((entry) => entry.id === loadout.knifeId);
    if (!glove || !knife) {
      throw new Error('Selected loadout entry was not found in manifest.');
    }

    const gloveVariant = glove.variants.find((variant) => variant.id === loadout.gloveVariantId) ?? glove.variants[0];
    const knifeVariant = knife.variants.find((variant) => variant.id === loadout.knifeVariantId) ?? knife.variants[0];
    if (!gloveVariant || !knifeVariant) {
      throw new Error('Selected loadout variant was not found in manifest.');
    }

    const [gloveResult, knifeResult] = await Promise.all([
      this.loadModelWithVariant(glove, gloveVariant, false),
      this.loadModelWithVariant(knife, knifeVariant, true, knife.includesHands ?? false),
    ]);

    if (this.currentGloves) {
      this.gloveRoot.remove(this.currentGloves);
    }
    if (this.currentKnife) {
      this.knifeRoot.remove(this.currentKnife);
    }

    this.currentGloves = gloveResult.root;
    this.currentKnife = knifeResult.root;
    this.gloveRoot.add(gloveResult.root);
    this.knifeRoot.add(knifeResult.root);

    this.usingIntegratedHands = knife.includesHands ?? false;
    this.gloveRoot.visible = !this.usingIntegratedHands;
    if (this.usingIntegratedHands) {
      this.knifeBasePosition.set(0, 0, 0);
      this.knifeBaseRotation.set(0, Math.PI, 0);
    } else {
      this.knifeBasePosition.set(0.11, -0.02, -0.16);
      this.knifeBaseRotation.set(0.06, Math.PI, 0.02);
    }
    this.knifeRoot.position.copy(this.knifeBasePosition);
    this.knifeRoot.rotation.set(
      this.knifeBaseRotation.x,
      this.knifeBaseRotation.y,
      this.knifeBaseRotation.z,
    );
    this.knifeRoot.scale.setScalar(this.viewmodelScale);

    this.setupKnifeAnimations(knifeResult.root, knifeResult.animations, knife);
  }

  public update(dt: number): void {
    if (this.knifeMixer) {
      this.knifeMixer.update(dt);
    }
    this.updateRangePlayback();
    if (this.knifeAttackCooldown > 0) {
      this.knifeAttackCooldown = Math.max(0, this.knifeAttackCooldown - dt);
    }
    this.drainQueuedAttack();
  }

  public triggerAttackPrimary(): void {
    this.triggerAttackFromRanges(this.knifeMouse1Ranges, 'mouse1');
  }

  public triggerAttackSecondary(): void {
    this.triggerAttackFromRanges(this.knifeMouse2Ranges, 'mouse2');
  }

  public triggerEquip(): boolean {
    if (!this.knifeRangeAction || !this.knifeEquipRange) {
      return false;
    }
    this.knifeAttackCooldown = Math.max(0.12, this.knifeEquipRange.endSec - this.knifeEquipRange.startSec);
    this.playRange(this.knifeEquipRange, false);
    return true;
  }

  public playKnifeClip(clipName: string): boolean {
    if (!this.knifeMixer) {
      return false;
    }
    const clip = this.knifeClipLookup.get(clipName);
    if (!clip) {
      return false;
    }

    let action = this.knifeActionLookup.get(clipName);
    if (!action) {
      action = this.knifeMixer.clipAction(clip);
      this.knifeActionLookup.set(clipName, action);
    }

    if (this.knifeIdleAction && action !== this.knifeIdleAction) {
      this.knifeIdleAction.paused = true;
    }
    action.loop = action === this.knifeIdleAction ? LoopRepeat : LoopOnce;
    action.clampWhenFinished = action !== this.knifeIdleAction;
    action.enabled = true;
    action.paused = false;
    action.reset();
    action.play();
    return true;
  }

  public setInspectAlpha(alpha: number): void {
    const clamped = Math.min(1, Math.max(0, alpha));
    const inspectScale = this.usingIntegratedHands ? 0.35 : 1;
    this.knifeRoot.position.set(
      this.knifeBasePosition.x - clamped * 0.12 * inspectScale,
      this.knifeBasePosition.y + clamped * 0.06 * inspectScale,
      this.knifeBasePosition.z + clamped * 0.16 * inspectScale,
    );
    this.knifeRoot.rotation.set(
      this.knifeBaseRotation.x + 0.12 * clamped * inspectScale,
      this.knifeBaseRotation.y - clamped * 0.8 * inspectScale,
      this.knifeBaseRotation.z - 0.25 * clamped * inspectScale,
    );

    this.gloveRoot.rotation.set(0.03 + clamped * 0.06, Math.PI - clamped * 0.2, 0.05 - 0.15 * clamped);
  }

  private setupKnifeAnimations(
    knifeRoot: Object3D,
    clips: AnimationClip[],
    knifeEntry: CosmeticModelEntry,
  ): void {
    if (this.knifeMixer) {
      this.knifeMixer.removeEventListener('finished', this.onKnifeActionFinished);
    }
    this.knifeMixer = null;
    this.knifeIdleAction = null;
    this.knifeAttackAction = null;
    this.knifeRangeAction = null;
    this.knifeEquipRange = null;
    this.knifeIdleRange = null;
    this.knifeMouse1Ranges = [];
    this.knifeMouse2Ranges = [];
    this.attackRangeSelectionMode = 'cycle';
    this.activeRange = null;
    this.queuedAttackLane = null;
    this.nextMouse1RangeIndex = 0;
    this.nextMouse2RangeIndex = 0;
    const clipNameOf = (clip: AnimationClip): string => {
      const index = clips.indexOf(clip);
      return clip.name || `clip_${Math.max(0, index)}`;
    };
    this.activeKnifeClipNames = clips.map((clip, index) => clip.name || `clip_${index}`);
    this.knifeClipLookup.clear();
    this.knifeActionLookup.clear();
    for (const clip of clips) {
      this.knifeClipLookup.set(clipNameOf(clip), clip);
    }

    if (clips.length === 0) {
      return;
    }

    const mixer = new AnimationMixer(knifeRoot);
    this.knifeMixer = mixer;
    const rangeConfig = this.buildRangeModeConfig(knifeEntry, clips);
    if (rangeConfig) {
      const sourceClip = clips.find((clip) => clip.name === rangeConfig.sourceClipName) ?? clips[0];
      if (!sourceClip) {
        return;
      }
      this.knifeRangeAction = mixer.clipAction(sourceClip);
      this.knifeRangeAction.enabled = true;
      this.knifeRangeAction.paused = true;
      this.knifeRangeAction.loop = LoopRepeat;
      this.knifeRangeAction.clampWhenFinished = false;
      this.knifeRangeAction.play();

      this.knifeEquipRange = rangeConfig.equipRange;
      this.knifeIdleRange = rangeConfig.idleLoopRange;
      this.knifeMouse1Ranges = [...rangeConfig.mouse1Ranges];
      this.knifeMouse2Ranges = [...rangeConfig.mouse2Ranges];
      this.attackRangeSelectionMode = rangeConfig.attackRangeSelectionMode;

      if (this.knifeIdleRange) {
        this.playRange(this.knifeIdleRange, true);
      } else {
        this.activeRange = null;
      }
      return;
    }

    mixer.addEventListener('finished', this.onKnifeActionFinished);

    const idleClip = this.pickIdleClip(clips, knifeEntry.defaultIdleClip);
    const attackClip = this.pickAttackClip(clips, knifeEntry.defaultAttackClip);
    const singleClipMode = idleClip !== null && attackClip !== null && idleClip === attackClip;

    if (idleClip) {
      this.knifeIdleAction = mixer.clipAction(idleClip);
      this.knifeIdleAction.loop = LoopRepeat;
      this.knifeIdleAction.enabled = true;
      this.knifeIdleAction.play();
      this.knifeActionLookup.set(clipNameOf(idleClip), this.knifeIdleAction);
    }

    if (attackClip) {
      if (singleClipMode && this.knifeIdleAction) {
        this.knifeAttackAction = this.knifeIdleAction;
      } else {
        this.knifeAttackAction = mixer.clipAction(attackClip);
      }
      this.knifeAttackAction.loop = singleClipMode ? LoopRepeat : LoopOnce;
      this.knifeAttackAction.clampWhenFinished = !singleClipMode;
      this.knifeAttackAction.enabled = true;
      this.knifeActionLookup.set(clipNameOf(attackClip), this.knifeAttackAction);
    }
  }

  private buildRangeModeConfig(
    knifeEntry: CosmeticModelEntry,
    clips: AnimationClip[],
  ): {
    attackRangeSelectionMode: 'cycle' | 'random';
    sourceClipName: string;
    equipRange: AnimationTimeRange | null;
    idleLoopRange: AnimationTimeRange | null;
    mouse1Ranges: AnimationTimeRange[];
    mouse2Ranges: AnimationTimeRange[];
  } | null {
    if (clips.length === 0) {
      return null;
    }
    const sourceClip =
      clips.find((clip) => clip.name === knifeEntry.animationBehavior?.sourceClip)
      ?? clips.find((clip) => clip.name === knifeEntry.defaultAttackClip)
      ?? clips[0];
    if (!sourceClip) {
      return null;
    }

    const duration = sourceClip.duration;
    const toRange = (range: AnimationTimeRange): AnimationTimeRange | null => {
      const start = Math.max(0, Math.min(duration - 1e-3, range.startSec));
      const end = Math.max(start + 1e-3, Math.min(duration, range.endSec));
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return null;
      }
      return { startSec: start, endSec: end };
    };

    const behavior = knifeEntry.animationBehavior;
    if (behavior) {
      const equip = behavior.equipRange ? toRange(behavior.equipRange) : null;
      const idle = behavior.idleLoopRange ? toRange(behavior.idleLoopRange) : null;
      const mouse1 = (behavior.mouse1Ranges ?? []).map(toRange).filter((v): v is AnimationTimeRange => v !== null);
      const mouse2 = (behavior.mouse2Ranges ?? []).map(toRange).filter((v): v is AnimationTimeRange => v !== null);
      return {
        attackRangeSelectionMode: behavior.attackRangeSelection ?? 'cycle',
        sourceClipName: sourceClip.name,
        equipRange: equip,
        idleLoopRange: idle,
        mouse1Ranges: mouse1,
        mouse2Ranges: mouse2,
      };
    }

    if (!knifeEntry.includesHands) {
      return null;
    }

    const idleEnd = Math.min(1, Math.max(0.1, duration * 0.25));
    const swingStart = Math.min(duration - 0.01, Math.max(idleEnd, duration * 0.28));
    const swingEnd = Math.min(duration, Math.max(swingStart + 0.03, duration * 0.83));
    const segment = (swingEnd - swingStart) / 3;
    if (segment <= 0.01) {
      return null;
    }

    return {
      attackRangeSelectionMode: 'cycle',
      sourceClipName: sourceClip.name,
      equipRange: null,
      idleLoopRange: { startSec: 0, endSec: idleEnd },
      mouse1Ranges: [
        { startSec: swingStart, endSec: swingStart + segment },
        { startSec: swingStart + segment, endSec: swingStart + segment * 2 },
      ],
      mouse2Ranges: [{ startSec: swingStart + segment * 2, endSec: swingEnd }],
    };
  }

  private pickIdleClip(clips: AnimationClip[], preferredName?: string): AnimationClip | null {
    if (preferredName) {
      const explicit = clips.find((clip) => clip.name === preferredName);
      if (explicit) {
        return explicit;
      }
    }

    const names = ['idle', 'draw', 'equip'];
    for (const key of names) {
      const hit = clips.find((clip) => clip.name.toLowerCase().includes(key));
      if (hit) {
        return hit;
      }
    }
    return null;
  }

  private pickAttackClip(clips: AnimationClip[], preferredName?: string): AnimationClip | null {
    if (preferredName) {
      const explicit = clips.find((clip) => clip.name === preferredName);
      if (explicit) {
        return explicit;
      }
    }

    const names = ['attack', 'swing', 'slash', 'hit', 'fire'];
    for (const key of names) {
      const hit = clips.find((clip) => clip.name.toLowerCase().includes(key));
      if (hit) {
        return hit;
      }
    }

    return clips[0] ?? null;
  }

  private readonly onKnifeActionFinished = (): void => {
    if (this.knifeIdleAction) {
      this.knifeIdleAction.paused = false;
      this.knifeIdleAction.play();
    }
  };

  private triggerAttackFromRanges(
    ranges: AnimationTimeRange[],
    lane: 'mouse1' | 'mouse2',
  ): void {
    if (this.activeRange && !this.activeRange.loop) {
      this.queuedAttackLane = lane;
      return;
    }
    if (this.knifeAttackCooldown > 0) {
      this.queuedAttackLane = lane;
      return;
    }

    if (this.knifeRangeAction) {
      const chosen = this.chooseNextRange(ranges, lane);
      if (!chosen) {
        return;
      }
      this.queuedAttackLane = null;
      this.knifeAttackCooldown = Math.max(0.14, chosen.endSec - chosen.startSec);
      this.playRange(chosen, false);
      return;
    }

    if (!this.knifeAttackAction) {
      return;
    }
    this.queuedAttackLane = null;
    this.knifeAttackCooldown = 0.18;
    if (this.knifeIdleAction && this.knifeIdleAction !== this.knifeAttackAction) {
      this.knifeIdleAction.paused = true;
    }
    this.knifeAttackAction.reset();
    this.knifeAttackAction.play();
  }

  private chooseNextRange(
    ranges: AnimationTimeRange[],
    lane: 'mouse1' | 'mouse2',
  ): AnimationTimeRange | null {
    if (ranges.length === 0) {
      return null;
    }
    if (this.attackRangeSelectionMode === 'random') {
      const index = Math.floor(Math.random() * ranges.length);
      return ranges[index] ?? ranges[0];
    }
    if (lane === 'mouse1') {
      const index = this.nextMouse1RangeIndex % ranges.length;
      this.nextMouse1RangeIndex = (this.nextMouse1RangeIndex + 1) % ranges.length;
      return ranges[index] ?? ranges[0];
    }
    const index = this.nextMouse2RangeIndex % ranges.length;
    this.nextMouse2RangeIndex = (this.nextMouse2RangeIndex + 1) % ranges.length;
    return ranges[index] ?? ranges[0];
  }

  private playRange(range: AnimationTimeRange, loop: boolean): void {
    if (!this.knifeRangeAction) {
      return;
    }
    this.activeRange = { ...range, loop };
    this.knifeRangeAction.enabled = true;
    this.knifeRangeAction.paused = false;
    this.knifeRangeAction.play();
    this.knifeRangeAction.time = range.startSec + 1e-4;
  }

  private updateRangePlayback(): void {
    if (!this.knifeRangeAction || !this.activeRange) {
      return;
    }

    const current = this.activeRange;
    const span = Math.max(1e-4, current.endSec - current.startSec);
    if (this.knifeRangeAction.time < current.startSec) {
      if (!current.loop) {
        if (this.knifeIdleRange) {
          this.playRange(this.knifeIdleRange, true);
        } else {
          this.knifeRangeAction.time = 0;
          this.knifeRangeAction.paused = true;
          this.activeRange = null;
        }
        return;
      }
      this.knifeRangeAction.time = current.startSec;
      return;
    }

    if (this.knifeRangeAction.time < current.endSec) {
      return;
    }

    if (current.loop) {
      const wrapped = (this.knifeRangeAction.time - current.startSec) % span;
      this.knifeRangeAction.time = current.startSec + wrapped;
      return;
    }

    if (this.knifeIdleRange) {
      this.playRange(this.knifeIdleRange, true);
      return;
    }

    this.knifeRangeAction.time = 0;
    this.knifeRangeAction.paused = true;
    this.activeRange = null;
  }

  private drainQueuedAttack(): void {
    if (!this.queuedAttackLane) {
      return;
    }
    if ((this.activeRange && !this.activeRange.loop) || this.knifeAttackCooldown > 0) {
      return;
    }

    const lane = this.queuedAttackLane;
    const ranges = lane === 'mouse1' ? this.knifeMouse1Ranges : this.knifeMouse2Ranges;
    this.triggerAttackFromRanges(ranges, lane);
  }

  private async loadModelWithVariant(
    entry: CosmeticModelEntry,
    variant: CosmeticVariant,
    normalizeAsKnife: boolean,
    includesHands = false,
  ): Promise<{ root: Object3D; animations: AnimationClip[] }> {
    const gltf = await gltfLoader.loadAsync(entry.modelPath);
    const root = cloneSkeleton(gltf.scene);
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    const animations = gltf.animations.map((clip) => clip.clone());

    if (variant.textures?.baseColor) {
      await this.applyVariantMaterials(root, variant);
    } else {
      this.reuseAuthoredMaterials(root, includesHands);
    }

    if (normalizeAsKnife) {
      this.normalizeKnifeScale(root, includesHands);
    }

    root.updateWorldMatrix(true, true);
    return { root, animations };
  }

  private async applyVariantMaterials(root: Object3D, variant: CosmeticVariant): Promise<void> {
    const [baseColor, normal, roughnessMetal, ao] = await Promise.all([
      this.loadTexture(variant.textures?.baseColor, true),
      this.loadTexture(variant.textures?.normal, false),
      this.loadTexture(variant.textures?.roughnessMetal, false),
      this.loadTexture(variant.textures?.ao, false),
    ]);

    root.traverse((child) => {
      if (!(child instanceof Mesh)) {
        return;
      }

      const material = new MeshStandardMaterial({
        map: baseColor,
        normalMap: normal,
        roughnessMap: roughnessMetal,
        metalnessMap: roughnessMetal,
        aoMap: ao,
        roughness: roughnessMetal ? 1 : 0.55,
        metalness: roughnessMetal ? 1 : 0.2,
      });

      const wearMaterial = applyWearShader(material, {
        wear: variant.wear ?? 0.1,
        patternSeed: variant.patternSeed ?? 0,
        patternScale: variant.patternScale ?? 1,
        hueShift: variant.hueShift ?? 0,
      });

      if (!child.geometry.getAttribute('uv2') && child.geometry.getAttribute('uv')) {
        child.geometry.setAttribute('uv2', child.geometry.getAttribute('uv'));
      }
      child.material = wearMaterial;
      child.castShadow = false;
      child.receiveShadow = false;
      child.renderOrder = 10;
      child.frustumCulled = false;
      wearMaterial.depthWrite = false;
      wearMaterial.depthTest = true;
    });
  }

  private reuseAuthoredMaterials(root: Object3D, preserveDepthWrite: boolean): void {
    root.traverse((child) => {
      if (!(child instanceof Mesh)) {
        return;
      }

      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];
      for (const material of materials) {
        this.fixMaterialColorSpaces(material);
        if (!preserveDepthWrite) {
          material.depthWrite = false;
        }
        material.depthTest = true;
        material.needsUpdate = true;
      }
      child.renderOrder = 10;
      child.frustumCulled = false;
    });
  }

  private fixMaterialColorSpaces(material: Material): void {
    const mat = material as Material & {
      map?: Texture | null;
      emissiveMap?: Texture | null;
    };
    if (mat.map) {
      mat.map.colorSpace = SRGBColorSpace;
      mat.map.needsUpdate = true;
    }
    if (mat.emissiveMap) {
      mat.emissiveMap.colorSpace = SRGBColorSpace;
      mat.emissiveMap.needsUpdate = true;
    }
  }

  private async loadTexture(path?: string, srgb = false): Promise<Texture | null> {
    if (!path) {
      return null;
    }

    let cached = this.textureCache.get(path);
    if (!cached) {
      cached = textureLoader.loadAsync(path);
      this.textureCache.set(path, cached);
    }

    const texture = await cached;
    texture.flipY = false;
    texture.needsUpdate = true;
    if (srgb) {
      texture.colorSpace = SRGBColorSpace;
    }
    return texture;
  }

  private normalizeKnifeScale(root: Object3D, includesHands: boolean): void {
    const bounds = new Box3().setFromObject(root);
    if (bounds.isEmpty()) {
      return;
    }

    const size = bounds.getSize(new Vector3());
    const diagonal = size.length();
    if (!Number.isFinite(diagonal) || diagonal <= 1e-6) {
      return;
    }

    const targetDiagonal = includesHands ? 0.72 : 0.6;
    const scaleFactor = targetDiagonal / diagonal;
    root.scale.multiplyScalar(scaleFactor);
    root.updateWorldMatrix(true, true);
  }
}
