import { Euler, Group, Matrix4, Mesh, MeshBasicMaterial, Object3D, Quaternion, SphereGeometry, Vector3, type Camera } from 'three';
import { sharedGltfLoader } from '../assets/gltfLoader';
import { DEFAULT_KNIFE_ID, getKnife, isKnifeId, type KnifeId } from '../combat/knives';
import { buildProceduralKnife, disposeProceduralKnife, KNIFE_NODES } from '../cosmetics/ProceduralKnife';
import { disposeKnifeModel, isKnifeModel, loadKnifeModel } from '../cosmetics/knifeAssets';
import { applyKnifeFinish, type KnifeFinishSelection } from '../cosmetics/finishes/applyFinish';
import { ArmsRig, type DigitSpread } from './ArmsRig';
import { checkGrip, type GripCheck } from './gripCheck';
import { FirstPersonArmor } from '../characters/fpArmor';
import type { CharacterLook } from '../characters/look';
import type { PlayerModel } from '../network/types';
import { sampleClip, seqWeights, retime, type Clip, type SeqKey, type SeqWeights } from './clips';
import { blendHandPose, createHandPose, HAND_POSES, type HandPose, type HandPoseName, type MutableHandPose } from './handPoses';
import { frameFromYZ } from './ik';
import { angularVelocity, createSpring, QuatInertializer, ScalarInertializer, smoothstep, springStep, Vec3Inertializer } from './motion';
import { fittedAttackPoses, frameXY, handKey, KNIFE_IDLES, KNIFE_LEFT_FISTS, KNIFE_POSES, knifeKey, leftHandKey, resolveKnifeKey, type ItemBase, type LeftHandKey } from './knifePoses';
import { alignRingGrip, fittedGripSpec, gripKindFor, knifeGripSpec, measureHandleDiameter, type KnifeGripSpec } from './knifeGrips';
import { knifeClip, knifeInspectCount, type KnifeClipName } from './knifeClips';
import {
  AWP_CLIPS,
  DEAGLE_CLIPS,
  KATANA_CLIPS,
  type GunClipName,
  type KatanaClipName,
} from './viewmodelClips';

export type ViewItem = 'knife' | 'deagle' | 'awp' | 'katana';
export type ViewAction = 'idle' | 'draw' | 'fire' | 'reload' | 'inspect' | 'slashA' | 'slashB' | 'stab' | 'backstab';
/** items held on sockets with the arms solved onto them (the katana included) */
type GunItem = 'deagle' | 'awp' | 'katana';
const GUN_ITEMS: readonly GunItem[] = ['deagle', 'awp', 'katana'];

const DEG = Math.PI / 180;
const GUN_URLS: Record<GunItem, string> = {
  deagle: '/viewmodels/v2/deagle.glb',
  awp: '/viewmodels/v2/awp.glb',
  katana: '/viewmodels/v2/katana.glb',
};

/** a hand placed on a socket: wrist position and hand bone frame in socket space */
interface HandGrip {
  matrix: Matrix4;
  pose: HandPoseName;
}

function gripYZ(y: Vector3, zHint: Vector3, wrist: Vector3, pose: HandPoseName): HandGrip {
  const q = frameFromYZ(y, zHint, new Quaternion());
  return { matrix: new Matrix4().compose(wrist, q, new Vector3(1, 1, 1)), pose };
}

const v = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

// gun grips (hand bone y along the hand, z out of the back of the hand) were
// fitted offline with their poses in handPoses.ts, so the padded glove rests on
// the real surfaces. deagle firing hand: web under the beavertail, knuckles at
// the front corner of the grip, back of the hand to the right.
const DEAGLE_RIGHT = gripYZ(v(0, 0, -1), v(0.9945, 0.1045, 0), v(0.041, -0.011, 0.079), 'deagle');
// support hand around the firing fingers, on socket_grip_l
const DEAGLE_SUPPORT = gripYZ(v(0.3522, -0.6048, -0.7143), v(-0.935, -0.2608, -0.2402), v(-0.0714, 0.0273, 0.0661), 'deagleSupport');
// awp firing hand pitched up the raked grip so the index meets the trigger and
// the web sits under the stock bar, clear of the bolt knob
const AWP_RIGHT = gripYZ(v(0.0623, 0.273, -0.96), v(0.9848, 0.1392, 0.1035), v(0.046, -0.022, 0.086), 'awp');
// palm up under the forend, fingers wrapping up the right side
const AWP_FOREND = gripYZ(v(0.8664, 0.3249, -0.3791), v(0.2977, -0.9457, -0.1302), v(-0.0655, -0.0492, 0.033), 'awpForend');
// fingers round the bolt knob from above and behind
const AWP_BOLT = gripYZ(v(-0.2506, -0.3509, -0.9023), v(0.8347, 0.3938, -0.385), v(0.0492, 0.0441, 0.0761), 'awpBolt');
// palm cupping the magazine floorplate, on socket_mag_bottom
const DEAGLE_MAG = gripYZ(v(0.5, 0.2, -0.8), v(0, -1, 0), v(-0.035, -0.03, 0.06), 'deagleMag');
const AWP_MAG = gripYZ(v(0.5, 0.2, -0.8), v(0, -1, 0), v(-0.0341, -0.0378, 0.0586), 'awpMag');

// katana: both hands in a hammer grip on the handle, fitted like the knives
// (socket_grip_r and socket_grip_l sit in the knife frame: +x to the tip, +y
// the spine). the left hand is the right one mirrored through the blade's plane
const KATANA_HANDLE_M = 0.03;
const KATANA_SPEC = knifeGripSpec('hammer', KATANA_HANDLE_M);
const KATANA_RIGHT: HandGrip = { matrix: KATANA_SPEC.handInAnchor.clone(), pose: 'knife' };
const KATANA_LEFT: HandGrip = {
  matrix: new Matrix4().makeScale(1, 1, -1).multiply(KATANA_SPEC.handInAnchor).multiply(new Matrix4().makeScale(-1, 1, 1)),
  pose: 'knife',
};

const GUN_GRIPS: Readonly<Record<GunItem, { right: HandGrip; support: HandGrip; mag: HandGrip }>> = {
  deagle: { right: DEAGLE_RIGHT, support: DEAGLE_SUPPORT, mag: DEAGLE_MAG },
  awp: { right: AWP_RIGHT, support: AWP_FOREND, mag: AWP_MAG },
  katana: { right: KATANA_RIGHT, support: KATANA_LEFT, mag: DEAGLE_MAG },
};
// between the grip and the bolt knob the hand opens and swings out along this
// gun space direction (metres at the midpoint), so it never cuts through the stock
const BOLT_REACH = v(0.07, 0.005, 0.02);
// thumb angles the swing passes through
const BOLT_THUMB = [0, 0, 0] as const;
const REACH_EXP = 1.5;
// how far the fingers open on the way between the grip and the bolt knob
const BOLT_TRANSIT_OPEN = 0.55;
// extra index curl (degrees per joint) at full trigger pull, so the pad follows the blade back
const TRIGGER_PULL: Readonly<Record<GunItem, readonly [number, number, number]>> = {
  deagle: [0, 14, 0],
  awp: [0, 14, 0],
  katana: [0, 0, 0],
};

// where each item's grip socket sits in camera space at idle
const DEAGLE_BASE: ItemBase = { position: v(0.14, -0.155, -0.32), rotation: new Quaternion().setFromEuler(new Euler(0.05, 0.12, 0.03, 'YXZ')) };
const AWP_BASE: ItemBase = { position: v(0.13, -0.165, -0.17), rotation: new Quaternion().setFromEuler(new Euler(0.03, 0.085, 0.03, 'YXZ')) };
// katana guard: hands low on the right, the blade rising forward and a little
// across to the left, edge forward and down
const KATANA_BASE: ItemBase = { position: v(0.14, -0.17, -0.3), rotation: frameXY(v(-0.42, 0.42, -0.8), v(0.12, 0.8, 0.55)) };

// whole poses the katana clips slerp toward, on the same channels as the knife keys.
// slashes lead with the edge, so the spine faces back along the swing
const KATANA_KEYS: Readonly<Record<'raise' | 'show' | 'showB' | 'hook' | 'hookB' | 'cock' | 'strike', ItemBase>> = {
  // draw: hands up on the right, the blade still back over the shoulder
  raise: knifeKey(v(0.2, -0.04, -0.14), v(0.25, 0.62, 0.75), v(0.6, -0.5, 0.3)),
  // inspect: laid flat across the view, edge up, one flat to the eye
  show: knifeKey(v(0.1, -0.12, -0.33), v(-0.95, 0.12, -0.28), v(0.1, -0.99, 0.05)),
  // inspect: rolled, looking down the edge
  showB: knifeKey(v(0.1, -0.11, -0.33), v(-0.95, 0.1, -0.28), v(0.3, -0.1, 0.95)),
  // primary: cut diagonally down through to the left
  hook: knifeKey(v(-0.04, -0.13, -0.38), v(-0.88, -0.2, -0.43), v(0.45, 0.75, -0.3)),
  // primary: backhand rising through to the right
  hookB: knifeKey(v(0.2, -0.15, -0.34), v(0.88, 0.12, -0.46), v(-0.4, -0.7, -0.3)),
  // secondary: up over the head
  cock: knifeKey(v(0.05, 0.08, -0.2), v(-0.08, 0.62, 0.78), v(0.0, -0.78, 0.62)),
  // secondary: down through the target, ending low and a little left
  strike: knifeKey(v(0.12, -0.11, -0.4), v(-0.72, -0.42, -0.55), v(0.2, 0.75, -0.6)),
};

/** the katana clips blend toward whole poses, one channel each */
const KEY_NAMES = ['raise', 'show', 'showB', 'hook', 'hookB', 'cock', 'strike'] as const;

// left hand targets that don't hang off an item, camera space
const LEFT_LOW = { position: v(-0.25, -0.5, -0.12), rotation: frameFromYZ(v(0.3, 0.6, -0.7), v(-0.6, 0.3, 0.2), new Quaternion()) };
const LEFT_WATCH = { position: v(0.0, -0.085, -0.27), rotation: frameFromYZ(v(0.96, 0.12, -0.25), v(-0.1, 0.5, 0.86), new Quaternion()) };
// open hand low on the left, palm down, fingers toward the middle
const LEFT_GUARD = { position: v(-0.18, -0.165, -0.28), rotation: frameFromYZ(v(0.75, 0.35, -0.55), v(-0.2, 0.45, 0.85), new Quaternion()) };
// how far the free fist drops to be out of view, and how loose it is
const LEFT_DROP_M = 0.16;
const LEFT_FIST_LOOSEN = 0.3;

// the shoulders sit behind the camera; sliding them is invisible. the awp's
// keep the long rifle reachable, the deagle's straighten the wrists
const ARMS_OFFSET: Readonly<Record<ViewItem, Vector3>> = {
  deagle: v(0, 0, 0.08),
  awp: v(0, 0.01, -0.1),
  knife: v(0, 0, 0),
  katana: v(0, 0, 0.04),
};
// the awp support hand holds the forend this far behind socket_grip_l
const AWP_SUPPORT_BACK_M = 0.12;

const SCALE_PIVOT = v(0.12, -0.15, -0.32);

const POLE_R = v(0.55, -0.7, 0.05);
const POLE_L = v(-0.55, -0.7, 0.05);
// elbows out wider on the guns so the forearms line up with the gripping hands
const GUN_POLE_R = v(0.8, -0.5, 0.2);
const GUN_POLE_L = v(-0.8, -0.5, 0.2);

const GUN_DEFAULTS: Readonly<Record<string, number>> = { leftAttach: 1 };
// how often an inspect press plays the knife's rare inspect instead
const RARE_INSPECT_CHANCE = 0.2;
const KNIFE_DEFAULTS: Readonly<Record<string, number>> = { knifeOpen: 1 };
// pose weights; the pose they make blends between clips instead (see play)
const POSE_CHANNELS: ReadonlySet<string> = new Set(KEY_NAMES);
// whole turns look the same, so these blend the short way round
const ANGLE_CHANNELS: ReadonlySet<string> = new Set(['spinZ', 'rollX']);
// a switch between clips keeps the old motion's momentum and blends it out on
// a critically damped spring, this fast (halflife, seconds)
const BLEND_ATTACK = 0.04;
const BLEND_DEFAULT = 0.05;
const BLEND_TO_IDLE = 0.06;
const BLEND_CANCEL = 0.075;
const SNAPPY_ACTIONS: ReadonlySet<ViewAction> = new Set(['slashA', 'slashB', 'stab', 'backstab', 'fire']);
// weights and fractions stay in range while a switch blends them
const UNIT_CHANNELS: ReadonlySet<string> = new Set([
  'gripOpen', 'ringHold', 'thumbOpener', 'watch', 'leftAttach', 'leftOnMag', 'rightOnBolt',
  'boltLift', 'boltBack', 'trigger', 'leftGuard', 'baliSafe', 'baliBite', 'leftDrop',
]);
// the free fist only ever leaves the view or comes back, so it follows its clip on a spring
const LEFT_DROP_HALFLIFE = 0.05;
const BACKSTAB_HALFLIFE = 0.08;
// fingers flaring out of a moving blade's way: quick out, slow back
const LET_GO_HALFLIFE = 0.012;
const LET_GO_RETURN_HALFLIFE = 0.08;
// how far into a new clip a switch looks to see how fast it sets off
const PROBE_S = 1 / 240;

/** an item pose and a pair's left knife pose (as the right hand pose it mirrors), before camera space offsets */
interface PoseFrame {
  pos: Vector3;
  rot: Quaternion;
  pole: Vector3;
  twinPos: Vector3;
  twinRot: Quaternion;
  twinPole: Vector3;
}

const poseFrame = (): PoseFrame => ({
  pos: new Vector3(), rot: new Quaternion(), pole: new Vector3(),
  twinPos: new Vector3(), twinRot: new Quaternion(), twinPole: new Vector3(),
});

function blendsChannel(name: string): boolean {
  return name !== 'magHidden' && name !== 'leftDrop' && !POSE_CHANNELS.has(name);
}

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
  /** knives with a finger ring the hand can switch to for spins (skeleton), knife frame */
  ringHold: { spec: KnifeGripSpec; anchorLocal: Vector3 } | null;
  base: ItemBase;
  /** the key poses its clips walk through (KNIFE_POSES), by name */
  poses: Record<string, ItemBase>;
  /** the elbow for keys that don't set their own (the grip's usual one, not the idle's) */
  pole: Vector3;
  /** the socket the hand anchors to, knife frame */
  anchorLocal: Vector3;
  /** the part that carries that socket (a balisong's bite handle, otherwise the knife) and the socket in its frame */
  anchorNode: Object3D;
  anchorInNode: Vector3;
  /** balisong: the bite handle's pin in the knife frame, the knife turns about it */
  bitePin: Vector3 | null;
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
const qRoll = new Quaternion();
const pairPos = new Vector3();
const pairRot = new Quaternion();
const twinPivotPos = new Vector3();
const twinPivotRot = new Quaternion();
const savePos = new Vector3();
const saveRot = new Quaternion();
// how far the fingers loosen at the middle of an in hand roll
const ROLL_LOOSEN = 0.6;
const LOOK_AHEAD_S = 0.08;
const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Z = new Vector3(0, 0, 1);
const sA = new Vector3();
const keyPos = new Vector3();
const keyRot = new Quaternion();
const keyPole = new Vector3();
const eA = new Euler(0, 0, 0, 'YXZ');
const poleWorld = new Vector3();
const poleBlend = new Vector3();
const seqW: SeqWeights = { keys: [0, 0, 0, 0], weights: [0, 0, 0, 0] };
const seqQ = [new Quaternion(), new Quaternion(), new Quaternion(), new Quaternion()];
const negate = (q: Quaternion): Quaternion => q.set(-q.x, -q.y, -q.z, -q.w);
const twinShownPos = new Vector3();
const twinShownRot = new Quaternion();
const twinShownPole = new Vector3();

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
  /** paints the cyborg arms and picks the plate kit from the look, see characters/fpArmor.ts */
  private readonly armsArmor = new FirstPersonArmor();
  private readonly guns: Partial<Record<GunItem, GunParts>> = {};
  private knife: KnifeRig | null = null;
  private knifeLeft: KnifeRig | null = null;
  /** tools: a left hand tried in place of the knife's own */
  private leftFistOverride: LeftHandKey | null = null;
  /** tools: no free left hand (fitting the knife arm alone) */
  private leftHidden = false;
  private knifeId: KnifeId = DEFAULT_KNIFE_ID;
  private knifeFinish: KnifeFinishSelection | null = null;
  private readonly itemPivot = new Group();
  /** everything drawn; scaled about a point in front of the eye so the scale setting is visible */
  private readonly content = new Group();

  private active: ViewItem = 'knife';
  private action: ViewAction = 'idle';
  private clip: Clip | null = null;
  private time = 0;
  private loadPromise: Promise<void> | null = null;
  private nextSlash: 'slashA' | 'slashB' = 'slashA';
  private inspectVariant = 0;
  private startedAttack: 'primary' | 'secondary' | null = null;
  private idleTime = 0;
  private backstabTarget = 0;
  private readonly backstab = createSpring();
  private hidden = false;
  private paused = false;
  private loopAction = false;
  private alive = true;
  private readonly channels = new Map<string, number>();
  private readonly channelVelocity = new Map<string, number>();
  private readonly channelBlends = new Map<string, ScalarInertializer>();
  private readonly channelNames = new Set<string>();
  private readonly leftDrop = createSpring();
  private snapLeftDrop = true;
  /** how far the knife fingers are flared out of a moving blade's way (see followLetGo) */
  private readonly letGo = createSpring();
  private frameStep = 0;
  private scrubbing = true;
  private blendHalflife = BLEND_DEFAULT;
  /** what the clip asks for now, and two looks into a new clip to see how fast it sets off */
  private readonly target = poseFrame();
  private readonly probeA = poseFrame();
  private readonly probeB = poseFrame();
  /** what was shown last frame and how fast it was moving (rotations as angular velocity) */
  private readonly shown = poseFrame();
  private readonly shownMotion = { pos: new Vector3(), rot: new Vector3(), pole: new Vector3(), twinPos: new Vector3(), twinRot: new Vector3(), twinPole: new Vector3() };
  /** what is left of the last switch, dying away */
  private readonly blend = {
    pos: new Vec3Inertializer(), rot: new QuatInertializer(), pole: new Vec3Inertializer(),
    twinPos: new Vec3Inertializer(), twinRot: new QuatInertializer(), twinPole: new Vec3Inertializer(),
  };
  /** this frame's camera space offsets (clip channels, breathing, backstab stance) */
  private readonly offsetPos = new Vector3();
  private readonly offsetRot = new Quaternion();
  private hasPose = false;
  private readonly poseR = createHandPose();
  private readonly poseL = createHandPose();
  private readonly poseTmp = createHandPose();
  private readonly spreadTmp: DigitSpread = {};
  private gripOpenNow = 0;
  /** knuckle angle the free fingers flare back to while a knife spins on the index (public for tuning) */
  public ringSpinFlare = -50;
  /** how much the hooked index's outer joints uncurl mid spin, degrees (public for tuning) */
  public ringSpinIndexRelax = 10;
  /** thumb while a knife spins on the index, out of the spin's plane (public for tuning) */
  public ringSpinThumb: [number, number, number] = [0, 2, 0];
  /** how much of a toss goes up the screen against out of the palm (public for tuning) */
  public tossUp = 0.6;
  /** how fast the fingers let go as a balisong handle leaves shut (public for tuning) */
  public baliLetGo = 2.5;
  /** knuckle angle the fingers flare back to while balisong handles swing (public for tuning) */
  public baliFlare = -50;
  /** how much the last two fingers loosen round a closed balisong (public for tuning) */
  public baliClosedLoosen = 0.35;
  /** how far the last two fingers open off a part-open folding blade (public for tuning) */
  public foldLoosen = 0.3;
  public baliIndex: [number, number, number] = [-30, 4, 2];
  /** default via point offset for the thumb's way to a folder's opener, degrees (public for tuning) */
  public thumbOpenerLift: [number, number, number] = [-30, -35, 0];
  private readonly ringSpinTmp = createHandPose(HAND_POSES.open);
  private readonly letGoTmp = createHandPose(HAND_POSES.open);
  /** thumb curl change that takes it off the spine, degrees (public for tuning in engine) */
  public thumbAway: [number, number, number] = [-50, -35, 0];
  /** thumb change while the hand slides between a handle and its ring (public for tuning) */
  public thumbSlide: [number, number, number] = [10, -35, 0];
  /** how much of the hand opening (or a ring swap) the thumb takes to get off the frame (public for tuning) */
  public thumbSlideRamp = 0.2;
  /** how far down the straightened index a ring starts before it slides onto it, metres (public for tuning) */
  public ringThread = 0.008;
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

  /** the arms take the player's plate kit (arms piece), paint and finish */
  public setArmsLook(look: CharacterLook, team?: PlayerModel): void {
    this.armsArmor.setLook(look, team);
  }

  /** settles when a skin's own arms (loaded on first use) are showing */
  public armsReady(): Promise<void> {
    return this.armsArmor.ready;
  }

  /** finish for the knife in hand; kept and reapplied whenever the knife rig is rebuilt */
  public setKnifeFinish(selection: KnifeFinishSelection | null): void {
    this.knifeFinish = selection ? { finishId: selection.finishId, wear: selection.wear, seed: selection.seed } : null;
    for (const rig of [this.knife, this.knifeLeft]) {
      if (rig) applyKnifeFinish(rig.knife, this.knifeFinish ?? { finishId: 'vanilla', wear: 0, seed: 0 });
    }
  }

  public equip(item: ViewItem): void {
    this.active = item;
    for (const id of GUN_ITEMS) {
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
    if (this.active === 'knife' || this.active === 'katana') return;
    this.play('fire');
  }

  public reload(durationMs?: number): void {
    if (this.active === 'knife' || this.active === 'katana') return;
    this.play('reload', false, durationMs ? durationMs / 1000 : undefined);
  }

  public inspect(): boolean {
    if (!this.canInspect()) return false;
    const rare = this.active === 'knife' && knifeInspectCount(getKnife(this.knifeId)) > 1;
    this.inspectVariant = rare && Math.random() < RARE_INSPECT_CHANCE ? 1 : 0;
    this.play('inspect');
    return true;
  }

  /** tools: which knife inspect plays (0 the usual one, 1 the rare one) */
  public setInspectVariant(variant: number): void {
    this.inspectVariant = variant;
  }

  public cancelInspect(): void {
    if (this.action === 'inspect') {
      this.play('idle', false, undefined, BLEND_CANCEL);
    }
  }

  public canInspect(): boolean {
    return this.isLoaded() && (this.action === 'idle' || this.action === 'inspect');
  }

  public knifeAttack(kind: 'primary' | 'secondary'): void {
    if (this.active !== 'knife' && this.active !== 'katana') return;
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

  public getActionTime(): number {
    return this.time;
  }

  public checkWrist(side: 'r' | 'l') {
    return this.arms?.getWristAngles(side) ?? null;
  }

  /** muzzle socket of the active gun in world space, null for the knife */
  public getMuzzleWorldPosition(out = new Vector3()): Vector3 | null {
    if (this.active === 'knife' || this.active === 'katana') return null;
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
    this.time = 0;
    // scrubbing leaves the breathing where it was, so a scrub is one steady pose per time
    this.idleTime -= time;
    this.advance(time, false, true);
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

  private advance(dt: number, fireEvents: boolean, scrub = false): void {
    const prev = this.time;
    this.time += dt;
    this.idleTime += dt;
    springStep(this.backstab, this.backstabTarget, BACKSTAB_HALFLIFE, dt);

    if (this.clip && fireEvents && this.clip.events) {
      for (const [t, name] of this.clip.events) {
        if (t > prev && t <= this.time) this.onEvent?.(name, this.active);
      }
    }
    if (this.clip && !this.clip.loop && this.time >= this.clip.duration && this.action !== 'idle') {
      this.play(this.loopAction ? this.action : 'idle');
    }
    for (const blend of this.channelBlends.values()) blend.update(this.blendHalflife, dt);
    for (const blend of Object.values(this.blend)) blend.update(this.blendHalflife, dt);
    // only real frames teach the switch how fast things were moving (not scrubs or pauses)
    const measure = fireEvents && dt > 0;
    this.frameStep = measure ? dt : 0;
    this.scrubbing = scrub;
    this.arms?.setStep(measure ? dt : 0, scrub);
    this.sampleChannels(dt, measure);
    this.pose(dt, measure);
  }

  private play(action: ViewAction, instant = false, duration?: number, halflife?: number): void {
    const blend = !instant && this.hasPose;
    this.action = action;
    this.time = 0;
    let clip: Clip | null = null;
    if (action !== 'idle') {
      if (this.active === 'knife') {
        clip = knifeClip(getKnife(this.knifeId), action as KnifeClipName, action === 'inspect' ? this.inspectVariant : 0);
      } else if (this.active === 'katana') {
        clip = KATANA_CLIPS[action as KatanaClipName] ?? null;
      } else {
        const set = this.active === 'deagle' ? DEAGLE_CLIPS : AWP_CLIPS;
        clip = set[action as GunClipName] ?? null;
      }
      if (clip && duration && duration > 0) {
        clip = retime(clip, duration);
      }
    }
    this.clip = clip;
    if (!clip) this.action = 'idle';
    if (blend) {
      this.beginBlend(halflife ?? (SNAPPY_ACTIONS.has(this.action) ? BLEND_ATTACK : this.action === 'idle' ? BLEND_TO_IDLE : BLEND_DEFAULT));
    } else {
      this.clearBlend();
    }
  }

  /**
   * a new clip starts where the last one left everything, moving the way it
   * was moving: the difference to the new clip (and in speed) is kept as an
   * offset that dies away, so a switch never freezes, pops or kills momentum
   */
  private beginBlend(halflife: number): void {
    this.blendHalflife = halflife;
    const defaults = this.active !== 'knife' ? GUN_DEFAULTS : KNIFE_DEFAULTS;
    const names = this.channelNames;
    names.clear();
    for (const key of this.channels.keys()) names.add(key);
    for (const key of Object.keys(defaults)) names.add(key);
    if (this.clip) for (const key of Object.keys(this.clip.tracks)) names.add(key);
    for (const name of names) {
      if (!blendsChannel(name)) continue;
      const fallback = defaults[name] ?? 0;
      const target = this.clipValue(name, 0, fallback);
      const targetVelocity = (this.clipValue(name, PROBE_S, fallback) - target) / PROBE_S;
      let output = this.channels.get(name) ?? fallback;
      if (ANGLE_CHANNELS.has(name)) output = target + wrap180(output - target);
      let channelBlend = this.channelBlends.get(name);
      if (!channelBlend) {
        channelBlend = new ScalarInertializer();
        this.channelBlends.set(name, channelBlend);
      }
      channelBlend.begin(output, this.channelVelocity.get(name) ?? 0, target, targetVelocity);
    }
    this.targetPose(0, this.probeA);
    this.targetPose(PROBE_S, this.probeB);
    const a = this.probeA;
    const b = this.probeB;
    const shown = this.shown;
    const motion = this.shownMotion;
    this.blend.pos.begin(shown.pos, motion.pos, a.pos, pA.subVectors(b.pos, a.pos).divideScalar(PROBE_S));
    this.blend.rot.begin(shown.rot, motion.rot, a.rot, angularVelocity(a.rot, b.rot, PROBE_S, pA));
    this.blend.pole.begin(shown.pole, motion.pole, a.pole, pA.subVectors(b.pole, a.pole).divideScalar(PROBE_S));
    this.blend.twinPos.begin(shown.twinPos, motion.twinPos, a.twinPos, pA.subVectors(b.twinPos, a.twinPos).divideScalar(PROBE_S));
    this.blend.twinRot.begin(shown.twinRot, motion.twinRot, a.twinRot, angularVelocity(a.twinRot, b.twinRot, PROBE_S, pA));
    this.blend.twinPole.begin(shown.twinPole, motion.twinPole, a.twinPole, pA.subVectors(b.twinPole, a.twinPole).divideScalar(PROBE_S));
  }

  /** an instant switch (draws on equip, scrubbing): nothing carries over */
  private clearBlend(): void {
    for (const blend of this.channelBlends.values()) blend.clear();
    for (const blend of Object.values(this.blend)) blend.clear();
    this.channelVelocity.clear();
    for (const v of Object.values(this.shownMotion)) v.set(0, 0, 0);
    this.snapLeftDrop = true;
    this.arms?.setStep(0, true);
  }

  private clipValue(name: string, time: number, fallback: number): number {
    return this.clip ? sampleClip(this.clip, name, time, fallback) : fallback;
  }

  private channel(name: string): number {
    return this.channels.get(name) ?? 0;
  }

  private sampleChannels(dt: number, measure: boolean): void {
    const defaults = this.active !== 'knife' ? GUN_DEFAULTS : KNIFE_DEFAULTS;
    const names = this.channelNames;
    names.clear();
    for (const key of this.channels.keys()) names.add(key);
    for (const key of Object.keys(defaults)) names.add(key);
    if (this.clip) for (const key of Object.keys(this.clip.tracks)) names.add(key);
    for (const name of names) {
      const fallback = defaults[name] ?? 0;
      let value = this.clipValue(name, this.time, fallback);
      if (name === 'leftDrop') {
        if (this.snapLeftDrop) {
          this.leftDrop.x = value;
          this.leftDrop.v = 0;
        } else {
          springStep(this.leftDrop, value, LEFT_DROP_HALFLIFE, dt);
        }
        value = this.leftDrop.x;
      } else {
        const blend = this.channelBlends.get(name);
        if (blend && blendsChannel(name)) value += blend.offset();
      }
      if (UNIT_CHANNELS.has(name)) value = Math.min(1, Math.max(0, value));
      else if (name === 'knifeOpen') value = Math.min(1.05, Math.max(0, value));
      else if (name === 'tossY') value = Math.max(0, value);
      if (measure) this.channelVelocity.set(name, (value - (this.channels.get(name) ?? value)) / dt);
      this.channels.set(name, value);
    }
    if (!names.has('leftDrop')) {
      this.leftDrop.x = 0;
      this.leftDrop.v = 0;
    }
    this.snapLeftDrop = false;
  }

  private pose(dt: number, measure: boolean): void {
    const arms = this.arms;
    if (!arms) return;
    this.content.updateWorldMatrix(true, false);

    // breathing, a slow drift that never quite repeats, and the backstab stance ride on top of every clip
    const t = this.idleTime;
    const breathe = Math.sin(t * 1.6);
    const backstab = Math.max(0, this.backstab.x);
    const px = this.channel('px') + Math.sin(t * 0.43 + 2.1) * 0.0008;
    const py = this.channel('py') + breathe * 0.0015 + backstab * 0.025;
    const pz = this.channel('pz') + backstab * 0.03;
    eA.set(
      (this.channel('rx') + breathe * 0.25 + Math.sin(t * 0.71 + 0.6) * 0.15 + backstab * 25) * DEG,
      (this.channel('ry') + Math.sin(t * 0.43 + 2.1) * 0.3) * DEG,
      (this.channel('rz') + Math.sin(t * 0.57 + 0.4) * 0.35 - backstab * 20) * DEG,
      'YXZ',
    );
    qA.setFromEuler(eA);
    this.offsetPos.set(px, py, pz);
    this.offsetRot.copy(qA);

    // the rifle's shoulder offset eases out for the watch check so the forearm stays level
    arms.root.position.copy(ARMS_OFFSET[this.active]).multiplyScalar(1 - this.channel('watch'));
    const target = this.target;
    this.targetPose(this.time, target);
    // whatever is left of the last switch rides on top
    this.blend.pos.apply(target.pos, keyPos);
    this.blend.rot.apply(target.rot, keyRot);
    this.blend.pole.apply(target.pole, keyPole);
    this.blend.twinPos.apply(target.twinPos, twinShownPos);
    this.blend.twinRot.apply(target.twinRot, twinShownRot);
    this.blend.twinPole.apply(target.twinPole, twinShownPole);
    const shown = this.shown;
    if (measure && this.hasPose) {
      const motion = this.shownMotion;
      motion.pos.subVectors(keyPos, shown.pos).divideScalar(dt);
      angularVelocity(shown.rot, keyRot, dt, motion.rot);
      motion.pole.subVectors(keyPole, shown.pole).divideScalar(dt);
      motion.twinPos.subVectors(twinShownPos, shown.twinPos).divideScalar(dt);
      angularVelocity(shown.twinRot, twinShownRot, dt, motion.twinRot);
      motion.twinPole.subVectors(twinShownPole, shown.twinPole).divideScalar(dt);
    }
    shown.pos.copy(keyPos);
    shown.rot.copy(keyRot);
    shown.pole.copy(keyPole);
    shown.twinPos.copy(twinShownPos);
    shown.twinRot.copy(twinShownRot);
    shown.twinPole.copy(twinShownPole);
    this.hasPose = true;
    this.itemPivot.position.set(keyPos.x + px, keyPos.y + py, keyPos.z + pz);
    this.itemPivot.quaternion.copy(qA).multiply(keyRot);

    if (this.active === 'knife') {
      this.poseKnife(arms);
    } else {
      this.poseGun(arms, this.active);
    }
    arms.updateWatch(this.clockOverride ?? new Date());
  }

  /** where the current clip puts the item (and a pair's left knife) at `time`, before offsets */
  private targetPose(time: number, out: PoseFrame): void {
    const base = this.itemBase();
    out.pos.copy(base.position);
    out.rot.copy(base.rotation);
    out.pole.copy(base.pole ?? POLE_R);
    const clip = this.clip;
    const rig = this.active === 'knife' ? this.knife : null;
    if (rig && clip?.seq) {
      // knife clips walk the knife through whole poses on a smooth path in time
      this.seqPose(clip.seq, rig, time, out.pos, out.rot, out.pole);
    } else if (this.active === 'katana' && clip) {
      // the katana clips blend toward whole poses by weight
      for (const name of KEY_NAMES) {
        const w = sampleClip(clip, name, time, 0);
        if (w === 0) continue;
        out.pos.lerp(KATANA_KEYS[name].position, w);
        out.rot.slerp(KATANA_KEYS[name].rotation, w);
      }
    }
    // a pair's left knife runs its own sequence when the clip has one, else it mirrors the right
    if (rig && clip?.seqL) {
      this.seqPose(clip.seqL, rig, time, out.twinPos, out.twinRot, out.twinPole);
    } else {
      out.twinPos.copy(out.pos);
      out.twinRot.copy(out.rot);
      out.twinPole.copy(out.pole);
    }
  }

  /**
   * where a pose sequence has the knife at `time`: a cubic hermite in time
   * through position, rotation and elbow (see seqWeights), so the motion runs
   * through keys at speed and only rests where the clip says
   */
  private seqPose(seq: readonly SeqKey[], rig: KnifeRig, time: number, outPos: Vector3, outRot: Quaternion, outPole: Vector3): void {
    seqWeights(seq, time, seqW);
    const at = (i: number): ItemBase => {
      const name = seq[i][1];
      return name === 'idle' ? rig.base : rig.poses[name] ?? rig.base;
    };
    outPos.set(0, 0, 0);
    outPole.set(0, 0, 0);
    // rotations as quaternion components on one hemisphere, chained from the segment's start
    seqQ[1].copy(at(seqW.keys[1]).rotation);
    seqQ[0].copy(at(seqW.keys[0]).rotation);
    if (seqQ[0].dot(seqQ[1]) < 0) negate(seqQ[0]);
    seqQ[2].copy(at(seqW.keys[2]).rotation);
    if (seqQ[2].dot(seqQ[1]) < 0) negate(seqQ[2]);
    seqQ[3].copy(at(seqW.keys[3]).rotation);
    if (seqQ[3].dot(seqQ[2]) < 0) negate(seqQ[3]);
    let x = 0;
    let y = 0;
    let z = 0;
    let w = 0;
    for (let s = 0; s < 4; s += 1) {
      const weight = seqW.weights[s];
      if (weight === 0) continue;
      const key = at(seqW.keys[s]);
      outPos.addScaledVector(key.position, weight);
      outPole.addScaledVector(key.pole ?? rig.pole, weight);
      const q = seqQ[s];
      x += q.x * weight;
      y += q.y * weight;
      z += q.z * weight;
      w += q.w * weight;
    }
    outRot.set(x, y, z, w).normalize();
  }

  private itemBase(): ItemBase {
    if (this.active === 'deagle') return DEAGLE_BASE;
    if (this.active === 'awp') return AWP_BASE;
    if (this.active === 'katana') return KATANA_BASE;
    return this.knife?.base ?? DEAGLE_BASE;
  }

  private poseGun(arms: ArmsRig, id: GunItem): void {
    const gun = this.guns[id];
    if (!gun) return;
    gun.root.position.set(0, 0, 0);
    gun.root.quaternion.identity();
    this.applyGunParts(gun);
    this.itemPivot.updateMatrixWorld(true);

    // right hand: grip, or the bolt knob during a bolt cycle
    const grips = GUN_GRIPS[id];
    const onBolt = this.channel('rightOnBolt');
    const gripPose = HAND_POSES[grips.right.pose];
    this.socketTarget(gun.gripR, grips.right, pA, qA);
    blendHandPose(gripPose, gripPose, 0, this.poseR);
    if (onBolt > 0 && gun.boltKnob) {
      this.socketTarget(gun.boltKnob, AWP_BOLT, pB, qB);
      pA.lerp(pB, onBolt);
      qA.slerp(qB, onBolt);
      // the thumb swings back out of the thumbhole first, then the hand travels out and up
      const arc = Math.sin(Math.PI * onBolt);
      const reach = arc ** REACH_EXP;
      const thumbOut = smoothstep(0, 0.45, arc);
      pC.copy(BOLT_REACH).transformDirection(this.itemPivot.matrixWorld).multiplyScalar(BOLT_REACH.length() * this.content.scale.x * reach);
      pA.add(pC);
      // the grasp changes with the lift: over the knob while it's down, wrapped once it's up
      // (the fingers start a moment before the bolt does, so they don't snap round it)
      const grasp = (this.channel('boltLift') + this.ahead('boltLift', 0.06)) / 2;
      blendHandPose(HAND_POSES.awpBoltClosed, HAND_POSES[AWP_BOLT.pose], grasp, this.poseTmp);
      blendHandPose(gripPose, this.poseTmp, onBolt, this.poseR);
      // fingers open a little in transit and the thumb swings back out through the thumbhole
      const [t0, t1, t2] = this.poseR.thumb;
      blendHandPose(this.poseR, HAND_POSES.open, reach * BOLT_TRANSIT_OPEN, this.poseR);
      this.poseR.thumb[0] = t0 + (BOLT_THUMB[0] - t0) * thumbOut;
      this.poseR.thumb[1] = t1 + (BOLT_THUMB[1] - t1) * thumbOut;
      this.poseR.thumb[2] = t2 + (BOLT_THUMB[2] - t2) * thumbOut;
    }
    const pull = TRIGGER_PULL[id];
    const trigger = this.channel('trigger') * (1 - onBolt);
    this.poseR.index[0] += pull[0] * trigger;
    this.poseR.index[1] += pull[1] * trigger;
    this.poseR.index[2] += pull[2] * trigger;
    arms.setArmVisible('r', true);
    arms.solveArm('r', pA, qA, this.pole(GUN_POLE_R));
    arms.applyHandPose('r', this.poseR);

    // left hand: low -> support grip -> magazine -> watch (the katana's free hand waits in a guard)
    const leftGrip = grips.support;
    const freeHand = id === 'katana' ? LEFT_GUARD : LEFT_LOW;
    const freePose = id === 'katana' ? HAND_POSES.guard : HAND_POSES.relaxed;
    this.cameraTarget(freeHand, pA, qA);
    blendHandPose(freePose, freePose, 0, this.poseL);
    const attach = this.channel('leftAttach');
    if (attach > 0) {
      this.socketTarget(gun.gripL, leftGrip, pB, qB);
      pA.lerp(pB, attach);
      qA.slerp(qB, attach);
      blendHandPose(freePose, HAND_POSES[leftGrip.pose], attach, this.poseL);
      // open on the way in so the fingers close onto the grip only as the hand arrives
      if (attach < 1) blendHandPose(this.poseL, HAND_POSES.open, Math.sin(Math.PI * attach) * 0.8, this.poseL);
    }
    const onMag = this.channel('leftOnMag');
    if (onMag > 0 && gun.magBottom) {
      this.socketTarget(gun.magBottom, grips.mag, pB, qB);
      pA.lerp(pB, onMag);
      qA.slerp(qB, onMag);
      blendHandPose(this.poseL, HAND_POSES[grips.mag.pose], onMag, this.poseL);
    }
    this.blendWatch(pA, qA, this.poseL, HAND_POSES.watchGun);
    arms.setArmVisible('l', true);
    // the watch check keeps the knife's elbow so it reads the same everywhere
    const pole = poleBlend.copy(GUN_POLE_L).lerp(POLE_L, this.channel('watch'));
    arms.solveArm('l', pA, qA, this.pole(pole));
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
    // rolling the knife over about its length (rollX) turns the handle in the
    // fingers, so they loosen through the middle of each half turn
    const rolling = Math.abs(Math.sin(this.channel('rollX') * DEG));
    const open = Math.max(this.channel('gripOpen'), ROLL_LOOSEN * rolling);
    this.gripOpenNow = open;
    const ringHold = rig.ringHold ? this.channel('ringHold') : 0;
    // how far into holding it by the ring (the swap eases each rule in instead of switching at 0)
    const ringMode = rig.grip.kind === 'reverse_ring' ? 1 : smoothstep(0, 0.15, ringHold);
    // a knife spinning on the index sweeps a disc across the index's first joint:
    // straight fingers would cross it, so they flare back at the knuckle instead
    const letGo = ringMode >= 1 ? this.ringSpinPose() : blendHandPose(HAND_POSES.open, this.ringSpinPose(), ringMode, this.letGoTmp);
    blendHandPose(rig.grip.pose, letGo, open, this.poseR);
    // the thumb comes off the spine whenever the blade moves past it or the hand opens
    // (a knife with a spin ring moves the thumb its own way when the hand opens, below)
    let thumbAway = Math.max(rolling, Math.min(1, open * 2) * (rig.ringHold ? ringMode : 1));
    if (rig.ringHold && ringHold > 0) {
      // the hand slides to the ring and hooks the index through it
      mB.compose(rig.ringHold.anchorLocal, qB.identity(), sA.set(1, 1, 1));
      mA.multiplyMatrices(rig.holder.matrixWorld, mB).multiply(rig.ringHold.spec.handInAnchor);
      mA.decompose(pB, qB, sA);
      // the ring goes onto the index end first: the hand first lines the ring
      // up just past the straightened fingertip, then slides it down the finger
      // the knife's ring axis (+z) points from the fingertip back to the knuckle,
      // so backing the hand along it puts the ring out on the straight finger
      pC.set(0, 0, 1).applyQuaternion(rig.ringHold.spec.knifeInHand).applyQuaternion(qB);
      // lined up by 0.4 and held there, so the finger is on the ring's axis before it slides
      const thread = smoothstep(0, 0.4, ringHold);
      const slide = smoothstep(0.5, 1, ringHold);
      pB.addScaledVector(pC, this.ringThread * (1 - slide) * this.content.scale.x);
      pA.lerp(pB, thread);
      qA.slerp(qB, thread);
      blendHandPose(this.poseR, rig.ringHold.spec.pose, ringHold, this.poseR);
      blendHandPose(this.poseR, letGo, open * ringMode, this.poseTmp);
      for (const d of ['middle', 'ring', 'pinky', 'thumb'] as const) copyDigit(this.poseTmp[d], this.poseR[d]);
    }
    const opener = rig.grip.openerThumb ? Math.min(1, this.channel('thumbOpener')) : 0;
    if (rig.grip.openerThumb && opener > 0) {
      // rest -> via -> opener on a curve through the via, so the thumb goes round
      // the handle and bolster instead of straight through them (the via is
      // fitted per knife in engine)
      const to = rig.grip.openerThumb;
      const th = this.poseR.thumb;
      for (let i = 0; i < 3; i += 1) {
        const via = rig.grip.openerVia ? rig.grip.openerVia[i] : (th[i] + to[i]) / 2 + this.thumbOpenerLift[i];
        const control = 2 * via - (th[i] + to[i]) / 2;
        th[i] = (1 - opener) * (1 - opener) * th[i] + 2 * opener * (1 - opener) * control + opener * opener * to[i];
      }
    }
    for (let i = 0; i < 3; i += 1) this.poseR.thumb[i] += this.thumbAway[i] * thumbAway;
    const hookWeight = rig.grip.kind === 'reverse_ring' ? 1 : ringHold;
    if (hookWeight > 0) {
      // spins hang off the index finger, so it stays hooked through the ring
      const hooked = rig.grip.kind === 'reverse_ring' ? rig.grip.pose : rig.ringHold!.spec.pose;
      // the tip uncurls a little while it spins so the handle passes under it
      const idx = this.poseR.index;
      idx[0] += (hooked.index[0] - idx[0]) * hookWeight;
      idx[1] += (hooked.index[1] - this.ringSpinIndexRelax * open - idx[1]) * hookWeight;
      idx[2] += (hooked.index[2] - this.ringSpinIndexRelax * 0.8 * open - idx[2]) * hookWeight;
    }
    // threading the ring: the index straightens past the knuckle while the ring
    // slides down it and only curls round once the ring is seated
    if (rig.ringHold && ringHold > 0 && ringHold < 1) {
      const straight = smoothstep(0, 0.5, ringHold) * smoothstep(1, 5 / 6, ringHold);
      this.poseR.index[1] *= 1 - straight;
      this.poseR.index[2] *= 1 - straight;
    }
    if (rig.ringHold) {
      // the thumb comes off the frame as the hand opens and stays off until it has settled
      const sliding = ringHold > 0 && ringHold < 1 ? smoothstep(0, this.thumbSlideRamp, Math.sin(Math.PI * ringHold)) : 0;
      const onHandle = smoothstep(0, this.thumbSlideRamp, open);
      const away = onHandle + (sliding - onHandle) * ringMode;
      for (let i = 0; i < 3; i += 1) {
        // on the handle it keeps its grip curls instead of blending to an open thumb
        const handleBase = rig.grip.pose.thumb[i] + this.thumbAway[i] * thumbAway;
        const base = handleBase + (this.poseR.thumb[i] - handleBase) * ringMode;
        this.poseR.thumb[i] = base + this.thumbSlide[i] * away;
      }
    }
    // a folding blade mid swing and a balisong handle away from shut pass where
    // the fingers are, so the hand lets go while they move. looking a little
    // ahead gets the fingers clear before the blade gets there
    const swing = (v: number) => Math.sin(Math.PI * Math.min(1, Math.max(0, v)));
    const moving = Math.max(
      rig.bladePivot ? 3 * Math.max(swing(this.channel('knifeOpen')), swing(this.ahead('knifeOpen'))) * this.moving('knifeOpen') : 0,
      rig.handleSafe ? this.baliLetGo * Math.max(swing(this.channel('baliSafe')), swing(this.ahead('baliSafe'))) * this.moving('baliSafe') : 0,
      rig.handleBite ? this.baliLetGo * Math.max(swing(this.channel('baliBite')), swing(this.ahead('baliBite'))) * this.moving('baliBite') : 0,
    );
    this.gripOpenNow = Math.max(this.gripOpenNow, Math.min(1, moving));
    // they clear it at once but come back slowly, so a run of flips doesn't flick them open and shut every time
    const m = this.followLetGo(smoothstep(0, 1, moving));
    if (m > 0.002) {
      // the tip of a folding blade and a swinging balisong handle both sweep
      // the finger side, so the fingers flare back out of the way
      const letGo = this.ringSpinPose(rig.handleSafe ? this.baliFlare : this.ringSpinFlare);
      // the safe handle swings back past the index, which lifts out of its way
      letGo.index[0] = rig.handleSafe ? this.baliIndex[0] : HAND_POSES.open.index[0];
      letGo.index[1] = rig.handleSafe ? this.baliIndex[1] : HAND_POSES.open.index[1];
      letGo.index[2] = rig.handleSafe ? this.baliIndex[2] : HAND_POSES.open.index[2];
      blendHandPose(this.poseR, letGo, m, this.poseTmp);
      for (const d of ['index', 'middle', 'ring', 'pinky'] as const) copyDigit(this.poseTmp[d], this.poseR[d]);
      // a thumb pressing a folder's opener stays on it while the blade goes
      // (until the blade itself starts to move under it)
      const onOpener = rig.grip.openerThumb
        ? Math.min(1, this.channel('thumbOpener')) * (1 - smoothstep(0, 0.3, swing(this.channel('knifeOpen'))))
        : 0;
      for (let i = 0; i < 3; i += 1) this.poseR.thumb[i] += this.thumbAway[i] * m * (1 - onOpener);
    }
    if (rig.handleSafe && rig.handleBite && this.baliClosedLoosen > 0) {
      // closed, the handles sit a little wider round the folded blade
      const closed = Math.min(this.channel('baliSafe'), this.channel('baliBite'));
      if (closed > 0.01) {
        blendHandPose(this.poseR, HAND_POSES.open, closed * this.baliClosedLoosen, this.poseTmp);
        for (const d of ['index', 'middle', 'ring', 'pinky'] as const) copyDigit(this.poseTmp[d], this.poseR[d]);
      }
    }
    if (rig.bladePivot) {
      // a folding blade held part open crosses in front of the index and
      // middle fingers, and folded it lies along the handle by the little
      // finger, so the fingers stay off it even while the blade is still
      const held = smoothstep(0, 0.45, swing(this.channel('knifeOpen')));
      if (held > 0.03) {
        blendHandPose(this.poseR, this.ringSpinPose(), held, this.poseTmp);
        copyDigit(this.poseTmp.index, this.poseR.index);
        copyDigit(this.poseTmp.middle, this.poseR.middle);
        blendHandPose(this.poseR, HAND_POSES.open, held * this.foldLoosen, this.poseTmp);
        copyDigit(this.poseTmp.ring, this.poseR.ring);
        copyDigit(this.poseTmp.pinky, this.poseR.pinky);
      }
    }
    arms.setArmVisible('r', true);
    arms.solveArm('r', pA, qA, this.pole(this.shown.pole), 0.8, true);
    arms.applyHandPose('r', this.poseR, this.knifeSpread(rig, open));
    this.keepKnifeInHand(rig, arms.getHandBone('r'), pA, qA);

    if (pair && this.knifeLeft) {
      const left = this.knifeLeft;
      // the left dagger: place a right hand twin at its pose (the right's own
      // unless the clip moves it alone), then mirror knife and hand target
      twinPivotPos.copy(this.shown.twinPos).add(this.offsetPos);
      twinPivotRot.copy(this.offsetRot).multiply(this.shown.twinRot);
      savePos.copy(rig.holder.position);
      saveRot.copy(rig.holder.quaternion);
      this.placeHolder(rig, twinPivotPos, twinPivotRot);
      rig.holder.updateMatrixWorld(true);
      pairPos.copy(rig.holder.position);
      pairRot.copy(rig.holder.quaternion);
      this.holderTarget(rig, pA, qA);
      rig.holder.position.copy(savePos);
      rig.holder.quaternion.copy(saveRot);
      rig.holder.updateMatrixWorld(true);
      mirrorRootPose(pairPos, pairRot, left.holder.position, left.holder.quaternion, MIRROR_KNIFE);
      this.applyKnifeParts(left);
      left.holder.updateMatrixWorld(true);
      // the left hand is the twin's target mirrored in camera space
      this.content.worldToLocal(pA);
      this.content.getWorldQuaternion(qB);
      qA.premultiply(qB.invert());
      mirrorRootPose(pA, qA, pA, qA, MIRROR_HAND);
      this.content.localToWorld(pA);
      qA.premultiply(this.content.getWorldQuaternion(qB));
      blendHandPose(rig.grip.pose, HAND_POSES.open, open, this.poseL);
      arms.setArmVisible('l', true);
      const twinPole = this.shown.twinPole;
      arms.solveArm('l', pA, qA, this.pole(poleBlend.set(-twinPole.x, twinPole.y, twinPole.z)), 0.8, true);
      arms.applyHandPose('l', this.poseL, this.knifeSpread(rig, open));
      this.keepKnifeInHand(left, arms.getHandBone('l'), pA, qA);
      return;
    }

    // like cs2 the free hand waits as a fist low in view (dropped out of view
    // by leftDrop), unless the knife keeps it down or a clip brings it up
    const fist = this.leftHidden ? null : this.leftFistOverride ?? KNIFE_LEFT_FISTS[this.knifeId] ?? null;
    const drop = Math.min(1, Math.max(0, this.channel('leftDrop')));
    const fistIn = fist !== null && drop < 0.999;
    const guard = Math.max(0, this.channel('leftGuard'));
    const showLeft = fistIn || guard > 0.001 || this.channel('leftAttach') > 0.001 || this.channel('watch') > 0.001;
    arms.setArmVisible('l', showLeft);
    if (showLeft) {
      if (fist && fistIn) {
        pA.copy(fist.wrist);
        pA.y -= drop * LEFT_DROP_M;
        this.content.localToWorld(pA);
        this.content.getWorldQuaternion(qA).multiply(fist.hand);
        blendHandPose(HAND_POSES.fist, HAND_POSES.relaxed, LEFT_FIST_LOOSEN, this.poseL);
        if (fist.open > 0) blendHandPose(this.poseL, HAND_POSES.guard, fist.open, this.poseL);
      } else {
        this.cameraTarget(LEFT_LOW, pA, qA);
        blendHandPose(HAND_POSES.relaxed, HAND_POSES.relaxed, 0, this.poseL);
      }
      if (guard > 0) {
        this.cameraTarget(LEFT_GUARD, pB, qB);
        // breathes a little out of step with the knife hand
        pB.y += Math.sin(this.idleTime * 1.6 + 1.1) * 0.0015 * this.content.scale.x;
        pA.lerp(pB, guard);
        qA.slerp(qB, guard);
        blendHandPose(this.poseL, HAND_POSES.guard, guard, this.poseL);
      }
      this.blendWatch(pA, qA, this.poseL);
      arms.solveArm('l', pA, qA, this.pole(fist && fistIn && fist.pole ? fist.pole : POLE_L), 0.8, 'relaxed');
      arms.applyHandPose('l', this.poseL);
    }
  }

  /** a channel's value a moment ahead in the current clip */
  private ahead(name: string, by = LOOK_AHEAD_S): number {
    const now = this.channel(name);
    return this.clip ? sampleClip(this.clip, name, Math.max(0, this.time + by), now) : now;
  }

  /** 0..1, whether a channel is changing around now (a held half open blade isn't) */
  private moving(name: string): number {
    const now = this.channel(name);
    const change = Math.abs(this.ahead(name) - now) + Math.abs(now - this.ahead(name, -LOOK_AHEAD_S));
    return smoothstep(0, 0.12, change);
  }

  private followLetGo(target: number): number {
    const state = this.letGo;
    if (this.frameStep <= 0 || this.scrubbing) {
      if (this.scrubbing) {
        state.x = target;
        state.v = 0;
      }
      return Math.min(1, Math.max(0, state.x));
    }
    springStep(state, target, target > state.x ? LET_GO_HALFLIFE : LET_GO_RETURN_HALFLIFE, this.frameStep);
    if (target > state.x) state.x = Math.max(state.x, target - 0.25);
    return Math.min(1, Math.max(0, state.x));
  }

  private ringSpinPose(f = this.ringSpinFlare): MutableHandPose {
    const p = this.ringSpinTmp;
    p.middle[0] = f; p.middle[1] = 4; p.middle[2] = 2;
    p.ring[0] = f - 2; p.ring[1] = 4; p.ring[2] = 2;
    p.pinky[0] = f - 4; p.pinky[1] = 4; p.pinky[2] = 2;
    p.thumb[0] = this.ringSpinThumb[0]; p.thumb[1] = this.ringSpinThumb[1]; p.thumb[2] = this.ringSpinThumb[2];
    return p;
  }

  private knifeSpread(rig: KnifeRig, open: number): DigitSpread | undefined {
    const spread = rig.grip.spread;
    if (!spread) return undefined;
    const k = 1 - Math.min(1, open);
    this.spreadTmp.middle = (spread.middle ?? 0) * k;
    this.spreadTmp.ring = (spread.ring ?? 0) * k;
    this.spreadTmp.pinky = (spread.pinky ?? 0) * k;
    this.spreadTmp.index = (spread.index ?? 0) * k;
    return this.spreadTmp;
  }

  private blendWatch(pos: Vector3, rot: Quaternion, pose: ReturnType<typeof createHandPose>, fingers: HandPose = HAND_POSES.relaxed): void {
    const watch = this.channel('watch');
    if (watch <= 0) return;
    this.cameraTarget(LEFT_WATCH, pC, qC);
    pos.lerp(pC, watch);
    rot.slerp(qC, watch);
    blendHandPose(pose, fingers, watch, this.poseTmp);
    blendHandPose(this.poseTmp, this.poseTmp, 0, pose);
  }

  /**
   * when a clip pushes the knife past the arm's reach the ik stops the hand
   * short; move the knife by the same miss so it stays in the fingers instead
   * of sliding through them.
   */
  private keepKnifeInHand(rig: KnifeRig, hand: Object3D, targetPos: Vector3, targetRot: Quaternion): void {
    hand.updateWorldMatrix(true, false);
    hand.matrixWorld.decompose(pC, qC, sA);
    if (pC.distanceToSquared(targetPos) < 1e-10 && qC.angleTo(targetRot) < 1e-5) return;
    // miss = actual * inverse(target), both without scale
    mB.compose(targetPos, targetRot, sA.set(1, 1, 1)).invert();
    mA.compose(pC, qC, sA.set(1, 1, 1)).multiply(mB);
    // holder world = content world * holder local; apply the miss in world space
    this.content.updateWorldMatrix(true, false);
    rig.holder.updateMatrix();
    mB.multiplyMatrices(this.content.matrixWorld, rig.holder.matrix);
    mA.multiply(mB);
    mB.copy(this.content.matrixWorld).invert().multiply(mA);
    mB.decompose(rig.holder.position, rig.holder.quaternion, sA);
    rig.holder.scale.set(1, 1, 1);
    rig.holder.updateMatrixWorld(true);
  }

  private placeHolder(rig: KnifeRig, gripPos: Vector3, rotation: Quaternion): void {
    // local root position so the grip socket lands on gripPos
    rig.holder.quaternion.copy(rotation);
    // holdRoll turns the knife about its length with the hand closed on it (the
    // wrist rolls), unlike rollX which turns it inside the fingers
    const roll = this.channel('holdRoll');
    if (roll !== 0) rig.holder.quaternion.multiply(qRoll.setFromAxisAngle(AXIS_X, roll * DEG));
    pC.copy(rig.anchorLocal).applyQuaternion(rig.holder.quaternion);
    rig.holder.position.copy(gripPos).sub(pC);
  }

  private applyKnifeParts(rig: KnifeRig): void {
    const open = this.channel('knifeOpen');
    if (rig.bladePivot) rig.bladePivot.rotation.z = -Math.PI * (1 - Math.min(1.05, Math.max(0, open)));
    // the blender balisong swings the safe handle the other way round (spine
    // side pin), so the halves never pass through each other mid swing
    const bali = isKnifeModel(rig.knife) ? -1 : 1;
    if (rig.handleSafe) rig.handleSafe.rotation.z = bali * Math.PI * this.channel('baliSafe');
    if (rig.handleBite) rig.handleBite.rotation.z = -bali * Math.PI * this.channel('baliBite');
    // spins and rolls happen about the pivot (ring centre or grip) inside the hand
    rig.spin.position.copy(rig.pivotLocal);
    const toss = this.channel('tossY');
    if (toss !== 0) {
      // the knife leaves out of the palm (the way the open fingers aren't) and
      // up the screen
      qC.copy(rig.holder.quaternion).invert();
      pC.set(0, 1, 0.25).normalize().applyQuaternion(qC).multiplyScalar(this.tossUp);
      pB.set(0, 0, -1).applyQuaternion(qB.copy(rig.grip.knifeInHand).invert());
      rig.spin.position.addScaledVector(pC.add(pB).normalize(), toss);
    }
    eA.set(this.channel('rollX') * DEG, 0, this.channel('spinZ') * DEG, 'XYZ');
    rig.spin.quaternion.setFromEuler(eA);
    rig.knife.position.copy(rig.pivotLocal).negate();
    rig.knife.quaternion.identity();
    if (rig.handleBite && rig.bitePin) {
      // the hand holds the bite handle: the blade and the safe handle swing
      // round its pin, so turn the whole knife back by the bite handle's angle
      const bite = -bali * Math.PI * this.channel('baliBite');
      rig.knife.quaternion.setFromAxisAngle(AXIS_Z, -bite);
      rig.knife.position.add(rig.bitePin).sub(pC.copy(rig.bitePin).applyQuaternion(rig.knife.quaternion));
    }
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
    this.clearBlend();
    this.backstab.x = 0;
    this.backstab.v = 0;
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
    const [arms, deagle, awp, katana] = await Promise.all([
      ArmsRig.load(),
      sharedGltfLoader().loadAsync(GUN_URLS.deagle),
      sharedGltfLoader().loadAsync(GUN_URLS.awp),
      // the katana is optional: a failed load only leaves it without a model
      sharedGltfLoader().loadAsync(GUN_URLS.katana).catch(() => null),
    ]);
    this.arms = arms;
    this.content.add(arms.root);
    this.armsArmor.attach(arms.root);
    this.guns.deagle = this.setupGun(deagle.scene);
    this.guns.awp = this.setupGun(awp.scene);
    if (katana) this.guns.katana = this.setupGun(katana.scene);
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

  /** debug: where the right wrist is versus where the grip wants it, and what knife rig is live */
  public debugGrip(): Record<string, unknown> | null {
    const rig = this.knife;
    if (!rig || !this.arms) return null;
    this.content.updateWorldMatrix(true, true);
    this.holderTarget(rig, pA, qA);
    const wrist = this.arms.getHandBone('r').getWorldPosition(new Vector3());
    const handQ = this.arms.getHandBone('r').getWorldQuaternion(new Quaternion());
    return {
      source: isKnifeModel(rig.knife) ? 'glb' : 'procedural',
      kind: rig.grip.kind,
      anchor: rig.grip.anchor,
      wristErrorMm: Math.round(wrist.distanceTo(pA) * 10000) / 10,
      handAngleErrorDeg: Math.round((handQ.angleTo(qA) * 180) / Math.PI * 10) / 10,
      pose: rig.grip.pose,
    };
  }

  /** debug: the current value of an animation channel */
  public debugChannel(name: string): number {
    return this.channel(name);
  }

  /** tools: tries a knife key pose on the knife in hand ('idle' is the rest pose), for tuning */
  public debugSetKnifePose(name: string, grip: number[], blade: number[], spine: number[], pole?: number[]): void {
    const rig = this.knife;
    if (!rig) return;
    const elbow = pole ? v(pole[0], pole[1], pole[2]) : KNIFE_POSES[rig.grip.kind].pole.clone();
    const pose = knifeKey(v(grip[0], grip[1], grip[2]), v(blade[0], blade[1], blade[2]), v(spine[0], spine[1], spine[2]), elbow);
    if (name === 'idle') rig.base = pose;
    else rig.poses[name] = pose;
  }

  /** tools: the same, placed by the fist (where it is, where the knuckles point, where the back of the hand faces) */
  public debugSetHandPose(name: string, fist: number[], knuckles: number[], back: number[], pole?: number[]): void {
    const rig = this.knife;
    if (!rig) return;
    const elbow = pole ? v(pole[0], pole[1], pole[2]) : KNIFE_POSES[rig.grip.kind].pole.clone();
    const key = handKey(v(fist[0], fist[1], fist[2]), v(knuckles[0], knuckles[1], knuckles[2]), v(back[0], back[1], back[2]), elbow);
    const pose = resolveKnifeKey(key, rig.grip);
    if (name === 'idle') rig.base = pose;
    else rig.poses[name] = pose;
  }

  /** tools: places the free left hand (where the fist is, where the knuckles point, where the back of the hand faces, how open), null for the knife's own */
  public debugSetLeftFist(fist: number[] | null, knuckles?: number[], back?: number[], pole?: number[], open = 0): void {
    this.leftFistOverride = fist && knuckles && back
      ? leftHandKey(v(fist[0], fist[1], fist[2]), v(knuckles[0], knuckles[1], knuckles[2]), v(back[0], back[1], back[2]), pole ? v(pole[0], pole[1], pole[2]) : undefined, open)
      : null;
  }

  /** tools: hides the free left hand */
  public debugHideLeft(hidden: boolean): void {
    this.leftHidden = hidden;
  }

  /** tools: shows the whole knife, only its blade steel, or none, with or without the arms (part masks) */
  public debugShowParts(knife: 'all' | 'blade' | 'none', arms: boolean): void {
    if (this.arms) this.arms.root.visible = arms;
    for (const rig of [this.knife, this.knifeLeft]) {
      if (!rig) continue;
      rig.holder.visible = knife !== 'none';
      rig.holder.traverse((node) => {
        const mesh = node as Mesh;
        if (!mesh.isMesh) return;
        const name = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material)?.name ?? '';
        mesh.visible = knife !== 'blade' || /^knife_(blade|edge)/.test(name);
      });
    }
  }

  /**
   * tools: where the knife and the hands land on screen (ndc, x right, y up,
   * plus depth in metres) and how far the right wrist bends off the forearm
   */
  public probe(camera: Camera): Record<string, number | number[] | boolean> {
    const out: Record<string, number | number[] | boolean> = {};
    const rig = this.knife;
    if (!this.arms || !rig) return out;
    this.root.updateWorldMatrix(true, true);
    camera.updateMatrixWorld();
    const ndc = (p: Vector3): number[] => {
      const depth = -p.clone().applyMatrix4(camera.matrixWorldInverse).z;
      const q = p.clone().project(camera);
      return [Math.round(q.x * 100) / 100, Math.round(q.y * 100) / 100, Math.round(depth * 1000) / 1000];
    };
    for (const [key, name] of [['tip', KNIFE_NODES.tip], ['grip', KNIFE_NODES.grip], ['ring', KNIFE_NODES.ring]] as const) {
      const node = rig.knife.getObjectByName(name);
      if (node) out[key] = ndc(node.getWorldPosition(new Vector3()));
    }
    // the knife's origin is where the blade meets the guard
    out.guard = ndc(rig.knife.getWorldPosition(new Vector3()));
    const hand = this.arms.getHandBone('r');
    const wrist = hand.getWorldPosition(new Vector3());
    const elbow = this.arms.getForearmBone('r').getWorldPosition(new Vector3());
    out.wrist = ndc(wrist);
    out.elbow = ndc(elbow);
    const along = new Vector3(0, 1, 0).applyQuaternion(hand.getWorldQuaternion(new Quaternion()));
    out.wristBendDeg = Math.round(along.angleTo(wrist.clone().sub(elbow).normalize()) / DEG);
    out.leftShown = this.arms.isArmVisible('l');
    // the knife frame in camera space: grip point, blade (+x) and spine (+y) directions
    const toCam = (p: Vector3) => p.applyMatrix4(camera.matrixWorldInverse);
    const r3 = (p: Vector3) => [p.x, p.y, p.z].map((c) => Math.round(c * 1000) / 1000);
    rig.holder.updateMatrixWorld(true);
    const origin = toCam(rig.holder.localToWorld(rig.anchorLocal.clone()));
    const xAxis = toCam(rig.holder.localToWorld(rig.anchorLocal.clone().add(new Vector3(1, 0, 0)))).sub(origin).normalize();
    const yAxis = toCam(rig.holder.localToWorld(rig.anchorLocal.clone().add(new Vector3(0, 1, 0)))).sub(origin).normalize();
    out.gripCam = r3(origin);
    out.bladeCam = r3(xAxis);
    out.spineCam = r3(yAxis);
    // the hand bone's frame in camera space (+y toward the knuckles, +z the back of the hand)
    const camInv = camera.getWorldQuaternion(new Quaternion()).invert();
    const handQ = hand.getWorldQuaternion(new Quaternion()).premultiply(camInv);
    out.handYCam = r3(new Vector3(0, 1, 0).applyQuaternion(handQ));
    out.handZCam = r3(new Vector3(0, 0, 1).applyQuaternion(handQ));
    return out;
  }



  /** how open the knife hand was on the last pose, after rolls loosen it (0 closed) */
  public debugGripOpen(): number {
    return this.gripOpenNow;
  }

  /** debug: the right wrist in world space (preview cameras aim at it) */
  public getHandWorldPosition(): Vector3 {
    const out = new Vector3();
    if (!this.arms) return out;
    this.content.updateWorldMatrix(true, true);
    // a little up the hand from the wrist, the middle of the fist
    const hand = this.arms.getHandBone('r');
    return out.set(0, 0.07, -0.02).applyMatrix4(hand.matrixWorld);
  }

  /** debug: small spheres on every finger joint and tip of the right hand */
  public showFingerMarkers(on: boolean): void {
    if (!this.arms) return;
    const digits = this.arms.getDigits('r');
    for (const bones of Object.values(digits)) {
      for (const bone of bones) {
        const old = bone.getObjectByName('fingerMarker');
        if (old) old.removeFromParent();
        if (!on) continue;
        const m = new Mesh(new SphereGeometry(0.0035, 10, 8), new MeshBasicMaterial({ color: 0xff2266, depthTest: false }));
        m.name = 'fingerMarker';
        m.renderOrder = 50;
        bone.add(m);
      }
    }
  }

  /** in-engine finger check against the knife in hand (see gripCheck.ts) */
  public checkKnifeGrip(side: 'r' | 'l' = 'r'): GripCheck | null {
    const rig = side === 'r' ? this.knife : this.knifeLeft;
    if (!rig || !this.arms) return null;
    this.content.updateWorldMatrix(true, true);
    const ring = rig.grip.kind === 'reverse_ring' ? rig.pivotLocal : null;
    return checkGrip(rig.knife, this.arms.getDigits(side), ring);
  }

  /**
   * attachment check: how far (metres, rig scale) the knife's grip socket sits
   * from where the hand's grip puts it. for a knife with a spin ring (skeleton)
   * the ring hold counts too, whichever is closer. 0 when there is no knife.
   */
  public checkKnifeAttachment(side: 'r' | 'l' = 'r'): { grip: number; ring: number | null } | null {
    const rig = side === 'r' ? this.knife : this.knifeLeft;
    if (!rig || !this.arms) return null;
    this.content.updateWorldMatrix(true, true);
    const hand = this.arms.getHandBone(side);
    const actual = rig.anchorNode.localToWorld(rig.anchorInNode.clone());
    const inHand = hand.worldToLocal(actual.clone());
    const expected = side === 'r' ? rig.grip.anchorInHand : mirrorHandPoint(rig.grip.anchorInHand);
    // grips are authored in the hand bone's frame, so hand-local lengths are metres
    const grip = inHand.distanceTo(expected);
    let ring: number | null = null;
    if (rig.ringHold && side === 'r') {
      const ringWorld = rig.knife.localToWorld(rig.ringHold.anchorLocal.clone());
      ring = hand.worldToLocal(ringWorld).distanceTo(rig.ringHold.spec.anchorInHand);
    }
    return { grip, ring };
  }

  /** length of the current knife's clip for an action, seconds */
  public knifeActionDuration(action: ViewAction): number {
    if (action === 'idle') return 0;
    return knifeClip(getKnife(this.knifeId), action as KnifeClipName, action === 'inspect' ? this.inspectVariant : 0)?.duration ?? 0;
  }

  /** the knife objects currently in hand (one, or two for the push daggers) */
  public getKnifeObjects(): Object3D[] {
    return [this.knife?.knife, this.knifeLeft?.knife].filter((k): k is Group => !!k);
  }

  private makeKnifeRig(model: Group | null = null): KnifeRig {
    const def = getKnife(this.knifeId);
    const knife = model ?? buildProceduralKnife(def);
    if (this.knifeFinish) applyKnifeFinish(knife, this.knifeFinish);
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
    const kind = gripKindFor(def);
    let grip = isKnifeModel(knife)
      ? fittedGripSpec(def.id, kind, measureHandleDiameter(knife))
      : knifeGripSpec(kind, measureHandleDiameter(knife));
    if (ringLocal) grip = alignRingGrip(grip, ringLocal, gripLocal);
    const anchorLocal = grip.anchor === 'ring' && ringLocal
      ? ringLocal.clone()
      : grip.anchor === 'tee' && teeNode ? teeNode.getWorldPosition(new Vector3()) : gripLocal.clone();
    // a hammer-grip knife with a ring (skeleton) can hang off the index finger for spins
    const ringHold = ringLocal && grip.kind !== 'reverse_ring'
      ? { spec: alignRingGrip(knifeGripSpec('reverse_ring', measureHandleDiameter(knife)), ringLocal, gripLocal), anchorLocal: ringLocal.clone() }
      : null;
    // ring knives spin on the ring (the index finger), everything else on the grip
    const pivotLocal = ringLocal && (grip.kind === 'reverse_ring' || ringHold) ? ringLocal.clone() : gripLocal.clone();
    // the held part: a balisong is held by its bite handle, everything else by the knife itself
    const handleBite = knife.getObjectByName(KNIFE_NODES.handleBite) ?? null;
    const anchorNode = handleBite ?? knife;
    const anchorInNode = anchorNode.worldToLocal(anchorLocal.clone());
    const bitePin = handleBite ? handleBite.getWorldPosition(new Vector3()) : null;
    // the knife group sits at its origin inside the holder, so world = local here
    this.content.add(holder);
    const poseSet = KNIFE_POSES[grip.kind];
    const idle = resolveKnifeKey(KNIFE_IDLES[def.id] ?? poseSet.idle, grip);
    const poses: Record<string, ItemBase> = {};
    for (const [name, key] of Object.entries(poseSet.poses)) poses[name] = resolveKnifeKey(key, grip);
    Object.assign(poses, fittedAttackPoses(def.id));
    return {
      anchorNode,
      anchorInNode,
      bitePin,
      id: def.id,
      holder,
      spin,
      knife,
      grip,
      ringHold,
      base: { ...idle, pole: idle.pole ?? poseSet.pole },
      poses,
      pole: poseSet.pole,
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

/** an angle difference in degrees, the short way round */
function wrap180(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

const mirrorM = new Matrix4().makeScale(-1, 1, 1);
const mirrorTmp = new Matrix4();
// knife: tip and spine mirror, thickness flips so it stays a rotation
const MIRROR_KNIFE = new Matrix4().makeScale(1, 1, -1);
// hand bones: y and z mirror, x flips (same rule as the rig's left side)
const MIRROR_HAND = new Matrix4().makeScale(-1, 1, 1);

/** mirrors a camera space pose across the view's vertical centre plane */
/** a right hand grip point in the left hand's frame: the left hand bone is the right one mirrored across x */
function mirrorHandPoint(p: Vector3): Vector3 {
  return new Vector3(-p.x, p.y, p.z);
}

function copyDigit(from: readonly number[], to: number[]): void {
  to[0] = from[0];
  to[1] = from[1];
  to[2] = from[2];
}

function mirrorRootPose(pos: Vector3, rot: Quaternion, outPos: Vector3, outRot: Quaternion, local: Matrix4): void {
  outPos.set(-pos.x, pos.y, pos.z);
  mirrorTmp.makeRotationFromQuaternion(rot);
  mirrorTmp.premultiply(mirrorM).multiply(local);
  outRot.setFromRotationMatrix(mirrorTmp);
}
