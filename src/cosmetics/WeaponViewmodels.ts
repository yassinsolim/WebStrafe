import {
  AnimationClip,
  AnimationMixer,
  Box3,
  Group,
  LoopRepeat,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type AnimationAction,
  type KeyframeTrack,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type GunId = 'deagle' | 'awp';

/**
 * Per-gun viewmodel config. Both guns are built (in tools/blender) on the SAME
 * proven arms + rig + `anims` clip as the knife viewmodel: a `Gun` mesh is
 * parented to the wrist attachment so the animated hands grip it. We therefore
 * load them exactly like the knife — a skinned model playing the idle sub-range
 * of `anims`, normalized to viewmodel size with a base transform applied.
 */
interface GunConfig {
  url: string;
  /** Idle loop sub-range of the `anims` clip, in seconds. */
  idle: [number, number];
  /** Target bounding diagonal (keeps the arms viewmodel-sized, like the knife). */
  targetDiagonal: number;
  /** Base placement of the model inside its mount (sway is applied to root). */
  basePos: [number, number, number];
  baseRot: [number, number, number];
  /**
   * Downward pitch (radians) applied to the seated barrel so the gun rests at a
   * natural slight downward angle instead of laser-level.
   */
  barrelPitch: number;
  /**
   * Sideways yaw (radians) applied to the seated barrel. 0 aims dead-forward
   * (fine for a pistol); a long rifle reads better canted a little so its side
   * profile + scope are visible instead of a foreshortened pole.
   */
  barrelYaw: number;
}

const CONFIGS: Record<GunId, GunConfig> = {
  deagle: {
    url: '/viewmodels/deagle/deagle.glb',
    idle: [0, 1],
    targetDiagonal: 0.62,
    basePos: [0.14, -0.09, -0.36],
    baseRot: [0.06, Math.PI, 0.02],
    barrelPitch: 0.08,
    barrelYaw: 0.03,
  },
  awp: {
    url: '/viewmodels/awp/awp.glb',
    idle: [0, 1],
    targetDiagonal: 0.8,
    basePos: [0.17, -0.14, -0.4],
    baseRot: [0.06, Math.PI, 0.02],
    barrelPitch: 0.05,
    barrelYaw: 0.58,
  },
};

interface GunInstance {
  id: GunId;
  cfg: GunConfig;
  mount: Group;
  model: Object3D;
  /** The `Gun` mesh, cached so we can re-seat it every frame (no per-frame traverse). */
  gunMesh: Object3D | null;
  mixer: AnimationMixer;
  idle: AnimationAction | null;
}

/**
 * Animated first-person Deagle + AWP viewmodels. Both share the knife's rig and
 * gripping arms (credited in README + menu): the real Deagle gun mesh is bolted
 * into the hand, and the AWP is a clean built rifle in the same hands. GameApp
 * shows one at a time based on the active weapon and drives sway/bob/fire-kick
 * onto {@link root} each frame; the knife keeps its own viewmodel in
 * CosmeticsManager.
 */
export class WeaponViewmodels {
  public readonly root = new Group();
  private readonly loader = new GLTFLoader();
  private readonly guns = new Map<GunId, GunInstance>();

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
      }
    });

    // Normalize to viewmodel size, then apply base transform inside a mount so the
    // camera-space sway/bob/kick that GameApp copies onto `root` composes cleanly.
    this.normalizeScale(model, cfg.targetDiagonal);
    model.position.set(cfg.basePos[0], cfg.basePos[1], cfg.basePos[2]);
    model.rotation.set(cfg.baseRot[0], cfg.baseRot[1], cfg.baseRot[2]);

    const mount = new Group();
    mount.name = `gun:${id}`;
    mount.add(model);
    mount.visible = false;
    this.root.add(mount);

    const mixer = new AnimationMixer(model);
    const source = gltf.animations.find((c) => /anims/i.test(c.name)) ?? gltf.animations[0];
    let idle: AnimationAction | null = null;
    if (source) {
      const idleClip = this.trimClip(source, cfg.idle[0], cfg.idle[1], `${id}-idle`);
      idle = mixer.clipAction(idleClip);
      idle.setLoop(LoopRepeat, Infinity);
      idle.play();
      mixer.update(0);
    }

    // The `Gun` mesh is authored barrel-along-local-(-Z) in the knife rig's wrist
    // frame, so the rig's wrist rotation alone doesn't aim it where the player looks.
    // We reorient it so the muzzle points forward (camera -Z). Because the idle
    // animation rotates the wrist every frame, a one-time seat drifts (the barrel
    // dips as the hand moves), so we cache the mesh and re-seat it every frame in
    // update() — see seatGunForward.
    let gunMesh: Object3D | null = null;
    model.traverse((o) => {
      if (o.name === 'Gun') gunMesh = o;
    });
    this.seatGunForward(gunMesh, cfg.barrelPitch, cfg.barrelYaw);

    this.guns.set(id, { id, cfg, mount, model, gunMesh, mixer, idle });
  }

  /**
   * Orients the `Gun` mesh so its muzzle points along the viewmodel forward
   * (`root` -Z, i.e. where the player aims) with `pitch` radians of downward tilt
   * and `yaw` radians of sideways cant, and its top points up. Both gun GLBs are
   * authored with the standard glTF viewmodel convention — barrel along local -Z,
   * up along local +Y (verified from geometry) — so we align those two local axes
   * to the target world directions. Computed relative to the animated wrist parent
   * so the grip stays in the hand; the camera + sway rotation cancel out (both
   * `refQ` and `parentQ` carry them), so we recompute every frame and the barrel
   * never drifts as the idle animation moves the wrist.
   */
  private seatGunForward(gun: Object3D | null, pitch: number, yaw: number): void {
    if (!gun || !gun.parent) return;

    this.root.updateWorldMatrix(true, true);
    const refQ = new Quaternion();
    this.root.getWorldQuaternion(refQ);
    // Target world direction for the muzzle (root-space forward, pitched down + yawed).
    const fwd = new Vector3(
      Math.sin(yaw) * Math.cos(pitch),
      -Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch),
    )
      .applyQuaternion(refQ)
      .normalize();
    const upW = new Vector3(0, 1, 0).applyQuaternion(refQ).normalize();
    // Build an orthonormal right-handed basis mapping the gun's LOCAL axes to world:
    // local +Z -> -fwd (so local -Z, the barrel, points along fwd) and local +Y -> up.
    const zCol = fwd.clone().negate();
    const yCol = upW.clone().sub(zCol.clone().multiplyScalar(upW.dot(zCol))).normalize();
    const xCol = new Vector3().crossVectors(yCol, zCol).normalize();
    const desired = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(xCol, yCol, zCol));
    const parentQ = new Quaternion();
    gun.parent.getWorldQuaternion(parentQ);
    gun.quaternion.copy(parentQ.invert().multiply(desired));
    gun.updateMatrix();
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

  /** Scales the model so its bounding diagonal equals `target` (like the knife). */
  private normalizeScale(model: Object3D, target: number): void {
    model.updateWorldMatrix(true, true);
    const bounds = new Box3().setFromObject(model);
    if (bounds.isEmpty()) return;
    const diagonal = bounds.getSize(new Vector3()).length();
    if (!Number.isFinite(diagonal) || diagonal <= 1e-6) return;
    model.scale.multiplyScalar(target / diagonal);
    model.updateWorldMatrix(true, true);
  }

  /**
   * Extracts a looping sub-clip covering [start, end] seconds from a source clip
   * (rebased to 0). Used to loop just the idle segment of the shared `anims`
   * animation, so the guns idle instead of playing the knife's attack swings.
   */
  private trimClip(clip: AnimationClip, start: number, end: number, name: string): AnimationClip {
    const tracks: KeyframeTrack[] = [];
    for (const track of clip.tracks) {
      const stride = track.getValueSize();
      const times: number[] = [];
      const values: number[] = [];
      for (let i = 0; i < track.times.length; i += 1) {
        const t = track.times[i];
        if (t >= start - 1e-4 && t <= end + 1e-4) {
          times.push(t - start);
          for (let j = 0; j < stride; j += 1) values.push(track.values[i * stride + j]);
        }
      }
      if (times.length >= 2) {
        const Ctor = track.constructor as new (n: string, t: number[], v: number[]) => KeyframeTrack;
        tracks.push(new Ctor(track.name, times, values));
      }
    }
    if (!tracks.length) return clip; // degenerate range: fall back to whole clip
    return new AnimationClip(name, Math.max(end - start, 1e-3), tracks);
  }

  /** Shows the given gun (hiding others), (re)starting its idle loop. */
  public show(id: GunId | null): void {
    for (const [gid, g] of this.guns) {
      g.mount.visible = gid === id;
    }
    const g = id ? this.guns.get(id) : null;
    if (g?.idle) {
      g.idle.reset();
      g.idle.play();
    }
  }

  /**
   * Fire/reload feedback is driven procedurally by ViewmodelRenderer (sway/bob/
   * fire-kick copied onto {@link root} by GameApp), so these are intentionally
   * light — the shared knife clip has no gun-specific fire/reload segments.
   */
  public triggerFire(): void {
    // procedural fire-kick handles the recoil; no authored gun-fire clip.
  }

  public triggerReload(): void {
    // no authored gun-reload clip; reload state is handled by weapon logic + HUD.
  }

  public update(dt: number): void {
    for (const g of this.guns.values()) {
      if (!g.mount.visible) continue;
      g.mixer.update(dt);
      // Re-seat AFTER the mixer moves the wrist, so the barrel stays locked forward
      // instead of dipping as the idle animation plays.
      this.seatGunForward(g.gunMesh, g.cfg.barrelPitch, g.cfg.barrelYaw);
    }
  }
}
