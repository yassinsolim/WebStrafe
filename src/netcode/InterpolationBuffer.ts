export type Vec3Tuple = [number, number, number];

export interface EntitySample {
  /** Sample time in the source clock, ms. */
  t: number;
  position: Vec3Tuple;
  velocity: Vec3Tuple;
  yaw: number;
  pitch: number;
}

export interface SampledState {
  position: Vec3Tuple;
  yaw: number;
  pitch: number;
  /** Source-clock time the returned state corresponds to. */
  sourceT: number;
  /** 'interp' between samples, 'extrap' past the newest, 'hold' when stale. */
  mode: 'interp' | 'extrap' | 'hold';
}

/** long enough to ride out a tcp retransmit stall (~200-300 ms) without freezing */
export const MAX_EXTRAPOLATION_MS = 250;
/** A gap bigger than this between two samples is a respawn or reset, not motion. */
export const TELEPORT_DISTANCE_M = 6;
const MAX_SAMPLES = 48;

/**
 * Per-entity snapshot buffer. Samples are kept in source-time order and read
 * back at a render time slightly in the past, so the entity moves between two
 * real samples instead of chasing the newest one.
 *
 * Positions use cubic Hermite interpolation with the sent velocities, which
 * follows curved surf/strafe paths far better than a straight lerp at low
 * update rates.
 */
export class InterpolationBuffer {
  private readonly samples: EntitySample[] = [];

  push(sample: EntitySample): boolean {
    const last = this.samples.at(-1);
    if (last && sample.t <= last.t) {
      if (sample.t === last.t) {
        return false;
      }
      // out of order: insert in place so late packets still help
      const index = this.samples.findIndex((s) => s.t >= sample.t);
      if (index >= 0 && this.samples[index].t === sample.t) {
        return false;
      }
      this.samples.splice(index < 0 ? this.samples.length : index, 0, sample);
    } else {
      this.samples.push(sample);
    }
    if (this.samples.length > MAX_SAMPLES) {
      this.samples.splice(0, this.samples.length - MAX_SAMPLES);
    }
    return true;
  }

  clear(): void {
    this.samples.length = 0;
  }

  size(): number {
    return this.samples.length;
  }

  newest(): EntitySample | undefined {
    return this.samples.at(-1);
  }

  /** Samples at `renderT`, expressed in the source clock (see SourceClock.toSource). */
  sampleAt(renderT: number): SampledState | null {
    const samples = this.samples;
    if (samples.length === 0) {
      return null;
    }
    const first = samples[0];
    if (renderT <= first.t) {
      return fromSample(first, 'interp');
    }
    const newest = samples[samples.length - 1];
    if (renderT >= newest.t) {
      const aheadMs = Math.min(renderT - newest.t, MAX_EXTRAPOLATION_MS);
      const mode = renderT - newest.t > MAX_EXTRAPOLATION_MS ? 'hold' : 'extrap';
      const dt = aheadMs / 1000;
      return {
        position: [
          newest.position[0] + newest.velocity[0] * dt,
          newest.position[1] + newest.velocity[1] * dt,
          newest.position[2] + newest.velocity[2] * dt,
        ],
        yaw: newest.yaw,
        pitch: newest.pitch,
        sourceT: newest.t + aheadMs,
        mode,
      };
    }

    // binary search for the pair around the render time
    let lo = 0;
    let hi = samples.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (samples[mid].t <= renderT) lo = mid;
      else hi = mid;
    }
    const a = samples[lo];
    const b = samples[hi];
    return interpolateSamples(a, b, renderT);
  }
}

function fromSample(s: EntitySample, mode: SampledState['mode']): SampledState {
  return {
    position: [s.position[0], s.position[1], s.position[2]],
    yaw: s.yaw,
    pitch: s.pitch,
    sourceT: s.t,
    mode,
  };
}

/**
 * Hermite between two samples at a source time. Exported so the authority's
 * lag compensation can rebuild exactly what a client rendered.
 */
export function interpolateSamples(a: EntitySample, b: EntitySample, atT: number): SampledState {
  const spanMs = b.t - a.t;
  const u = spanMs > 0 ? Math.min(1, Math.max(0, (atT - a.t) / spanMs)) : 1;
  const sourceT = a.t + spanMs * u;
  const dx = b.position[0] - a.position[0];
  const dy = b.position[1] - a.position[1];
  const dz = b.position[2] - a.position[2];
  if (dx * dx + dy * dy + dz * dz > TELEPORT_DISTANCE_M * TELEPORT_DISTANCE_M) {
    return fromSample(u < 1 ? a : b, 'interp');
  }
  const h = spanMs / 1000;
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  const position: Vec3Tuple = [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    position[i] = h00 * a.position[i] + h10 * h * a.velocity[i] + h01 * b.position[i] + h11 * h * b.velocity[i];
  }
  return {
    position,
    yaw: lerpAngle(a.yaw, b.yaw, u),
    pitch: a.pitch + (b.pitch - a.pitch) * u,
    sourceT,
    mode: 'interp',
  };
}

export function lerpAngle(from: number, to: number, alpha: number): number {
  const twoPi = Math.PI * 2;
  let delta = (to - from) % twoPi;
  if (delta > Math.PI) delta -= twoPi;
  if (delta < -Math.PI) delta += twoPi;
  return from + delta * alpha;
}
