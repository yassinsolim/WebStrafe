/**
 * tiny keyframe clips for the viewmodel. a clip is a set of named number
 * channels, each a list of [time in seconds, value, ease into this key].
 * channels that a clip doesn't list sit at their default.
 */
export type Ease = 'linear' | 'in' | 'out' | 'inOut' | 'step' | 'back';

export type Key = readonly [t: number, value: number, ease?: Ease];

/** a whole hand and item pose by name at a time ('idle' is the rest pose), with the ease into it */
export type SeqKey = readonly [t: number, pose: string, ease?: Ease];

export interface Clip {
  duration: number;
  tracks: Readonly<Record<string, readonly Key[]>>;
  /** [time, name] fired once when playback crosses the time */
  events?: ReadonlyArray<readonly [number, string]>;
  loop?: boolean;
  /** the item travels through these poses on a smooth path in time (knives) */
  seq?: readonly SeqKey[];
  /** a pair's left knife runs this one (mirrored) instead of mirroring the right */
  seqL?: readonly SeqKey[];
}

/** where a pose sequence is at a time: four neighbouring keys (indices, clamped) and how much of each */
export interface SeqWeights {
  keys: [number, number, number, number];
  weights: [number, number, number, number];
}

// 'in': k x^3 up to 0.8, then a constant slow down to rest at 1 (k so it lands on 1)
const IN_SCALE = 1 / 0.704;
const IN_LAND = (IN_SCALE * 1.92) / 0.4;

export function applyEase(ease: Ease | undefined, t: number): number {
  const x = Math.min(1, Math.max(0, t));
  switch (ease) {
    case 'linear':
      return x;
    case 'in':
      // speeds up into the key and lands over the last fifth instead of stopping dead
      return x < 0.8 ? IN_SCALE * x * x * x : 1 - IN_LAND * (1 - x) * (1 - x);
    case 'out':
      // fast early and a long settle, but from rest and without a kick (a cubic out starts at full speed, which reads as a jolt)
      return 1 - (1 - x) ** 4 * (1 + 4 * x + 10 * x * x);
    case 'step':
      return x < 1 ? 0 : 1;
    case 'back': {
      // overshoots a little then settles
      const c = 1.70158;
      const y = x - 1;
      return 1 + (c + 1) * y * y * y + c * y * y;
    }
    case 'inOut':
    default:
      return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
  }
}

export function sampleKeys(keys: readonly Key[] | undefined, t: number, fallback = 0): number {
  if (!keys || keys.length === 0) {
    return fallback;
  }
  if (t <= keys[0][0]) {
    return keys[0][1];
  }
  for (let i = 1; i < keys.length; i += 1) {
    const [t1, v1, ease] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      const span = t1 - t0;
      const u = span > 1e-9 ? (t - t0) / span : 1;
      return v0 + (v1 - v0) * applyEase(ease, u);
    }
  }
  return keys[keys.length - 1][1];
}

export function sampleClip(clip: Clip, channel: string, t: number, fallback = 0): number {
  return sampleKeys(clip.tracks[channel], t, fallback);
}

/**
 * a key's velocity as scale * (pose b - pose a). every key gets one velocity so
 * the motion runs through it instead of stopping and setting off again: keys
 * eased 'out' or 'inOut' and holds are arrived at and left at rest, the rest
 * pass through along the line between their neighbours. a dense fitted clip
 * ('linear' throughout) sets off already moving, everything else from rest,
 * and every clip comes to rest on its last key
 */
function keyVelocity(seq: readonly SeqKey[], j: number): [a: number, b: number, scale: number] {
  const last = seq.length - 1;
  if (j <= 0) {
    if (last < 1 || seq[1][1] === seq[0][1] || seq[1][2] !== 'linear') return [0, 0, 0];
    return [0, 1, 1 / Math.max(1e-6, seq[1][0] - seq[0][0])];
  }
  if (j >= last) return [j, j, 0];
  const [, name, ease] = seq[j];
  if (name === seq[j - 1][1] || name === seq[j + 1][1]) return [j, j, 0];
  if (ease === 'out' || ease === 'inOut' || ease === 'step' || ease === 'back') return [j, j, 0];
  return [j - 1, j + 1, 1 / Math.max(1e-6, seq[j + 1][0] - seq[j - 1][0])];
}

/**
 * a pose sequence on a cubic hermite in time: the pose at `t` is the weighted
 * sum of the four keys around it (positions directly, rotations as quaternions
 * on one hemisphere, renormalised)
 */
export function seqWeights(seq: readonly SeqKey[], t: number, out: SeqWeights): SeqWeights {
  const last = seq.length - 1;
  const { keys, weights } = out;
  weights.fill(0);
  if (last <= 0 || t <= seq[0][0] || t >= seq[last][0]) {
    const end = last <= 0 || t <= seq[0][0] ? 0 : last;
    keys.fill(end);
    weights[1] = 1;
    return out;
  }
  let k = 1;
  while (k < last && seq[k][0] < t) k += 1;
  keys[0] = Math.max(0, k - 2);
  keys[1] = k - 1;
  keys[2] = k;
  keys[3] = Math.min(last, k + 1);
  const h = seq[k][0] - seq[k - 1][0];
  let u = h > 1e-9 ? (t - seq[k - 1][0]) / h : 1;
  const ease = seq[k][2];
  if (ease === 'step') u = u < 1 ? 0 : 1;
  const [, , startScale] = keyVelocity(seq, k - 1);
  const [, , endScale] = keyVelocity(seq, k);
  if (startScale === 0 && endScale === 0) {
    // rest to rest: an ease that starts and stops gently (no kick in acceleration either)
    const e = applyEase(ease === 'out' || ease === 'in' || ease === 'step' || ease === 'back' ? ease : 'inOut', u);
    weights[1] = 1 - e;
    weights[2] = e;
    return out;
  }
  const u2 = u * u;
  const u3 = u2 * u;
  weights[1] = 2 * u3 - 3 * u2 + 1;
  weights[2] = 3 * u2 - 2 * u3;
  const slot = (index: number): number => keys.indexOf(index, index >= k ? 2 : 0);
  const addVelocity = (j: number, basis: number) => {
    const [a, b, scale] = keyVelocity(seq, j);
    if (scale === 0) return;
    weights[slot(a)] -= basis * h * scale;
    weights[slot(b)] += basis * h * scale;
  };
  addVelocity(k - 1, u3 - 2 * u2 + u);
  addVelocity(k, u3 - u2);
  return out;
}

/** scales every key time so the clip lasts `duration` seconds */
export function retime(clip: Clip, duration: number): Clip {
  const k = duration / clip.duration;
  const tracks: Record<string, Key[]> = {};
  for (const [name, keys] of Object.entries(clip.tracks)) {
    tracks[name] = keys.map(([t, v, e]) => [t * k, v, e] as Key);
  }
  return {
    ...clip,
    duration,
    tracks,
    events: clip.events?.map(([t, name]) => [t * k, name] as const),
    seq: clip.seq?.map(([t, pose, e]) => [t * k, pose, e] as SeqKey),
    seqL: clip.seqL?.map(([t, pose, e]) => [t * k, pose, e] as SeqKey),
  };
}
