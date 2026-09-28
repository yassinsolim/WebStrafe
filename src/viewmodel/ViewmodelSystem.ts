import { Euler, Group, Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import { sharedGltfLoader } from '../assets/gltfLoader';
import { DEFAULT_KNIFE_ID, getKnife, isKnifeId, type KnifeId } from '../combat/knives';
import { buildProceduralKnife, disposeProceduralKnife, KNIFE_NODES } from '../cosmetics/ProceduralKnife';
import { disposeKnifeModel, isKnifeModel, loadKnifeModel } from '../cosmetics/knifeAssets';
import { ArmsRig } from './ArmsRig';
import { sampleClip, retime, type Clip } from './clips';
import { blendHandPose, createHandPose, HAND_POSES, type HandPoseName } from './handPoses';
import { frameFromAxes, frameFromXZ, frameFromYZ } from './ik';
import { alignRingGrip, gripKindFor, knifeGripSpec, measureHandleDiameter, type KnifeGripKind, type KnifeGripSpec } from './knifeGrips';
import {
  AWP_CLIPS,
  DEAGLE_CLIPS,
  knifeClip,
  type GunClipName,
  type KnifeClipName,
} from './viewmodelClips';

export type ViewItem = 'knife' | 'deagle' | 'awp';
export type ViewAction = 'idle' | 'draw' | 'fire' | 'reload' | 'inspect' | 'slashA' | 'slashB' | 'stab' | 'backstab';

const DEG = Math.PI / 180;
const GUN_URLS: Record<'deagle' | 'awp', string> = {
  deagle: '/viewmodels/v2/deagle.glb',
  awp: '/viewmodels/v2/awp.glb',
};

/** a hand placed on a socket: wrist position and hand bone frame in socket space */
interface HandGrip {
  matrix: Matrix4;
  pose: HandPoseName;
}

function grip(x: Vector3, y: Vector3, z: Vector3, wrist: Vector3, pose: HandPoseName): HandGrip {
  const q = frameFromAxes(x.normalize(), y.normalize(), z.normalize(), new Quaternion());
  return { matrix: new Matrix4().compose(wrist, q, new Vector3(1, 1, 1)), pose };
}

function gripYZ(y: Vector3, zHint: Vector3, wrist: Vector3, pose: HandPoseName): HandGrip {
  const q = frameFromYZ(y, zHint, new Quaternion());
  return { matrix: new Matrix4().compose(wrist, q, new Vector3(1, 1, 1)), pose };
}

const v = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

// the fist closes around a channel 9.3 cm along the hand bone and 2 cm to the
// palm side of it, running along the knuckle line (local x). right hand on a
// pistol grip: thumb side up the grip, back of the hand to the gun's right.
const RIGHT_PISTOL = grip(v(0, -1, 0), v(0, 0, -1), v(1, 0, 0), v(0.024, -0.004, 0.1), 'pistol');
// support hand wraps the front of the right hand, thumb forward along the frame
const LEFT_PISTOL = gripYZ(v(0.35, -0.55, -0.75), v(-1, 0.1, 0.2), v(-0.035, 0.03, 0.075), 'pistolSupport');
// palm up under the forend, fingers wrapping up the right side
const LEFT_FOREND = gripYZ(v(0.8, 0.3, -0.35), v(0, -1, 0), v(-0.07, -0.035, 0.035), 'forend');
// pinching the bolt knob from above and behind
const RIGHT_BOLT = gripYZ(v(-0.25, -0.35, -0.9), v(1, 0.6, 0.1), v(0.03, 0.035, 0.085), 'pinch');
// palm cupping a magazine baseplate
const LEFT_MAG = gripYZ(v(0.5, 0.2, -0.8), v(0, -1, 0), v(-0.035, -0.03, 0.06), 'cupMag');

interface ItemBase {
  position: Vector3;
  rotation: Quaternion;
}

// where each item's grip socket sits in camera space at idle
const DEAGLE_BASE: ItemBase = { position: v(0.14, -0.155, -0.32), rotation: new Quaternion().setFromEuler(new Euler(0.05, 0.12, 0.03, 'YXZ')) };
const AWP_BASE: ItemBase = { position: v(0.13, -0.165, -0.17), rotation: new Quaternion().setFromEuler(new Euler(0.03, 0.085, 0.03, 'YXZ')) };
// knife bases are given as the blade direction (+x) and the handle's side (+z)
const KNIFE_BASE: ItemBase = {
  position: v(0.125, -0.13, -0.31),
  rotation: frameFromXZ(v(-0.5, 0.42, -0.76), v(0.45, 0.35, 0.8), new Quaternion()),
};

// every grip style starts from the same idle hand: the one implied by the
// tuned hammer-grip pose above, so switching knives never jumps the arm
const HAMMER_GRIP = knifeGripSpec('hammer', 0.026);
const KNIFE_HAND_ROT = KNIFE_BASE.rotation.clone().multiply(HAMMER_GRIP.knifeInHand.clone().invert());
const KNIFE_WRIST = KNIFE_BASE.position.clone().sub(HAMMER_GRIP.anchorInHand.clone().applyQuaternion(KNIFE_HAND_ROT));
// small per style turns of that idle hand (camera space, degrees)
const HAND_TWEAK_DEG: Readonly<Record<KnifeGripKind, [number, number, number]>> = {
  hammer: [0, 0, 0],
  balisong: [0, 0, 0],
  reverse_ring: [0, 0, 0],
  tee: [0, 0, 0],
};

// grip styles that need a different idle hand: given as the knuckle direction
// (hand +y) and the back of the hand (+z), camera space
const HAND_OVERRIDE: Partial<Record<KnifeGripKind, Quaternion>> = {
  // knuckles forward, back of the hand to the right: the little finger side
  // faces down, so the claw comes out under the fist and curves forward
  reverse_ring: frameFromYZ(v(-0.35, 0.25, -0.9), v(0.9, 0.3, 0.15), new Quaternion()),
  // push daggers: knuckles up and forward so the blades rise out of the fists
  tee: frameFromYZ(v(-0.15, 0.82, -0.55), v(0.3, 0.55, 0.8), new Quaternion()),
};

// and where that idle hand sits relative to the hammer grip's wrist, metres
const HAND_OFFSET: Partial<Record<KnifeGripKind, Vector3>> = {
  reverse_ring: v(0.085, 0.07, -0.02),
  tee: v(0.06, 0.0, -0.02),
};

function knifeBaseFor(spec: KnifeGripSpec): ItemBase {
  const [x, y, z] = HAND_TWEAK_DEG[spec.kind];
  const idle = HAND_OVERRIDE[spec.kind] ?? KNIFE_HAND_ROT;
  const hand = new Quaternion().setFromEuler(new Euler(x * DEG, y * DEG, z * DEG, 'YXZ')).multiply(idle);
  return {
    position: KNIFE_WRIST.clone().add(HAND_OFFSET[spec.kind] ?? v(0, 0, 0)).add(spec.anchorInHand.clone().applyQuaternion(hand)),
    rotation: hand.clone().multiply(spec.knifeInHand),
  };
}

// left hand targets that don't hang off an item, camera space
const LEFT_LOW = { position: v(-0.25, -0.5, -0.12), rotation: frameFromYZ(v(0.3, 0.6, -0.7), v(-0.6, 0.3, 0.2), new Quaternion()) };
const LEFT_WATCH = { position: v(0.0, -0.085, -0.27), rotation: frameFromYZ(v(0.96, 0.12, -0.25), v(-0.1, 0.5, 0.86), new Quaternion()) };

// the shoulders sit behind the camera; sliding them is invisible and keeps the
// long rifle reachable
const ARMS_OFFSET: Readonly<Record<ViewItem, Vector3>> = {
  deagle: v(0, 0, 0),
  awp: v(0, 0.01, -0.1),
  knife: v(0, 0, 0),
};
// the awp support hand holds the forend this far behind socket_grip_l
const AWP_SUPPORT_BACK_M = 0.12;

const SCALE_PIVOT = v(0.12, -0.15, -0.32);

const POLE_R = v(0.55, -0.7, 0.05);
const POLE_L = v(-0.55, -0.7, 0.05);

const GUN_DEFAULTS: Readonly<Record<string, number>> = { leftAttach: 1 };
const KNIFE_DEFAULTS: Readonly<Record<string, number>> = { knifeOpen: 1 };

interface GunParts {
  root: Object3D;
  slide: Object3D | null;
  hammer: Object3D | null;
  trigger: Object3D | null;
  mag: Object3D | null;
  bolt: Object3D | null;
  gripR: Object3D;
  gripL: Object3D;
  muzzle: Object3D | null;
  boltKnob: Object3D | null;
  magBottom: Object3D | null;
  rest: Map<Object3D, { position: Vector3; quaternion: Quaternion }>;
}

interface KnifeRig {
  /** how the hand holds it, and where it sits at idle */
  grip: KnifeGripSpec;
  base: ItemBase;
  /** the socket the hand anchors to, knife frame */
  anchorLocal: Vector3;
  id: KnifeId;
  holder: Group;
  spin: Group;
  knife: Group;
  pivotLocal: Vector3;
  bladePivot: Object3D | null;
  handleSafe: Object3D | null;
  handleBite: Object3D | null;
}

// scratch
const mA = new Matrix4();
const mB = new Matrix4();
const pA = new Vector3();
const pB = new Vector3();
const pC = new Vector3();
const qA = new Quaternion();
const qB = new Quaternion();
const qC = new Quaternion();
const sA = new Vector3();
const eA = new Euler(0, 0, 0, 'YXZ');
const poleWorld = new Vector3();

export interface ViewmodelPresentationState {
  active: ViewItem;
  action: ViewAction;
}

/**
 * first-person viewmodel: one arms rig shared by the deagle, the awp and every
 * knife. items sit at a camera space base pose, clips offset them and move
 * their parts, and both arms are solved onto sockets every frame.
 */
export class ViewmodelSystem {
  public readonly root = new Group();
  /** clip events like 'sound:bolt_back' or 'eject' */
  public onEvent: ((name: string, item: ViewItem) => void) | null = null;

  private arms: ArmsRig | null = null;
  private readonly guns: Partial<Record<'deagle' | 'awp', GunParts>> = {};
  private knife: KnifeRig | null = null;
  private knifeLeft: KnifeRig | null = null;
  private knifeId: KnifeId = DEFAULT_KNIFE_ID;
  private readonly itemPivot = new Group();
  /** everything drawn; scaled about a point in front of the eye so the scale setting is visible */
  private readonly content = new Group();

  private active: ViewItem = 'knife';
  private action: ViewAction = 'idle';
  private clip: Clip | null = null;
  private time = 0;
  private loadPromise: Promise<void> | null = null;
  private nextSlash: 'slashA' | 'slashB' = 'slashA';
  private startedAttack: 'primary' | 'secondary' | null = null;
  private idleTime = 0;
  private backstabTarget = 0;
  private backstab = 0;
  private hidden = false;
  private paused = false;
  private loopAction = false;
  private alive = true;
  private readonly channels = new Map<string, number>();
  private readonly fadeFrom = new Map<string, number>();
  private fade = 1;
  private readonly fadeDuration = 0.12;
  private readonly poseR = createHandPose();
  private readonly poseL = createHandPose();
  private readonly poseTmp = createHandPose();
  private clockOverride: Date | null = null;

  constructor() {
    this.root.name = 'ViewmodelSystem';
    this.itemPivot.name = 'ViewmodelItem';
    this.root.add(this.content);
    this.content.add(this.itemPivot);
  }

  /** loads the arms and both guns; knives build on demand */
  public load(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this.loadAll();
    }
    return this.loadPromise;
  }

  public isLoaded(): boolean {
    return this.arms !== null;
  }

  public setKnife(id: KnifeId | null): void {
    const next = isKnifeId(id) ? id : DEFAULT_KNIFE_ID;
    if (next === this.knifeId && this.knife) {
      return;
    }
    this.knifeId = next;
    this.rebuildKnife();
    if (this.active === 'knife') {
      this.play('draw');
    }
  }

  public getKnife(): KnifeId {
    return this.knifeId;
  }

  public equip(item: ViewItem): void {
    this.active = item;
    for (const id of ['deagle', 'awp'] as const) {
      const gun = this.guns[id];
      if (gun) gun.root.visible = id === item;
    }
    if (this.knife) this.knife.holder.visible = item === 'knife';
    if (this.knifeLeft) this.knifeLeft.holder.visible = item === 'knife';
    this.resetParts();
    this.play('draw', true);
  }

  public getActiveItem(): ViewItem {
    return this.active;
  }

  public fire(): void {
    if (this.active === 'knife') return;
    this.play('fire');
  }

  public reload(durationMs?: number): void {
    if (this.active === 'knife') return;
    this.play('reload', false, durationMs ? durationMs / 1000 : undefined);
  }

  public inspect(): boolean {
    if (!this.canInspect()) return false;
    this.play('inspect');
    return true;
  }

  public cancelInspect(): void {
    if (this.action === 'inspect') {
      this.play('idle');
    }
  }

  public canInspect(): boolean {
    return this.isLoaded() && (this.action === 'idle' || this.action === 'inspect');
  }

  public knifeAttack(kind: 'primary' | 'secondary'): void {
    if (this.active !== 'knife') return;
    if (kind === 'primary') {
      this.play(this.nextSlash);
      this.nextSlash = this.nextSlash === 'slashA' ? 'slashB' : 'slashA';
    } else {
      // a stab with a back turned in front of us is the overhand backstab
      this.play(this.backstabTarget > 0.5 ? 'backstab' : 'stab');
    }
    this.startedAttack = kind;
  }

  public consumeStartedAttack(): 'primary' | 'secondary' | null {
    const started = this.startedAttack;
    this.startedAttack = null;
    return started;
  }

  public setBackstabReady(ready: boolean): void {
    this.backstabTarget = ready ? 1 : 0;
  }

  /** hidden while the scope is up */
  public setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.root.visible = !this.hidden && this.alive;
  }

  public setAlive(alive: boolean): void {
    this.alive = alive;
    this.root.visible = !this.hidden && this.alive;
  }

  public setScale(scale: number): void {
    const s = Math.max(0.5, Math.min(1.5, scale));
    // scaling about the eye would look identical, so grow and shrink about the hands
    this.content.scale.setScalar(s);
    this.content.position.copy(SCALE_PIVOT).multiplyScalar(1 - s);
  }

  public isHidden(): boolean {
    return this.hidden;
  }

  public getPresentationState(): ViewmodelPresentationState {
    return { active: this.active, action: this.action };
  }

  /** muzzle socket of the active gun in world space, null for the knife */
  public getMuzzleWorldPosition(out = new Vector3()): Vector3 | null {
    if (this.active === 'knife') return null;
    const muzzle = this.guns[this.active]?.muzzle;
    if (!muzzle) return null;
    this.root.updateWorldMatrix(true, true);
    return muzzle.getWorldPosition(out);
  }

  /** freezes the watch for previews and screenshots */
  public setClockOverride(date: Date | null): void {
    this.clockOverride = date;
  }

  /** jumps to `time` seconds into a clip, for the preview page */
  public seek(action: ViewAction, time: number): void {
    this.play(action, true);
    this.fade = 1;
    this.time = 0;
    this.advance(time, false);
  }

  /** replays the current clip forever (perf runs) */
  public setLoopAction(loop: boolean): void {
    this.loopAction = loop;
  }

  /** holds the current pose (screenshots) */
  public setPaused(paused: boolean): void {
    this.paused = paused;
  }

  public update(dt: number): void {
    if (!this.arms) return;
    this.advance(this.paused ? 0 : Math.max(0, Math.min(0.1, dt)), !this.paused);
  }

  private advance(dt: number, fireEvents: boolean): void {
    const prev = this.time;
    this.time += dt;
    this.idleTime += dt;
    this.fade = Math.min(1, this.fade + dt / this.fadeDuration);
    const blend = 1 - Math.exp(-dt * 10);
    this.backstab += (this.backstabTarget - this.backstab) * blend;

    if (this.clip && fireEvents && this.clip.events) {
      for (const [t, name] of this.clip.events) {
        if (t > prev && t <= this.time) this.onEvent?.(name, this.active);
      }
    }
    if (this.clip && !this.clip.loop && this.time >= this.clip.duration && this.action !== 'idle') {
      this.play(this.loopAction ? this.action : 'idle');
    }
    this.sampleChannels();
    this.pose();
  }

  private play(action: ViewAction, instant = false, duration?: number): void {
    // snapshot for a short crossfade so switching clips never pops
    this.fadeFrom.clear();
    for (const [key, value] of this.channels) this.fadeFrom.set(key, value);
    this.fade = instant ? 1 : 0;
    this.action = action;
    this.time = 0;
    if (action === 'idle') {
      this.clip = null;
      return;
    }
    let clip: Clip | null = null;
    if (this.active === 'knife') {
      clip = knifeClip(getKnife(this.knifeId), action as KnifeClipName);
    } else {
      const set = this.active === 'deagle' ? DEAGLE_CLIPS : AWP_CLIPS;
      clip = set[action as GunClipName] ?? null;
    }
    if (clip && duration && duration > 0) {
      clip = retime(clip, duration);
    }
    this.clip = clip;
    if (!clip) this.action = 'idle';
  }

  private channel(name: string): number {
    return this.channels.get(name) ?? 0;
  }

  private sampleChannels(): void {
    const defaults = this.active === 'knife' ? KNIFE_DEFAULTS : GUN_DEFAULTS;
    const names = new Set<string>([...Object.keys(defaults), ...this.fadeFrom.keys()]);
    if (this.clip) for (const key of Object.keys(this.clip.tracks)) names.add(key);
    for (const name of names) {
      const fallback = defaults[name] ?? 0;
      let value = this.clip ? sampleClip(this.clip, name, this.time, fallback) : fallback;
      if (this.fade < 1) {
        const from = this.fadeFrom.get(name) ?? fallback;
        // step channels (hidden flags) don't blend
        value = name === 'magHidden' ? value : from + (value - from) * smooth(this.fade);
      }
      this.channels.set(name, value);
    }
  }

  private pose(): void {
    const arms = this.arms;
    if (!arms) return;
    this.content.updateWorldMatrix(true, false);

    // idle breathing and the backstab stance ride on top of every clip
    const breathe = Math.sin(this.idleTime * 1.6);
    const px = this.channel('px');
    const py = this.channel('py') + breathe * 0.0015 + this.backstab * 0.025;
    const pz = this.channel('pz') + this.backstab * 0.03;
    eA.set(
      (this.channel('rx') + breathe * 0.25 + this.backstab * 25) * DEG,
      this.channel('ry') * DEG,
      (this.channel('rz') - this.backstab * 20) * DEG,
      'YXZ',
    );
    qA.setFromEuler(eA);

    // the rifle's shoulder offset eases out for the watch check so the forearm stays level
    arms.root.position.copy(ARMS_OFFSET[this.active]).multiplyScalar(1 - this.channel('watch'));
    const base = this.itemBase();
    this.itemPivot.position.set(base.position.x + px, base.position.y + py, base.position.z + pz);
    this.itemPivot.quaternion.copy(qA).multiply(base.rotation);

    if (this.active === 'knife') {
      this.poseKnife(arms);
    } else {
      this.poseGun(arms, this.active);
    }
    arms.updateWatch(this.clockOverride ?? new Date());
  }

  private itemBase(): ItemBase {
    if (this.active === 'deagle') return DEAGLE_BASE;
    if (this.active === 'awp') return AWP_BASE;
    return this.knife?.base ?? KNIFE_BASE;
  }

  private poseGun(arms: ArmsRig, id: 'deagle' | 'awp'): void {
    const gun = this.guns[id];
    if (!gun) return;
    gun.root.position.set(0, 0, 0);
    gun.root.quaternion.identity();
    this.applyGunParts(gun);
    this.itemPivot.updateMatrixWorld(true);

    // right hand: grip, or the bolt knob during a bolt cycle
    const onBolt = this.channel('rightOnBolt');
    this.socketTarget(gun.gripR, RIGHT_PISTOL, pA, qA);
    blendHandPose(HAND_POSES.pistol, HAND_POSES.pistol, 0, this.poseR);
    if (onBolt > 0 && gun.boltKnob) {
      this.socketTarget(gun.boltKnob, RIGHT_BOLT, pB, qB);
      pA.lerp(pB, onBolt);
      qA.slerp(qB, onBolt);
      blendHandPose(HAND_POSES.pistol, HAND_POSES.pinch, onBolt, this.poseR);
    }
    this.poseR.index[1] += this.channel('trigger') * 14;
    arms.setArmVisible('r', true);
    arms.solveArm('r', pA, qA, this.pole(POLE_R));
    arms.applyHandPose('r', this.poseR);

    // left hand: low -> support grip -> magazine -> watch
    const leftGrip = id === 'deagle' ? LEFT_PISTOL : LEFT_FOREND;
    this.cameraTarget(LEFT_LOW, pA, qA);
    blendHandPose(HAND_POSES.relaxed, HAND_POSES.relaxed, 0, this.poseL);
    const attach = this.channel('leftAttach');
    if (attach > 0) {
      this.socketTarget(gun.gripL, leftGrip, pB, qB);
      pA.lerp(pB, attach);
      qA.slerp(qB, attach);
      blendHandPose(HAND_POSES.relaxed, HAND_POSES[leftGrip.pose], attach, this.poseL);
    }
    const onMag = this.channel('leftOnMag');
    if (onMag > 0 && gun.magBottom) {
      this.socketTarget(gun.magBottom, LEFT_MAG, pB, qB);
      pA.lerp(pB, onMag);
      qA.slerp(qB, onMag);
      blendHandPose(this.poseL, HAND_POSES.cupMag, onMag, this.poseL);
    }
    this.blendWatch(pA, qA, this.poseL);
    arms.setArmVisible('l', true);
    arms.solveArm('l', pA, qA, this.pole(POLE_L));
    arms.applyHandPose('l', this.poseL);
  }

  private poseKnife(arms: ArmsRig): void {
    const rig = this.knife;
    if (!rig) return;
    const def = getKnife(this.knifeId);
    const pair = def.shape.pair === true;

    // holder = knife frame in the hand; the grip socket sits on the item pivot
    this.placeHolder(rig, this.itemPivot.position, this.itemPivot.quaternion);
    this.applyKnifeParts(rig);
    rig.holder.updateMatrixWorld(true);

    this.holderTarget(rig, pA, qA);
    const open = this.channel('gripOpen');
    blendHandPose(rig.grip.pose, HAND_POSES.open, open, this.poseR);
    if (rig.grip.kind === 'reverse_ring') {
      // spins hang off the index finger, so it stays hooked through the ring
      this.poseR.index[0] = rig.grip.pose.index[0];
      this.poseR.index[1] = rig.grip.pose.index[1];
      this.poseR.index[2] = rig.grip.pose.index[2];
    }
    arms.setArmVisible('r', true);
    arms.solveArm('r', pA, qA, this.pole(POLE_R));
    arms.applyHandPose('r', this.poseR);

    if (pair && this.knifeLeft) {
      const left = this.knifeLeft;
      mirrorRootPose(rig.holder.position, rig.holder.quaternion, left.holder.position, left.holder.quaternion, MIRROR_KNIFE);
      this.applyKnifeParts(left);
      left.holder.updateMatrixWorld(true);
      // the left hand is the right hand's target mirrored in camera space
      this.content.worldToLocal(pA);
      this.content.getWorldQuaternion(qB);
      qA.premultiply(qB.invert());
      mirrorRootPose(pA, qA, pA, qA, MIRROR_HAND);
      this.content.localToWorld(pA);
      qA.premultiply(this.content.getWorldQuaternion(qB));
      blendHandPose(rig.grip.pose, HAND_POSES.open, open, this.poseL);
      arms.setArmVisible('l', true);
      arms.solveArm('l', pA, qA, this.pole(POLE_L));
      arms.applyHandPose('l', this.poseL);
      return;
    }

    // the left arm only comes in to check the watch
    const showLeft = this.channel('leftAttach') > 0.001 || this.channel('watch') > 0.001;
    arms.setArmVisible('l', showLeft);
    if (showLeft) {
      this.cameraTarget(LEFT_LOW, pA, qA);
      blendHandPose(HAND_POSES.relaxed, HAND_POSES.relaxed, 0, this.poseL);
      this.blendWatch(pA, qA, this.poseL);
      arms.solveArm('l', pA, qA, this.pole(POLE_L));
      arms.applyHandPose('l', this.poseL);
    }
  }

  private blendWatch(pos: Vector3, rot: Quaternion, pose: ReturnType<typeof createHandPose>): void {
    const watch = this.channel('watch');
    if (watch <= 0) return;
    this.cameraTarget(LEFT_WATCH, pC, qC);
    pos.lerp(pC, watch);
    rot.slerp(qC, watch);
    blendHandPose(pose, HAND_POSES.relaxed, watch, this.poseTmp);
    blendHandPose(this.poseTmp, this.poseTmp, 0, pose);
  }

  private placeHolder(rig: KnifeRig, gripPos: Vector3, rotation: Quaternion): void {
    // local root position so the grip socket lands on gripPos
    rig.holder.quaternion.copy(rotation);
    pC.copy(rig.anchorLocal).applyQuaternion(rotation);
    rig.holder.position.copy(gripPos).sub(pC);
  }

  private applyKnifeParts(rig: KnifeRig): void {
    const open = this.channel('knifeOpen');
    if (rig.bladePivot) rig.bladePivot.rotation.z = -Math.PI * (1 - Math.min(1.05, Math.max(0, open)));
    if (rig.handleSafe) rig.handleSafe.rotation.z = Math.PI * this.channel('baliSafe');
    if (rig.handleBite) rig.handleBite.rotation.z = -Math.PI * this.channel('baliBite');
    // spins and rolls happen about the pivot (ring centre or grip) inside the hand
    rig.spin.position.copy(rig.pivotLocal);
    const toss = this.channel('tossY');
    if (toss !== 0) {
      // the toss goes straight up the screen, whatever way the knife points
      qC.copy(rig.holder.quaternion).invert();
      rig.spin.position.addScaledVector(pC.set(0, 1, 0.25).normalize().applyQuaternion(qC), toss);
    }
    eA.set(this.channel('rollX') * DEG, 0, this.channel('spinZ') * DEG, 'XYZ');
    rig.spin.quaternion.setFromEuler(eA);
    rig.knife.position.copy(rig.pivotLocal).negate();
  }

  private applyGunParts(gun: GunParts): void {
    const rest = (node: Object3D | null) => (node ? gun.rest.get(node) : undefined);
    if (gun.slide) {
      const r = rest(gun.slide)!;
      gun.slide.position.copy(r.position);
      gun.slide.position.z += num(gun.slide.userData.travel_m, 0.05) * this.channel('slide');
    }
    if (gun.hammer) {
      const r = rest(gun.hammer)!;
      gun.hammer.quaternion.copy(r.quaternion);
      gun.hammer.rotateX(num(gun.hammer.userData.fire_rot_x_deg, -55) * DEG * this.channel('hammer'));
    }
    if (gun.trigger) {
      const r = rest(gun.trigger)!;
      gun.trigger.quaternion.copy(r.quaternion);
      gun.trigger.rotateX(num(gun.trigger.userData.pull_rot_x_deg, -14) * DEG * this.channel('trigger'));
    }
    if (gun.bolt) {
      const r = rest(gun.bolt)!;
      gun.bolt.quaternion.copy(r.quaternion);
      gun.bolt.rotateZ(num(gun.bolt.userData.lift_rot_z_deg, 60) * DEG * this.channel('boltLift'));
      gun.bolt.position.copy(r.position);
      gun.bolt.position.z += num(gun.bolt.userData.travel_m, 0.1) * this.channel('boltBack');
    }
    if (gun.mag) {
      const r = rest(gun.mag)!;
      const dir = Array.isArray(gun.mag.userData.drop_dir) ? gun.mag.userData.drop_dir as number[] : [0, -1, 0];
      const dist = num(gun.mag.userData.drop_m, 0.14) * this.channel('mag');
      gun.mag.position.set(r.position.x + dir[0] * dist, r.position.y + dir[1] * dist, r.position.z + dir[2] * dist);
      gun.mag.visible = this.channel('magHidden') < 0.5;
    }
  }

  private resetParts(): void {
    this.channels.clear();
    this.fadeFrom.clear();
    this.backstab = 0;
  }

  /** world wrist position and hand rotation for `g` on `socket` */
  private socketTarget(socket: Object3D, g: HandGrip, outPos: Vector3, outRot: Quaternion): void {
    mA.multiplyMatrices(socket.matrixWorld, g.matrix);
    mA.decompose(outPos, outRot, sA);
  }

  private holderTarget(rig: KnifeRig, outPos: Vector3, outRot: Quaternion): void {
    // the hand follows the holder frame, not the spinning knife
    mB.compose(rig.anchorLocal, qB.identity(), sA.set(1, 1, 1));
    mA.multiplyMatrices(rig.holder.matrixWorld, mB).multiply(rig.grip.handInAnchor);
    mA.decompose(outPos, outRot, sA);
  }

  private cameraTarget(target: { position: Vector3; rotation: Quaternion }, outPos: Vector3, outRot: Quaternion): void {
    outPos.copy(target.position);
    this.content.localToWorld(outPos);
    this.content.getWorldQuaternion(outRot).multiply(target.rotation);
  }

  private pole(local: Vector3): Vector3 {
    return this.content.localToWorld(poleWorld.copy(local));
  }

  private async loadAll(): Promise<void> {
    const [arms, deagle, awp] = await Promise.all([
      ArmsRig.load(),
      sharedGltfLoader().loadAsync(GUN_URLS.deagle),
      sharedGltfLoader().loadAsync(GUN_URLS.awp),
    ]);
    this.arms = arms;
    this.content.add(arms.root);
    this.guns.deagle = this.setupGun(deagle.scene);
    this.guns.awp = this.setupGun(awp.scene);
    this.rebuildKnife();
    this.equip(this.active);
  }

  private setupGun(scene: Object3D): GunParts {
    const find = (name: string) => scene.getObjectByName(name) ?? null;
    scene.traverse((node) => {
      node.frustumCulled = false;
    });
    const gun: GunParts = {
      root: scene,
      slide: find('slide'),
      hammer: find('hammer'),
      trigger: find('trigger'),
      mag: find('mag'),
      bolt: find('bolt'),
      gripR: find('socket_grip_r') ?? scene,
      gripL: supportSocket(scene),
      muzzle: find('socket_muzzle'),
      boltKnob: find('socket_bolt_knob'),
      magBottom: find('socket_mag_bottom'),
      rest: new Map(),
    };
    for (const node of [gun.slide, gun.hammer, gun.trigger, gun.mag, gun.bolt]) {
      if (node) gun.rest.set(node, { position: node.position.clone(), quaternion: node.quaternion.clone() });
    }
    scene.visible = false;
    this.itemPivot.add(scene);
    return gun;
  }

  private rebuildKnife(): void {
    const id = this.knifeId;
    this.installKnife(null, null);
    // swap in the blender model once it's loaded (if one exists for this knife)
    void Promise.all([loadKnifeModel(id), getKnife(id).shape.pair ? loadKnifeModel(id) : Promise.resolve(null)])
      .then(([model, second]) => {
        if (!model) return;
        if (this.knifeId !== id) {
          disposeKnifeModel(model);
          if (second) disposeKnifeModel(second);
          return;
        }
        this.installKnife(model, second);
      });
  }

  /** builds the knife rigs from the given models, or procedural knives when null */
  private installKnife(model: Group | null, second: Group | null): void {
    for (const rig of [this.knife, this.knifeLeft]) {
      if (rig) {
        rig.holder.removeFromParent();
        if (isKnifeModel(rig.knife)) disposeKnifeModel(rig.knife);
        else disposeProceduralKnife(rig.knife);
      }
    }
    this.knife = null;
    this.knifeLeft = null;
    const def = getKnife(this.knifeId);
    this.knife = this.makeKnifeRig(model);
    if (def.shape.pair) {
      this.knifeLeft = this.makeKnifeRig(second);
    }
    const visible = this.active === 'knife';
    this.knife.holder.visible = visible;
    if (this.knifeLeft) this.knifeLeft.holder.visible = visible;
    this.onKnifeRigsChanged?.();
  }

  /** hook for the finish system to repaint freshly built knives */
  public onKnifeRigsChanged: (() => void) | null = null;

  /** the knife objects currently in hand (one, or two for the push daggers) */
  public getKnifeObjects(): Object3D[] {
    return [this.knife?.knife, this.knifeLeft?.knife].filter((k): k is Group => !!k);
  }

  private makeKnifeRig(model: Group | null = null): KnifeRig {
    const def = getKnife(this.knifeId);
    const knife = model ?? buildProceduralKnife(def);
    knife.traverse((node) => {
      node.frustumCulled = false;
    });
    const holder = new Group();
    holder.name = 'KnifeHolder';
    const spin = new Group();
    holder.add(spin);
    spin.add(knife);
    knife.updateMatrixWorld(true);
    const gripNode = knife.getObjectByName(KNIFE_NODES.grip);
    const ringNode = knife.getObjectByName(KNIFE_NODES.ring);
    const gripLocal = gripNode ? gripNode.getWorldPosition(new Vector3()) : new Vector3(-0.05, 0, 0);
    const ringLocal = ringNode ? ringNode.getWorldPosition(new Vector3()) : null;
    const teeNode = knife.getObjectByName('socket_tee');
    let grip = knifeGripSpec(gripKindFor(def), measureHandleDiameter(knife));
    if (ringLocal) grip = alignRingGrip(grip, ringLocal, gripLocal);
    const anchorLocal = grip.anchor === 'ring' && ringLocal
      ? ringLocal.clone()
      : grip.anchor === 'tee' && teeNode ? teeNode.getWorldPosition(new Vector3()) : gripLocal.clone();
    // ring knives spin on the ring (the index finger), everything else on the grip
    const pivotLocal = ringLocal && grip.kind === 'reverse_ring' ? ringLocal.clone() : gripLocal.clone();
    // the knife group sits at its origin inside the holder, so world = local here
    this.content.add(holder);
    return {
      id: def.id,
      holder,
      spin,
      knife,
      grip,
      base: knifeBaseFor(grip),
      anchorLocal,
      pivotLocal,
      bladePivot: knife.getObjectByName(KNIFE_NODES.bladePivot) ?? null,
      handleSafe: knife.getObjectByName(KNIFE_NODES.handleSafe) ?? null,
      handleBite: knife.getObjectByName(KNIFE_NODES.handleBite) ?? null,
    };
  }
}

function supportSocket(scene: Object3D): Object3D {
  const socket = scene.getObjectByName('socket_grip_l');
  if (!socket) return scene;
  if (scene.getObjectByName('bolt')) {
    // the rifle's forend panel is out of reach for the rig, grip it closer in
    const near = new Object3D();
    near.name = 'viewmodel_support';
    near.position.copy(socket.position);
    near.position.z += AWP_SUPPORT_BACK_M;
    near.quaternion.copy(socket.quaternion);
    socket.parent?.add(near);
    return near;
  }
  return socket;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function smooth(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

const mirrorM = new Matrix4().makeScale(-1, 1, 1);
const mirrorTmp = new Matrix4();
// knife: tip and spine mirror, thickness flips so it stays a rotation
const MIRROR_KNIFE = new Matrix4().makeScale(1, 1, -1);
// hand bones: y and z mirror, x flips (same rule as the rig's left side)
const MIRROR_HAND = new Matrix4().makeScale(-1, 1, 1);

/** mirrors a camera space pose across the view's vertical centre plane */
function mirrorRootPose(pos: Vector3, rot: Quaternion, outPos: Vector3, outRot: Quaternion, local: Matrix4): void {
  outPos.set(-pos.x, pos.y, pos.z);
  mirrorTmp.makeRotationFromQuaternion(rot);
  mirrorTmp.premultiply(mirrorM).multiply(local);
  outRot.setFromRotationMatrix(mirrorTmp);
}
