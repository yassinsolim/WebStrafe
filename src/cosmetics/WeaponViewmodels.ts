import {
  AnimationMixer,
  Box3,
  Group,
  LoopOnce,
  LoopRepeat,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SRGBColorSpace,
  SkinnedMesh,
  Vector3,
  type AnimationAction,
  type Bone,
  type Material,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type GunId = 'deagle' | 'awp';

/**
 * Extract-and-attach config for a gun whose gun *mesh* skinning is broken in the
 * export (authored thousands of units from the hands) even though the ARMS skin
 * perfectly and the hand/weapon bone is animated correctly. We keep the real
 * animated arms, pull the gun geometry out of the broken skin, and rigidly bolt
 * it to the weapon bone — which the arm animation carries — so equip/idle/fire/
 * reload all move arms + gun together, in the hand, like a proper viewmodel.
 */
interface GunAttach {
  /** Material names identifying the gun meshes to extract. */
  materials: string[];
  /** Bone the gun rides (its animated transform places the gun in the hand). */
  bone: RegExp;
  /** Uniform scale of the extracted gun in bone-local space. */
  scale: number;
  /** Offset of the gun in bone-local space (after centring on its own bounds). */
  pos: [number, number, number];
  /** Orientation of the gun in bone-local space (XYZ euler, radians). */
  rot: [number, number, number];
}

/** Per-gun placement + animation config. */
interface GunConfig {
  url: string;
  /**
   * Material names of meshes to HIDE (e.g. a broken helper, or the low-quality
   * arms of a model we render gun-forward). Everything else stays visible.
   */
  hideMaterials?: string[];
  /** Extract + attach the gun to a bone (for models with broken gun skinning). */
  gunAttach?: GunAttach;
  /** Animation clip name patterns. */
  clips: { idle: RegExp; equip: RegExp; fire: RegExp; reload: RegExp };
  /** Final placement of the whole viewmodel in camera space. */
  place: { rot: [number, number, number]; pos: [number, number, number]; scale: number; size?: number };
  /**
   * Fit by the visible meshes' *bind-space geometry* bounds (Box3.expandByObject,
   * which ignores skinning) instead of the animated skinned bounds. For a model
   * whose skinning scatters meshes unpredictably (the AWP), the bind geometry
   * still forms a coherent shape, so this frames it reliably. `size` becomes the
   * target largest dimension in camera units.
   */
  meshFit?: boolean;
}

const CONFIGS: Record<GunId, GunConfig> = {
  deagle: {
    url: '/viewmodels/deagle/deagle.glb',
    hideMaterials: ['Bullet', 'Skybox', 'material'],
    gunAttach: {
      materials: ['MainBody', 'Slide', 'Magazine'],
      bone: /Weapon/i,
      scale: 1.6e-4,
      pos: [0, -0.05, 0.04],
      rot: [-0.4, 0, 0],
    },
    clips: { idle: /idle/i, equip: /equip/i, fire: /^rig\|Fire$|fire/i, reload: /reload(?!_empty)/i },
    place: { rot: [-1.15, Math.PI, 0.06], pos: [0.06, -0.14, -0.48], scale: 0.5 },
  },
  awp: {
    // This AWP model's arms skin to a different place than the gun (broken rig)
    // and are low-poly, so we hide them and present a clean, correctly-oriented
    // rifle fit by its bind-space geometry. The Deagle carries the full arms+gun
    // showcase.
    url: '/viewmodels/awp/awp.glb',
    hideMaterials: ['Material', 'Back'],
    meshFit: true,
    clips: { idle: /idle/i, equip: /draw|equip/i, fire: /fire/i, reload: /reload/i },
    place: { rot: [-1.05, 0.5, 0], pos: [0.05, -0.14, -0.5], scale: 1, size: 0.62 },
  },
};

interface GunInstance {
  id: GunId;
  mount: Group;
  model: Object3D;
  mixer: AnimationMixer;
  actions: { idle: AnimationAction | null; equip: AnimationAction | null; fire: AnimationAction | null; reload: AnimationAction | null };
}

/**
 * Animated first-person Deagle + AWP viewmodels loaded from the real Sketchfab
 * GLBs (credited in README + menu), each playing equip/idle/fire/reload. GameApp
 * shows one at a time based on the active weapon; the knife keeps its own
 * viewmodel in CosmeticsManager.
 *
 * Both source models ship a broken skinned export (gun meshes authored thousands
 * of units from the hands), handled per-gun:
 *  - **Deagle:** the arms skin perfectly and the `Weapon` bone tracks the hand,
 *    so we keep the real animated arms and rigidly bolt the extracted gun to that
 *    bone (see {@link GunAttach}) — real hands holding a real Deagle through every
 *    clip.
 *  - **AWP:** the arms skin to a different place than the gun (and are low-poly),
 *    so we hide them and present the gun fit by its bind-space geometry
 *    ({@link GunConfig.meshFit}) — a clean, correctly-oriented rifle.
 */
export class WeaponViewmodels {
  public readonly root = new Group();
  private readonly loader = new GLTFLoader();
  private readonly guns = new Map<GunId, GunInstance>();
  private active: GunId | null = null;

  constructor() {
    this.root.name = 'WeaponViewmodels';
  }

  /** Loads both gun viewmodels. Safe to call once during init. */
  public async load(): Promise<void> {
    await Promise.all((Object.keys(CONFIGS) as GunId[]).map((id) => this.loadGun(id)));
  }

  private async loadGun(id: GunId): Promise<void> {
    const cfg = CONFIGS[id];
    const gltf = await this.loader.loadAsync(cfg.url);
    const model = gltf.scene;

    model.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) {
        mesh.frustumCulled = false;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        this.normalizeMaterials(mesh);
        if (cfg.hideMaterials && this.materialNames(mesh).some((n) => cfg.hideMaterials!.includes(n))) {
          mesh.visible = false;
        }
      }
    });

    if (cfg.gunAttach) this.attachGun(model, cfg.gunAttach);

    const mount = new Group();
    mount.name = `gun:${id}`;
    mount.add(model);
    mount.visible = false;
    this.root.add(mount);

    const mixer = new AnimationMixer(model);
    const clips = gltf.animations;
    const makeAction = (re: RegExp, loop: boolean): AnimationAction | null => {
      const clip = clips.find((c) => re.test(c.name));
      if (!clip) return null;
      const a = mixer.clipAction(clip);
      a.setLoop(loop ? LoopRepeat : LoopOnce, Infinity);
      a.clampWhenFinished = !loop;
      return a;
    };
    const actions = {
      idle: makeAction(cfg.clips.idle, true),
      equip: makeAction(cfg.clips.equip, false),
      fire: makeAction(cfg.clips.fire, false),
      reload: makeAction(cfg.clips.reload, false),
    };

    // Prime the idle pose so bone matrices (and the attached gun) are valid, then
    // place the whole viewmodel in camera space.
    (actions.idle ?? mixer.clipAction(clips[0]))?.play();
    mixer.update(0);
    this.place(model, cfg);
    mixer.stopAllAction();

    // When a one-shot (equip/fire/reload) finishes, ease back to the idle loop so
    // the arms never stick in a clamped end pose.
    mixer.addEventListener('finished', () => {
      if (this.active === id) this.playExclusive({ id, mount, model, mixer, actions }, actions.idle, true);
    });

    this.guns.set(id, { id, mount, model, mixer, actions });
  }

  private materialNames(mesh: Mesh): string[] {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    return mats.map((m) => (m as Material).name || '');
  }

  /** sRGB colour maps + depth setup for the viewmodel pass. */
  private normalizeMaterials(mesh: Mesh): void {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const std = m as MeshStandardMaterial;
      if (std.map) std.map.colorSpace = SRGBColorSpace;
      std.depthWrite = true;
      std.depthTest = true;
      std.needsUpdate = true;
    }
  }

  /**
   * Extracts the gun meshes (by material) into plain meshes, drops the broken
   * skinning, hides the originals, and rigidly parents the gun to a bone. The
   * bone is animated with the hand, so the gun follows every clip.
   */
  private attachGun(model: Object3D, cfg: GunAttach): void {
    const parts: Mesh[] = [];
    let bone: Object3D | null = null;
    model.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh && this.materialNames(mesh).some((n) => cfg.materials.includes(n))) parts.push(mesh);
      if (!bone && (o as Bone).isBone && cfg.bone.test(o.name)) bone = o as Object3D;
    });
    if (!parts.length || !bone) {
      // eslint-disable-next-line no-console
      console.warn('[Combat] gun-attach failed: parts', parts.length, 'bone', !!bone);
      return;
    }

    const raw = new Box3();
    for (const p of parts) {
      p.geometry.computeBoundingBox();
      if (p.geometry.boundingBox) raw.union(p.geometry.boundingBox);
    }
    const rawCenter = raw.getCenter(new Vector3());

    const pivot = new Group();
    pivot.name = 'rigidGun';
    const inner = new Group();
    pivot.add(inner);
    for (const p of parts) {
      const clone = new Mesh(p.geometry, p.material);
      clone.frustumCulled = false;
      clone.castShadow = false;
      clone.receiveShadow = false;
      this.normalizeMaterials(clone);
      inner.add(clone);
      p.visible = false; // hide the broken skinned original
    }
    inner.position.copy(rawCenter).multiplyScalar(-1);
    pivot.scale.setScalar(cfg.scale);
    pivot.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
    pivot.rotation.set(cfg.rot[0], cfg.rot[1], cfg.rot[2]);
    (bone as Object3D).add(pivot);
  }

  /**
   * Real skinned world bounds at the current pose (sampled via applyBoneTransform
   * — the reliable way; Box3.setFromObject/expandByObject ignore bone skinning).
   * Only samples visible skinned meshes, so hidden broken parts don't skew it.
   */
  private skinnedBounds(model: Object3D): Box3 {
    const box = new Box3();
    const v = new Vector3();
    model.updateWorldMatrix(true, true);
    model.traverse((o) => {
      const sm = o as SkinnedMesh;
      if (!sm.isSkinnedMesh || !sm.visible || !sm.geometry) return;
      const pos = sm.geometry.getAttribute('position');
      if (!pos) return;
      const step = Math.max(1, Math.floor(pos.count / 200));
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i);
        sm.applyBoneTransform(i, v);
        sm.localToWorld(v);
        box.expandByPoint(v);
      }
    });
    return box;
  }

  /**
   * Places the whole viewmodel in camera space: apply the base rotation, scale so
   * the arm cluster is viewmodel-sized, then translate so its centre lands at the
   * target position in front of the camera. Mirrors the knife's approach.
   */
  private place(model: Object3D, cfg: GunConfig): void {
    model.position.set(0, 0, 0);
    model.rotation.set(cfg.place.rot[0], cfg.place.rot[1], cfg.place.rot[2]);
    model.scale.setScalar(cfg.place.scale);
    model.updateMatrixWorld(true);
    if (cfg.meshFit) {
      // Fit by bind-space geometry bounds (ignores skinning). Scale so the
      // largest dimension is `size`, then centre on the placement point. Robust
      // for models whose skinning scatters (the AWP).
      const raw = this.meshBounds(model);
      if (!raw.isEmpty()) {
        const size = raw.getSize(new Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const s = (cfg.place.size ?? 0.6) / maxDim;
        model.scale.setScalar(s);
        model.updateMatrixWorld(true);
      }
      const box = this.meshBounds(model);
      const c = box.getCenter(new Vector3());
      model.position.set(cfg.place.pos[0] - c.x, cfg.place.pos[1] - c.y, cfg.place.pos[2] - c.z);
      return;
    }
    const box = this.skinnedBounds(model);
    if (box.isEmpty()) return;
    const c = box.getCenter(new Vector3());
    model.position.set(cfg.place.pos[0] - c.x, cfg.place.pos[1] - c.y, cfg.place.pos[2] - c.z);
  }

  /** Bind-space bounds of the visible meshes (ignores skinning). */
  private meshBounds(model: Object3D): Box3 {
    const box = new Box3();
    model.updateWorldMatrix(true, true);
    model.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh && mesh.visible && mesh.geometry) box.expandByObject(mesh);
    });
    return box;
  }

  /** Shows the given gun (hiding others), playing its equip then idle. */
  public show(id: GunId | null): void {
    this.active = id;
    for (const [gid, g] of this.guns) {
      g.mount.visible = gid === id;
    }
    const g = id ? this.guns.get(id) : null;
    if (!g) return;
    if (g.actions.equip) {
      this.playExclusive(g, g.actions.equip, false);
    } else {
      this.playExclusive(g, g.actions.idle, true);
    }
  }

  /** Plays exactly one action, fading the others out (avoids blended garbage). */
  private playExclusive(g: GunInstance, action: AnimationAction | null, loop: boolean, fade = 0.12): void {
    if (!action) return;
    for (const other of Object.values(g.actions)) {
      if (other && other !== action && other.isRunning()) other.fadeOut(fade);
    }
    action.reset();
    action.setLoop(loop ? LoopRepeat : LoopOnce, Infinity);
    action.clampWhenFinished = !loop;
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.fadeIn(fade).play();
  }

  /** Plays the fire animation for the active gun (one-shot, eases back to idle). */
  public triggerFire(): void {
    const g = this.active ? this.guns.get(this.active) : null;
    if (!g || !g.actions.fire) return;
    this.playExclusive(g, g.actions.fire, false, 0.03);
  }

  /** Plays the reload animation for the active gun. */
  public triggerReload(): void {
    const g = this.active ? this.guns.get(this.active) : null;
    if (!g || !g.actions.reload) return;
    this.playExclusive(g, g.actions.reload, false, 0.08);
  }

  public update(dt: number): void {
    for (const g of this.guns.values()) {
      if (!g.mount.visible) continue;
      g.mixer.update(dt);
    }
  }
}
