import type { Clip } from './clips';

/**
 * the gun and katana first person animations, authored as keyframes in
 * seconds (the knives' are in knifeClips.ts). offsets (px py pz in metres,
 * rx ry rz in degrees) are in camera space around the hand's grip point: rx
 * lifts the muzzle or tip, ry yaws left, rz rolls the top to the left. part
 * channels drive the glb pivots, hand channels pick where the left hand goes
 * (see ViewmodelSystem).
 */

export type GunClipName = 'draw' | 'fire' | 'reload' | 'inspect';

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

export type KatanaClipName = 'draw' | 'inspect' | 'slashA' | 'slashB' | 'stab' | 'backstab';

/**
 * the katana rests two handed, blade up and forward on the right. slashes let
 * go with the left hand and cut flat across the screen, the heavy cut goes up
 * over the head and comes down with both hands. timings sit inside the swing
 * cooldowns in combat/katana.ts (slash 0.56 s, heavy 1.15 s).
 */
export const KATANA_CLIPS: Readonly<Record<KatanaClipName, Clip>> = {
  draw: {
    // pulled from the scabbard over the right shoulder, swung down into guard
    duration: 0.9,
    tracks: {
      raise: [[0, 1], [0.12, 1], [0.52, 0, 'inOut']],
      py: [[0, 0.05], [0.52, 0, 'out']],
      leftAttach: [[0, 0], [0.5, 0], [0.82, 1, 'out']],
    },
    events: [[0.04, 'sound:katana_draw']],
  },
  slashA: {
    // a short wind to the right, then cut through to the left
    duration: 0.55,
    tracks: {
      hookB: [[0, 0], [0.08, 0.3, 'out'], [0.16, 0, 'in']],
      hook: [[0, 0], [0.08, 0], [0.19, 1, 'in'], [0.27, 1.06, 'out'], [0.55, 0, 'inOut']],
      leftAttach: [[0, 1], [0.05, 0, 'out'], [0.4, 0], [0.55, 1, 'inOut']],
    },
  },
  slashB: {
    // backhand: wound to the left, cut through to the right
    duration: 0.55,
    tracks: {
      hook: [[0, 0], [0.08, 0.3, 'out'], [0.16, 0, 'in']],
      hookB: [[0, 0], [0.08, 0], [0.19, 1, 'in'], [0.27, 1.06, 'out'], [0.55, 0, 'inOut']],
      leftAttach: [[0, 1], [0.05, 0, 'out'], [0.4, 0], [0.55, 1, 'inOut']],
    },
  },
  stab: {
    // heavy cut: both hands up over the head, then straight down through the target
    duration: 1.0,
    tracks: {
      cock: [[0, 0], [0.3, 1, 'out'], [0.42, 0, 'in']],
      strike: [[0, 0], [0.3, 0], [0.43, 1, 'in'], [0.56, 1], [1.0, 0, 'inOut']],
    },
  },
  backstab: {
    // the same cut, wound up a beat longer and driven deeper
    duration: 1.05,
    tracks: {
      cock: [[0, 0], [0.33, 1.08, 'out'], [0.46, 0, 'in']],
      strike: [[0, 0], [0.33, 0], [0.46, 1.08, 'in'], [0.6, 1.08], [1.05, 0, 'inOut']],
      pz: [[0, 0], [0.33, 0], [0.46, -0.05, 'in'], [1.05, 0, 'inOut']],
    },
  },
  inspect: {
    // one handed: laid flat across the view, rolled to run the light down the
    // edge, a quick flick, back to guard
    duration: 3.9,
    tracks: {
      leftAttach: [[0, 1], [0.25, 0, 'out'], [3.35, 0], [3.8, 1, 'inOut']],
      show: [[0, 0], [0.7, 1, 'inOut'], [3.0, 1], [3.7, 0, 'inOut']],
      showB: [[0, 0], [1.4, 0], [2.2, 1, 'inOut'], [2.6, 1], [2.95, 0, 'inOut']],
      rz: [[0, 0], [2.95, 0], [3.1, 22, 'out'], [3.28, -12, 'inOut'], [3.5, 0, 'inOut']],
      py: [[0, 0], [0.7, 0.015, 'inOut'], [3.0, 0.01], [3.7, 0, 'inOut']],
    },
    events: [[3.0, 'sound:katana_flourish']],
  },
};
