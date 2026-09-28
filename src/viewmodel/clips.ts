/**
 * tiny keyframe clips for the viewmodel. a clip is a set of named number
 * channels, each a list of [time in seconds, value, ease into this key].
 * channels that a clip doesn't list sit at their default.
 */
export type Ease = 'linear' | 'in' | 'out' | 'inOut' | 'step' | 'back';

export type Key = readonly [t: number, value: number, ease?: Ease];

export interface Clip {
  duration: number;
  tracks: Readonly<Record<string, readonly Key[]>>;
  /** [time, name] fired once when playback crosses the time */
  events?: ReadonlyArray<readonly [number, string]>;
  loop?: boolean;
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
  };
}
