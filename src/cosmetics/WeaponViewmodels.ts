import {
  AnimationMixer,
  Box3,
  Euler,
  Group,
  LoopOnce,
  LoopRepeat,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type AnimationAction,
  type AnimationClip,
  type Bone,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type GunId = 'deagle' | 'awp';

/**
 * Rigid gun-attach config. Some FP models (the Deagle) ship a broken skinned
 * export where the gun meshes are authored thousands of units away from the
 * hands at an incompatible scale, so their skinning renders them off-screen —
 * yet the arms and the `Weapon` bone are perfectly fine. Instead of throwing the
 * model away, we extract the gun meshes' geometry, drop the broken skinning, and
 * rigidly parent them to a hand/weapon bone (which the arm animation carries).
 * This yields real arms + a real gun with all the authored clips intact.
 */
interface GunAttach {
  /** Exact mesh names of the broken gun parts to extract. */
  meshes: string[];
  /** Bone whose animated transform the gun should rigidly follow. */
  bone: RegExp;
  /** Uniform scale applied in bone-local space (absorbs the rig's own scale). */
  scale: number;
  /** Offset of the gun in bone-local space. */
  pos: [number, number, number];
  /** Orientation of the gun in bone-local space (XYZ euler, radians). */
  rot: [number, number, number];
  /**
   * Hide every other mesh in the model, leaving only the extracted gun. Used
   * when the model's arms are unusable (bulky/broken) and we want a clean
   * animated gun-only viewmodel that still rides the skeleton's clips.
   */
  hideOthers?: boolean;
  /**
   * Lock the gun's orientation in camera space every frame (see `camRot`)
   * instead of inheriting the bone's rotation. The gun still follows the bone's
   * translation, so idle sway + fire recoil from the authored clips move it, but
   * it always points cleanly forward regardless of the bone's messy local frame.
   */
  lockOrient?: boolean;
  /** Camera-space orientation (XYZ euler) used when `lockOrient` is set. */
  camRot?: [number, number, number];
}

/**
 * Per-gun placement in the viewmodel camera space. The model is auto-fit at load
 * time: its posed hand/gun bones are scaled to `size` and centred at
 * `pos`, after the `rot` orientation is applied. Only these few values are
 * hand-tuned; scale + exact translation are derived from the skeleton so the fit
 * is deterministic and robust to the model's authored units.
 */
interface GunPlacement {
  /** Small correction on top of the auto-computed orientation (radians, XYZ). */
  rot: [number, number, number];
  /** Target centre of the hand/gun bones in camera space. */
  pos: [number, number, number];
  /** Target largest dimension of the focused bones, in camera-space units. */
  size: number;
  /** Bone-name substrings (lowercase) used to frame on the hand/gun region. */
  focus: string[];
  /** Animation clip name substrings for each action. */
  clips: { idle: RegExp; draw: RegExp; fire: RegExp; reload: RegExp };
  /** Mesh-name substrings to hide (helper/aim geometry). */
  hide: string[];
  /**
   * Centre + size the fit on the *visible mesh* world-bounds instead of the
   * skeleton's bone positions. Bones on these gun rigs are clustered/placed
   * unpredictably (the fit becomes wildly sensitive), whereas the visible mesh
   * bounds are exactly what the player sees — so for a gun-only viewmodel (arms
   * hidden) this frames the weapon predictably.
   */
  centerOnMeshes?: boolean;
  /**
   * Fixed uniform scale. When set, the model is scaled by this directly instead
   * of auto-fitting `size` to the focus-bone span (more stable for full-body
   * character rigs like the Deagle, where the bone cluster span is tiny and the
   * fit becomes wildly sensitive).
   */
  fixedScale?: number;
  /**
   * Auto-orientation references (node-name substrings). The model is rotated so
   * that `(fwdTo - fwdFrom)` points forward (-Z, into the screen) and
   * `(upTo - upFrom)` points up (+Y). If the up refs are omitted, world up is
   * used. This derives the correct barrel direction from the model's own
   * geometry instead of hand-guessing Euler angles.
   */
  orient?: { fwdFrom: string; fwdTo: string; upFrom?: string; upTo?: string };
  /** Extract + rigidly attach the gun to a bone (see {@link GunAttach}). */
  gunAttach?: GunAttach;
}

const PLACEMENTS: Record<GunId, GunPlacement> = {
  deagle: {
    // Real Sketchfab FP Deagle: the arms rig + gun-mesh skinning are a broken
    // export (arms bulky, gun authored ~15000u away), so we extract the two
    // clean gun parts (body + slide), drop the arms, and rigidly bolt the gun to
    // the `Weapon` bone — an animated real Deagle that rides the authored clips.
    rot: [0, Math.PI, 0],
    pos: [0.2, -0.16, -0.5],
    size: 0.3,
    fixedScale: 0.5,
    focus: ['palmr', 'hand_r'],
    clips: { idle: /idle/i, draw: /equip/i, fire: /fire/i, reload: /reload(?!_empty)/i },
    hide: [],
    gunAttach: {
      meshes: ['Object_1082', 'Object_1083'],
      bone: /weapon/i,
      scale: 1.7e-4,
      pos: [0, 0, 0],
      rot: [0, 0, 0],
      hideOthers: true,
      lockOrient: true,
      camRot: [-0.05, 0.48, 0],
    },
  },
  awp: {
    // Gun-only, angled to look down the length of the rifle (barrel forward/up),
    // scope + receiver reading like a CS rifle. The model's mannequin arms are
    // low-poly/untextured and wreck the framing (the fit centres on the arm
    // bones), so we hide them and centre the fit on the gun bones instead — a
    // clean rifle, consistent with the gun-only Deagle. The barrel axis is the
    // model's local +Y, hence the ~-60° pitch.
    rot: [-1.05, 0.5, 0],
    pos: [0.17, -0.18, -0.48],
    size: 0.68,
    focus: [],
    centerOnMeshes: true,
    clips: { idle: /idle/i, draw: /draw|equip/i, fire: /fire/i, reload: /reload/i },
    hide: ['object_86'],
  },
};

const GUN_URLS: Record<GunId, string> = {
  deagle: '/viewmodels/deagle/deagle.glb',
  awp: '/viewmodels/awp/awp.glb',
};

interface GunInstance {
  id: GunId;
  mount: Group;
  model: Object3D;
  mixer: AnimationMixer;
  actions: { idle: AnimationAction | null; draw: AnimationAction | null; fire: AnimationAction | null; reload: AnimationAction | null };
  bones: Bone[];
  /** Auto-computed base orientation that points the barrel forward (-Z). */
  orientQuat: Quaternion;
  /** Rigidly-attached gun pivot (Deagle) whose orientation may be camera-locked. */
  gunPivot: Object3D | null;
  /** Bone the gun pivot hangs off (for the camera-space orientation lock). */
  gunBone: Object3D | null;
  /** Target camera-space orientation for the gun when locked, else null. */
  gunLockQuat: Quaternion | null;
}

/**
 * Animated first-person Deagle and AWP viewmodels loaded from real GLB assets
 * (Sketchfab, credited in the README + in-game menu). Each carries its own arms
 * + skeleton and plays draw/idle/fire/reload clips. GameApp shows one at a time
 * based on the active weapon; the knife keeps its own viewmodel in
 * CosmeticsManager.
 */
export class WeaponViewmodels {
  public readonly root = new Group();
  private readonly loader = new GLTFLoader();
  private readonly guns = new Map<GunId, GunInstance>();
  private active: GunId | null = null;

  constructor() {
    this.root.name = 'WeaponViewmodels';
  }

  /** Loads and builds both gun viewmodels. Safe to call once during init. */
  public async load(): Promise<void> {
    await Promise.all((Object.keys(PLACEMENTS) as GunId[]).map((id) => this.loadGun(id)));
  }

  private async loadGun(id: GunId): Promise<void> {
    const place = PLACEMENTS[id];
    const url = GUN_URLS[id];
    const gltf = await this.loader.loadAsync(url);
    const model = gltf.scene;

    const bones: Bone[] = [];
    model.traverse((o) => {
      if ((o as Bone).isBone) bones.push(o as Bone);
      if (o instanceof Mesh) {
        o.frustumCulled = false;
        o.castShadow = false;
        o.receiveShadow = false;
        const name = o.name.toLowerCase();
        if (place.hide.some((h) => name.includes(h))) o.visible = false;
        this.normalizeMaterials(o);
      }
    });

    // Rigid gun-attach (Deagle): extract the broken gun meshes and bolt them to
    // the weapon bone so the arm animation carries a correctly-placed gun.
    let gunPivot: Object3D | null = null;
    let gunBone: Object3D | null = null;
    let gunLockQuat: Quaternion | null = null;
    if (place.gunAttach) {
      const res = this.attachRigidGun(model, place.gunAttach);
      gunPivot = res.pivot;
      gunBone = res.bone;
      if (place.gunAttach.lockOrient && place.gunAttach.camRot) {
        gunLockQuat = new Quaternion().setFromEuler(
          new Euler(place.gunAttach.camRot[0], place.gunAttach.camRot[1], place.gunAttach.camRot[2], 'XYZ'),
        );
      }
    }

    const mount = new Group();
    mount.name = `gun:${id}`;
    mount.add(model);
    mount.visible = false;
    this.root.add(mount);

    const mixer = new AnimationMixer(model);
    const clips = gltf.animations;
    const find = (re: RegExp): AnimationClip | undefined => clips.find((c) => re.test(c.name));
    const makeAction = (re: RegExp, loop: boolean): AnimationAction | null => {
      const clip = find(re);
      if (!clip) return null;
      const a = mixer.clipAction(clip);
      a.setLoop(loop ? LoopRepeat : LoopOnce, Infinity);
      a.clampWhenFinished = !loop;
      return a;
    };
    const actions = {
      idle: makeAction(place.clips.idle, true),
      draw: makeAction(place.clips.draw, false),
      fire: makeAction(place.clips.fire, false),
      reload: makeAction(place.clips.reload, false),
    };

    // Prime one frame at the idle pose so bone matrices are valid, then compute
    // the auto-orientation and auto-fit.
    (actions.idle ?? mixer.clipAction(clips[0]))?.play();
    mixer.update(0);
    const orientQuat = this.computeOrient(model, place);
    const instance: GunInstance = { id, mount, model, mixer, actions, bones, orientQuat, gunPivot, gunBone, gunLockQuat };
    this.fit(instance);
    mixer.stopAllAction();

    // When a one-shot (draw/fire/reload) finishes, ease back to the idle loop so
    // the gun never gets stuck in a clamped end pose or blended between clips.
    mixer.addEventListener('finished', () => {
      if (this.active === id) this.playExclusive(instance, instance.actions.idle, true);
    });

    this.guns.set(id, instance);
  }

  /** Normalises a mesh's materials for the viewmodel pass (sRGB maps, depth). */
  private normalizeMaterials(o: Mesh): void {
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      const std = m as MeshStandardMaterial;
      if (std.map) std.map.colorSpace = SRGBColorSpace;
      std.depthWrite = true;
      std.depthTest = true;
      std.needsUpdate = true;
    }
  }

  /**
   * Extracts the configured gun meshes' geometry, drops their broken skinning,
   * and rigidly parents them (centred, scaled, oriented) to a hand/weapon bone.
   * Returns the created pivot + the bone it hangs off (for the orientation lock).
   */
  private attachRigidGun(model: Object3D, cfg: GunAttach): { pivot: Object3D | null; bone: Object3D | null } {
    const parts: Mesh[] = [];
    let bone: Object3D | null = null;
    model.traverse((o) => {
      if (o instanceof Mesh && cfg.meshes.includes(o.name)) parts.push(o);
      if (!bone && (o as Bone).isBone && cfg.bone.test(o.name)) bone = o as Object3D;
    });
    if (!parts.length || !bone) {
      // eslint-disable-next-line no-console
      console.warn('[Combat] rigid gun-attach failed: parts', parts.length, 'bone', !!bone);
      return { pivot: null, bone: null };
    }

    // Combined raw (pre-skinning) bounds so we can centre the gun on its origin.
    const rawBox = new Box3();
    for (const p of parts) {
      p.geometry.computeBoundingBox();
      if (p.geometry.boundingBox) rawBox.union(p.geometry.boundingBox);
    }
    const rawCenter = rawBox.getCenter(new Vector3());

    if (cfg.hideOthers) {
      model.traverse((o) => { if (o instanceof Mesh) o.visible = false; });
    }

    const pivot = new Group();
    pivot.name = 'rigidGun';
    const inner = new Group();
    pivot.add(inner);
    for (const p of parts) {
      const m = new Mesh(p.geometry, p.material);
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = false;
      this.normalizeMaterials(m);
      inner.add(m);
      p.visible = false; // hide the broken skinned copy
    }
    inner.position.copy(rawCenter).multiplyScalar(-1);
    pivot.scale.setScalar(cfg.scale);
    pivot.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
    pivot.rotation.set(cfg.rot[0], cfg.rot[1], cfg.rot[2]);
    (bone as Object3D).add(pivot);
    return { pivot, bone };
  }

  /**
   * Computes the base orientation that points the model's barrel forward (-Z)
   * and its top up (+Y), derived from the model's own reference nodes (e.g. the
   * AWP's Camera bone, the Deagle's Weapon bone + Aim sights). Returns identity
   * if the references are missing.
   */
  private computeOrient(model: Object3D, place: GunPlacement): Quaternion {
    if (!place.orient) return new Quaternion();
    model.updateMatrixWorld(true);
    const worldPos = (sub: string): Vector3 | null => {
      let hit: Object3D | null = null;
      model.traverse((o) => {
        if (!hit && o.name && o.name.toLowerCase().includes(sub.toLowerCase())) hit = o;
      });
      return hit ? (hit as Object3D).getWorldPosition(new Vector3()) : null;
    };
    const toLocal = (w: Vector3 | null): Vector3 | null => (w ? model.worldToLocal(w.clone()) : null);
    const fFrom = toLocal(worldPos(place.orient.fwdFrom));
    const fTo = toLocal(worldPos(place.orient.fwdTo));
    if (!fFrom || !fTo) {
      // eslint-disable-next-line no-console
      console.warn('[Combat] gun forward refs missing; using identity', place.orient);
      return new Quaternion();
    }
    const forward = fTo.clone().sub(fFrom).normalize();
    // Up: from refs if provided, else world up.
    let up = new Vector3(0, 1, 0);
    if (place.orient.upFrom && place.orient.upTo) {
      const uFrom = toLocal(worldPos(place.orient.upFrom));
      const uTo = toLocal(worldPos(place.orient.upTo));
      if (uFrom && uTo) up = uTo.clone().sub(uFrom).normalize();
    }
    // Orthogonalise up against forward.
    up.addScaledVector(forward, -forward.dot(up)).normalize();
    if (up.lengthSq() < 1e-6) up = new Vector3(0, 1, 0);
    // camera->model basis: X = forward × up, Y = up, Z = -forward.
    const right = new Vector3().crossVectors(forward, up).normalize();
    const zModel = forward.clone().negate();
    const camToModel = new Matrix4().makeBasis(right, up, zModel);
    const modelToCam = camToModel.clone().transpose();
    return new Quaternion().setFromRotationMatrix(modelToCam);
  }

  /** Scales + centres the model so its focused bones fill the placement box. */
  private fit(g: GunInstance): void {
    const place = PLACEMENTS[g.id];
    const model = g.model;
    const bones = g.bones;
    const focus = (b: Bone): boolean => {
      const n = b.name.toLowerCase();
      return place.focus.some((t) => n.includes(t));
    };
    const boundsOf = (): Box3 => {
      g.mount.updateWorldMatrix(true, true);
      const box = new Box3();
      const v = new Vector3();
      // Frame on the visible mesh geometry (what the player actually sees) —
      // robust for gun-only viewmodels where bone positions are unpredictable.
      if (place.centerOnMeshes) {
        model.traverse((o) => {
          const mesh = o as Mesh;
          if (!mesh.isMesh || !mesh.visible || !mesh.geometry) return;
          mesh.geometry.computeBoundingBox();
          const bb = mesh.geometry.boundingBox;
          if (!bb) return;
          for (const cx of [bb.min.x, bb.max.x]) {
            for (const cy of [bb.min.y, bb.max.y]) {
              for (const cz of [bb.min.z, bb.max.z]) {
                v.set(cx, cy, cz);
                mesh.localToWorld(v);
                g.mount.worldToLocal(v);
                box.expandByPoint(v);
              }
            }
          }
        });
        return box;
      }
      const add = (b: Object3D) => {
        b.getWorldPosition(v);
        g.mount.worldToLocal(v); // express in camera-local space (pos is camera-local)
        box.expandByPoint(v);
      };
      let any = false;
      for (const b of bones) {
        if (!focus(b)) continue;
        add(b);
        any = true;
      }
      if (!any) for (const b of bones) add(b);
      return box;
    };

    // Base orientation = auto-computed barrel-forward, then a small correction.
    const tweak = new Quaternion().setFromEuler(new Euler(place.rot[0], place.rot[1], place.rot[2], 'XYZ'));
    const quat = tweak.multiply(g.orientQuat);
    model.position.set(0, 0, 0);
    model.scale.setScalar(1);
    model.quaternion.copy(quat);
    model.updateMatrixWorld(true);
    let s: number;
    if (place.fixedScale !== undefined) {
      s = place.fixedScale;
    } else {
      const size = boundsOf().getSize(new Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      s = place.size / maxDim;
    }
    model.scale.setScalar(s);
    model.updateMatrixWorld(true);
    const c = boundsOf().getCenter(new Vector3());
    model.position.set(place.pos[0] - c.x, place.pos[1] - c.y, place.pos[2] - c.z);
  }

  /** Shows the given gun (hiding others), playing its draw then idle. */
  public show(id: GunId | null): void {
    this.active = id;
    for (const [gid, g] of this.guns) {
      g.mount.visible = gid === id;
    }
    const g = id ? this.guns.get(id) : null;
    if (!g) return;
    // Draw on equip, then the 'finished' handler eases into the idle loop.
    if (g.actions.draw) {
      this.playExclusive(g, g.actions.draw, false);
    } else {
      this.playExclusive(g, g.actions.idle, true);
    }
  }

  /**
   * Plays exactly one action, fading every other action of this gun out. This is
   * the core fix for the "gun flies off / only arms show" bug: previously
   * draw/fire/idle all played at full weight at once and the mixer averaged
   * their transforms into a broken pose.
   */
  private playExclusive(g: GunInstance, action: AnimationAction | null, loop: boolean, fade = 0.12): void {
    if (!action) return;
    for (const other of Object.values(g.actions)) {
      if (other && other !== action && other.isRunning()) {
        other.fadeOut(fade);
      }
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
    const wq = new Quaternion();
    const bq = new Quaternion();
    for (const g of this.guns.values()) {
      if (!g.mount.visible) continue;
      g.mixer.update(dt);
      // Camera-space orientation lock: keep the gun pointing cleanly forward
      // (mount orientation ∘ camRot) regardless of the bone's messy local frame,
      // while still riding the bone's translation (idle sway + fire recoil).
      if (g.gunPivot && g.gunBone && g.gunLockQuat) {
        g.mount.getWorldQuaternion(wq).multiply(g.gunLockQuat); // desired world quat
        g.gunBone.getWorldQuaternion(bq).invert();              // bone world → local
        g.gunPivot.quaternion.copy(bq.multiply(wq));
      }
    }
  }
}
