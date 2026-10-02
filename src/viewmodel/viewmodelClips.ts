import type { KnifeDef, KnifeId } from '../combat/knives';
import type { Clip } from './clips';

/**
 * every first-person animation, authored as keyframes in seconds. offsets
 * (px py pz in metres, rx ry rz in degrees) are in camera space around the
 * hand's grip point: rx lifts the muzzle or tip, ry yaws left, rz rolls the top
 * to the left. part channels drive the glb pivots, hand channels pick where
 * the left hand goes (see ViewmodelSystem).
 */

export type GunClipName = 'draw' | 'fire' | 'reload' | 'inspect';
export type KnifeClipName = 'draw' | 'inspect' | 'slashA' | 'slashB' | 'stab' | 'backstab';

export const DEAGLE_CLIPS: Readonly<Record<GunClipName, Clip>> = {
  draw: {
    duration: 0.72,
    tracks: {
      py: [[0, -0.2], [0.42, 0, 'out']],
      rx: [[0, -55], [0.42, 0, 'out']],
      rz: [[0, 30], [0.42, 0, 'out']],
      slide: [[0, 0], [0.44, 0], [0.52, 1, 'out'], [0.6, 0, 'in']],
      hammer: [[0, 0], [0.5, 0], [0.52, -0.3], [0.62, 0]],
      leftAttach: [[0, 0], [0.24, 0], [0.5, 1, 'out']],
    },
    events: [[0.5, 'sound:slide']],
  },
  fire: {
    duration: 0.22,
    tracks: {
      slide: [[0, 0], [0.018, 1, 'out'], [0.09, 0, 'inOut']],
      hammer: [[0, 0], [0.008, 1, 'in'], [0.03, -0.25, 'out'], [0.1, 0]],
      trigger: [[0, 1], [0.05, 1], [0.13, 0]],
      rx: [[0, 0], [0.03, 7, 'out'], [0.22, 0, 'inOut']],
      pz: [[0, 0], [0.03, 0.018, 'out'], [0.22, 0, 'inOut']],
    },
    events: [[0.02, 'eject']],
  },
  reload: {
    duration: 3.33,
    tracks: {
      rz: [[0, 0], [0.3, -26], [2.5, -26], [2.9, 0]],
      rx: [[0, 0], [0.3, 12], [2.2, 12], [2.5, -4], [2.9, 0]],
      py: [[0, 0], [0.3, 0.02], [2.5, 0.02], [2.9, 0]],
      px: [[0, 0], [0.3, -0.02], [2.5, -0.02], [2.9, 0]],
      leftAttach: [[0, 1], [0.25, 0], [2.2, 0], [2.55, 1, 'inOut']],
      mag: [[0, 0], [0.45, 0], [0.62, 1, 'in'], [1.5, 1.4], [2.0, 0.3, 'out'], [2.2, 0, 'in']],
      magHidden: [[0, 0], [0.64, 0], [0.65, 1, 'step'], [1.49, 1], [1.5, 0, 'step']],
      leftOnMag: [[0, 0], [1.25, 0], [1.5, 1, 'inOut'], [2.2, 1], [2.45, 0, 'inOut']],
      slide: [[0, 0], [2.45, 0], [2.5, 1, 'out'], [2.62, 0, 'in']],
    },
    events: [[0.55, 'sound:mag_out'], [2.15, 'sound:mag_in'], [2.52, 'sound:slide']],
  },
  inspect: {
    duration: 3.4,
    tracks: {
      ry: [[0, 0], [0.5, 50], [1.2, 50], [1.6, -30], [2.4, -30], [2.9, 0]],
      rz: [[0, 0], [0.5, 38], [1.2, 42], [1.6, -46], [2.4, -42], [2.9, 0]],
      // the gun steps right while the watch is up so the wrist clears the firing hand
      px: [[0, 0], [0.5, -0.05], [1.2, -0.05], [1.6, 0.04], [2.4, 0.04], [2.9, 0]],
      py: [[0, 0], [0.5, 0.05], [2.4, 0.04], [2.9, 0]],
      pz: [[0, 0], [0.5, 0.04], [2.4, 0.04], [2.9, 0]],
      leftAttach: [[0, 1], [0.3, 0], [2.7, 0], [3.1, 1, 'inOut']],
      watch: [[0, 0], [1.3, 0], [1.75, 1, 'inOut'], [2.5, 1], [2.9, 0, 'inOut']],
    },
  },
};

export const AWP_CLIPS: Readonly<Record<GunClipName, Clip>> = {
  draw: {
    duration: 1.2,
    tracks: {
      py: [[0, -0.2], [0.6, 0, 'out']],
      rx: [[0, -35], [0.6, 0, 'out']],
      rz: [[0, -20], [0.6, 0, 'out']],
      leftAttach: [[0, 0], [0.4, 0], [0.75, 1, 'out']],
      rightOnBolt: [[0, 0], [0.6, 0], [0.75, 1, 'inOut'], [1.02, 1], [1.2, 0, 'inOut']],
      boltLift: [[0, 0], [0.76, 0], [0.82, 1, 'out'], [0.96, 1], [1.02, 0, 'in']],
      boltBack: [[0, 0], [0.82, 0], [0.87, 0.5, 'out'], [0.91, 0.5], [0.96, 0, 'in']],
    },
    events: [[0.85, 'sound:bolt_back'], [0.97, 'sound:bolt_forward']],
  },
  fire: {
    // bolt timing lines up with GunAudio's scheduled bolt sounds
    duration: 1.45,
    tracks: {
      rx: [[0, 0], [0.04, 9, 'out'], [0.35, 0, 'inOut']],
      pz: [[0, 0], [0.04, 0.05, 'out'], [0.35, 0, 'inOut']],
      trigger: [[0, 1], [0.1, 1], [0.2, 0]],
      rz: [[0, 0], [0.3, 0], [0.45, 9], [0.95, 9], [1.2, 0]],
      rightOnBolt: [[0, 0], [0.26, 0], [0.42, 1, 'inOut'], [0.98, 1], [1.18, 0, 'inOut']],
      boltLift: [[0, 0], [0.44, 0], [0.5, 1, 'out'], [0.86, 1], [0.94, 0, 'in']],
      boltBack: [[0, 0], [0.52, 0], [0.6, 1, 'out'], [0.72, 1], [0.82, 0, 'in']],
    },
    events: [[0.62, 'eject']],
  },
  reload: {
    duration: 3.45,
    tracks: {
      rz: [[0, 0], [0.35, -14], [2.3, -14], [2.55, 6], [3.1, 6], [3.4, 0]],
      rx: [[0, 0], [0.35, 7], [2.3, 7], [2.6, 0]],
      py: [[0, 0], [0.35, 0.025], [2.3, 0.025], [2.6, 0]],
      leftAttach: [[0, 1], [0.3, 0], [2.25, 0], [2.6, 1, 'inOut']],
      leftOnMag: [[0, 0], [0.35, 1, 'inOut'], [0.8, 1], [1.0, 0, 'inOut'], [1.3, 0], [1.55, 1, 'inOut'], [2.15, 1], [2.35, 0, 'inOut']],
      mag: [[0, 0], [0.45, 0], [0.9, 1, 'inOut'], [1.55, 1.3], [2.05, 0.25, 'out'], [2.15, 0, 'in']],
      magHidden: [[0, 0], [0.97, 0], [0.98, 1, 'step'], [1.49, 1], [1.5, 0, 'step']],
      rightOnBolt: [[0, 0], [2.3, 0], [2.5, 1, 'inOut'], [3.05, 1], [3.3, 0, 'inOut']],
      boltLift: [[0, 0], [2.5, 0], [2.58, 1, 'out'], [2.95, 1], [3.03, 0, 'in']],
      boltBack: [[0, 0], [2.58, 0], [2.68, 1, 'out'], [2.78, 1], [2.9, 0, 'in']],
    },
    events: [[0.5, 'sound:mag_out'], [2.1, 'sound:mag_in'], [2.66, 'sound:bolt_back'], [2.9, 'sound:bolt_forward']],
  },
  inspect: {
    duration: 4.0,
    tracks: {
      rz: [[0, 0], [0.6, -30], [1.8, -32], [2.2, 10], [3.1, 10], [3.6, 0]],
      ry: [[0, 0], [0.6, 18], [1.8, 18], [2.2, -8], [3.1, -8], [3.6, 0]],
      rx: [[0, 0], [0.6, 8], [1.8, 8], [2.2, 0]],
      px: [[0, 0], [0.6, -0.03], [1.8, -0.03], [2.2, 0.02], [3.1, 0.02], [3.6, 0]],
      py: [[0, 0], [0.6, 0.03], [3.1, 0.02], [3.6, 0]],
      leftAttach: [[0, 1], [1.9, 1], [2.2, 0], [3.2, 0], [3.65, 1, 'inOut']],
      watch: [[0, 0], [2.1, 0], [2.5, 1, 'inOut'], [3.05, 1], [3.45, 0, 'inOut']],
    },
  },
};

export type KnifeDrawStyle = 'unsheathe' | 'flip_open' | 'switch_open' | 'flick_open' | 'spin_draw' | 'balisong_open' | 'spin_in' | 'skeleton_spin' | 'dagger_pair';
export type KnifeInspectStyle = 'flip_show' | 'switch_show' | 'flick_show' | 'balisong' | 'ring_spin' | 'skeleton_ring' | 'toss_catch' | 'twirl' | 'heavy_show' | 'dagger_pair';

const HEAVY: ReadonlySet<KnifeId> = new Set(['bowie', 'huntsman', 'survival', 'kukri']);
const TWIRL: ReadonlySet<KnifeId> = new Set(['bayonet', 'm9_bayonet']);

export function knifeDrawStyle(def: KnifeDef): KnifeDrawStyle {
  const mech = def.shape.mechanism ?? 'fixed';
  if (def.shape.pair) return 'dagger_pair';
  if (mech === 'balisong') return 'balisong_open';
  // the stiletto is a switchblade: the blade snaps out; the navaja is flicked open
  if (def.id === 'stiletto') return 'switch_open';
  if (def.id === 'navaja') return 'flick_open';
  // the skeleton is held in a hammer grip, but the draw twirls it on the index finger through its ring
  if (def.id === 'skeleton') return 'skeleton_spin';
  if (def.shape.fingerRing) return 'spin_in';
  if (mech === 'folder') return 'flip_open';
  if (TWIRL.has(def.id)) return 'spin_draw';
  return 'unsheathe';
}

export function knifeInspectStyle(def: KnifeDef): KnifeInspectStyle {
  const mech = def.shape.mechanism ?? 'fixed';
  if (def.shape.pair) return 'dagger_pair';
  if (mech === 'balisong') return 'balisong';
  if (def.id === 'skeleton') return 'skeleton_ring';
  if (def.shape.fingerRing) return 'ring_spin';
  if (def.id === 'stiletto') return 'switch_show';
  if (def.id === 'navaja') return 'flick_show';
  if (TWIRL.has(def.id)) return 'twirl';
  // the ursus is a heavy tanto: looked over and tossed rather than folded
  if (def.id === 'ursus') return 'heavy_show';
  if (mech === 'folder') return 'flip_show';
  if (HEAVY.has(def.id)) return 'heavy_show';
  return 'toss_catch';
}

/** reverse (blade under the little finger) grip for the hawkbill ring knives */
export function knifeUsesReverseGrip(def: KnifeDef): boolean {
  return def.shape.fingerRing === true;
}

const DRAWS: Readonly<Record<KnifeDrawStyle, Clip>> = {
  unsheathe: {
    // comes up from low right, the wrist rolling it over into the grip
    duration: 0.9,
    tracks: {
      raise: [[0, 0.6], [0.3, 0.6], [0.62, 0, 'inOut']],
      py: [[0, -0.2], [0.28, 0, 'out']],
      px: [[0, 0.04], [0.28, 0, 'out']],
      rz: [[0, -25], [0.3, 0, 'out'], [0.62, 6, 'inOut'], [0.85, 0, 'inOut']],
      holdRoll: [[0, -150], [0.12, -150], [0.5, 0, 'out']],
    },
    events: [[0.08, 'sound:knife_draw'], [0.48, 'sound:knife_catch']],
  },
  flip_open: {
    // up closed, thumb on the opener, a wrist snap throws the blade open
    duration: 1.0,
    tracks: {
      raise: [[0, 0.7], [0.45, 0.7], [0.8, 0, 'inOut']],
      py: [[0, -0.18], [0.28, 0, 'out']],
      knifeOpen: [[0, 0], [0.36, 0], [0.48, 1, 'back']],
      thumbOpener: [[0, 0], [0.16, 0], [0.3, 1, 'inOut'], [0.46, 1], [0.6, 0, 'inOut']],
      rz: [[0, 15], [0.3, 0, 'out'], [0.38, -6], [0.46, 18, 'out'], [0.62, -4, 'inOut'], [0.85, 0, 'inOut']],
      rx: [[0, 0], [0.38, 0], [0.47, 10, 'out'], [0.65, 0, 'inOut']],
    },
    events: [[0.05, 'sound:knife_draw'], [0.46, 'sound:knife_open']],
  },
  skeleton_spin: {
    // index slips into the ring, the knife twirls around it, then the hand takes the handle
    duration: 1.1,
    tracks: {
      raise: [[0, 1], [0.6, 1], [0.95, 0, 'inOut']],
      py: [[0, -0.18], [0.26, 0, 'out']],
      ringHold: [[0, 1], [0.75, 1], [0.95, 0, 'inOut']],
      spinZ: [[0, 720], [0.8, 0, 'out']],
      // the fingers close on the handle once the hand has arrived from the ring
      gripOpen: [[0, 0.95], [0.95, 0.95], [1.05, 0, 'out']],
    },
    events: [[0.08, 'sound:knife_draw'], [0.3, 'sound:knife_spin']],
  },
  switch_open: {
    // button press, the blade swings out in a few frames and the knife kicks
    duration: 0.95,
    tracks: {
      raise: [[0, 0.6], [0.45, 0.6], [0.78, 0, 'inOut']],
      py: [[0, -0.18], [0.28, 0, 'out']],
      thumbOpener: [[0, 1], [0.44, 1], [0.58, 0, 'inOut']],
      knifeOpen: [[0, 0], [0.38, 0], [0.43, 1, 'out']],
      rx: [[0, 0], [0.38, 0], [0.44, 9, 'out'], [0.6, 0, 'inOut']],
      rz: [[0, 0], [0.38, 0], [0.45, -6, 'out'], [0.62, 0, 'inOut']],
      leftGuard: [[0, 0], [0.4, 0], [0.85, 1, 'out']],
    },
    events: [[0.05, 'sound:knife_draw'], [0.41, 'sound:knife_open']],
  },
  flick_open: {
    // a wrist flick throws the blade open against the lock
    duration: 1.0,
    tracks: {
      raise: [[0, 0.6], [0.45, 0.6], [0.8, 0, 'inOut']],
      py: [[0, -0.18], [0.28, 0, 'out']],
      thumbOpener: [[0, 0], [0.2, 0], [0.32, 1, 'inOut'], [0.42, 1], [0.55, 0, 'inOut']],
      rz: [[0, 10], [0.3, 0, 'out'], [0.4, 22, 'out'], [0.48, -16, 'in'], [0.66, 4, 'inOut'], [0.85, 0, 'inOut']],
      knifeOpen: [[0, 0], [0.42, 0], [0.5, 1, 'back']],
      leftGuard: [[0, 0], [0.45, 0], [0.9, 1, 'out']],
    },
    events: [[0.05, 'sound:knife_draw'], [0.48, 'sound:knife_open']],
  },
  spin_draw: {
    // cs2's bayonet pullout: up on the right with the hand open and the knife
    // whirling a turn and a half, the fingers snap shut on it and it drops in
    duration: 1.05,
    tracks: {
      raise: [[0, 1], [0.58, 1], [0.9, 0, 'inOut']],
      py: [[0, -0.2], [0.26, 0, 'out']],
      px: [[0, 0.05], [0.26, 0, 'out']],
      spinZ: [[0, 540], [0.14, 540], [0.62, 0, 'out']],
      tossY: [[0, 0], [0.12, 0], [0.18, 0.025, 'out'], [0.56, 0.025], [0.62, 0, 'in']],
      gripOpen: [[0, 0.9], [0.56, 0.9], [0.66, 0, 'out']],
      rz: [[0, 0], [0.62, 0], [0.7, -8, 'out'], [0.92, 0, 'inOut']],
    },
    events: [[0.1, 'sound:knife_draw'], [0.3, 'sound:knife_spin'], [0.64, 'sound:knife_catch']],
  },
  balisong_open: {
    // every handle swing is thrown by a wrist flick
    duration: 1.3,
    tracks: {
      raise: [[0, 0.8], [0.9, 0.8], [1.2, 0, 'inOut']],
      py: [[0, -0.18], [0.28, 0, 'out']],
      baliSafe: [[0, 1], [0.28, 1], [0.48, 0, 'out'], [0.66, 0], [0.84, 1, 'inOut'], [1.02, 0, 'out']],
      baliBite: [[0, 1], [0.42, 1], [0.66, 0, 'out']],
      rz: [[0, 0], [0.26, -10, 'out'], [0.44, 14, 'out'], [0.62, -12, 'inOut'], [0.82, 12, 'inOut'], [1.0, -8, 'out'], [1.25, 0, 'inOut']],
      leftGuard: [[0, 0], [0.8, 0], [1.25, 1, 'out']],
    },
    events: [[0.48, 'sound:knife_open'], [0.66, 'sound:knife_open'], [1.02, 'sound:knife_open']],
  },
  spin_in: {
    // cs2 karambit: the hand comes up on the right with the fingers open and the
    // knife whirling round the index, then drops palm down into the idle while
    // the left hand comes up
    duration: 1.0,
    tracks: {
      raise: [[0, 1], [0.5, 1], [0.84, 0, 'inOut']],
      py: [[0, -0.22], [0.26, 0, 'out']],
      px: [[0, 0.05], [0.26, 0, 'out']],
      rz: [[0, 0], [0.84, 0], [0.92, -5, 'out'], [1.0, 0, 'inOut']],
      spinZ: [[0, 540], [0.16, 540], [0.6, 0, 'out']],
      gripOpen: [[0, 0.95], [0.52, 0.95], [0.66, 0, 'out']],
      leftGuard: [[0, 0], [0.45, 0], [0.9, 1, 'out']],
    },
    events: [[0.12, 'sound:knife_draw'], [0.34, 'sound:knife_spin']],
  },
  dagger_pair: {
    duration: 0.8,
    tracks: {
      py: [[0, -0.22], [0.5, 0, 'out']],
      rx: [[0, -45], [0.5, 0, 'out']],
      rz: [[0, 20], [0.5, 0, 'out']],
      holdRoll: [[0, -90], [0.55, 0, 'out']],
    },
    events: [[0.3, 'sound:knife_draw']],
  },
};

const INSPECTS: Readonly<Record<KnifeInspectStyle, Clip>> = {
  flip_show: {
    // snap it up to look at one side, turn it over, then fold it and flick it open again
    duration: 4.0,
    tracks: {
      show: [[0, 0], [0.45, 1, 'out'], [1.6, 1], [1.95, 0, 'inOut']],
      showB: [[0, 0], [1.6, 0], [1.95, 1, 'inOut'], [3.2, 1], [3.6, 0, 'inOut']],
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
    tracks: {
      show: [[0, 0], [0.45, 1, 'out'], [1.9, 1], [2.25, 0, 'inOut']],
      showB: [[0, 0], [1.9, 0], [2.25, 1, 'inOut'], [3.2, 1], [3.6, 0, 'inOut']],
      knifeOpen: [[0, 1], [0.75, 1], [1.05, 0, 'inOut'], [1.38, 0], [1.43, 1, 'out']],
      // the thumb waits off the blade's path while it shuts, then goes onto the button
      thumbOpener: [[0, 0], [0.5, 0], [0.66, 0.5, 'inOut'], [1.06, 0.5], [1.18, 1, 'inOut'], [1.45, 1], [1.6, 0, 'inOut']],
      rx: [[0, 0], [1.38, 0], [1.44, 8, 'out'], [1.6, 0, 'inOut']],
      rz: [[0, 0], [0.45, -4, 'out'], [1.0, 5, 'inOut'], [1.38, 0, 'inOut']],
      leftGuard: [[0, 1], [0.3, 0, 'inOut'], [3.4, 0], [3.85, 1, 'inOut']],
    },
    events: [[1.0, 'sound:knife_open'], [1.41, 'sound:knife_open']],
  },
  flick_show: {
    // fold it half shut, flick it open with the wrist, then the other side
    duration: 3.9,
    tracks: {
      show: [[0, 0], [0.45, 1, 'out'], [1.8, 1], [2.15, 0, 'inOut']],
      showB: [[0, 0], [1.8, 0], [2.15, 1, 'inOut'], [3.2, 1], [3.6, 0, 'inOut']],
      knifeOpen: [[0, 1], [0.7, 1], [0.95, 0.7, 'inOut'], [1.2, 0.7], [1.3, 1, 'back']],
      thumbOpener: [[0, 0], [0.65, 0], [0.78, 1, 'inOut'], [0.9, 1], [1.0, 0, 'inOut']],
      rz: [[0, 0], [0.45, -4, 'out'], [0.95, 4, 'inOut'], [1.16, -14, 'out'], [1.26, 18, 'in'], [1.45, -3, 'inOut'], [1.7, 0, 'inOut']],
      leftGuard: [[0, 1], [0.3, 0, 'inOut'], [3.4, 0], [3.85, 1, 'inOut']],
    },
    events: [[1.27, 'sound:knife_open']],
  },
  balisong: {
    // opens and closes in a rhythm: the hand keeps the bite handle, the safe
    // handle swings over the spine and the blade swings out round the bite pin,
    // every swing thrown by the wrist, with a rollover in the middle
    duration: 4.7,
    tracks: {
      show: [[0, 0], [0.4, 0.8, 'out'], [3.85, 0.8], [4.25, 0, 'inOut']],
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
      leftGuard: [[0, 1], [0.3, 0, 'inOut'], [4.2, 0], [4.65, 1, 'inOut']],
    },
    events: [
      [0.62, 'sound:knife_open'], [0.97, 'sound:knife_open'], [1.6, 'sound:knife_open'], [1.9, 'sound:knife_open'],
      [2.5, 'sound:knife_open'], [2.93, 'sound:knife_open'], [3.33, 'sound:knife_open'], [3.6, 'sound:knife_open'],
    ],
  },
  ring_spin: {
    // cs2 karambit: a spin on the index while the fist turns up to show the
    // claw, a slow look at both curves, another spin on the way back down
    duration: 4.0,
    tracks: {
      show: [[0, 0], [0.7, 1, 'inOut'], [3.0, 1], [3.65, 0, 'inOut']],
      leftGuard: [[0, 1], [0.35, 0, 'inOut'], [3.35, 0], [3.9, 1, 'inOut']],
      rz: [[0, 0], [0.7, 0], [1.5, 9, 'inOut'], [2.3, -7, 'inOut'], [3.0, 0, 'inOut']],
      ry: [[0, 0], [0.7, 0], [1.6, -12, 'inOut'], [2.4, 8, 'inOut'], [3.0, 0, 'inOut']],
      py: [[0, 0], [0.7, 0], [1.9, 0.008, 'inOut'], [3.0, 0, 'inOut']],
      spinZ: [[0, 0], [0.12, 0], [0.62, 360, 'inOut'], [3.0, 360], [3.55, 720, 'inOut']],
      // the fingers let go while it spins, the index stays hooked in the ring
      gripOpen: [[0, 0], [0.1, 0], [0.18, 0.95], [0.56, 0.95], [0.68, 0], [2.96, 0], [3.04, 0.95], [3.5, 0.95], [3.62, 0]],
    },
    events: [[0.3, 'sound:knife_spin'], [3.2, 'sound:knife_spin']],
  },
  skeleton_ring: {
    // look at it, then hook the index through the ring and spin it on the finger
    duration: 4.4,
    tracks: {
      show: [[0, 0], [0.45, 1, 'out'], [1.1, 1], [1.4, 0.4, 'inOut'], [3.3, 0.4], [3.7, 0, 'inOut']],
      rz: [[0, 0], [0.45, -5, 'out'], [1.0, 5, 'inOut'], [1.3, 0, 'inOut']],
      ringHold: [[0, 0], [1.25, 0], [1.5, 1, 'inOut'], [2.95, 1], [3.2, 0, 'inOut']],
      // let go before the hand moves to the ring, close only once it is back on the handle
      gripOpen: [[0, 0], [1.15, 0], [1.25, 0.95], [3.2, 0.95], [3.3, 0]],
      spinZ: [[0, 0], [1.5, 0], [2.15, 360, 'inOut'], [2.85, 720, 'inOut']],
    },
    events: [[1.85, 'sound:knife_spin'], [2.55, 'sound:knife_spin']],
  },
  toss_catch: {
    // up to look at it, a dip and a flick that tumbles it end over end and
    // over once in the air, caught with a bounce
    duration: 3.8,
    tracks: {
      show: [[0, 0], [0.45, 1, 'out'], [1.4, 1], [1.7, 0.6, 'inOut'], [2.6, 0.6], [3.0, 0, 'inOut']],
      py: [[0, 0], [1.4, 0], [1.6, -0.015, 'inOut'], [1.72, 0.02, 'out'], [2.2, 0.01], [2.32, -0.01, 'out'], [2.6, 0, 'inOut']],
      rx: [[0, 0], [1.5, 0], [1.6, -10], [1.72, 10, 'out'], [2.0, 0, 'inOut'], [2.3, 0], [2.36, -8, 'out'], [2.6, 0, 'inOut']],
      tossY: [[0, 0], [1.72, 0], [2.0, 0.13, 'out'], [2.3, 0.012, 'in'], [2.34, 0]],
      // spins and rolls only once it has left the fingers and lands the right way round
      spinZ: [[0, 0], [1.78, 0], [2.3, 360, 'inOut']],
      rollX: [[0, 0], [1.78, 0], [2.3, 360, 'inOut']],
      gripOpen: [[0, 0], [1.68, 0], [1.75, 1], [2.3, 1], [2.38, 0]],
      rz: [[0, 0], [0.45, -5, 'out'], [1.0, 6, 'inOut'], [1.4, 0, 'inOut']],
    },
    events: [[1.73, 'sound:knife_toss'], [2.33, 'sound:knife_catch']],
  },
  twirl: {
    // look at both sides, then open the hand and whirl it twice round the grip
    // and snap the fingers shut on it
    duration: 4.2,
    tracks: {
      show: [[0, 0], [0.45, 1, 'out'], [1.5, 1], [1.85, 0, 'inOut']],
      showB: [[0, 0], [1.5, 0], [1.85, 1, 'inOut'], [2.5, 1], [2.8, 0, 'inOut']],
      raise: [[0, 0], [2.5, 0], [2.8, 0.85, 'inOut'], [3.55, 0.85], [3.95, 0, 'inOut']],
      rz: [[0, 0], [0.45, -4, 'out'], [1.0, 5, 'inOut'], [1.5, 0, 'inOut'], [3.5, 0], [3.58, -10, 'out'], [3.8, 0, 'inOut']],
      ry: [[0, 0], [0.45, 6, 'out'], [1.1, -6, 'inOut'], [1.5, 0, 'inOut']],
      spinZ: [[0, 0], [2.8, 0], [3.42, 720, 'inOut']],
      tossY: [[0, 0], [2.72, 0], [2.82, 0.035, 'out'], [3.42, 0.035], [3.5, 0, 'in']],
      gripOpen: [[0, 0], [2.66, 0], [2.76, 0.9], [3.46, 0.9], [3.56, 0, 'out']],
    },
    events: [[2.95, 'sound:knife_spin'], [3.25, 'sound:knife_spin'], [3.52, 'sound:knife_catch']],
  },
  heavy_show: {
    // slower and weightier: look at both sides, then a short flip toss and catch
    duration: 4.3,
    tracks: {
      show: [[0, 0], [0.55, 1, 'out'], [1.7, 1], [2.05, 0, 'inOut']],
      showB: [[0, 0], [1.7, 0], [2.05, 1, 'inOut'], [2.75, 1], [3.05, 0, 'inOut']],
      raise: [[0, 0], [2.75, 0], [3.05, 0.7, 'inOut'], [3.75, 0.7], [4.1, 0, 'inOut']],
      tossY: [[0, 0], [3.05, 0], [3.3, 0.09, 'out'], [3.55, 0.01, 'in'], [3.6, 0]],
      spinZ: [[0, 0], [3.1, 0], [3.55, 360, 'inOut']],
      gripOpen: [[0, 0], [3.0, 0], [3.08, 1], [3.55, 1], [3.64, 0]],
      py: [[0, 0], [3.55, 0], [3.62, -0.012, 'out'], [3.85, 0, 'inOut']],
      rz: [[0, 0], [0.55, -4, 'out'], [1.2, 6, 'inOut'], [1.7, 0, 'inOut']],
    },
    events: [[3.06, 'sound:knife_toss'], [3.58, 'sound:knife_catch']],
  },
  dagger_pair: {
    duration: 3.4,
    tracks: {
      ry: [[0, 0], [0.5, 25], [1.4, 25], [1.8, -15], [2.5, -15], [2.9, 0]],
      rz: [[0, 0], [0.5, 50], [1.4, 50], [1.8, -40], [2.5, -40], [2.9, 0]],
      py: [[0, 0], [0.5, 0.05], [2.5, 0.05], [2.9, 0]],
      // a t-grip can't turn in the fist, so the wrist rolls each side into view
      holdRoll: [[0, 0], [1.4, 0], [1.8, 70, 'inOut'], [2.1, 70], [2.5, -50, 'inOut'], [2.9, 0, 'inOut']],
    },
  },
};

// the rarer inspect a knife sometimes plays instead, like cs2's rare animations
const RARE_INSPECTS: Partial<Record<KnifeInspectStyle, Clip>> = {
  // the talon's endless loop: spin after spin on the index with the fist up
  ring_spin: {
    duration: 4.2,
    tracks: {
      show: [[0, 0], [0.6, 1, 'inOut'], [3.3, 1], [3.9, 0, 'inOut']],
      leftGuard: [[0, 1], [0.35, 0, 'inOut'], [3.6, 0], [4.15, 1, 'inOut']],
      spinZ: [[0, 0], [0.12, 0], [0.6, 360, 'inOut'], [1.1, 720, 'inOut'], [1.6, 1080, 'inOut'], [2.1, 1440, 'inOut'], [2.6, 1800, 'inOut'], [3.3, 2160, 'inOut']],
      gripOpen: [[0, 0], [0.1, 0], [0.18, 0.95], [3.2, 0.95], [3.35, 0]],
      rz: [[0, 0], [0.6, 0], [1.6, 8, 'inOut'], [2.6, -8, 'inOut'], [3.3, 0, 'inOut']],
    },
    events: [[0.3, 'sound:knife_spin'], [0.85, 'sound:knife_spin'], [1.35, 'sound:knife_spin'], [1.85, 'sound:knife_spin'], [2.35, 'sound:knife_spin'], [2.9, 'sound:knife_spin']],
  },
  // fast fanning: four quick open and shut swings with the wrist driving each
  balisong: {
    duration: 3.6,
    tracks: {
      show: [[0, 0], [0.35, 0.7, 'out'], [2.9, 0.7], [3.3, 0, 'inOut']],
      baliSafe: [[0, 0], [0.4, 0], [0.52, 1, 'out'], [0.64, 0, 'in'], [0.9, 0], [1.02, 1, 'out'], [1.14, 0, 'in'], [1.4, 0], [1.52, 1, 'out'], [1.64, 0, 'in'], [1.9, 0], [2.02, 1, 'out'], [2.14, 0, 'in']],
      baliBite: [[0, 0], [0.52, 0], [0.64, 1, 'out'], [0.76, 0, 'in'], [1.02, 0], [1.14, 1, 'out'], [1.26, 0, 'in'], [1.52, 0], [1.64, 1, 'out'], [1.76, 0, 'in'], [2.02, 0], [2.14, 1, 'out'], [2.26, 0, 'in']],
      rz: [[0, 0], [0.5, 12, 'out'], [0.64, -10, 'inOut'], [0.76, 6], [1.0, 12, 'out'], [1.14, -10, 'inOut'], [1.26, 6], [1.5, 12, 'out'], [1.64, -10, 'inOut'], [1.76, 6], [2.0, 12, 'out'], [2.14, -10, 'inOut'], [2.26, 6], [2.6, 0, 'inOut']],
      rollX: [[0, 0], [2.26, 0], [2.6, 360, 'inOut']],
      leftGuard: [[0, 1], [0.3, 0, 'inOut'], [3.2, 0], [3.55, 1, 'inOut']],
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

// hammer and balisong knives: whole hand poses, a quick wind up, the slash
// carried through past the target, and a settle back
const ATTACKS: Readonly<Record<'slashA' | 'slashB' | 'stab' | 'backstab', Clip>> = {
  slashA: {
    // right to left and a little down
    duration: 0.45,
    tracks: {
      hook: [[0, 0], [0.06, -0.12, 'out'], [0.17, 1, 'in'], [0.24, 1.05], [0.45, 0, 'inOut']],
      py: [[0, 0], [0.06, 0.02, 'out'], [0.17, -0.02, 'in'], [0.45, 0, 'inOut']],
      rz: [[0, 0], [0.06, -8, 'out'], [0.17, 12, 'in'], [0.45, 0, 'inOut']],
    },
  },
  slashB: {
    // backhand from the left back across to the right
    duration: 0.45,
    tracks: {
      hook: [[0, 0], [0.07, 0.35, 'out'], [0.14, 0, 'in']],
      hookB: [[0, 0], [0.07, 0], [0.17, 1, 'in'], [0.24, 1.05], [0.45, 0, 'inOut']],
      py: [[0, 0], [0.07, 0.015, 'out'], [0.17, -0.015, 'in'], [0.45, 0, 'inOut']],
      rz: [[0, 0], [0.07, 10, 'out'], [0.17, -10, 'in'], [0.45, 0, 'inOut']],
    },
  },
  stab: {
    // drawn back high, then punched in
    duration: 0.85,
    tracks: {
      cock: [[0, 0], [0.22, 1, 'out'], [0.34, 0, 'in']],
      strike: [[0, 0], [0.22, 0], [0.34, 1, 'in'], [0.48, 1], [0.85, 0, 'inOut']],
      rz: [[0, 0], [0.22, -6, 'out'], [0.34, 6, 'in'], [0.85, 0, 'inOut']],
    },
  },
  backstab: {
    // higher, a beat longer, driven deeper
    duration: 0.95,
    tracks: {
      cock: [[0, 0], [0.26, 1.1, 'out'], [0.4, 0, 'in']],
      strike: [[0, 0], [0.26, 0], [0.4, 1.1, 'in'], [0.56, 1.1], [0.95, 0, 'inOut']],
      pz: [[0, 0], [0.26, 0], [0.4, -0.04, 'in'], [0.95, 0, 'inOut']],
      rz: [[0, 0], [0.26, -8, 'out'], [0.4, 8, 'in'], [0.95, 0, 'inOut']],
    },
  },
};

// the push daggers have no whole hand poses, they still move by offsets
const DAGGER_ATTACKS: Readonly<Record<'slashA' | 'slashB' | 'stab' | 'backstab', Clip>> = {
  slashA: {
    duration: 0.45,
    tracks: {
      px: [[0, 0], [0.07, 0.05, 'out'], [0.19, -0.13, 'in'], [0.45, 0, 'inOut']],
      py: [[0, 0], [0.07, 0.05, 'out'], [0.19, -0.04, 'in'], [0.45, 0, 'inOut']],
      pz: [[0, 0], [0.19, -0.07], [0.45, 0]],
      ry: [[0, 0], [0.07, -22, 'out'], [0.19, 38, 'in'], [0.45, 0, 'inOut']],
      rz: [[0, 0], [0.07, -25, 'out'], [0.19, 45, 'in'], [0.45, 0, 'inOut']],
      rx: [[0, 0], [0.07, 10], [0.19, -15], [0.45, 0]],
    },
  },
  slashB: {
    duration: 0.45,
    tracks: {
      px: [[0, 0], [0.07, -0.08, 'out'], [0.19, 0.08, 'in'], [0.45, 0, 'inOut']],
      py: [[0, 0], [0.07, 0.03, 'out'], [0.19, -0.05, 'in'], [0.45, 0, 'inOut']],
      pz: [[0, 0], [0.19, -0.07], [0.45, 0]],
      ry: [[0, 0], [0.07, 30, 'out'], [0.19, -30, 'in'], [0.45, 0, 'inOut']],
      rz: [[0, 0], [0.07, 50, 'out'], [0.19, -40, 'in'], [0.45, 0, 'inOut']],
      rx: [[0, 0], [0.07, 5], [0.19, -12], [0.45, 0]],
    },
  },
  backstab: {
    // raised overhand and driven down, the heavy stab from behind
    duration: 0.95,
    tracks: {
      py: [[0, 0], [0.25, 0.09, 'out'], [0.42, -0.06, 'in'], [0.95, 0, 'inOut']],
      pz: [[0, 0], [0.25, 0.04, 'out'], [0.42, -0.12, 'in'], [0.95, 0, 'inOut']],
      rx: [[0, 0], [0.25, 45, 'out'], [0.42, -40, 'in'], [0.95, 0, 'inOut']],
      rz: [[0, 0], [0.25, -15], [0.42, 10], [0.95, 0]],
    },
  },
  stab: {
    duration: 0.85,
    tracks: {
      pz: [[0, 0], [0.2, 0.05, 'out'], [0.36, -0.15, 'in'], [0.85, 0, 'inOut']],
      py: [[0, 0], [0.2, 0.03, 'out'], [0.36, 0.01], [0.85, 0, 'inOut']],
      px: [[0, 0], [0.36, -0.04], [0.85, 0]],
      rx: [[0, 0], [0.2, 20, 'out'], [0.36, -25, 'in'], [0.85, 0, 'inOut']],
      rz: [[0, 0], [0.2, 10], [0.36, -10], [0.85, 0]],
    },
  },
};

// ring knives hook rather than slash (cs2 karambit): the primary throws the
// palm down fist across to the left claw first and lets it carry out of view,
// the secondary cocks the fist high on the right and rips it down across
const RING_ATTACKS: Readonly<Record<'slashA' | 'slashB' | 'stab' | 'backstab', Clip>> = {
  slashA: {
    duration: 0.45,
    tracks: {
      hook: [[0, 0], [0.06, -0.15, 'out'], [0.16, 1, 'in'], [0.45, 0, 'inOut']],
      px: [[0, 0], [0.16, 0], [0.25, -0.07, 'out'], [0.45, 0, 'inOut']],
      py: [[0, 0], [0.16, 0], [0.25, -0.1, 'out'], [0.45, 0, 'inOut']],
      ry: [[0, 0], [0.06, -12, 'out'], [0.16, 14, 'in'], [0.45, 0, 'inOut']],
      leftGuard: [[0, 1], [0.12, 0, 'out'], [0.3, 0], [0.45, 1, 'inOut']],
    },
  },
  slashB: {
    // the same hook from lower down, rising as it crosses
    duration: 0.45,
    tracks: {
      hook: [[0, 0], [0.06, -0.2, 'out'], [0.16, 1, 'in'], [0.45, 0, 'inOut']],
      px: [[0, 0], [0.16, 0], [0.25, -0.06, 'out'], [0.45, 0, 'inOut']],
      py: [[0, 0], [0.06, -0.04, 'out'], [0.16, 0.04, 'in'], [0.25, -0.08, 'out'], [0.45, 0, 'inOut']],
      rz: [[0, 0], [0.06, -10, 'out'], [0.16, 16, 'in'], [0.45, 0, 'inOut']],
      leftGuard: [[0, 1], [0.12, 0, 'out'], [0.3, 0], [0.45, 1, 'inOut']],
    },
  },
  stab: {
    duration: 0.85,
    tracks: {
      cock: [[0, 0], [0.24, 1, 'out'], [0.36, 0, 'in']],
      strike: [[0, 0], [0.24, 0], [0.36, 1, 'in'], [0.48, 1], [0.85, 0, 'inOut']],
      py: [[0, 0], [0.36, 0], [0.5, -0.06, 'out'], [0.85, 0, 'inOut']],
      leftGuard: [[0, 1], [0.15, 0, 'out'], [0.6, 0], [0.85, 1, 'inOut']],
    },
  },
  backstab: {
    // higher, a beat longer, driven deeper
    duration: 0.95,
    tracks: {
      cock: [[0, 0], [0.28, 1.15, 'out'], [0.42, 0, 'in']],
      strike: [[0, 0], [0.28, 0], [0.42, 1.1, 'in'], [0.56, 1.1], [0.95, 0, 'inOut']],
      pz: [[0, 0], [0.42, -0.04, 'in'], [0.95, 0, 'inOut']],
      py: [[0, 0], [0.42, 0], [0.56, -0.07, 'out'], [0.95, 0, 'inOut']],
      leftGuard: [[0, 1], [0.15, 0, 'out'], [0.7, 0], [0.95, 1, 'inOut']],
    },
  },
};

/** `variant` picks the rare inspect (1) over the usual one (0) when the knife has one */
export function knifeClip(def: KnifeDef, name: KnifeClipName, variant = 0): Clip {
  if (name === 'draw') {
    const clip = DRAWS[knifeDrawStyle(def)];
    return clip;
  }
  if (name === 'inspect') {
    return (variant > 0 ? rareInspect(def) : null) ?? INSPECTS[knifeInspectStyle(def)];
  }
  if (knifeUsesReverseGrip(def)) return RING_ATTACKS[name];
  return def.shape.pair ? DAGGER_ATTACKS[name] : ATTACKS[name];
}
