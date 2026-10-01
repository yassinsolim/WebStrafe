import { Box3, Matrix4, Mesh, Quaternion, Vector3, type Object3D } from 'three';
import type { KnifeDef, KnifeId } from '../combat/knives';
import FITTED from './knifeHandPoses.json';
import { blendHandPose, createHandPose, HAND_POSES, type HandPose, type MutableHandPose } from './handPoses';
import type { DigitSpread } from './ArmsRig';

/**
 * how each knife sits in the right hand, written as the knife's frame in the
 * hand bone's frame (hand +Y runs wrist to knuckles, +Z is the back of the
 * hand, the index finger is on -X). the rig's fist closes around a channel
 * 9.3 cm up the hand and 2 cm to the palm side, running along x.
 *
 * - hammer: blade out above the thumb and index, edge facing the knuckles.
 * - reverse_ring (karambit, talon): the INDEX finger goes through the ring,
 *   the handle runs down the fist and the hooked blade comes out under the
 *   little finger, edge forward. this is how cs2 and real karambit users hold
 *   it (the classic inspect spins the knife on the index finger), not the thumb.
 * - tee (push daggers): the t-bar lies across the palm inside the fist and the
 *   blade comes out between the middle and ring fingers, pointing forward.
 * - balisong: both handles closed together, held like a hammer grip.
 */
export type KnifeGripKind = 'hammer' | 'reverse_ring' | 'tee' | 'balisong';

export interface KnifeGripSpec {
  kind: KnifeGripKind;
  /** which knife socket the hand is anchored to */
  anchor: 'grip' | 'ring' | 'tee';
  /** anchor socket position in the hand frame */
  anchorInHand: Vector3;
  /** knife axes in the hand frame */
  knifeInHand: Quaternion;
  /** finger curls that wrap this knife's handle */
  pose: MutableHandPose;
  /** hand frame in the anchor socket frame, what the ik targets */
  handInAnchor: Matrix4;
  /** folders: thumb curls that put it on the opener, blended in while opening */
  openerThumb?: [number, number, number];
  /** folders: thumb curls it passes through on its way to the opener */
  openerVia?: [number, number, number];
  /** ring knives: extra turn about the ring axis after the handle is aimed into the fist */
  ringTwistDeg?: number;
  /** fingers spread apart at the knuckles (push daggers part the middle and ring fingers) */
  spread?: DigitSpread;
}

// push daggers: the neck passes between the middle and ring fingers
// fingers round a ~3.3 cm handle (the pose the rig's pistol support grip used)
const THICK_HANDLE_POSE: HandPose = {
  index: [48, 58, 30], middle: [56, 66, 34], ring: [60, 70, 36], pinky: [64, 70, 34], thumb: [4, 8, 4],
};
const TEE_SPREAD: DigitSpread = { middle: 6, ring: -8, pinky: -8 };
const TEE_POSE: HandPose = {
  index: [54.6, 75.4, 33.8], middle: [71.8, 84.6, 38.6], ring: [65.6, 77.1, 36.1], pinky: [46.2, 50.6, 23.1],
  thumb: [...HAND_POSES.fist.thumb],
};

export function gripKindFor(def: KnifeDef): KnifeGripKind {
  const hint = (def as { grip?: unknown }).grip;
  if (hint === 'hammer' || hint === 'reverse_ring' || hint === 'tee' || hint === 'balisong') return hint;
  if (def.shape.pair) return 'tee';
  if (def.shape.fingerRing && def.id !== 'skeleton') return 'reverse_ring';
  if ((def.shape.mechanism ?? 'fixed') === 'balisong') return 'balisong';
  return 'hammer';
}

const axes = (x: [number, number, number], y: [number, number, number], z: [number, number, number]): Quaternion =>
  new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(
    new Vector3(...x).normalize(),
    new Vector3(...y).normalize(),
    new Vector3(...z).normalize(),
  ));

// index finger: knuckle at (-0.024, 0.101, 0), first phalanx 3.8 cm. curled
// toward the palm, the middle of that phalanx is where the ring sits
const INDEX_CURL_DEG = 60;

/** ring centre and ring axis (along the index's first phalanx) for an index curl */
function ringSeat(curlDeg: number): { axis: Vector3; centre: Vector3 } {
  const a = (curlDeg * Math.PI) / 180;
  const axis = new Vector3(0, Math.cos(a), -Math.sin(a));
  return { axis, centre: new Vector3(-0.024, 0.101, 0).addScaledVector(axis, 0.019) };
}

function ringKnifeInHand(curlDeg: number): Quaternion {
  const { axis } = ringSeat(curlDeg);
  // the claw curves the way the knuckles face (edge forward, like cs2): the
  // knife's concave side (-y) looks up the hand, the spine back at the wrist
  return axes([1, 0, 0], [0, axis.z, -axis.y], [0, axis.y, axis.z]);
}

const KNIFE_IN_HAND: Record<KnifeGripKind, Quaternion> = {
  hammer: axes([-1, 0, 0], [0, -1, 0], [0, 0, 1]),
  balisong: axes([-1, 0, 0], [0, -1, 0], [0, 0, 1]),
  // ring axis is the knife's z (the ring lies in the blade plane)
  reverse_ring: ringKnifeInHand(INDEX_CURL_DEG),
  tee: axes([0, 1, 0], [-1, 0, 0], [0, 0, 1]),
};

/** typical handle, the size the default anchors were tuned on */
const REFERENCE_HANDLE_M = 0.026;

function anchorFor(kind: KnifeGripKind, handleDiameter: number): Vector3 {
  // a thicker handle sits further out from the finger bones
  const extra = Math.max(-0.006, Math.min(0.01, handleDiameter - REFERENCE_HANDLE_M));
  switch (kind) {
    case 'reverse_ring':
      return ringSeat(INDEX_CURL_DEG).centre;
    case 'tee':
      // bar in the fist channel, neck between the middle (x 0) and ring (x 0.021) fingers
      return new Vector3(0.0115, 0.09, -0.028);
    default:
      return new Vector3(0, 0.1 + extra * 0.3, -0.024 - extra * 0.5);
  }
}

/**
 * finger curls for a handle this thick: the rig's fist closes around ~2.3 cm,
 * the pistol pose around ~3.3 cm, so blend between them by diameter.
 */
export function wrapPose(kind: KnifeGripKind, handleDiameter: number, out: MutableHandPose = createHandPose()): MutableHandPose {
  const open = Math.min(1, Math.max(0, (handleDiameter - 0.021) / (0.034 - 0.021)));
  blendHandPose(HAND_POSES.fist, THICK_HANDLE_POSE, open * 0.8, out);
  if (kind === 'reverse_ring') {
    // the index hooks through the ring, the thumb presses on top of it
    out.index[0] = INDEX_CURL_DEG;
    out.index[1] = 74;
    out.index[2] = 40;
    out.thumb[0] = 26;
    out.thumb[1] = 34;
    out.thumb[2] = 14;
  } else if (kind === 'hammer' || kind === 'balisong') {
    // index a touch looser than the rest, thumb over the index
    out.index[0] -= 6;
    out.thumb[1] = Math.max(out.thumb[1], 30);
  } else if (kind === 'tee') {
    // fist around the bar, tuned in engine against the live meshes: the index
    // wraps the bar's front end, the pinky rides the rounded far end
    blendHandPose(TEE_POSE, TEE_POSE, 0, out);
  }
  return out;
}

export interface RingFit {
  /** index first-joint curl the ring sits on, degrees */
  curl: number;
  /** turn about the ring axis on top of the automatic alignment, degrees */
  twist: number;
}

export function knifeGripSpec(
  kind: KnifeGripKind,
  handleDiameter: number,
  offset?: readonly [number, number, number],
  ring?: RingFit,
): KnifeGripSpec {
  const anchorInHand = kind === 'reverse_ring' && ring ? ringSeat(ring.curl).centre : anchorFor(kind, handleDiameter);
  // per knife nudge fitted to the model (see tools/assets/gripFit.ts)
  if (offset) anchorInHand.add(new Vector3(offset[0], offset[1], offset[2]));
  const knifeInHand = kind === 'reverse_ring' && ring ? ringKnifeInHand(ring.curl) : KNIFE_IN_HAND[kind].clone();
  const handInAnchor = new Matrix4().compose(anchorInHand, knifeInHand, new Vector3(1, 1, 1)).invert();
  const pose = wrapPose(kind, handleDiameter);
  if (kind === 'reverse_ring' && ring) pose.index[0] = ring.curl;
  return {
    kind,
    anchor: kind === 'reverse_ring' ? 'ring' : kind === 'tee' ? 'tee' : 'grip',
    anchorInHand,
    knifeInHand,
    pose,
    handInAnchor,
    ringTwistDeg: ring?.twist,
    spread: kind === 'tee' ? { ...TEE_SPREAD } : undefined,
  };
}

// where a ring knife's handle should run: inside the fist, middle finger height
const RING_HANDLE_TARGET = new Vector3(0.006, 0.096, -0.024);
const vA = new Vector3();
const vB = new Vector3();
const vAxis = new Vector3();

/**
 * ring knives have curved handles, so after the ring is on the index finger,
 * turn the knife about the ring's axis until the handle's grip point is inside
 * the fist instead of sticking out past the finger tips.
 */
export function alignRingGrip(spec: KnifeGripSpec, ringLocal: Vector3, gripLocal: Vector3): KnifeGripSpec {
  if (spec.kind !== 'reverse_ring') return spec;
  vAxis.set(0, 0, 1).applyQuaternion(spec.knifeInHand);
  vA.subVectors(gripLocal, ringLocal).applyQuaternion(spec.knifeInHand);
  vB.subVectors(RING_HANDLE_TARGET, spec.anchorInHand);
  vA.addScaledVector(vAxis, -vA.dot(vAxis));
  vB.addScaledVector(vAxis, -vB.dot(vAxis));
  if (vA.lengthSq() < 1e-8 || vB.lengthSq() < 1e-8) return spec;
  vA.normalize();
  vB.normalize();
  const angle = Math.atan2(vA.clone().cross(vB).dot(vAxis), vA.dot(vB)) + ((spec.ringTwistDeg ?? 0) * Math.PI) / 180;
  const knifeInHand = new Quaternion().setFromAxisAngle(vAxis, angle).multiply(spec.knifeInHand);
  return {
    ...spec,
    knifeInHand,
    handInAnchor: new Matrix4().compose(spec.anchorInHand, knifeInHand, new Vector3(1, 1, 1)).invert(),
  };
}

const box = new Box3();
const tmp = new Vector3();

/**
 * handle thickness from the model: userData hints on contract glbs, otherwise
 * the mean of the height and thickness of everything behind the guard.
 */
export function measureHandleDiameter(knife: Object3D): number {
  const ud = knife.userData as { handleHeight?: number; handleThickness?: number };
  if (typeof ud.handleHeight === 'number' && typeof ud.handleThickness === 'number') {
    return (ud.handleHeight + ud.handleThickness) / 2;
  }
  box.makeEmpty();
  knife.updateMatrixWorld(true);
  const inv = new Matrix4().copy(knife.matrixWorld).invert();
  knife.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.getAttribute('position');
    if (!pos) return;
    const toKnife = new Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
    for (let i = 0; i < pos.count; i += 3) {
      tmp.fromBufferAttribute(pos, i).applyMatrix4(toKnife);
      // the handle proper, skipping the guard and any ring at the butt
      if (tmp.x < -0.015 && tmp.x > -0.09) box.expandByPoint(tmp);
    }
  });
  if (box.isEmpty()) return REFERENCE_HANDLE_M;
  const size = box.getSize(tmp);
  return Math.min(0.04, Math.max(0.012, (size.y + size.z) / 2));
}

export type { HandPose };

interface FittedEntry {
  pose: HandPose;
  offset: [number, number, number];
  opener?: [number, number, number];
  ring?: RingFit;
  engine?: Partial<Record<keyof HandPose, [number, number, number]>>;
  openerVia?: [number, number, number];
}
const FITTED_POSES = FITTED as unknown as Partial<Record<KnifeId, FittedEntry>>;

/**
 * the grip for a blender knife model: finger curls and handle placement fitted
 * to that model's geometry offline (tools/assets/gripFit.ts), so every finger
 * rests on the handle without sinking into it or the blade.
 */
export function fittedGripSpec(id: KnifeId, kind: KnifeGripKind, handleDiameter: number): KnifeGripSpec {
  // the tee grip is authored: the fitter can't spread fingers, so it would
  // rather slide the bar out of the fist than close them around the neck
  const fit = kind === 'tee' ? undefined : FITTED_POSES[id];
  const spec = knifeGripSpec(kind, handleDiameter, fit?.offset, fit?.ring);
  if (fit) spec.pose = createHandPose({ ...fit.pose, ...fit.engine });
  if (fit?.opener) spec.openerThumb = [...fit.opener];
  if (fit?.openerVia) spec.openerVia = [...fit.openerVia];
  return spec;
}
