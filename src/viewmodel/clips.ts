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
  /** the item travels through these poses on a smooth path (knives) */
  seq?: readonly SeqKey[];
  /** a pair's left knife runs this one (mirrored) instead of mirroring the right */
  seqL?: readonly SeqKey[];
  /** the seq keys are dense samples (fitted clips): played on a time spline through every channel */
  seqSpline?: boolean;
}

/** where a pose sequence is: between poses a and b, u of the way, with the poses either side for the curve */
export interface SeqSample {
  before: string;
  a: string;
  b: string;
  after: string;
  u: number;
}

export function applyEase(ease: Ease | undefined, t: number): number {
  const x = Math.min(1, Math.max(0, t));
  switch (ease) {
    case 'linear':
      return x;
    case 'in':
      return x * x * x;
    case 'out':
      return 1 - (1 - x) ** 3;
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

export function sampleSeq(seq: readonly SeqKey[], t: number, out: SeqSample): SeqSample {
  const at = (i: number) => seq[Math.max(0, Math.min(seq.length - 1, i))][1];
  if (t <= seq[0][0]) {
    out.before = out.a = out.b = at(0);
    out.after = at(1);
    out.u = 0;
    return out;
  }
  for (let i = 1; i < seq.length; i += 1) {
    const [t1, , ease] = seq[i];
    if (t <= t1) {
      const t0 = seq[i - 1][0];
      const span = t1 - t0;
      out.before = at(i - 2);
      out.a = at(i - 1);
      out.b = at(i);
      out.after = at(i + 1);
      out.u = applyEase(ease, span > 1e-9 ? (t - t0) / span : 1);
      return out;
    }
  }
  out.before = out.a = out.b = out.after = at(seq.length - 1);
  out.u = 1;
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
