import type { KnifeDef, KnifeId } from '../combat/knives';
import type { Clip } from './clips';

/**
 * first person knife clips, after cs2's. the hand and knife travel through
 * whole key poses on curved paths (seq, names from knifePoses.ts, 'idle' is
 * the rest pose); the channel tracks on top drive the fingers and the knife's
 * own parts (spins, tosses, folding blades, balisong handles) and small camera
 * space accents (px py pz in metres, rx ry rz in degrees).
 *
 * the feel: slashes wind up for a few frames, cut through the crosshair edge
 * first and carry through before settling back, so the hit (which lands on the
 * click) reads at once; the stab draws back and drives in at the crosshair;
 * draws come up from low on the right with the knife's own flourish and settle
 * by about 0.6 s; inspects show one flat, then the other, then a flourish.
 */

export type KnifeClipName = 'draw' | 'inspect' | 'slashA' | 'slashB' | 'stab' | 'backstab';
export type KnifeDrawStyle = 'unsheathe' | 'toss_flip' | 'flip_open' | 'switch_open' | 'spin_draw' | 'balisong_open' | 'spin_in' | 'skeleton_spin' | 'dagger_pair';
export type KnifeInspectStyle = 'flip_show' | 'switch_show' | 'balisong' | 'ring_spin' | 'skeleton_ring' | 'toss_catch' | 'twirl' | 'heavy_show' | 'dagger_pair';

const HEAVY: ReadonlySet<KnifeId> = new Set(['bowie', 'huntsman']);
const TWIRL: ReadonlySet<KnifeId> = new Set(['bayonet', 'm9_bayonet']);

export function knifeDrawStyle(def: KnifeDef): KnifeDrawStyle {
  const mech = def.shape.mechanism ?? 'fixed';
  if (def.shape.pair) return 'dagger_pair';
  if (mech === 'balisong') return 'balisong_open';
  // the stiletto is a switchblade: the blade snaps out on the button
  if (def.id === 'stiletto') return 'switch_open';
  // the skeleton is held in a hammer grip, but the draw twirls it on the index finger through its ring
  if (def.id === 'skeleton') return 'skeleton_spin';
  if (def.shape.fingerRing) return 'spin_in';
  if (mech === 'folder') return 'flip_open';
  if (TWIRL.has(def.id)) return 'spin_draw';
  if (HEAVY.has(def.id)) return 'toss_flip';
  return 'unsheathe';
}

export function knifeInspectStyle(def: KnifeDef): KnifeInspectStyle {
  const mech = def.shape.mechanism ?? 'fixed';
  if (def.shape.pair) return 'dagger_pair';
  if (mech === 'balisong') return 'balisong';
  if (def.id === 'skeleton') return 'skeleton_ring';
  if (def.shape.fingerRing) return 'ring_spin';
  if (def.id === 'stiletto') return 'switch_show';
  if (TWIRL.has(def.id)) return 'twirl';
  if (mech === 'folder') return 'flip_show';
  if (HEAVY.has(def.id)) return 'heavy_show';
  return 'toss_catch';
}

/** reverse (blade under the little finger) grip for the hawkbill ring knives */
export function knifeUsesReverseGrip(def: KnifeDef): boolean {
  return def.shape.fingerRing === true;
}

// every draw starts out of view low on the right ('low'), comes up into the
// pose its flourish needs ('raise') and settles into the idle
const DRAWS: Readonly<Record<KnifeDrawStyle, Clip>> = {
  unsheathe: {
    // straight up from low right, the wrist rolling the knife over into the grip
    duration: 0.75,
    seq: [[0, 'low'], [0.2, 'raise', 'out'], [0.55, 'idle', 'inOut']],
    tracks: {
      holdRoll: [[0, -140], [0.06, -140], [0.38, 0, 'out']],
      rz: [[0, 0], [0.5, 0], [0.58, -4, 'out'], [0.75, 0, 'inOut']],
    },
    events: [[0.05, 'sound:knife_draw'], [0.38, 'sound:knife_catch']],
  },
  toss_flip: {
    // heavy blades: tossed up off the palm, one turn end over end, caught with a dip
    duration: 0.85,
    seq: [[0, 'low'], [0.2, 'raise', 'out'], [0.62, 'idle', 'inOut']],
    tracks: {
      tossY: [[0, 0], [0.13, 0], [0.25, 0.07, 'out'], [0.4, 0, 'in']],
      spinZ: [[0, 0], [0.14, 0], [0.4, 360, 'inOut']],
      gripOpen: [[0, 0], [0.11, 0], [0.15, 1], [0.38, 1], [0.44, 0, 'out']],
      py: [[0, 0], [0.4, 0], [0.45, -0.012, 'out'], [0.62, 0, 'inOut']],
    },
    events: [[0.05, 'sound:knife_draw'], [0.14, 'sound:knife_toss'], [0.41, 'sound:knife_catch']],
  },
  flip_open: {
    // up closed with the thumb on the opener, a wrist snap throws the blade open
    duration: 0.95,
    seq: [[0, 'low'], [0.22, 'raise', 'out'], [0.5, 'raise'], [0.78, 'idle', 'inOut']],
    tracks: {
      knifeOpen: [[0, 0], [0.34, 0], [0.44, 1, 'back']],
      thumbOpener: [[0, 0], [0.14, 0], [0.28, 1, 'inOut'], [0.44, 1], [0.58, 0, 'inOut']],
      rz: [[0, 12], [0.28, 0, 'out'], [0.36, -6], [0.44, 16, 'out'], [0.6, -3, 'inOut'], [0.8, 0, 'inOut']],
      rx: [[0, 0], [0.36, 0], [0.45, 8, 'out'], [0.62, 0, 'inOut']],
    },
    events: [[0.05, 'sound:knife_draw'], [0.43, 'sound:knife_open']],
  },
  switch_open: {
    // up with the thumb on the button, the blade swings out in a few frames and the knife kicks
    duration: 0.9,
    seq: [[0, 'low'], [0.22, 'raise', 'out'], [0.46, 'raise'], [0.75, 'idle', 'inOut']],
    tracks: {
      thumbOpener: [[0, 1], [0.42, 1], [0.56, 0, 'inOut']],
      knifeOpen: [[0, 0], [0.36, 0], [0.41, 1, 'out']],
      rx: [[0, 0], [0.36, 0], [0.42, 9, 'out'], [0.58, 0, 'inOut']],
      rz: [[0, 0], [0.36, 0], [0.43, -6, 'out'], [0.6, 0, 'inOut']],
    },
    events: [[0.05, 'sound:knife_draw'], [0.39, 'sound:knife_open']],
  },
  spin_draw: {
    // bayonets: a flick on the way up turns the knife once round just off the
    // loosened fingers, which snap shut on it before it drops into the idle
    duration: 0.8,
    seq: [[0, 'low'], [0.2, 'raise', 'out'], [0.42, 'raise'], [0.66, 'idle', 'inOut']],
    tracks: {
      spinZ: [[0, 0], [0.12, 0], [0.38, 360, 'inOut']],
      tossY: [[0, 0], [0.1, 0], [0.16, 0.03, 'out'], [0.33, 0.03], [0.39, 0, 'in']],
      gripOpen: [[0, 0], [0.1, 0], [0.14, 0.85], [0.36, 0.85], [0.42, 0, 'out']],
      rz: [[0, 0], [0.4, 0], [0.47, -6, 'out'], [0.66, 0, 'inOut']],
    },
    events: [[0.05, 'sound:knife_draw'], [0.2, 'sound:knife_spin'], [0.4, 'sound:knife_catch']],
  },
  balisong_open: {
    // up on the right, every handle swing thrown by a wrist flick, then down into the idle
    duration: 1.25,
    seq: [[0, 'low'], [0.22, 'raise', 'out'], [0.92, 'raise'], [1.2, 'idle', 'inOut']],
    tracks: {
      baliSafe: [[0, 1], [0.26, 1], [0.44, 0, 'out'], [0.6, 0], [0.78, 1, 'inOut'], [0.96, 0, 'out']],
      baliBite: [[0, 1], [0.4, 1], [0.62, 0, 'out']],
      rz: [[0, 0], [0.24, -10, 'out'], [0.42, 14, 'out'], [0.58, -12, 'inOut'], [0.76, 12, 'inOut'], [0.94, -8, 'out'], [1.2, 0, 'inOut']],
    },
    events: [[0.44, 'sound:knife_open'], [0.62, 'sound:knife_open'], [0.96, 'sound:knife_open']],
  },
  spin_in: {
    // ring knives: up with the fingers open and the knife whirling twice round
    // the index through the ring, then the fist closes and drops into the idle
    duration: 0.95,
    seq: [[0, 'low'], [0.2, 'raise', 'out'], [0.5, 'raise'], [0.8, 'idle', 'inOut']],
    tracks: {
      spinZ: [[0, 0], [0.08, 0], [0.56, 720, 'out']],
      gripOpen: [[0, 0.95], [0.5, 0.95], [0.62, 0, 'out']],
      rz: [[0, 0], [0.78, 0], [0.86, -5, 'out'], [0.95, 0, 'inOut']],
    },
    events: [[0.08, 'sound:knife_draw'], [0.28, 'sound:knife_spin']],
  },
  skeleton_spin: {
    // index slips into the ring, the knife twirls round it, then the hand takes the handle
    duration: 1.05,
    seq: [[0, 'low'], [0.22, 'ringRaise', 'out'], [0.72, 'ringRaise'], [0.84, 'idle', 'inOut']],
    tracks: {
      // the hand swaps from the ring to the handle quickly, in step with the pose
      ringHold: [[0, 1], [0.72, 1], [0.84, 0, 'inOut']],
      spinZ: [[0, 0], [0.08, 0], [0.7, 720, 'out']],
      gripOpen: [[0, 0.95], [0.84, 0.95], [0.94, 0, 'out']],
    },
    events: [[0.08, 'sound:knife_draw'], [0.3, 'sound:knife_spin']],
  },
  dagger_pair: {
    // both fists come up from low, the wrists turning the blades into place
    duration: 0.7,
    seq: [[0, 'low'], [0.42, 'idle', 'out']],
    tracks: {
      holdRoll: [[0, -80], [0.46, 0, 'out']],
      rz: [[0, 0], [0.42, 0], [0.5, -5, 'out'], [0.7, 0, 'inOut']],
    },
    events: [[0.25, 'sound:knife_draw']],
  },
};

// show one flat, turn it over to the other, and back to the idle
const SHOW_TURN = (end: number) => [
  [0, 'idle'], [0.45, 'show', 'out'], [1.6, 'show'], [1.95, 'showB', 'inOut'], [end - 0.4, 'showB'], [end, 'idle', 'inOut'],
] as const;

const INSPECTS: Readonly<Record<KnifeInspectStyle, Clip>> = {
  flip_show: {
    // one flat, the other, then folded half shut and flicked open again
    duration: 4.0,
    seq: SHOW_TURN(3.6),
    tracks: {
      knifeOpen: [[0, 1], [2.1, 1], [2.4, 0.72, 'inOut'], [2.62, 0.72], [2.72, 1, 'back']],
      thumbOpener: [[0, 0], [2.35, 0], [2.48, 1, 'inOut'], [2.66, 1], [2.8, 0, 'inOut']],
      rz: [[0, 0], [0.45, -5, 'out'], [1.1, 6, 'inOut'], [1.6, 0, 'inOut'], [2.6, 0], [2.68, 16, 'out'], [2.85, -4, 'inOut'], [3.0, 0, 'inOut']],
      ry: [[0, 0], [0.45, 8, 'out'], [1.2, -6, 'inOut'], [1.6, 0, 'inOut']],
    },
    events: [[2.4, 'sound:knife_open'], [2.7, 'sound:knife_open']],
  },
  switch_show: {
    // look at it, let the blade fold, snap it out on the button, then the other side
    duration: 3.9,
    seq: [[0, 'idle'], [0.45, 'show', 'out'], [1.9, 'show'], [2.25, 'showB', 'inOut'], [3.2, 'showB'], [3.6, 'idle', 'inOut']],
    tracks: {
      knifeOpen: [[0, 1], [0.75, 1], [1.05, 0, 'inOut'], [1.38, 0], [1.43, 1, 'out']],
      // the thumb waits off the blade's path while it shuts, then goes onto the button
      thumbOpener: [[0, 0], [0.5, 0], [0.66, 0.5, 'inOut'], [1.06, 0.5], [1.18, 1, 'inOut'], [1.45, 1], [1.6, 0, 'inOut']],
      rx: [[0, 0], [1.38, 0], [1.44, 8, 'out'], [1.6, 0, 'inOut']],
      rz: [[0, 0], [0.45, -4, 'out'], [1.0, 5, 'inOut'], [1.38, 0, 'inOut']],
    },
    events: [[1.0, 'sound:knife_open'], [1.41, 'sound:knife_open']],
  },
  balisong: {
    // opens and closes in a rhythm: the hand keeps the bite handle, the safe
    // handle swings over the spine and the blade swings out round the bite pin,
    // every swing thrown by the wrist, with a rollover in the middle
    duration: 4.7,
    seq: [[0, 'idle'], [0.4, 'show', 'out'], [3.85, 'show'], [4.25, 'idle', 'inOut']],
    tracks: {
      baliSafe: [
        [0, 0], [0.45, 0], [0.62, 1, 'out'], [0.8, 1], [0.97, 0, 'in'],
        [1.45, 0], [1.6, 1, 'out'], [1.75, 0, 'in'],
        [2.35, 0], [2.5, 1, 'out'], [2.62, 1], [2.78, 0, 'in'],
        [3.2, 0], [3.33, 1, 'out'], [3.46, 0, 'in'],
      ],
      baliBite: [
        [0, 0], [0.62, 0], [0.8, 1, 'out'], [0.97, 1], [1.12, 0, 'in'],
        [1.6, 0], [1.75, 1, 'out'], [1.9, 0, 'in'],
        [2.5, 0], [2.62, 1, 'out'], [2.78, 1], [2.93, 0, 'in'],
        [3.33, 0], [3.46, 1, 'out'], [3.6, 0, 'in'],
      ],
      rz: [
        [0, 0], [0.4, -4, 'out'], [0.6, 12, 'out'], [0.8, -8, 'inOut'], [0.97, 10, 'out'], [1.2, 0, 'inOut'],
        [1.58, 12, 'out'], [1.75, -10, 'inOut'], [1.9, 8, 'out'], [2.2, 0, 'inOut'],
        [2.48, 12, 'out'], [2.78, -10, 'inOut'], [2.93, 8, 'out'], [3.3, -10, 'out'], [3.46, 10, 'inOut'], [3.6, -6, 'out'], [3.85, 0, 'inOut'],
      ],
      rollX: [[0, 0], [1.9, 0], [2.2, 180, 'inOut'], [2.93, 360, 'inOut']],
    },
    events: [
      [0.62, 'sound:knife_open'], [0.97, 'sound:knife_open'], [1.6, 'sound:knife_open'], [1.9, 'sound:knife_open'],
      [2.5, 'sound:knife_open'], [2.93, 'sound:knife_open'], [3.33, 'sound:knife_open'], [3.6, 'sound:knife_open'],
    ],
  },
  ring_spin: {
    // ring knives: a spin on the index while the fist comes up to show the
    // claw, a slow look at both curves, another spin on the way back down
    duration: 4.0,
    seq: [[0, 'idle'], [0.7, 'show', 'inOut'], [1.7, 'show'], [2.2, 'showB', 'inOut'], [3.0, 'showB'], [3.65, 'idle', 'inOut']],
    tracks: {
      rz: [[0, 0], [0.7, 0], [1.2, 6, 'inOut'], [1.7, 0, 'inOut'], [2.6, -5, 'inOut'], [3.0, 0, 'inOut']],
      ry: [[0, 0], [0.7, 0], [1.3, -8, 'inOut'], [1.7, 0, 'inOut']],
      spinZ: [[0, 0], [0.12, 0], [0.62, 360, 'inOut'], [3.0, 360], [3.55, 720, 'inOut']],
      // the fingers let go while it spins, the index stays hooked in the ring
      gripOpen: [[0, 0], [0.1, 0], [0.18, 0.95], [0.56, 0.95], [0.68, 0], [2.96, 0], [3.04, 0.95], [3.5, 0.95], [3.62, 0]],
    },
    events: [[0.3, 'sound:knife_spin'], [3.2, 'sound:knife_spin']],
  },
  skeleton_ring: {
    // look at it, then hook the index through the ring and spin it on the finger
    duration: 4.4,
    // the hand swaps between the handle and the ring quickly, in step with the pose
    seq: [[0, 'idle'], [0.45, 'show', 'out'], [1.3, 'show'], [1.42, 'ringRaise', 'inOut'], [3.0, 'ringRaise'], [3.12, 'raise', 'inOut'], [3.7, 'idle', 'inOut']],
    tracks: {
      rz: [[0, 0], [0.45, -5, 'out'], [1.0, 5, 'inOut'], [1.3, 0, 'inOut']],
      ringHold: [[0, 0], [1.3, 0], [1.42, 1, 'inOut'], [3.0, 1], [3.12, 0, 'inOut']],
      // let go before the hand moves to the ring, close only once it is back on the handle
      gripOpen: [[0, 0], [1.22, 0], [1.3, 0.95], [3.12, 0.95], [3.22, 0]],
      spinZ: [[0, 0], [1.5, 0], [2.15, 360, 'inOut'], [2.85, 720, 'inOut']],
    },
    events: [[1.85, 'sound:knife_spin'], [2.55, 'sound:knife_spin']],
  },
  toss_catch: {
    // up to look at it, a dip and a flick that tumbles it end over end and
    // over once in the air, caught with a bounce
    duration: 3.8,
    seq: [[0, 'idle'], [0.45, 'show', 'out'], [1.35, 'show'], [1.65, 'raise', 'inOut'], [2.6, 'raise'], [3.0, 'idle', 'inOut']],
    tracks: {
      py: [[0, 0], [1.4, 0], [1.6, -0.015, 'inOut'], [1.72, 0.02, 'out'], [2.2, 0.01], [2.32, -0.01, 'out'], [2.6, 0, 'inOut']],
      rx: [[0, 0], [1.5, 0], [1.6, -10], [1.72, 10, 'out'], [2.0, 0, 'inOut'], [2.3, 0], [2.36, -8, 'out'], [2.6, 0, 'inOut']],
      tossY: [[0, 0], [1.72, 0], [2.0, 0.13, 'out'], [2.3, 0.012, 'in'], [2.34, 0]],
      // spins and rolls only once it has left the fingers and lands the right way round
      spinZ: [[0, 0], [1.78, 0], [2.3, 360, 'inOut']],
      rollX: [[0, 0], [1.78, 0], [2.3, 360, 'inOut']],
      gripOpen: [[0, 0], [1.68, 0], [1.75, 1], [2.3, 1], [2.38, 0]],
      rz: [[0, 0], [0.45, -5, 'out'], [1.0, 6, 'inOut'], [1.35, 0, 'inOut']],
    },
    events: [[1.73, 'sound:knife_toss'], [2.33, 'sound:knife_catch']],
  },
  twirl: {
    // both flats, then the hand opens and whirls it twice round the grip and
    // snaps the fingers shut on it
    duration: 4.2,
    seq: [[0, 'idle'], [0.45, 'show', 'out'], [1.5, 'show'], [1.85, 'showB', 'inOut'], [2.45, 'showB'], [2.8, 'raise', 'inOut'], [3.55, 'raise'], [3.95, 'idle', 'inOut']],
    tracks: {
      rz: [[0, 0], [0.45, -4, 'out'], [1.0, 5, 'inOut'], [1.5, 0, 'inOut'], [3.5, 0], [3.58, -10, 'out'], [3.8, 0, 'inOut']],
      ry: [[0, 0], [0.45, 6, 'out'], [1.1, -6, 'inOut'], [1.5, 0, 'inOut']],
      spinZ: [[0, 0], [2.8, 0], [3.42, 720, 'inOut']],
      tossY: [[0, 0], [2.72, 0], [2.82, 0.035, 'out'], [3.42, 0.035], [3.5, 0, 'in']],
      gripOpen: [[0, 0], [2.66, 0], [2.76, 0.9], [3.46, 0.9], [3.56, 0, 'out']],
    },
    events: [[2.95, 'sound:knife_spin'], [3.25, 'sound:knife_spin'], [3.52, 'sound:knife_catch']],
  },
  heavy_show: {
    // slower and weightier: both flats, then a short flip toss and catch
    duration: 4.3,
    seq: [[0, 'idle'], [0.55, 'show', 'out'], [1.7, 'show'], [2.05, 'showB', 'inOut'], [2.7, 'showB'], [3.0, 'raise', 'inOut'], [3.75, 'raise'], [4.1, 'idle', 'inOut']],
    tracks: {
      tossY: [[0, 0], [3.05, 0], [3.3, 0.09, 'out'], [3.55, 0.01, 'in'], [3.6, 0]],
      spinZ: [[0, 0], [3.1, 0], [3.55, 360, 'inOut']],
      gripOpen: [[0, 0], [3.0, 0], [3.08, 1], [3.55, 1], [3.64, 0]],
      py: [[0, 0], [3.55, 0], [3.62, -0.012, 'out'], [3.85, 0, 'inOut']],
      rz: [[0, 0], [0.55, -4, 'out'], [1.2, 6, 'inOut'], [1.7, 0, 'inOut']],
    },
    events: [[3.06, 'sound:knife_toss'], [3.58, 'sound:knife_catch']],
  },
  dagger_pair: {
    // a t-grip can't turn in the fist, so the wrists roll each side into view
    duration: 3.4,
    tracks: {
      ry: [[0, 0], [0.5, 25], [1.4, 25], [1.8, -15], [2.5, -15], [2.9, 0]],
      rz: [[0, 0], [0.5, 50], [1.4, 50], [1.8, -40], [2.5, -40], [2.9, 0]],
      py: [[0, 0], [0.5, 0.05], [2.5, 0.05], [2.9, 0]],
      holdRoll: [[0, 0], [1.4, 0], [1.8, 70, 'inOut'], [2.1, 70], [2.5, -50, 'inOut'], [2.9, 0, 'inOut']],
    },
  },
};

// the rarer inspect a knife sometimes plays instead, like cs2's rare animations
const RARE_INSPECTS: Partial<Record<KnifeInspectStyle, Clip>> = {
  // ring knives: spin after spin on the index with the fist up
  ring_spin: {
    duration: 4.2,
    seq: [[0, 'idle'], [0.6, 'show', 'inOut'], [3.3, 'show'], [3.9, 'idle', 'inOut']],
    tracks: {
      spinZ: [[0, 0], [0.12, 0], [0.6, 360, 'inOut'], [1.1, 720, 'inOut'], [1.6, 1080, 'inOut'], [2.1, 1440, 'inOut'], [2.6, 1800, 'inOut'], [3.3, 2160, 'inOut']],
      gripOpen: [[0, 0], [0.1, 0], [0.18, 0.95], [3.2, 0.95], [3.35, 0]],
      rz: [[0, 0], [0.6, 0], [1.6, 8, 'inOut'], [2.6, -8, 'inOut'], [3.3, 0, 'inOut']],
    },
    events: [[0.3, 'sound:knife_spin'], [0.85, 'sound:knife_spin'], [1.35, 'sound:knife_spin'], [1.85, 'sound:knife_spin'], [2.35, 'sound:knife_spin'], [2.9, 'sound:knife_spin']],
  },
  // fast fanning: four quick open and shut swings with the wrist driving each
  balisong: {
    duration: 3.6,
    seq: [[0, 'idle'], [0.35, 'show', 'out'], [2.9, 'show'], [3.3, 'idle', 'inOut']],
    tracks: {
      baliSafe: [[0, 0], [0.4, 0], [0.52, 1, 'out'], [0.64, 0, 'in'], [0.9, 0], [1.02, 1, 'out'], [1.14, 0, 'in'], [1.4, 0], [1.52, 1, 'out'], [1.64, 0, 'in'], [1.9, 0], [2.02, 1, 'out'], [2.14, 0, 'in']],
      baliBite: [[0, 0], [0.52, 0], [0.64, 1, 'out'], [0.76, 0, 'in'], [1.02, 0], [1.14, 1, 'out'], [1.26, 0, 'in'], [1.52, 0], [1.64, 1, 'out'], [1.76, 0, 'in'], [2.02, 0], [2.14, 1, 'out'], [2.26, 0, 'in']],
      rz: [[0, 0], [0.5, 12, 'out'], [0.64, -10, 'inOut'], [0.76, 6], [1.0, 12, 'out'], [1.14, -10, 'inOut'], [1.26, 6], [1.5, 12, 'out'], [1.64, -10, 'inOut'], [1.76, 6], [2.0, 12, 'out'], [2.14, -10, 'inOut'], [2.26, 6], [2.6, 0, 'inOut']],
      rollX: [[0, 0], [2.26, 0], [2.6, 360, 'inOut']],
    },
    events: [[0.52, 'sound:knife_open'], [0.76, 'sound:knife_open'], [1.02, 'sound:knife_open'], [1.26, 'sound:knife_open'], [1.52, 'sound:knife_open'], [1.76, 'sound:knife_open'], [2.02, 'sound:knife_open'], [2.26, 'sound:knife_open']],
  },
};

/** which other inspect a knife sometimes plays instead of its usual one */
function rareInspect(def: KnifeDef): Clip | null {
  const style = knifeInspectStyle(def);
  if (RARE_INSPECTS[style]) return RARE_INSPECTS[style];
  if (style === 'dagger_pair' || style === 'skeleton_ring') return null;
  // spinners toss it, tossers and heavy knives spin it
  return style === 'twirl' || style === 'flip_show' ? INSPECTS.toss_catch : INSPECTS.twirl;
}

/** how many inspects a knife has (the usual one, then a rare one) */
export function knifeInspectCount(def: KnifeDef): number {
  return rareInspect(def) ? 2 : 1;
}

type AttackName = 'slashA' | 'slashB' | 'stab' | 'backstab';

// hammer grip and balisong, timed off a 60 fps cs2 capture: the cut crosses the
// crosshair by 0.1 s and carries on out of view, the knife stays down for half
// a second and then comes back up from under the screen into the idle
const ATTACKS: Readonly<Record<AttackName, Clip>> = {
  slashA: {
    // forehand: a flick up to the right, then edge first down through the
    // crosshair and out of view low on the left
    duration: 1.1,
    seq: [[0, 'idle'], [0.06, 'windA', 'out'], [0.1, 'cutA', 'in'], [0.135, 'endA'], [0.2, 'goneA', 'out'], [0.8, 'under'], [1.1, 'idle', 'out']],
    tracks: {},
  },
  slashB: {
    // backhand: across to the left, then back through the crosshair and out of view on the right
    duration: 1.1,
    seq: [[0, 'idle'], [0.05, 'windB', 'out'], [0.1, 'cutB', 'in'], [0.15, 'endB'], [0.22, 'goneB', 'out'], [0.8, 'under'], [1.1, 'idle', 'out']],
    tracks: {},
  },
  stab: {
    // a short pull back, driven in at the crosshair and held, then dropped out of view
    duration: 1.1,
    seq: [[0, 'idle'], [0.05, 'cock', 'out'], [0.13, 'thrust', 'in'], [0.38, 'thrust'], [0.46, 'under', 'in'], [0.83, 'under'], [1.1, 'idle', 'out']],
    tracks: {
      pz: [[0, 0], [0.13, 0], [0.17, -0.012, 'out'], [0.3, 0, 'inOut']],
    },
  },
  backstab: {
    // higher, then driven in and down, then dropped out of view
    duration: 1.15,
    seq: [[0, 'idle'], [0.08, 'over', 'out'], [0.18, 'plunge', 'in'], [0.4, 'plunge'], [0.48, 'under', 'in'], [0.85, 'under'], [1.15, 'idle', 'out']],
    tracks: {
      pz: [[0, 0], [0.18, 0], [0.22, -0.015, 'out'], [0.36, 0, 'inOut']],
    },
  },
};

// ring knives rake the claw across behind the fist (the edge leads), and the
// heavy cocks it high on the right and rips it down
const RING_ATTACKS: Readonly<Record<AttackName, Clip>> = {
  slashA: {
    duration: 0.5,
    seq: [[0, 'idle'], [0.06, 'windA', 'out'], [0.12, 'cutA', 'in'], [0.2, 'endA', 'out'], [0.5, 'idle', 'inOut']],
    tracks: {},
  },
  slashB: {
    duration: 0.5,
    seq: [[0, 'idle'], [0.08, 'windB', 'out'], [0.15, 'cutB', 'in'], [0.23, 'endB', 'out'], [0.5, 'idle', 'inOut']],
    tracks: {},
  },
  stab: {
    duration: 0.9,
    seq: [[0, 'idle'], [0.2, 'cock', 'out'], [0.31, 'thrust', 'in'], [0.44, 'thrust'], [0.9, 'idle', 'inOut']],
    tracks: {},
  },
  backstab: {
    duration: 0.95,
    seq: [[0, 'idle'], [0.24, 'over', 'out'], [0.36, 'plunge', 'in'], [0.5, 'plunge'], [0.95, 'idle', 'inOut']],
    tracks: {},
  },
};

// push daggers: the primary jabs with one fist at a time (right, then left),
// the secondary punches both in, the backstab hammers both down
const JAB = [[0, 'idle'], [0.05, 'cock', 'out'], [0.12, 'jab', 'in'], [0.2, 'jab'], [0.45, 'idle', 'inOut']] as const;
const STILL = [[0, 'idle']] as const;
const DAGGER_ATTACKS: Readonly<Record<AttackName, Clip>> = {
  slashA: { duration: 0.45, seq: JAB, seqL: STILL, tracks: {} },
  slashB: { duration: 0.45, seq: STILL, seqL: JAB, tracks: {} },
  stab: {
    duration: 0.85,
    seq: [[0, 'idle'], [0.18, 'cock', 'out'], [0.3, 'jab', 'in'], [0.42, 'jab'], [0.85, 'idle', 'inOut']],
    tracks: {},
  },
  backstab: {
    duration: 0.95,
    seq: [[0, 'idle'], [0.25, 'over', 'out'], [0.38, 'plunge', 'in'], [0.52, 'plunge'], [0.95, 'idle', 'inOut']],
    tracks: {},
  },
};

/** `variant` picks the rare inspect (1) over the usual one (0) when the knife has one */
export function knifeClip(def: KnifeDef, name: KnifeClipName, variant = 0): Clip {
  if (name === 'draw') return DRAWS[knifeDrawStyle(def)];
  if (name === 'inspect') {
    return (variant > 0 ? rareInspect(def) : null) ?? INSPECTS[knifeInspectStyle(def)];
  }
  if (knifeUsesReverseGrip(def)) return RING_ATTACKS[name];
  return def.shape.pair ? DAGGER_ATTACKS[name] : ATTACKS[name];
}

/** every knife clip, for checks */
export const ALL_KNIFE_CLIPS: readonly Clip[] = [
  ...Object.values(DRAWS), ...Object.values(INSPECTS), ...Object.values(RARE_INSPECTS),
  ...Object.values(ATTACKS), ...Object.values(RING_ATTACKS), ...Object.values(DAGGER_ATTACKS),
];
