import { Box3, Matrix4, Mesh, Quaternion, Vector3, type Object3D } from 'three';
import type { KnifeDef } from '../combat/knives';
import { blendHandPose, createHandPose, HAND_POSES, type HandPose, type MutableHandPose } from './handPoses';

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
}

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
// 60 degrees toward the palm, the middle of that phalanx is where the ring sits
const INDEX_CURL_DEG = 60;
const ringAxis = new Vector3(0, Math.cos((INDEX_CURL_DEG * Math.PI) / 180), -Math.sin((INDEX_CURL_DEG * Math.PI) / 180));
const RING_IN_HAND = new Vector3(-0.024, 0.101, 0).addScaledVector(ringAxis, 0.019);

const KNIFE_IN_HAND: Record<KnifeGripKind, Quaternion> = {
  hammer: axes([-1, 0, 0], [0, -1, 0], [0, 0, 1]),
  balisong: axes([-1, 0, 0], [0, -1, 0], [0, 0, 1]),
  // ring axis is the knife's z (the ring lies in the blade plane)
  // edge (and the hook's curve) forward past the little finger
  reverse_ring: axes([1, 0, 0], [0, -ringAxis.z, ringAxis.y], [0, -ringAxis.y, -ringAxis.z]),
  tee: axes([0, 1, 0], [-1, 0, 0], [0, 0, 1]),
};

/** typical handle, the size the default anchors were tuned on */
const REFERENCE_HANDLE_M = 0.026;

function anchorFor(kind: KnifeGripKind, handleDiameter: number): Vector3 {
  // a thicker handle sits further out from the finger bones
  const extra = Math.max(-0.006, Math.min(0.01, handleDiameter - REFERENCE_HANDLE_M));
  switch (kind) {
    case 'reverse_ring':
      return RING_IN_HAND.clone();
    case 'tee':
      // between the middle (x 0) and ring (x 0.021) fingers
      return new Vector3(0.011, 0.098, -0.022);
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
  blendHandPose(HAND_POSES.fist, HAND_POSES.pistolSupport, open * 0.8, out);
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
    // tight fist around the bar
    blendHandPose(HAND_POSES.fist, HAND_POSES.fist, 0, out);
  }
  return out;
}

export function knifeGripSpec(kind: KnifeGripKind, handleDiameter: number): KnifeGripSpec {
  const anchorInHand = anchorFor(kind, handleDiameter);
  const knifeInHand = KNIFE_IN_HAND[kind].clone();
  const handInAnchor = new Matrix4().compose(anchorInHand, knifeInHand, new Vector3(1, 1, 1)).invert();
  return {
    kind,
    anchor: kind === 'reverse_ring' ? 'ring' : kind === 'tee' ? 'tee' : 'grip',
    anchorInHand,
    knifeInHand,
    pose: wrapPose(kind, handleDiameter),
    handInAnchor,
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
  const angle = Math.atan2(vA.clone().cross(vB).dot(vAxis), vA.dot(vB));
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
