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
      px: [[0, 0], [0.5, -0.05], [1.2, -0.05], [1.6, 0.01], [2.4, 0.01], [2.9, 0]],
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
    duration: 0.8,
    tracks: {
      py: [[0, -0.2], [0.45, 0, 'out']],
      px: [[0, 0.06], [0.45, 0, 'out']],
      rx: [[0, -70], [0.45, 0, 'out']],
      rz: [[0, 35], [0.45, -8, 'out'], [0.7, 0]],
      rollX: [[0, -120], [0.55, 0, 'out']],
    },
    events: [[0.3, 'sound:knife_draw']],
  },
  flip_open: {
    duration: 0.9,
    tracks: {
      py: [[0, -0.16], [0.35, 0, 'out']],
      rx: [[0, -40], [0.35, 0, 'out']],
      rz: [[0, 20], [0.35, 0], [0.47, -14, 'out'], [0.75, 0]],
      knifeOpen: [[0, 0], [0.36, 0], [0.5, 1, 'back']],
      thumbOpener: [[0, 0], [0.18, 0], [0.32, 1, 'inOut'], [0.5, 1], [0.64, 0, 'inOut']],
    },
    events: [[0.46, 'sound:knife_open']],
  },
  skeleton_spin: {
    // index slips into the ring, the knife twirls around it, then the hand takes the handle
    duration: 1.1,
    tracks: {
      py: [[0, -0.16], [0.3, 0, 'out']],
      rx: [[0, -30], [0.3, 0, 'out']],
      ringHold: [[0, 1], [0.75, 1], [0.95, 0, 'inOut']],
      spinZ: [[0, 720], [0.8, 0, 'out']],
      gripOpen: [[0, 0.95], [0.78, 0.95], [0.98, 0, 'out']],
    },
    events: [[0.3, 'sound:knife_spin']],
  },
  switch_open: {
    // button press, the blade swings out in a few frames and the knife kicks
    duration: 0.9,
    tracks: {
      py: [[0, -0.16], [0.32, 0, 'out']],
      rx: [[0, -35], [0.32, 0, 'out'], [0.45, 0], [0.49, 8, 'out'], [0.65, 0]],
      knifeOpen: [[0, 0], [0.42, 0], [0.47, 1, 'out']],
      rz: [[0, 12], [0.32, 0], [0.49, -6], [0.65, 0]],
      thumbOpener: [[0, 0], [0.2, 0], [0.34, 1, 'inOut'], [0.48, 1], [0.62, 0, 'inOut']],
    },
    events: [[0.44, 'sound:knife_open']],
  },
  flick_open: {
    // a wrist flick throws the blade open against the lock
    duration: 1.0,
    tracks: {
      py: [[0, -0.16], [0.35, 0, 'out']],
      rx: [[0, -30], [0.35, 0, 'out']],
      rz: [[0, 15], [0.35, 0], [0.45, 30, 'out'], [0.55, -18, 'in'], [0.8, 0]],
      knifeOpen: [[0, 0], [0.47, 0], [0.56, 1, 'back']],
      thumbOpener: [[0, 0], [0.25, 0], [0.4, 1, 'inOut'], [0.55, 1], [0.7, 0, 'inOut']],
    },
    events: [[0.53, 'sound:knife_open']],
  },
  spin_draw: {
    // the knife comes up spinning once about the grip and lands in hand
    duration: 0.95,
    tracks: {
      py: [[0, -0.18], [0.4, 0, 'out']],
      rx: [[0, -45], [0.4, 0, 'out']],
      rollX: [[0, 0], [0.15, 0], [0.7, 360, 'inOut']],
      gripOpen: [[0, 0], [0.2, 0], [0.26, 0.7], [0.62, 0.7], [0.7, 0]],
    },
    events: [[0.3, 'sound:knife_spin']],
  },
  balisong_open: {
    duration: 1.3,
    tracks: {
      py: [[0, -0.16], [0.3, 0, 'out']],
      rx: [[0, -30], [0.3, 0, 'out']],
      baliSafe: [[0, 1], [0.3, 1], [0.55, 0, 'out'], [0.75, 0], [0.95, 1, 'inOut'], [1.15, 0, 'out']],
      baliBite: [[0, 1], [0.45, 1], [0.75, 0, 'out']],
      spinZ: [[0, 0], [0.3, 0], [0.8, -360, 'inOut']],
      rz: [[0, 0], [0.8, 0], [1.0, 12], [1.3, 0]],
    },
    events: [[0.55, 'sound:knife_open'], [1.15, 'sound:knife_open']],
  },
  spin_in: {
    // pulled out spinning on the index finger through the ring, the other fingers
    // open to let it turn, then close around the handle as it lands
    duration: 1.0,
    tracks: {
      py: [[0, -0.16], [0.3, 0, 'out']],
      rx: [[0, -30], [0.3, 0, 'out']],
      spinZ: [[0, 720], [0.85, 0, 'out']],
      gripOpen: [[0, 0.95], [0.72, 0.95], [0.9, 0, 'out']],
    },
    events: [[0.3, 'sound:knife_draw']],
  },
  dagger_pair: {
    duration: 0.8,
    tracks: {
      py: [[0, -0.22], [0.5, 0, 'out']],
      rx: [[0, -45], [0.5, 0, 'out']],
      rz: [[0, 20], [0.5, 0, 'out']],
      rollX: [[0, -90], [0.55, 0, 'out']],
    },
    events: [[0.3, 'sound:knife_draw']],
  },
};

const WATCH_TAIL = (start: number): Readonly<Record<string, readonly (readonly [number, number, ('inOut' | 'out')?])[]>> => ({
  watch: [[0, 0], [start, 0], [start + 0.4, 1, 'inOut'], [start + 1.0, 1], [start + 1.4, 0, 'inOut']],
  leftAttach: [[0, 0], [start - 0.05, 0], [start, 1, 'out'], [start + 1.4, 1], [start + 1.45, 0]],
});

const INSPECTS: Readonly<Record<KnifeInspectStyle, Clip>> = {
  flip_show: {
    duration: 3.8,
    tracks: {
      ry: [[0, 0], [0.5, 35], [1.3, 35], [1.7, -20], [2.2, -20], [2.6, 0]],
      rz: [[0, 0], [0.5, 55], [1.3, 60], [1.7, -35], [2.2, -30], [2.6, 0]],
      px: [[0, 0], [0.5, -0.05], [1.3, -0.05], [1.7, 0], [2.6, 0]],
      py: [[0, 0], [0.5, 0.05], [2.2, 0.04], [2.6, 0]],
      rollX: [[0, 0], [1.3, 0], [1.7, 180, 'inOut'], [2.2, 180], [2.6, 360, 'inOut']],
      knifeOpen: [[0, 1], [2.0, 1], [2.2, 0.15, 'inOut'], [2.4, 1, 'back']],
      ...WATCH_TAIL(2.4),
    },
    events: [[2.2, 'sound:knife_open'], [2.4, 'sound:knife_open']],
  },
  switch_show: {
    // close and snap the blade out again, then turn it over
    duration: 3.6,
    tracks: {
      ry: [[0, 0], [0.4, 30], [2.6, 30], [3.0, 0]],
      rz: [[0, 0], [0.4, 50], [1.6, 50], [2.0, -30], [2.6, -30], [3.0, 0]],
      py: [[0, 0], [0.4, 0.05], [2.6, 0.05], [3.0, 0]],
      knifeOpen: [[0, 1], [0.7, 1], [0.95, 0, 'inOut'], [1.3, 0], [1.35, 1, 'out']],
      rx: [[0, 0], [1.3, 0], [1.36, 8, 'out'], [1.5, 0]],
      rollX: [[0, 0], [1.6, 0], [2.0, 180, 'inOut'], [2.6, 360, 'inOut']],
      ...WATCH_TAIL(2.15),
    },
    events: [[0.95, 'sound:knife_open'], [1.33, 'sound:knife_open']],
  },
  flick_show: {
    // fold it half shut, flick it open with the wrist, show both sides
    duration: 3.8,
    tracks: {
      ry: [[0, 0], [0.4, 28], [2.8, 28], [3.2, 0]],
      rz: [[0, 0], [0.4, 45], [1.1, 45], [1.2, 70, 'out'], [1.3, 40, 'in'], [2.0, -28], [2.8, -28], [3.2, 0]],
      py: [[0, 0], [0.4, 0.05], [2.8, 0.05], [3.2, 0]],
      knifeOpen: [[0, 1], [0.6, 1], [0.9, 0.35, 'inOut'], [1.18, 0.35], [1.28, 1, 'back']],
      rollX: [[0, 0], [1.6, 0], [2.0, 180, 'inOut'], [2.8, 360, 'inOut']],
      ...WATCH_TAIL(2.4),
    },
    events: [[1.26, 'sound:knife_open']],
  },
  balisong: {
    // opens and closes in a rhythm: the safe handle swings over the spine, the
    // bite handle under the edge, with the whole knife rolling between them
    duration: 4.6,
    tracks: {
      ry: [[0, 0], [0.4, 34], [3.2, 34], [3.6, 0]],
      rz: [[0, 0], [0.4, 48], [1.6, 55], [2.4, 38], [3.2, 48], [3.6, 0]],
      rx: [[0, 0], [0.4, 12], [3.2, 12], [3.6, 0]],
      px: [[0, 0], [0.4, -0.05], [3.2, -0.05], [3.6, 0]],
      py: [[0, 0], [0.4, 0.07], [3.2, 0.07], [3.6, 0]],
      baliSafe: [
        [0, 0], [0.45, 0], [0.62, 1, 'out'], [0.8, 1], [0.97, 0, 'in'],
        [1.45, 0], [1.6, 1, 'out'], [1.75, 0, 'in'],
        [2.35, 0], [2.5, 1, 'out'], [2.62, 1], [2.78, 0, 'in'],
      ],
      baliBite: [
        [0, 0], [0.62, 0], [0.8, 1, 'out'], [0.97, 1], [1.12, 0, 'in'],
        [1.6, 0], [1.75, 1, 'out'], [1.9, 0, 'in'],
        [2.5, 0], [2.62, 1, 'out'], [2.78, 1], [2.93, 0, 'in'],
      ],
      spinZ: [[0, 0], [0.8, 0], [1.12, -180, 'inOut'], [1.45, -180], [1.9, -360, 'inOut'], [2.35, -360], [2.93, -720, 'inOut']],
      rollX: [[0, 0], [1.9, 0], [2.2, 180, 'inOut'], [2.93, 360, 'inOut']],
      ...WATCH_TAIL(3.2),
    },
    events: [[0.62, 'sound:knife_open'], [0.97, 'sound:knife_open'], [1.6, 'sound:knife_open'], [1.9, 'sound:knife_open'], [2.5, 'sound:knife_open'], [2.93, 'sound:knife_open']],
  },
  ring_spin: {
    duration: 4.4,
    tracks: {
      ry: [[0, 0], [0.4, 25], [2.8, 25], [3.1, 0]],
      rz: [[0, 0], [0.4, 25], [1.6, 25], [2.0, -20], [2.8, -20], [3.1, 0]],
      py: [[0, 0], [0.4, 0.04], [2.8, 0.04], [3.1, 0]],
      spinZ: [[0, 0], [0.5, 0], [1.0, 360, 'inOut'], [1.3, 360], [1.8, 720, 'inOut'], [2.1, 720], [2.8, 0, 'inOut']],
      // the fingers let go while it spins, the index stays hooked in the ring
      gripOpen: [[0, 0], [0.45, 0], [0.55, 0.95], [1.02, 0.95], [1.12, 0], [1.28, 0], [1.38, 0.95], [1.82, 0.95], [1.92, 0], [2.05, 0], [2.15, 0.95], [2.78, 0.95], [2.9, 0]],
      ...WATCH_TAIL(3.0),
    },
    events: [[0.7, 'sound:knife_spin'], [1.5, 'sound:knife_spin'], [2.4, 'sound:knife_spin']],
  },
  skeleton_ring: {
    // turn it over, then hook the index through the ring and spin it on the finger
    duration: 4.6,
    tracks: {
      ry: [[0, 0], [0.4, 30], [3.2, 30], [3.6, 0]],
      rz: [[0, 0], [0.4, 45], [1.0, 45], [1.3, 20], [3.2, 20], [3.6, 0]],
      py: [[0, 0], [0.4, 0.05], [3.2, 0.05], [3.6, 0]],
      rollX: [[0, 0], [0.5, 0], [0.9, 180, 'inOut'], [1.2, 360, 'inOut']],
      ringHold: [[0, 0], [1.25, 0], [1.5, 1, 'inOut'], [2.95, 1], [3.2, 0, 'inOut']],
      gripOpen: [[0, 0], [1.3, 0], [1.5, 0.95], [2.95, 0.95], [3.15, 0]],
      spinZ: [[0, 0], [1.5, 0], [2.2, 360, 'inOut'], [2.9, 720, 'inOut']],
      ...WATCH_TAIL(3.2),
    },
    events: [[1.9, 'sound:knife_spin'], [2.6, 'sound:knife_spin']],
  },
  toss_catch: {
    // the hand dips, flicks the knife up through a full flip and catches it
    duration: 3.6,
    tracks: {
      ry: [[0, 0], [0.45, 28], [1.85, 28], [2.2, -18], [2.6, 0]],
      rz: [[0, 0], [0.45, 42], [1.85, 40], [2.2, -28], [2.6, 0]],
      px: [[0, 0], [0.45, -0.04], [1.85, -0.04], [2.2, 0], [2.6, 0]],
      py: [[0, 0], [0.45, 0.03], [0.7, -0.015, 'inOut'], [0.85, 0.04, 'out'], [1.45, 0.05], [1.6, 0.02, 'out'], [2.2, 0.04], [2.6, 0]],
      rx: [[0, 0], [0.7, -12], [0.85, 10, 'out'], [1.5, 0], [1.62, -8, 'out'], [1.9, 0]],
      tossY: [[0, 0], [0.85, 0], [1.17, 0.13, 'out'], [1.5, 0.015, 'in'], [1.55, 0]],
      spinZ: [[0, 0], [0.85, 0], [1.55, 360, 'linear']],
      rollX: [[0, 0], [0.85, 0], [1.55, 180, 'inOut'], [2.2, 180], [2.55, 360, 'inOut']],
      gripOpen: [[0, 0], [0.8, 0], [0.88, 1], [1.46, 1], [1.56, 0]],
      ...WATCH_TAIL(2.15),
    },
    events: [[0.86, 'sound:knife_toss'], [1.55, 'sound:knife_catch']],
  },
  twirl: {
    duration: 4.2,
    tracks: {
      ry: [[0, 0], [0.5, 35], [2.4, 35], [2.8, 0]],
      rz: [[0, 0], [0.5, 50], [1.4, 50], [1.8, -30], [2.4, -30], [2.8, 0]],
      px: [[0, 0], [0.5, -0.04], [2.4, -0.02], [2.8, 0]],
      py: [[0, 0], [0.5, 0.05], [2.4, 0.04], [2.8, 0]],
      rollX: [[0, 0], [0.6, 0], [1.2, 360, 'inOut'], [1.8, 360], [2.3, 720, 'inOut']],
      ...WATCH_TAIL(2.7),
    },
    events: [[0.9, 'sound:knife_spin'], [2.0, 'sound:knife_spin']],
  },
  heavy_show: {
    duration: 4.0,
    tracks: {
      ry: [[0, 0], [0.7, 40], [1.6, 40], [2.1, -25], [2.7, -25], [3.1, 0]],
      rz: [[0, 0], [0.7, 65], [1.6, 70], [2.1, -40], [2.7, -35], [3.1, 0]],
      px: [[0, 0], [0.7, -0.05], [1.6, -0.05], [2.1, 0.01], [3.1, 0]],
      py: [[0, 0], [0.7, 0.06], [2.7, 0.05], [3.1, 0]],
      pz: [[0, 0], [0.7, 0.03], [2.7, 0.03], [3.1, 0]],
      rollX: [[0, 0], [1.6, 0], [2.1, 180, 'inOut'], [2.7, 180], [3.1, 360, 'inOut']],
      ...WATCH_TAIL(2.6),
    },
  },
  dagger_pair: {
    duration: 3.4,
    tracks: {
      ry: [[0, 0], [0.5, 25], [1.4, 25], [1.8, -15], [2.5, -15], [2.9, 0]],
      rz: [[0, 0], [0.5, 50], [1.4, 50], [1.8, -40], [2.5, -40], [2.9, 0]],
      py: [[0, 0], [0.5, 0.05], [2.5, 0.05], [2.9, 0]],
      rollX: [[0, 0], [1.4, 0], [1.8, 180, 'inOut'], [2.5, 180], [2.9, 360, 'inOut']],
    },
  },
};

const ATTACKS: Readonly<Record<'slashA' | 'slashB' | 'stab' | 'backstab', Clip>> = {
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

export function knifeClip(def: KnifeDef, name: KnifeClipName): Clip {
  if (name === 'draw') {
    const clip = DRAWS[knifeDrawStyle(def)];
    return clip;
  }
  if (name === 'inspect') {
    return INSPECTS[knifeInspectStyle(def)];
  }
  return ATTACKS[name];
}
