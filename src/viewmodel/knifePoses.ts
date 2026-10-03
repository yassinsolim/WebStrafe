import { Matrix4, Quaternion, Vector3 } from 'three';
import type { KnifeId } from '../combat/knives';
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
    // slashes and the stab fitted to the m9's in a 60 fps cs2 capture.
    // forehand: flicked up on the right, cut down through the crosshair and
    // carried out of view low on the left
    windA: knifeKey(v(0.289, -0.05, -0.293), v(0.034, 0.213, -0.977), v(0.171, -0.964, -0.204), v(0.376, -0.905, 0.199)),
    cutA: knifeKey(v(0.153, -0.097, -0.327), v(0.456, 0.642, -0.617), v(0.711, 0.155, 0.686), v(0.394, -0.722, 0.568)),
    endA: knifeKey(v(0.003, -0.103, -0.351), v(0.265, 0.452, -0.852), v(0.869, 0.27, 0.414), v(0.719, -0.668, 0.192)),
    goneA: knifeKey(v(-0.05, -0.34, -0.3), v(0.265, 0.452, -0.852), v(0.869, 0.27, 0.414), v(0.719, -0.668, 0.192)),
    // backhand: across on the left, back through the crosshair and out of view on the right
    windB: knifeKey(v(-0.207, -0.102, -0.337), v(-0.51, 0.57, -0.644), v(0.433, 0.817, 0.38), v(0.742, -0.542, 0.394)),
    cutB: knifeKey(v(-0.018, -0.049, -0.299), v(-0.707, 0.036, -0.706), v(0.556, -0.589, -0.587), v(0.739, -0.528, -0.418)),
    endB: knifeKey(v(0.225, -0.119, -0.301), v(-0.132, -0.157, -0.979), v(0.929, -0.363, -0.067), v(0.714, -0.4, 0.575)),
    goneB: knifeKey(v(0.36, -0.32, -0.26), v(-0.132, -0.157, -0.979), v(0.929, -0.363, -0.067), v(0.714, -0.4, 0.575)),
    // under the screen below the idle, where every attack comes back up from
    under: knifeKey(v(0.15, -0.31, -0.25), v(-0.86, 0.45, -0.24), v(-0.46, -0.86, 0.22), v(0.4, -0.9, 0.15)),
    // stab: a short pull back, then driven in at the crosshair with the blade level
    cock: knifeKey(v(0.2, -0.04, -0.23), v(-0.3, 0.4, -0.87), v(0.95, 0.24, -0.22)),
    thrust: knifeKey(v(-0.12, -0.045, -0.32), v(0.601, 0.471, -0.646), v(0.794, -0.255, 0.552), v(-0.039, -0.782, 0.622)),
    // backstab: higher, then driven in and down
    over: knifeKey(v(0.18, 0.01, -0.22), v(-0.3, 0.25, -0.92), v(0.41, -0.84, -0.36), ELBOW_LOW),
    plunge: knifeKey(v(0.06, -0.1, -0.43), v(-0.35, -0.2, -0.91), v(0.31, -0.95, 0.09), ELBOW_IN),
  },
};

// reverse grip on the ring (karambit, talon): like cs2's idle, the fist low on
// the right with the back of the hand to the eye, leaning into the screen, the
// ring at the left end under the index and the claw out of the right end
// curving up. placed by the fist so the wrist only flexes a little. slashes
// rake the claw across, the heavy cocks it high and rips it down
const RING: KnifePoses = {
  idle: handKey(v(0.09, -0.115, -0.26), v(-0.12, 0.76, -0.64), v(0.1, 0.63, 0.77), v(0.24, -0.94, 0.24)),
  pole: ELBOW_IN,
  poses: {
    low: knifeKey(v(0.3, -0.4, -0.22), v(0.6, -0.1, -0.8), v(0.8, 0, 0.6), ELBOW_OUT),
    // the claw's flat to the eye, so a spin on the index reads as a disc
    raise: knifeKey(v(0.2, -0.03, -0.3), v(-0.7, -0.3, -0.65), v(-0.15, -0.83, 0.54)),
    // inspect: fist up, the claw hanging under it toward the middle
    show: knifeKey(v(0.12, 0, -0.27), v(-0.6, -0.7, -0.4), v(0.42, -0.69, 0.59), ELBOW_DOWN),
    // inspect: palm turned up, the claw laid out to the left
    showB: knifeKey(v(0.1, -0.05, -0.26), v(-0.85, 0.1, 0.5), v(0.3, -0.7, 0.65)),
    // forehand: the fist pulls the claw right to left through the crosshair
    windA: handKey(v(0.14, -0.05, -0.27), v(-0.12, 0.98, -0.17), v(0.24, 0.2, 0.95), v(0.24, -0.94, 0.24)),
    cutA: handKey(v(0.02, -0.04, -0.33), v(-0.12, 0.9, -0.42), v(0.2, 0.44, 0.88), v(0.24, -0.94, 0.24)),
    endA: handKey(v(-0.11, -0.11, -0.3), v(-0.37, 0.81, -0.44), v(0.7, 0.56, 0.45), v(0.24, -0.94, 0.24)),
    // backhand: from across on the left, the claw leads back out to the right
    windB: handKey(v(-0.05, -0.1, -0.28), v(-0.12, 0.9, -0.42), v(0.45, 0.43, 0.79), v(0.24, -0.94, 0.24)),
    cutB: handKey(v(0.08, -0.05, -0.34), v(-0.12, 0.9, -0.42), v(0.45, 0.43, 0.79), v(0.1, -0.9, -0.4)),
    endB: handKey(v(0.2, -0.08, -0.3), v(0.15, 0.97, -0.18), v(0.28, 0.13, 0.95), v(0.1, -0.9, -0.4)),
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

// cs2 gives every knife its own idle, so these replace the grip's one. each was
// fitted to the knife+arm outline cut out of a 60 fps cs2 capture (static
// camera), plus the blade tip, back of the hand to the eye, inside a natural
// wrist. like cs2 they all hold the blade low across the bottom right, pointing
// left and a little up
export const KNIFE_IDLES: Readonly<Partial<Record<KnifeId, KnifeKey>>> = {
  m9_bayonet: knifeKey(v(0.135, -0.138, -0.253), v(-0.867, 0.381, -0.321), v(-0.481, -0.808, 0.341), v(0.26, -0.792, -0.552)),
  bayonet: knifeKey(v(0.139, -0.117, -0.255), v(-0.898, 0.257, -0.358), v(-0.034, -0.85, -0.525), v(0.498, -0.833, 0.242)),
  flip: knifeKey(v(0.132, -0.14, -0.242), v(-0.84, 0.538, -0.073), v(-0.537, -0.805, 0.253), v(0.338, -0.832, 0.441)),
  stiletto: knifeKey(v(0.14, -0.133, -0.246), v(-0.847, 0.387, -0.364), v(-0.412, -0.911, -0.01), v(0.36, -0.9, 0.245)),
  butterfly: knifeKey(v(0.131, -0.134, -0.235), v(-0.8, 0.594, -0.081), v(-0.599, -0.8, 0.048), v(0.327, -0.918, 0.224)),
  gut: knifeKey(v(0.11, -0.102, -0.214), v(-0.879, 0.447, -0.164), v(-0.251, -0.727, -0.639), v(0.504, -0.862, -0.059)),
  huntsman: knifeKey(v(0.132, -0.137, -0.251), v(-0.857, 0.499, -0.125), v(-0.515, -0.833, 0.202), v(0.35, -0.93, 0.112)),
  skeleton: knifeKey(v(0.13, -0.125, -0.243), v(-0.879, 0.463, -0.117), v(-0.452, -0.886, -0.103), v(0.44, -0.894, 0.089)),
  bowie: knifeKey(v(0.156, -0.143, -0.227), v(-0.887, 0.456, -0.075), v(-0.332, -0.517, 0.789), v(0.674, -0.71, 0.202)),
  shadow_daggers: knifeKey(v(0.119, -0.054, -0.171), v(-0.893, 0.239, -0.381), v(-0.437, -0.66, 0.611), v(0.885, -0.391, 0.254)),
};
