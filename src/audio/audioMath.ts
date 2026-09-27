/**
 * Pure helpers shared by the audio engine and the procedural sounds. Nothing
 * here touches Web Audio, so all of it is unit tested.
 */

export type Vec3Like = { x: number; y: number; z: number } | readonly [number, number, number];

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function toVec3(value: Vec3Like): Vec3 {
  if (Array.isArray(value)) {
    const [x, y, z] = value as readonly [number, number, number];
    return { x, y, z };
  }
  const v = value as { x: number; y: number; z: number };
  return { x: v.x, y: v.y, z: v.z };
}

export function distance3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Slider value (0..1) to linear gain. Squaring gives a roughly perceptual
 * taper: 50% on the slider is about -12 dB instead of -6 dB.
 */
export function volumeToGain(volume: number): number {
  if (!Number.isFinite(volume) || volume <= 0) {
    return 0;
  }
  const v = Math.min(1, volume);
  return v * v;
}

/**
 * Inverse distance attenuation (the same curve as PannerNode's 'inverse'
 * model), computed by hand so the engine can pair it with air absorption.
 */
export function distanceGain(distance: number, refDistance: number, rolloff: number): number {
  const ref = Math.max(0.01, refDistance);
  const d = Math.max(0, Number.isFinite(distance) ? distance : 0);
  return ref / (ref + Math.max(0, rolloff) * Math.max(0, d - ref));
}

/** lowpass cutoff that dulls far sounds like air does */
export function airAbsorptionHz(distance: number): number {
  const d = Math.max(0, Number.isFinite(distance) ? distance : 0);
  return clamp(20000 / (1 + d / 40), 1800, 20000);
}

/** far sounds get more room and less direct signal */
export function reverbSendForDistance(distance: number): number {
  const d = Math.max(0, Number.isFinite(distance) ? distance : 0);
  return clamp(0.06 + d / 260, 0.06, 0.42);
}

/** base * (1 +/- spread), with rand in [0, 1) */
export function vary(base: number, spread: number, rand: () => number): number {
  return base * (1 + (rand() * 2 - 1) * spread);
}

export function semitonesToRatio(semitones: number): number {
  return 2 ** (semitones / 12);
}

/** seconds between footsteps; about a 1.9 m stride like source's 300 ms at run speed */
export function footstepInterval(speedMps: number): number {
  if (!Number.isFinite(speedMps) || speedMps <= 0) {
    return 0.5;
  }
  return clamp(1.9 / speedMps, 0.27, 0.5);
}

/** 0..1 loudness for a footstep at this horizontal speed */
export function footstepIntensity(speedMps: number): number {
  if (!Number.isFinite(speedMps)) {
    return 0.25;
  }
  return clamp((speedMps - 2) / (6.4 - 2), 0.25, 1);
}

/** 0..1 impact strength for landing at this downward speed (m/s) */
export function landingIntensity(fallSpeedMps: number): number {
  if (!Number.isFinite(fallSpeedMps) || fallSpeedMps <= 2) {
    return 0;
  }
  return clamp((fallSpeedMps - 2) / 12, 0, 1) ** 0.8;
}

/** small deterministic prng for tests and reproducible variation */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
