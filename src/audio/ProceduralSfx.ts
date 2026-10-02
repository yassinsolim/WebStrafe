import { click, noise, partials, tone, type VoiceContext } from './synth';

/**
 * Every non-recorded sound in the game, synthesized at play time. No files,
 * no third party samples: layered noise bursts through filters, short
 * resonant partials for metal, pitched thumps for weight, and per-play random
 * pitch/gain so repeats never sound identical.
 */

export type AudioBus = 'effects' | 'ui';

export interface SfxRecipe {
  bus: AudioBus;
  /** voice gain before the bus volume */
  gain: number;
  /** random pitch spread per play, as a fraction */
  pitchSpread?: number;
  /** random gain spread per play, as a fraction */
  gainSpread?: number;
  /** oldest voice of this sound is cut when a new one would exceed this */
  maxVoices?: number;
  /** drop plays that arrive faster than this */
  minIntervalMs?: number;
  /** distance where positional attenuation starts, metres */
  refDistance?: number;
  rolloff?: number;
  build(v: VoiceContext): void;
}

function footstep(v: VoiceContext): void {
  const i = 0.55 + 0.45 * v.intensity;
  const p = v.pitch;
  const pan = v.variant % 2 === 0 ? -0.07 : 0.07;
  // heel thump, body, grit transient, then the toe rolling off
  tone(v, { freq: 150 * p, to: 62 * p, glide: 0.05, attack: 0.002, decay: 0.075, peak: 0.3 * i, pan });
  noise(v, {
    attack: 0.0015,
    decay: 0.075,
    peak: 0.28 * i,
    filters: [
      { type: 'highpass', freq: 90 },
      { type: 'lowpass', freq: 1250 * p, q: 0.8 },
    ],
    pan,
    send: 0.05,
  });
  noise(v, { attack: 0.0005, decay: 0.02, peak: 0.11 * i, filters: [{ type: 'bandpass', freq: 3900 * p, q: 1.1 }], pan });
  noise(v, {
    at: 0.028 + v.rand() * 0.02,
    attack: 0.008,
    decay: 0.07,
    peak: 0.07 * i,
    filters: [{ type: 'bandpass', freq: 2100 * p, q: 0.9 }],
    pan,
  });
}

function jump(v: VoiceContext): void {
  const p = v.pitch;
  noise(v, { attack: 0.004, decay: 0.09, peak: 0.2, filters: [{ type: 'bandpass', freq: 1300 * p, q: 0.8 }] });
  // cloth and gear shifting as the body lifts
  noise(v, {
    at: 0.01,
    attack: 0.03,
    decay: 0.13,
    peak: 0.09,
    filters: [{ type: 'bandpass', freq: 700 * p, to: 2300 * p, sweep: 0.15, q: 1.4 }],
  });
  tone(v, { freq: 125 * p, to: 78 * p, glide: 0.045, attack: 0.002, decay: 0.055, peak: 0.18 });
}

function land(v: VoiceContext): void {
  const i = v.intensity;
  const p = v.pitch;
  tone(v, {
    freq: (100 - 30 * i) * p,
    to: 42 * p,
    glide: 0.09 + 0.06 * i,
    attack: 0.002,
    decay: 0.1 + 0.09 * i,
    peak: 0.3 + 0.4 * i,
  });
  noise(v, {
    attack: 0.002,
    decay: 0.08 + 0.11 * i,
    peak: 0.22 + 0.34 * i,
    filters: [{ type: 'lowpass', freq: (700 + 1100 * i) * p, q: 0.8 }],
    send: 0.12,
  });
  noise(v, { attack: 0.0006, decay: 0.022, peak: 0.09 + 0.1 * i, filters: [{ type: 'highpass', freq: 2800 * p }] });
  if (i > 0.3) {
    // loose gear rattling after a hard landing
    let at = 0.022;
    for (let k = 0; k < 3; k += 1) {
      click(v, { at, freq: (4200 + v.rand() * 1800) * p, q: 6, peak: 0.05 * i, decay: 0.03 });
      at += 0.018 + v.rand() * 0.014;
    }
  }
}

// cs style knife sounds. measured off cs2/csgo clips: the miss is a broadband
// "fwsh" (flat from ~60 hz to 5 khz) that swells for ~70 ms and is gone by
// ~200 ms, a hit is a bright crack, a meaty thump ~40 ms later and a short
// hiss. nothing in them is pitched, so no narrow swept bands or glides here
// (those read as a whirr)

/** air moved by the blade: pink noise under a wide open lowpass that brightens into the cut */
function swish(
  v: VoiceContext,
  spec: { at: number; rise: number; fall: number; peak: number; p: number; dir: number },
): void {
  const { at, rise, fall, peak, p, dir } = spec;
  noise(v, {
    color: 'pink',
    at,
    attack: rise,
    decay: fall,
    peak,
    filters: [
      { type: 'highpass', freq: 120 * p },
      { type: 'lowpass', freq: 1500 * p, points: [[0, 1500 * p], [rise, 5600 * p], [rise + fall * 0.7, 1800 * p]], q: 0.5 },
    ],
    pan: [-0.25 * dir, 0.25 * dir],
  });
  // the arm's low push
  noise(v, { color: 'brown', at: at + 0.01, attack: rise, decay: fall * 0.75, peak: peak * 0.55, filters: [{ type: 'lowpass', freq: 300 * p }] });
  // thin sheen right at the fastest point
  noise(v, {
    at: at + rise * 0.6,
    attack: rise * 0.5,
    decay: fall * 0.45,
    peak: peak * 0.14,
    filters: [
      { type: 'highpass', freq: 3800 * p },
      { type: 'lowpass', freq: 9500 },
    ],
    pan: [-0.2 * dir, 0.2 * dir],
  });
}

function knifeSwing(v: VoiceContext): void {
  const p = v.pitch * (v.variant === 1 ? 0.93 : 1);
  const s = 0.94 + v.rand() * 0.12;
  const dir = v.rand() < 0.5 ? -1 : 1;
  // peaks as the edge crosses the crosshair, ~0.11 s into the slash
  swish(v, { at: 0.035, rise: 0.07 * s, fall: 0.3 * s, peak: 0.5, p, dir });
}

function knifeStab(v: VoiceContext): void {
  const p = v.pitch * (v.variant === 1 ? 0.94 : 1);
  const s = 0.94 + v.rand() * 0.12;
  // a soft rustle as the arm draws back, then a heavier swish that lands with
  // the thrust ~0.3 s in
  noise(v, { color: 'pink', at: 0.03, attack: 0.07, decay: 0.16, peak: 0.07, filters: [{ type: 'lowpass', freq: 1300 * p }] });
  swish(v, { at: 0.2, rise: 0.09 * s, fall: 0.36 * s, peak: 0.58, p: p * 0.85, dir: -1 });
}

/** a long blade through the air: a deeper sweep than the knife plus the blade's high frequency hum */
function katanaSwing(v: VoiceContext): void {
  const heavy = v.variant === 1;
  const p = v.pitch * (heavy ? 0.82 : 1);
  const dur = (heavy ? 0.42 : 0.3) * (0.94 + v.rand() * 0.12);
  const dir = v.rand() < 0.5 ? -1 : 1;
  noise(v, {
    attack: dur * 0.3,
    decay: dur * 0.85,
    peak: heavy ? 0.5 : 0.44,
    filters: [{ type: 'bandpass', freq: 260 * p, points: [[0, 260 * p], [dur * 0.34, 1900 * p], [dur, 520 * p]], q: 2.6 }],
    pan: [-0.4 * dir, 0.4 * dir],
  });
  noise(v, { attack: dur * 0.3, decay: dur * 0.8, peak: 0.16, filters: [{ type: 'lowpass', freq: 380 * p, q: 0.9 }] });
  // the blade's hum rises and falls with the arc
  tone(v, { type: 'sawtooth', freq: 610 * p, to: 820 * p, glide: dur * 0.4, attack: dur * 0.28, decay: dur * 0.7, peak: 0.035,
    pan: 0.2 * dir });
  tone(v, { freq: 1220 * p, to: 1640 * p, glide: dur * 0.4, attack: dur * 0.28, decay: dur * 0.6, peak: 0.03 });
  noise(v, { at: dur * 0.15, attack: dur * 0.2, decay: dur * 0.5, peak: 0.08, filters: [{ type: 'highpass', freq: 5200 * p }] });
}

/** drawing the blade: a bright metal scrape that rings out */
function katanaDraw(v: VoiceContext): void {
  const p = v.pitch;
  noise(v, {
    attack: 0.06,
    decay: 0.22,
    peak: 0.22,
    filters: [{ type: 'bandpass', freq: 2400 * p, points: [[0, 2400 * p], [0.22, 6200 * p]], q: 3.5 }],
    send: 0.1,
  });
  partials(v, {
    at: 0.2,
    base: 2350 * p,
    ratios: [1, 1.52, 2.27, 2.93],
    gains: [0.09, 0.07, 0.05, 0.03],
    decays: [0.9, 0.6, 0.42, 0.3],
    attack: 0.002,
    jitter: 0.008,
    send: 0.3,
  });
  tone(v, { at: 0.19, freq: 180 * p, to: 120 * p, glide: 0.05, attack: 0.001, decay: 0.06, peak: 0.12 });
}

/** the blade cutting through armour: a sharp slice with a short metallic ring */
function katanaHit(v: VoiceContext): void {
  const p = v.pitch;
  noise(v, { attack: 0.0005, decay: 0.03, peak: 0.36, filters: [{ type: 'highpass', freq: 2600 * p }] });
  noise(v, {
    attack: 0.002,
    decay: 0.16,
    peak: 0.3,
    filters: [{ type: 'bandpass', freq: 3200 * p, to: 900 * p, sweep: 0.14, q: 2.2 }],
    send: 0.1,
  });
  tone(v, { freq: 140 * p, to: 55 * p, glide: 0.1, attack: 0.002, decay: 0.13, peak: 0.34 });
  partials(v, {
    base: 1650 * p,
    ratios: [1, 1.61, 2.33],
    gains: [0.06, 0.04, 0.03],
    decays: [0.32, 0.2, 0.14],
    attack: 0.001,
    jitter: 0.01,
    send: 0.18,
  });
}

/** the edge biting: a sharp bright crack and a short sizzle after it */
function slice(v: VoiceContext, peak: number, p: number): void {
  noise(v, {
    attack: 0.0006,
    decay: 0.035,
    peak,
    filters: [
      { type: 'highpass', freq: 2200 * p },
      { type: 'lowpass', freq: 12000 },
    ],
  });
  noise(v, { at: 0.004, attack: 0.004, decay: 0.36, peak: peak * 0.3, filters: [{ type: 'highpass', freq: 2600 * p }], send: 0.05 });
}

/** the body taking it: meaty mids and a low thump that land a beat after the crack */
function meat(v: VoiceContext, spec: { at: number; peak: number; low: number; fall: number; p: number }): void {
  const { at, peak, low, fall, p } = spec;
  noise(v, {
    color: 'pink',
    at,
    attack: 0.008,
    decay: fall,
    peak,
    filters: [
      { type: 'highpass', freq: 220 * p },
      { type: 'lowpass', freq: 1700 * p },
    ],
    send: 0.06,
  });
  noise(v, { color: 'brown', at: at + 0.006, attack: 0.01, decay: fall * 1.3, peak: low, filters: [{ type: 'lowpass', freq: 200 * p }] });
  // a very short drop gives the thump its punch without ringing on
  tone(v, { at: at + 0.004, freq: 105 * p, to: 62 * p, glide: 0.035, attack: 0.002, decay: 0.05, peak: low * 0.4 });
}

function knifeHitFlesh(v: VoiceContext): void {
  const p = v.pitch;
  // some hits come out brighter, some meatier, like cs's set of four
  const body = 0.75 + v.rand() * 0.5;
  slice(v, 0.42, p);
  meat(v, { at: 0.03, peak: 0.3 * body, low: 0.5 * body, fall: 0.3, p });
}

function knifeHitWall(v: VoiceContext): void {
  const p = v.pitch;
  // hard "tschk": crack, gritty scrape, a tiny steel tick and a dull knock, all short
  noise(v, { attack: 0.0004, decay: 0.016, peak: 0.44, filters: [{ type: 'highpass', freq: 2400 * p }] });
  noise(v, {
    at: 0.002,
    attack: 0.002,
    decay: 0.13,
    peak: 0.17,
    filters: [
      { type: 'highpass', freq: 1800 * p },
      { type: 'lowpass', freq: 8000 * p },
    ],
    send: 0.1,
  });
  partials(v, {
    base: 2900 * p,
    ratios: [1, 1.43, 2.71],
    gains: [0.05, 0.035, 0.025],
    decays: [0.08, 0.06, 0.045],
    attack: 0.0008,
    jitter: 0.03,
    send: 0.08,
  });
  noise(v, { color: 'pink', attack: 0.001, decay: 0.06, peak: 0.16, filters: [{ type: 'lowpass', freq: 600 * p }] });
}

function backstab(v: VoiceContext): void {
  const p = v.pitch;
  // the flesh hit, heavier: a harder crack, more body, and a second rip as the blade drags out
  slice(v, 0.46, p * 0.95);
  meat(v, { at: 0.028, peak: 0.42, low: 0.75, fall: 0.3, p: p * 0.9 });
  noise(v, {
    color: 'pink',
    at: 0.085,
    attack: 0.012,
    decay: 0.16,
    peak: 0.16,
    filters: [
      { type: 'highpass', freq: 700 * p },
      { type: 'lowpass', freq: 4200 * p },
    ],
  });
}

/** metal on metal contact: tick + short ring + optional low thunk */
function mechanism(
  v: VoiceContext,
  spec: { at?: number; freq: number; peak: number; ring: number; thunk?: number; decay?: number },
): void {
  const p = v.pitch;
  const at = spec.at ?? 0;
  click(v, { at, freq: spec.freq * p, q: 3, peak: spec.peak, decay: spec.decay ?? 0.024 });
  noise(v, { at, attack: 0.0003, decay: 0.008, peak: spec.peak * 0.5, filters: [{ type: 'highpass', freq: 3500 * p }] });
  partials(v, {
    at,
    base: spec.freq * 0.83 * p,
    ratios: [1, 1.63, 2.41],
    gains: [spec.ring, spec.ring * 0.6, spec.ring * 0.35],
    decays: [0.06, 0.042, 0.03],
    jitter: 0.02,
  });
  if (spec.thunk) {
    tone(v, { at, freq: 300 * p, to: 170 * p, glide: 0.04, attack: 0.001, decay: 0.05, peak: spec.thunk });
  }
}

/** a part sliding along a rail */
function slide(v: VoiceContext, spec: { at?: number; from: number; to: number; dur: number; peak: number }): void {
  const p = v.pitch;
  noise(v, {
    at: spec.at,
    attack: spec.dur * 0.25,
    hold: spec.dur * 0.45,
    decay: spec.dur * 0.4,
    peak: spec.peak,
    filters: [
      { type: 'bandpass', freq: spec.from * p, to: spec.to * p, sweep: spec.dur, q: 2.5 },
      { type: 'highpass', freq: 700 },
    ],
  });
}

function awpBoltUp(v: VoiceContext): void {
  mechanism(v, { freq: 2300, peak: 0.26, ring: 0.07, thunk: 0.08 });
}

function awpBoltBack(v: VoiceContext): void {
  slide(v, { from: 1500, to: 3200, dur: 0.11, peak: 0.13 });
  mechanism(v, { at: 0.11, freq: 2800, peak: 0.3, ring: 0.07 });
}

function awpBoltForward(v: VoiceContext): void {
  slide(v, { from: 3000, to: 1600, dur: 0.09, peak: 0.12 });
  mechanism(v, { at: 0.09, freq: 2100, peak: 0.32, ring: 0.08, thunk: 0.1 });
}

function awpBoltDown(v: VoiceContext): void {
  mechanism(v, { freq: 1500, peak: 0.35, ring: 0.06, thunk: 0.15, decay: 0.03 });
}

function deagleSlideRack(v: VoiceContext): void {
  slide(v, { from: 1800, to: 3600, dur: 0.07, peak: 0.12 });
  mechanism(v, { at: 0.07, freq: 3000, peak: 0.28, ring: 0.07 });
}

function deagleSlideRelease(v: VoiceContext): void {
  const p = v.pitch;
  noise(v, { attack: 0.0005, decay: 0.025, peak: 0.4, filters: [{ type: 'highpass', freq: 1500 * p }], send: 0.06 });
  partials(v, {
    base: 2200 * p,
    ratios: [1, 1.59, 2.32],
    gains: [0.08, 0.06, 0.04],
    decays: [0.07, 0.05, 0.035],
    jitter: 0.02,
  });
  tone(v, { freq: 180 * p, to: 120 * p, glide: 0.045, attack: 0.001, decay: 0.05, peak: 0.15 });
}

function dryFire(v: VoiceContext): void {
  const p = v.pitch;
  click(v, { freq: 3800 * p, q: 4, peak: 0.28, decay: 0.014 });
  tone(v, { freq: 3200 * p, attack: 0.0005, decay: 0.03, peak: 0.05 });
  tone(v, { freq: 700 * p, attack: 0.0005, decay: 0.012, peak: 0.04 });
}

function scopeZoom(v: VoiceContext): void {
  // variant 0 zoom in, 1 second zoom level, 2 zoom out
  const p = v.pitch * (v.variant === 1 ? 1.08 : v.variant === 2 ? 0.92 : 1);
  click(v, { freq: 5200 * p, q: 5, peak: 0.16, decay: 0.009 });
  click(v, { at: 0.038, freq: 4700 * p, q: 5, peak: 0.12, decay: 0.009 });
  noise(v, {
    attack: 0.012,
    decay: 0.06,
    peak: 0.05,
    filters: [
      { type: 'highpass', freq: 2500 * p },
      { type: 'lowpass', freq: 7000 * p },
    ],
  });
}

function weaponDraw(v: VoiceContext): void {
  const p = v.pitch;
  noise(v, {
    attack: 0.012,
    decay: 0.07,
    peak: 0.08,
    filters: [{ type: 'bandpass', freq: 1200 * p, to: 2600 * p, sweep: 0.06, q: 1.2 }],
  });
  click(v, { at: 0.05, freq: 2400 * p, q: 3, peak: 0.1, decay: 0.02 });
}

function hitmarker(v: VoiceContext): void {
  const p = v.pitch;
  // dry tick on top, a short padded thud under it so a hit feels like it landed
  click(v, { freq: 3900 * p, q: 3.2, peak: 0.26, decay: 0.012 });
  click(v, { freq: 2100 * p, q: 1.6, peak: 0.12, decay: 0.02, at: 0.002 });
  noise(v, { attack: 0.0006, decay: 0.03, peak: 0.16, color: 'pink', filters: [{ type: 'bandpass', freq: 720 * p, q: 1.3 }] });
  tone(v, { type: 'sine', freq: 180 * p, to: 120 * p, glide: 0.035, attack: 0.001, decay: 0.045, peak: 0.12 });
}

function headshot(v: VoiceContext): void {
  const p = v.pitch;
  // hard crack, then a bright helmet ping with an inharmonic ring
  noise(v, { attack: 0.0003, decay: 0.009, peak: 0.28, filters: [{ type: 'highpass', freq: 5200 * p }] });
  click(v, { freq: 3000 * p, q: 2.4, peak: 0.2, decay: 0.014 });
  partials(v, {
    base: 1840 * p,
    ratios: [1, 1.51, 2.26, 3.12],
    gains: [0.19, 0.1, 0.07, 0.04],
    decays: [0.42, 0.28, 0.18, 0.12],
    attack: 0.001,
    jitter: 0.004,
  });
  tone(v, { type: 'triangle', freq: 900 * p, attack: 0.001, decay: 0.07, peak: 0.05 });
}

function killConfirm(v: VoiceContext): void {
  const p = v.pitch;
  tone(v, { freq: 200 * p, to: 96 * p, glide: 0.07, attack: 0.002, decay: 0.09, peak: 0.3 });
  noise(v, { attack: 0.001, decay: 0.045, peak: 0.16, filters: [{ type: 'bandpass', freq: 1100 * p, q: 1.4 }] });
  // rising fourth, each note with a quiet octave on top
  for (const [at, hz] of [[0.012, 988], [0.082, 1319]] as const) {
    tone(v, { type: 'triangle', freq: hz * p, at, attack: 0.003, decay: at > 0.05 ? 0.32 : 0.24, peak: 0.13 });
    tone(v, { freq: hz * 2 * p, at, attack: 0.003, decay: 0.14, peak: 0.03, detune: 4 });
  }
}

function uiHover(v: VoiceContext): void {
  const p = v.pitch;
  tone(v, { freq: 2100 * p, attack: 0.001, decay: 0.022, peak: 0.05 });
  click(v, { freq: 6000 * p, q: 3, peak: 0.03, decay: 0.01 });
}

function uiClick(v: VoiceContext): void {
  const p = v.pitch;
  click(v, { freq: 2600 * p, q: 2, peak: 0.22, decay: 0.018 });
  tone(v, { freq: 1180 * p, to: 980 * p, glide: 0.04, attack: 0.001, decay: 0.045, peak: 0.09 });
  tone(v, { freq: 420 * p, attack: 0.001, decay: 0.02, peak: 0.05 });
}

function uiConfirm(v: VoiceContext): void {
  const p = v.pitch;
  tone(v, { type: 'triangle', freq: 740 * p, attack: 0.002, decay: 0.14, peak: 0.1 });
  tone(v, { type: 'triangle', freq: 1110 * p, at: 0.055, attack: 0.002, decay: 0.22, peak: 0.1 });
  noise(v, { attack: 0.02, decay: 0.1, peak: 0.05, filters: [{ type: 'bandpass', freq: 1200 * p, to: 4000 * p, sweep: 0.12, q: 1 }] });
}

function respawn(v: VoiceContext): void {
  const p = v.pitch;
  noise(v, {
    attack: 0.35,
    decay: 0.25,
    peak: 0.16,
    filters: [{ type: 'bandpass', freq: 260 * p, to: 2400 * p, sweep: 0.45, q: 1.2 }],
    send: 0.2,
  });
  tone(v, { freq: 130 * p, attack: 0.2, decay: 0.4, peak: 0.08 });
  for (const [hz, peak] of [[523.25, 0.06], [783.99, 0.045], [1046.5, 0.03]] as const) {
    tone(v, { freq: hz * p, at: 0.28, attack: 0.04, decay: 0.9, peak, send: 0.25 });
  }
}

export const SFX = {
  footstep: { bus: 'effects', gain: 0.5, pitchSpread: 0.07, gainSpread: 0.12, maxVoices: 4, minIntervalMs: 60, refDistance: 3, rolloff: 1.2, build: footstep },
  jump: { bus: 'effects', gain: 0.45, pitchSpread: 0.06, maxVoices: 2, minIntervalMs: 60, build: jump },
  land: { bus: 'effects', gain: 0.6, pitchSpread: 0.05, gainSpread: 0.08, maxVoices: 3, minIntervalMs: 80, build: land },
  knifeSwing: { bus: 'effects', gain: 0.55, pitchSpread: 0.08, maxVoices: 3, refDistance: 3, rolloff: 1, build: knifeSwing },
  knifeStab: { bus: 'effects', gain: 0.7, pitchSpread: 0.07, maxVoices: 2, refDistance: 3, rolloff: 1, build: knifeStab },
  knifeHitFlesh: { bus: 'effects', gain: 0.65, pitchSpread: 0.08, maxVoices: 3, refDistance: 4, rolloff: 1, build: knifeHitFlesh },
  knifeHitWall: { bus: 'effects', gain: 1.15, pitchSpread: 0.08, maxVoices: 3, refDistance: 4, rolloff: 1, build: knifeHitWall },
  backstab: { bus: 'effects', gain: 0.75, pitchSpread: 0.05, maxVoices: 2, refDistance: 5, rolloff: 1, build: backstab },
  katanaSwing: { bus: 'effects', gain: 0.85, pitchSpread: 0.06, maxVoices: 3, refDistance: 3.5, rolloff: 1, build: katanaSwing },
  katanaDraw: { bus: 'effects', gain: 0.6, pitchSpread: 0.03, maxVoices: 1, minIntervalMs: 200, build: katanaDraw },
  katanaHit: { bus: 'effects', gain: 0.85, pitchSpread: 0.06, maxVoices: 3, refDistance: 4, rolloff: 1, build: katanaHit },
  awpBoltUp: { bus: 'effects', gain: 0.7, pitchSpread: 0.03, maxVoices: 2, build: awpBoltUp },
  awpBoltBack: { bus: 'effects', gain: 0.7, pitchSpread: 0.03, maxVoices: 2, build: awpBoltBack },
  awpBoltForward: { bus: 'effects', gain: 0.7, pitchSpread: 0.03, maxVoices: 2, build: awpBoltForward },
  awpBoltDown: { bus: 'effects', gain: 0.7, pitchSpread: 0.03, maxVoices: 2, build: awpBoltDown },
  deagleSlideRack: { bus: 'effects', gain: 0.7, pitchSpread: 0.03, maxVoices: 2, build: deagleSlideRack },
  deagleSlideRelease: { bus: 'effects', gain: 0.7, pitchSpread: 0.03, maxVoices: 2, build: deagleSlideRelease },
  dryFire: { bus: 'effects', gain: 0.6, pitchSpread: 0.05, maxVoices: 2, minIntervalMs: 90, build: dryFire },
  scopeZoom: { bus: 'effects', gain: 0.55, pitchSpread: 0.03, maxVoices: 2, minIntervalMs: 40, build: scopeZoom },
  weaponDraw: { bus: 'effects', gain: 0.5, pitchSpread: 0.06, maxVoices: 2, minIntervalMs: 50, build: weaponDraw },
  hitmarker: { bus: 'effects', gain: 0.6, pitchSpread: 0.04, maxVoices: 4, minIntervalMs: 18, build: hitmarker },
  headshot: { bus: 'effects', gain: 0.7, pitchSpread: 0.02, maxVoices: 3, minIntervalMs: 30, build: headshot },
  killConfirm: { bus: 'effects', gain: 0.7, pitchSpread: 0.015, maxVoices: 2, minIntervalMs: 40, build: killConfirm },
  respawn: { bus: 'effects', gain: 0.7, maxVoices: 1, minIntervalMs: 300, build: respawn },
  uiHover: { bus: 'ui', gain: 0.8, pitchSpread: 0.03, maxVoices: 2, minIntervalMs: 45, build: uiHover },
  uiClick: { bus: 'ui', gain: 0.8, pitchSpread: 0.03, maxVoices: 3, minIntervalMs: 30, build: uiClick },
  uiConfirm: { bus: 'ui', gain: 0.8, maxVoices: 1, minIntervalMs: 120, build: uiConfirm },
} satisfies Record<string, SfxRecipe>;

export type SfxName = keyof typeof SFX;

export const SFX_NAMES = Object.keys(SFX) as SfxName[];

export function isSfxName(value: unknown): value is SfxName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SFX, value);
}
