import {
  AnimationMixer,
  Box3,
  BoxGeometry,
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
  /**
   * Procedural builder. When set, the gun is built from primitives instead of
   * loaded from a GLB (used for the Deagle, whose only available animated GLB
   * has a broken mesh export — gun and hand meshes at incompatible 1:8000
   * scales in one skeleton, so it cannot render). Placed directly at `pos`/`rot`
   * scaled by `fixedScale`; no skeletal animation, just a recoil kick on fire.
   */
  build?: () => Object3D;
}

/** Builds a clean first-person Desert Eagle from primitives (dark gunmetal). */
function buildDeagle(): Object3D {
  const g = new Group();
  const metal = new MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.85, roughness: 0.38 });
  const dark = new MeshStandardMaterial({ color: 0x17191d, metalness: 0.8, roughness: 0.5 });
  const grip = new MeshStandardMaterial({ color: 0x3b3f46, metalness: 0.35, roughness: 0.7 });
  const gold = new MeshStandardMaterial({ color: 0xb8963f, metalness: 0.9, roughness: 0.3 });
  const box = (w: number, h: number, d: number, mat: MeshStandardMaterial, x: number, y: number, z: number, rx = 0) => {
    const m = new Mesh(new BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false;
    g.add(m);
    return m;
  };
  // Slide (top), running along -Z (forward). Length in Z.
  box(0.5, 0.5, 2.0, metal, 0, 0.42, -0.6);
  // Slide serrations hint (rear block).
  box(0.52, 0.52, 0.35, dark, 0, 0.42, 0.35);
  // Barrel opening at the muzzle.
  box(0.42, 0.42, 0.18, dark, 0, 0.42, -1.65);
  // Gold accent line on the slide.
  box(0.54, 0.06, 1.4, gold, 0, 0.62, -0.5);
  // Frame / lower under the slide.
  box(0.46, 0.34, 1.5, dark, 0, 0.1, -0.35);
  // Trigger guard.
  box(0.42, 0.36, 0.16, metal, 0, -0.14, -0.15);
  box(0.42, 0.1, 0.5, metal, 0, -0.28, 0.0);
  // Grip, raked back-down.
  box(0.44, 1.2, 0.55, grip, 0, -0.75, 0.55, -0.34);
  // Rear + front sights.
  box(0.1, 0.14, 0.12, dark, 0, 0.72, 0.5);
  box(0.08, 0.14, 0.1, dark, 0, 0.72, -1.5);
  return g;
}

const PLACEMENTS: Record<GunId, GunPlacement> = {
  deagle: {
    rot: [0.05, -0.5, 0.05],
    pos: [0.2, -0.2, -0.52],
    size: 0.16,
    fixedScale: 0.17,
    focus: [],
    clips: { idle: /idle/i, draw: /equip|draw/i, fire: /fire/i, reload: /reload(?!_empty)/i },
    hide: [],
    build: buildDeagle,
  },
  awp: {
    rot: [0.06, 0.05, 0],
    pos: [0.03, -0.2, -0.55],
    size: 0.82,
    focus: [],
    clips: { idle: /idle/i, draw: /draw|equip/i, fire: /fire/i, reload: /reload/i },
    hide: [],
  },
};

const GUN_URLS: Partial<Record<GunId, string>> = {
  awp: '/viewmodels/awp/awp.glb',
};

interface GunInstance {
  id: GunId;
  mount: Group;
  model: Object3D;
  mixer: AnimationMixer | null;
  actions: { idle: AnimationAction | null; draw: AnimationAction | null; fire: AnimationAction | null; reload: AnimationAction | null };
  bones: Bone[];
  /** Auto-computed base orientation that points the barrel forward (-Z). */
  orientQuat: Quaternion;
  /** Procedural guns animate a simple recoil kick instead of skeletal clips. */
  procedural: boolean;
  recoil: number;
}

/**
 * Animated first-person Deagle and AWP viewmodels loaded from real GLB assets
 * (Sketchfab, credited in CREDITS.md). Each carries its own arms + skeleton and
 * plays draw/idle/fire/reload clips. GameApp shows one at a time based on the
 * active weapon; the knife keeps its own viewmodel in CosmeticsManager.
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
    if (place.build) {
      this.buildProceduralGun(id, place);
      return;
    }
    const url = GUN_URLS[id];
    if (!url) return;
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
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          const std = m as MeshStandardMaterial;
          if (std.map) std.map.colorSpace = SRGBColorSpace;
          std.depthWrite = true;
          std.depthTest = true;
          std.needsUpdate = true;
        }
      }
    });

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
    const instance: GunInstance = { id, mount, model, mixer, actions, bones, orientQuat, procedural: false, recoil: 0 };
    this.fit(instance);
    mixer.stopAllAction();

    // When a one-shot (draw/fire/reload) finishes, ease back to the idle loop so
    // the gun never gets stuck in a clamped end pose or blended between clips.
    mixer.addEventListener('finished', () => {
      if (this.active === id) this.playExclusive(instance, instance.actions.idle, true);
    });

    this.guns.set(id, instance);
  }

  /** Builds a procedural gun (primitives) and places it directly in camera space. */
  private buildProceduralGun(id: GunId, place: GunPlacement): void {
    const model = place.build!();
    model.traverse((o) => {
      if (o instanceof Mesh) o.frustumCulled = false;
    });
    model.scale.setScalar(place.fixedScale ?? 1);
    model.setRotationFromEuler(new Euler(place.rot[0], place.rot[1], place.rot[2], 'XYZ'));
    model.position.set(place.pos[0], place.pos[1], place.pos[2]);

    const mount = new Group();
    mount.name = `gun:${id}`;
    mount.add(model);
    mount.visible = false;
    this.root.add(mount);

    const instance: GunInstance = {
      id, mount, model,
      mixer: null,
      actions: { idle: null, draw: null, fire: null, reload: null },
      bones: [],
      orientQuat: new Quaternion(),
      procedural: true,
      recoil: 0,
    };
    this.guns.set(id, instance);
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
    if (!g) return;
    if (g.procedural) {
      g.recoil = 1;
      return;
    }
    if (!g.actions.fire) return;
    this.playExclusive(g, g.actions.fire, false, 0.03);
  }

  /** Plays the reload animation for the active gun. */
  public triggerReload(): void {
    const g = this.active ? this.guns.get(this.active) : null;
    if (!g || g.procedural || !g.actions.reload) return;
    this.playExclusive(g, g.actions.reload, false, 0.08);
  }

  public update(dt: number): void {
    for (const g of this.guns.values()) {
      if (!g.mount.visible) continue;
      if (g.procedural) {
        // Simple recoil: kick the gun back + up, then ease home.
        if (g.recoil > 1e-3) g.recoil = Math.max(0, g.recoil - dt * 6);
        const place = PLACEMENTS[g.id];
        const k = g.recoil * g.recoil;
        g.model.position.set(place.pos[0], place.pos[1] + k * 0.02, place.pos[2] + k * 0.06);
        g.model.rotation.x = place.rot[0] - k * 0.25;
      } else {
        g.mixer?.update(dt);
      }
    }
  }
}


