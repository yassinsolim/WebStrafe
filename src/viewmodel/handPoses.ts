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
  | 'pistol'
  | 'deagle'
  | 'pistolSupport'
  | 'forend'
  | 'knife'
  | 'knifeReverse'
  | 'pinch'
  | 'cupMag';

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
  // thicker grip, index straight along the frame onto the trigger
  pistol: {
    index: [16, 34, 18], middle: [62, 74, 38], ring: [66, 78, 40], pinky: [70, 78, 38], thumb: [16, 26, 8],
  },
  // the deagle's trigger sits close in front of its deep grip: the first index
  // segment lies along the frame, then the finger bends in onto the trigger face
  deagle: {
    index: [-4, 60, 36], middle: [62, 74, 38], ring: [66, 78, 40], pinky: [70, 78, 38], thumb: [16, 26, 8],
  },
  pistolSupport: {
    index: [48, 58, 30], middle: [56, 66, 34], ring: [60, 70, 36], pinky: [64, 70, 34], thumb: [4, 8, 4],
  },
  forend: {
    index: [34, 44, 24], middle: [40, 50, 26], ring: [44, 54, 28], pinky: [48, 56, 28], thumb: [10, 18, 6],
  },
  knife: {
    index: [50, 64, 30], middle: [68, 84, 40], ring: [72, 86, 42], pinky: [76, 84, 40], thumb: [20, 34, 10],
  },
  knifeReverse: {
    index: [60, 70, 34], middle: [70, 86, 40], ring: [74, 88, 42], pinky: [78, 86, 40], thumb: [26, 40, 12],
  },
  pinch: {
    index: [36, 48, 26], middle: [44, 58, 30], ring: [62, 76, 38], pinky: [70, 80, 38], thumb: [24, 22, 14],
  },
  cupMag: {
    index: [26, 36, 20], middle: [32, 42, 22], ring: [36, 46, 24], pinky: [40, 48, 24], thumb: [14, 20, 8],
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
