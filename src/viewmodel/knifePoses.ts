import { Matrix4, Quaternion, Vector3 } from 'three';
import { frameFromYZ } from './ik';
import type { KnifeGripKind, KnifeGripSpec } from './knifeGrips';

/**
 * the key poses first person knife clips walk through (clip.seq), per way of
 * holding a knife. each pose says, in camera space (x right, y up, the view
 * down -z), where the hand's anchor sits (grip socket, ring or tee), where the
 * blade points and where the spine faces, plus where the elbow points when it
 * differs from the grip's usual one. they were laid out after cs2's knives and
 * then solved per pose for a natural wrist (tools: pose scan and probe), so the
 * edge leads every slash where the wrist allows it.
 */

export interface ItemBase {
  position: Vector3;
  rotation: Quaternion;
  /** knife keys: where the arm's elbow points (camera space), else the grip's usual one */
  pole?: Vector3;
}

/** a key placed by the hand instead (the knife follows from its grip): wrist and hand bone frame */
export interface HandKey {
  wrist: Vector3;
  hand: Quaternion;
  pole?: Vector3;
}

export type KnifeKey = ItemBase | HandKey;

export interface KnifePoses {
  idle: KnifeKey;
  /** the elbow for poses that don't set their own */
  pole: Vector3;
  poses: Readonly<Record<string, KnifeKey>>;
}

const v = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

/** an item frame from its +x and a hint for +y */
export function frameXY(x: Vector3, yHint: Vector3): Quaternion {
  const ax = x.clone().normalize();
  const az = ax.clone().cross(yHint).normalize();
  const ay = az.clone().cross(ax);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(ax, ay, az));
}

/** a key pose: grip point, where the blade points and where the spine faces (the edge faces away), and optionally the elbow */
export function knifeKey(grip: Vector3, blade: Vector3, spine: Vector3, pole?: Vector3): ItemBase {
  return { position: grip, rotation: frameXY(blade, spine), pole };
}

// middle of the closed fist in the hand bone's frame
const FIST_CENTRE = new Vector3(0, 0.093, -0.02);

/** a key placed by the fist: where it is, where the knuckles point and where the back of the hand faces */
export function handKey(fist: Vector3, knuckles: Vector3, back: Vector3, pole?: Vector3): HandKey {
  const hand = frameFromYZ(knuckles, back, new Quaternion());
  return { wrist: fist.clone().sub(FIST_CENTRE.clone().applyQuaternion(hand)), hand, pole };
}

/** the knife pose a key puts the knife in, for a knife held with `grip` */
export function resolveKnifeKey(key: KnifeKey, grip: KnifeGripSpec): ItemBase {
  if ('position' in key) return key;
  return {
    position: key.wrist.clone().add(grip.anchorInHand.clone().applyQuaternion(key.hand)),
    rotation: key.hand.clone().multiply(grip.knifeInHand),
    pole: key.pole,
  };
}

// elbows: out to the right (the usual hammer grip), down and in front (backhands
// and the ring grip), and low on the right
const ELBOW_OUT = v(1, -0.15, -0.1);
const ELBOW_IN = v(0.3, -0.6, -0.5);
const ELBOW_LOW = v(0.6, -0.6, -0.2);
const ELBOW_DOWN = v(0.55, -0.7, 0.05);

// hammer grip (and the balisong): like cs2, the fist sits low on the right with
// the elbow down and the blade stands up out of it, edge toward the middle
const HAMMER: KnifePoses = {
  idle: knifeKey(v(0.155, -0.105, -0.3), v(-0.1, 0.95, -0.3), v(0.95, 0.05, 0.3), ELBOW_DOWN),
  pole: ELBOW_OUT,
  poses: {
    // draws start out of view low on the right
    low: knifeKey(v(0.3, -0.42, -0.2), v(-0.2, 0.6, -0.77), v(0.4, 0.77, 0.5), ELBOW_LOW),
    // up on the right with the flat to the eye, where draws and tosses flourish
    raise: knifeKey(v(0.18, -0.06, -0.3), v(-0.35, 0.85, -0.4), v(0.56, 0.53, 0.64)),
    // the skeleton hanging off the index through its ring for spins (the ring
    // grip's raise, moved back by the ring to grip distance)
    ringRaise: knifeKey(v(0.163, -0.046, -0.334), v(-0.7, -0.3, -0.65), v(-0.15, -0.83, 0.54), ELBOW_IN),
    // inspect: blade upright right of the middle, one flat to the eye
    show: knifeKey(v(0.12, -0.1, -0.27), v(-0.25, 0.95, -0.15), v(0.66, 0.28, 0.7)),
    // inspect: turned over and laid across to the left, the other flat to the eye
    showB: knifeKey(v(0.1, -0.08, -0.28), v(-0.9, 0.3, -0.3), v(-0.36, -0.92, 0.15), ELBOW_IN),
    // forehand: a short wind up on the right, the blade up and the edge facing left
    windA: knifeKey(v(0.2, -0.06, -0.28), v(-0.2, 0.95, 0.1), v(0.45, 0, 0.89), ELBOW_LOW),
    // forehand: through the crosshair edge first, sweeping down to the left
    cutA: knifeKey(v(0.07, -0.07, -0.37), v(-0.55, 0.5, -0.67), v(0.51, 0.84, 0.21)),
    // forehand: carried through to the lower left, the wrist rolling over
    endA: knifeKey(v(-0.06, -0.12, -0.33), v(-0.85, -0.2, -0.5), v(0.3, -0.95, -0.13), ELBOW_LOW),
    // backhand: across the body on the left, edge facing back up to the right
    windB: knifeKey(v(0, -0.1, -0.28), v(-0.75, 0.4, -0.5), v(-0.34, -0.91, -0.22), ELBOW_IN),
    cutB: knifeKey(v(0.12, -0.06, -0.36), v(-0.4, 0.6, -0.7), v(-0.51, -0.77, -0.37), ELBOW_IN),
    endB: knifeKey(v(0.25, -0.08, -0.3), v(-0.05, 0.8, -0.6), v(-0.56, -0.52, -0.65), ELBOW_IN),
    // stab: drawn back high on the right, then driven in at the crosshair with
    // the blade angled in past the fist so it stays in view
    cock: knifeKey(v(0.2, -0.04, -0.23), v(-0.3, 0.4, -0.87), v(0.95, 0.24, -0.22)),
    thrust: knifeKey(v(0.08, -0.08, -0.43), v(-0.35, 0.2, -0.91), v(0.93, 0, -0.36)),
    // backstab: higher, then driven in and down
    over: knifeKey(v(0.18, 0.01, -0.22), v(-0.3, 0.25, -0.92), v(0.41, -0.84, -0.36), ELBOW_LOW),
    plunge: knifeKey(v(0.06, -0.1, -0.43), v(-0.35, -0.2, -0.91), v(0.31, -0.95, 0.09), ELBOW_IN),
  },
};

// reverse grip on the ring (karambit, talon): like cs2, an upright fist on the
// right with the handle standing straight up through it, the ring on top under
// the index and the claw hanging out under the little finger, curving down to
// the left. the idle is placed by the fist so the wrist stays straight.
// slashes rake the claw across behind the fist, the heavy cocks it high and
// rips it down
const RING: KnifePoses = {
  idle: handKey(v(0.13, 0, -0.25), v(-0.81, 0.5, -0.3), v(-0.04, -0.56, -0.83), v(0.9, -0.5, 0.1)),
  pole: ELBOW_IN,
  poses: {
    low: knifeKey(v(0.3, -0.4, -0.22), v(0.6, -0.1, -0.8), v(0.8, 0, 0.6), ELBOW_OUT),
    // the claw's flat to the eye, so a spin on the index reads as a disc
    raise: knifeKey(v(0.2, -0.03, -0.3), v(-0.7, -0.3, -0.65), v(-0.15, -0.83, 0.54)),
    // inspect: fist up, the claw hanging under it toward the middle
    show: knifeKey(v(0.12, 0, -0.27), v(-0.6, -0.7, -0.4), v(0.42, -0.69, 0.59), ELBOW_DOWN),
    // inspect: palm turned up, the claw laid out to the left
    showB: knifeKey(v(0.1, -0.05, -0.26), v(-0.85, 0.1, 0.5), v(0.3, -0.7, 0.65)),
    // forehand rake: the claw hangs off the fist on the right, then rakes
    // across the middle and carries through low on the left
    windA: knifeKey(v(0.22, -0.03, -0.28), v(0.3, -0.8, -0.5), v(0.07, -0.51, 0.86), ELBOW_OUT),
    cutA: knifeKey(v(0.04, -0.05, -0.36), v(0.6, -0.6, -0.5), v(-0.47, -0.79, 0.39)),
    endA: knifeKey(v(-0.12, -0.1, -0.3), v(0.2, -0.1, -1), v(0.24, -0.96, 0.14)),
    // backhand: the fist leads back to the right with the claw out behind it
    windB: knifeKey(v(-0.02, -0.12, -0.28), v(0.7, -0.1, -0.7), v(0.11, -0.96, 0.25)),
    cutB: knifeKey(v(0.13, -0.05, -0.35), v(1, 0, -0.2), v(0, -1, 0)),
    endB: knifeKey(v(0.24, -0.06, -0.32), v(0.75, 0.1, -0.65), v(0.24, -0.96, 0.13), ELBOW_DOWN),
    cock: knifeKey(v(0.18, 0.06, -0.26), v(0, -0.8, -0.6), v(0.26, -0.58, 0.77), ELBOW_OUT),
    thrust: knifeKey(v(0.02, -0.1, -0.38), v(0.5, -0.5, -0.7), v(-0.07, -0.84, 0.55)),
    over: knifeKey(v(0.17, 0.1, -0.24), v(0.1, -0.6, -0.8), v(0.19, -0.77, 0.6), ELBOW_OUT),
    plunge: knifeKey(v(0.05, -0.08, -0.4), v(-0.1, -0.85, -0.5), v(0.17, -0.51, 0.84), ELBOW_OUT),
  },
};

// push daggers: knuckles up and forward so the blades come out between the
// fingers; the left fist mirrors the right unless a clip moves it on its own
const DAGGER_SPINE = v(-0.95, 0.05, 0.3);
const TEE: KnifePoses = {
  idle: knifeKey(v(0.093, -0.058, -0.344), v(-0.15, 0.823, -0.547), v(-0.945, 0.043, 0.324)),
  pole: ELBOW_DOWN,
  poses: {
    low: knifeKey(v(0.25, -0.4, -0.22), v(-0.1, 0.8, -0.6), v(-0.92, 0.16, 0.36)),
    // jab: a short pull back, then punched straight in at the crosshair
    cock: knifeKey(v(0.16, -0.07, -0.24), v(-0.1, 0.9, -0.4), DAGGER_SPINE),
    jab: knifeKey(v(0.05, -0.02, -0.5), v(-0.05, 0.45, -0.89), DAGGER_SPINE),
    // backstab: up high, then hammered down and in
    over: knifeKey(v(0.12, 0.01, -0.32), v(-0.1, 0.6, -0.8), v(-0.43, 0.69, 0.58)),
    plunge: knifeKey(v(0.06, -0.1, -0.45), v(-0.05, -0.2, -0.98), DAGGER_SPINE),
  },
};

export const KNIFE_POSES: Readonly<Record<KnifeGripKind, KnifePoses>> = {
  hammer: HAMMER,
  balisong: HAMMER,
  reverse_ring: RING,
  tee: TEE,
};
