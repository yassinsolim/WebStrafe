import {
  AnimationMixer,
  Box3,
  Euler,
  Group,
  LoopOnce,
  LoopRepeat,
  Mesh,
  Object3D,
  SRGBColorSpace,
  Vector3,
  type AnimationAction,
  type AnimationClip,
  type Bone,
  type MeshStandardMaterial,
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
  /** Orientation of the model in camera space (radians, XYZ Euler). */
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
}

const PLACEMENTS: Record<GunId, GunPlacement> = {
  deagle: {
    rot: [0.05, -0.6, -0.12],
    pos: [0.11, -0.09, -0.4],
    size: 0.4,
    focus: ['hand', 'wrist', 'finger', 'thumb', 'index', 'deagle', 'slide', 'body'],
    clips: { idle: /idle/i, draw: /equip|draw/i, fire: /fire/i, reload: /reload(?!_empty)/i },
    hide: ['aim', 'skybox', 'watch_emission'],
  },
  awp: {
    rot: [-0.18, 0.06, 0],
    pos: [0.06, -0.24, -0.58],
    size: 1.02,
    focus: [],
    clips: { idle: /idle/i, draw: /draw|equip/i, fire: /fire/i, reload: /reload/i },
    hide: [],
  },
};

const GUN_URLS: Record<GunId, string> = {
  deagle: '/viewmodels/deagle/deagle.glb',
  awp: '/viewmodels/awp/awp.glb',
};

interface GunInstance {
  id: GunId;
  mount: Group;
  mixer: AnimationMixer;
  actions: { idle: AnimationAction | null; draw: AnimationAction | null; fire: AnimationAction | null; reload: AnimationAction | null };
  bones: Bone[];
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

  /** Loads and fits both gun models. Safe to call once during init. */
  public async load(): Promise<void> {
    await Promise.all((Object.keys(GUN_URLS) as GunId[]).map((id) => this.loadGun(id)));
  }

  private async loadGun(id: GunId): Promise<void> {
    const place = PLACEMENTS[id];
    const gltf = await this.loader.loadAsync(GUN_URLS[id]);
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
    const action = (re: RegExp, loop: boolean): AnimationAction | null => {
      const clip = find(re);
      if (!clip) return null;
      const a = mixer.clipAction(clip);
      a.setLoop(loop ? LoopRepeat : LoopOnce, Infinity);
      a.clampWhenFinished = !loop;
      return a;
    };
    const actions = {
      idle: action(place.clips.idle, true),
      draw: action(place.clips.draw, false),
      fire: action(place.clips.fire, false),
      reload: action(place.clips.reload, false),
    };

    // Prime one frame at the idle pose so bone matrices are valid, then auto-fit.
    (actions.idle ?? mixer.clipAction(clips[0]))?.play();
    mixer.update(0);
    this.fit(model, bones, place);

    this.guns.set(id, { id, mount, mixer, actions, bones });
  }

  /** Scales + centres the model so its focused bones fill the placement box. */
  private fit(model: Object3D, bones: Bone[], place: GunPlacement): void {
    const focus = (b: Bone): boolean => {
      const n = b.name.toLowerCase();
      return place.focus.some((t) => n.includes(t));
    };
    const boundsOf = (): Box3 => {
      model.updateMatrixWorld(true);
      const box = new Box3();
      const v = new Vector3();
      let any = false;
      for (const b of bones) {
        if (!focus(b)) continue;
        b.getWorldPosition(v);
        box.expandByPoint(v);
        any = true;
      }
      if (!any) for (const b of bones) { b.getWorldPosition(v); box.expandByPoint(v); }
      return box;
    };

    model.position.set(0, 0, 0);
    model.scale.setScalar(1);
    model.setRotationFromEuler(new Euler(place.rot[0], place.rot[1], place.rot[2], 'XYZ'));
    model.updateMatrixWorld(true);
    const size = boundsOf().getSize(new Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const s = place.size / maxDim;
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
    if (g) this.playDraw(g);
  }

  private playDraw(g: GunInstance): void {
    g.mixer.stopAllAction();
    if (g.actions.draw) {
      g.actions.draw.reset().play();
      const dur = g.actions.draw.getClip().duration;
      window.setTimeout(() => {
        if (this.active === g.id) this.playIdle(g);
      }, dur * 1000);
    } else {
      this.playIdle(g);
    }
  }

  private playIdle(g: GunInstance): void {
    if (g.actions.idle) {
      g.actions.idle.reset().play();
    }
  }

  /** Plays the fire animation for the active gun (one-shot over idle). */
  public triggerFire(): void {
    const g = this.active ? this.guns.get(this.active) : null;
    if (!g?.actions.fire) return;
    g.actions.fire.reset().play();
    const dur = g.actions.fire.getClip().duration || 0.2;
    window.setTimeout(() => {
      if (this.active === g.id) this.playIdle(g);
    }, dur * 1000);
  }

  /** Plays the reload animation for the active gun. */
  public triggerReload(): void {
    const g = this.active ? this.guns.get(this.active) : null;
    if (!g?.actions.reload) return;
    g.mixer.stopAllAction();
    g.actions.reload.reset().play();
    const dur = g.actions.reload.getClip().duration || 2;
    window.setTimeout(() => {
      if (this.active === g.id) this.playIdle(g);
    }, dur * 1000);
  }

  public update(dt: number): void {
    for (const g of this.guns.values()) {
      if (g.mount.visible) g.mixer.update(dt);
    }
  }
}


