/**
 * finger poses for the v2 arms, in degrees. digits curl about local -X
 * (positive closes toward the palm), the same on both hands. thumb angles run
 * about the three thumb axes measured on the rig (docs/assets/arms.md).
 */
export interface HandPose {
  index: readonly [number, number, number];
  middle: readonly [number, number, number];
  ring: readonly [number, number, number];
  pinky: readonly [number, number, number];
  thumb: readonly [number, number, number];
}

export type HandPoseName =
  | 'relaxed'
  | 'open'
  | 'fist'
  | 'deagle'
  | 'deagleSupport'
  | 'awp'
  | 'awpForend'
  | 'awpBolt'
  | 'awpBoltClosed'
  | 'deagleMag'
  | 'awpMag'
  | 'knife'
  | 'knifeReverse'
  | 'watchGun';

export const HAND_POSES: Readonly<Record<HandPoseName, HandPose>> = {
  relaxed: {
    index: [10, 16, 10], middle: [14, 20, 12], ring: [16, 22, 12], pinky: [18, 22, 12], thumb: [6, 10, 6],
  },
  open: {
    index: [2, 4, 2], middle: [2, 4, 2], ring: [3, 5, 3], pinky: [4, 6, 3], thumb: [0, 2, 0],
  },
  // the rig's measured fist around a 2 cm channel
  fist: {
    index: [42, 58, 26], middle: [78, 92, 42], ring: [80, 94, 44], pinky: [84, 92, 42], thumb: [22.5, 38.6, 9.5],
  },
  // gun poses are fitted offline against the shipped glbs with their grips in
  // ViewmodelSystem: every segment within about 1 mm of the surface it rests on,
  // at most a few mm of glove squeeze, nothing through a guard or panel.
  // deagle firing hand: index pad on the trigger face, the rest wrapped around
  // the front strap, thumb behind the backstrap and forward high on the left
  deagle: {
    index: [-8, 78, 54], middle: [58, 34, 48], ring: [52, 30, 23], pinky: [36, 18, 36], thumb: [59, -27, -30],
  },
  // support hand wrapped over the firing fingers under the guard, thumb forward
  // along the left of the frame below the firing thumb
  deagleSupport: {
    index: [16, 26, 17], middle: [0, 26, 17], ring: [9, 5, 56], pinky: [19, 11, 29], thumb: [14, -19, 17],
  },
  // awp thumbhole grip: index on the trigger, thumb out through the hole
  awp: {
    index: [-1, 83, -12], middle: [57, 26, 15], ring: [57, 26, 15], pinky: [52, 24, 13], thumb: [61, -32, -11],
  },
  // palm up under the forend, fingers up the right side, thumb up the left
  awpForend: {
    index: [0, 62, 41], middle: [22, 51, 34], ring: [44, 26, 18], pinky: [40, 24, 16], thumb: [39, -44, 16],
  },
  // bolt knob, lifted or pulled back: index and middle wrapped round the knob and handle
  awpBolt: {
    index: [54, 43, 75], middle: [52, 72, 45], ring: [85, 100, 75], pinky: [85, 100, 75], thumb: [33, 31, -49],
  },
  // bolt closed, the knob sits against the stock: fingers over the top, thumb pad on the knob
  awpBoltClosed: {
    index: [4, 3, 2], middle: [26, 21, 13], ring: [85, 100, 75], pinky: [85, 100, 75], thumb: [-14, 64, 18],
  },
  knife: {
    index: [50, 64, 30], middle: [68, 84, 40], ring: [72, 86, 42], pinky: [76, 84, 40], thumb: [20, 34, 10],
  },
  knifeReverse: {
    index: [60, 70, 34], middle: [70, 86, 40], ring: [74, 88, 42], pinky: [78, 86, 40], thumb: [26, 40, 12],
  },
  // palm under the magazine floorplate, fingers up the front against the grip
  deagleMag: {
    index: [38, 23, 15], middle: [36, 21, 14], ring: [34, 20, 14], pinky: [36, 21, 14], thumb: [14, 20, 8],
  },
  awpMag: {
    index: [8, 67, 45], middle: [41, 37, 24], ring: [65, 39, 26], pinky: [93, 56, 37], thumb: [-10, -20, 0],
  },
  // loosely curled for the watch check on the guns, so the fingers stay off the gun
  watchGun: {
    index: [40, 50, 30], middle: [46, 56, 32], ring: [50, 58, 32], pinky: [54, 58, 30], thumb: [10, 16, 8],
  },
};

const DIGITS = ['index', 'middle', 'ring', 'pinky', 'thumb'] as const;

/** out = lerp(a, b, t), reusing out's arrays */
export function blendHandPose(a: HandPose, b: HandPose, t: number, out: MutableHandPose): MutableHandPose {
  for (const digit of DIGITS) {
    const from = a[digit];
    const to = b[digit];
    const dst = out[digit];
    dst[0] = from[0] + (to[0] - from[0]) * t;
    dst[1] = from[1] + (to[1] - from[1]) * t;
    dst[2] = from[2] + (to[2] - from[2]) * t;
  }
  return out;
}

export interface MutableHandPose {
  index: [number, number, number];
  middle: [number, number, number];
  ring: [number, number, number];
  pinky: [number, number, number];
  thumb: [number, number, number];
}

export function createHandPose(from: HandPose = HAND_POSES.relaxed): MutableHandPose {
  return {
    index: [...from.index],
    middle: [...from.middle],
    ring: [...from.ring],
    pinky: [...from.pinky],
    thumb: [...from.thumb],
  };
}
