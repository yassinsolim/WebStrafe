/**
 * Tiny synthesis toolkit for the procedural sounds. A voice is one play of a
 * sound: layers (filtered noise bursts, pitched tones, resonant partials) are
 * scheduled against the voice start time and summed into `out`.
 */

export type NoiseColor = 'white' | 'pink' | 'brown';

export interface VoiceContext {
  readonly ctx: BaseAudioContext;
  /** every layer ends up here */
  readonly out: AudioNode;
  /** voice start time on the context clock */
  readonly t: number;
  /** pitch multiplier, already includes per-play variation */
  readonly pitch: number;
  /** 0..1, meaning depends on the sound (fall speed, run speed...) */
  readonly intensity: number;
  readonly variant: number;
  /** send input of the shared room reverb, null for dry buses */
  readonly reverb: AudioNode | null;
  rand(): number;
  /** latest end time of any scheduled layer */
  end: number;
  readonly sources: AudioScheduledSourceNode[];
}

export interface FilterSpec {
  type: BiquadFilterType;
  freq: number;
  /** exponential sweep target reached after `sweep` seconds (or the layer length) */
  to?: number;
  sweep?: number;
  /** multi point sweep as [seconds from layer start, hz]; overrides freq/to */
  points?: ReadonlyArray<readonly [number, number]>;
  q?: number;
  gain?: number;
}

interface LayerTiming {
  /** seconds after the voice start */
  at?: number;
  attack?: number;
  hold?: number;
  /** exponential fall to silence, seconds */
  decay: number;
  peak: number;
  /** static pan or a [from, to] sweep over the layer */
  pan?: number | readonly [number, number];
  /** amount sent to the room reverb */
  send?: number;
}

export interface NoiseSpec extends LayerTiming {
  filters: readonly FilterSpec[];
  color?: NoiseColor;
  rate?: number;
}

export interface ToneSpec extends LayerTiming {
  type?: OscillatorType;
  freq: number;
  to?: number;
  glide?: number;
  detune?: number;
  /** tanh drive for a little grit, 0 = clean */
  drive?: number;
}

export interface PartialsSpec {
  at?: number;
  attack?: number;
  base: number;
  ratios: readonly number[];
  gains: readonly number[];
  decays: readonly number[];
  type?: OscillatorType;
  /** random detune per partial as a fraction of its frequency */
  jitter?: number;
  pan?: number;
  send?: number;
}

const SILENCE = 0.0001;
const NOISE_SECONDS = 2;

interface NoiseBank {
  white: AudioBuffer;
  pink: AudioBuffer;
  brown: AudioBuffer;
}

const noiseBanks = new WeakMap<BaseAudioContext, NoiseBank>();
const shaperCurves = new WeakMap<BaseAudioContext, Map<number, Float32Array<ArrayBuffer>>>();

export function createVoice(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  options: {
    pitch: number;
    intensity: number;
    variant: number;
    reverb: AudioNode | null;
    rand: () => number;
  },
): VoiceContext {
  return {
    ctx,
    out,
    t,
    pitch: options.pitch,
    intensity: options.intensity,
    variant: options.variant,
    reverb: options.reverb,
    rand: options.rand,
    end: t,
    sources: [],
  };
}

export function noiseBuffer(ctx: BaseAudioContext, color: NoiseColor): AudioBuffer {
  let bank = noiseBanks.get(ctx);
  if (!bank) {
    bank = buildNoiseBank(ctx);
    noiseBanks.set(ctx, bank);
  }
  return bank[color];
}

/** filtered noise burst with an attack/hold/decay envelope */
export function noise(v: VoiceContext, spec: NoiseSpec): void {
  const { ctx } = v;
  const timing = layerTiming(v, spec);
  if (!timing) {
    return;
  }
  const { start, end } = timing;
  const src = ctx.createBufferSource();
  const buffer = noiseBuffer(ctx, spec.color ?? 'white');
  src.buffer = buffer;
  src.playbackRate.value = spec.rate ?? 1;

  let node: AudioNode = src;
  for (const filter of spec.filters) {
    node = node.connect(makeFilter(ctx, filter, start, end));
  }
  const amp = ctx.createGain();
  envelope(amp.gain, timing);
  node.connect(amp);
  route(v, amp, spec, start, end);

  const length = end - start + 0.02;
  const maxOffset = Math.max(0, NOISE_SECONDS - length - 0.01);
  src.start(start, v.rand() * maxOffset);
  src.stop(end + 0.01);
  v.sources.push(src);
  v.end = Math.max(v.end, end);
}

/** pitched oscillator with an optional exponential glide */
export function tone(v: VoiceContext, spec: ToneSpec): void {
  const { ctx } = v;
  const timing = layerTiming(v, spec);
  if (!timing) {
    return;
  }
  const { start, end } = timing;
  const osc = ctx.createOscillator();
  osc.type = spec.type ?? 'sine';
  osc.frequency.setValueAtTime(clampHz(ctx, spec.freq), start);
  if (spec.to !== undefined) {
    const glide = spec.glide ?? end - start;
    osc.frequency.exponentialRampToValueAtTime(clampHz(ctx, spec.to), start + Math.max(0.001, glide));
  }
  if (spec.detune) {
    osc.detune.value = spec.detune;
  }
  let node: AudioNode = osc;
  if (spec.drive && spec.drive > 0) {
    const shaper = ctx.createWaveShaper();
    shaper.curve = softClipCurve(ctx, spec.drive);
    node = node.connect(shaper);
  }
  const amp = ctx.createGain();
  envelope(amp.gain, timing);
  node.connect(amp);
  route(v, amp, spec, start, end);

  osc.start(start);
  osc.stop(end + 0.01);
  v.sources.push(osc);
  v.end = Math.max(v.end, end);
}

/** a set of decaying sine partials, the core of every metallic ring */
export function partials(v: VoiceContext, spec: PartialsSpec): void {
  const count = Math.min(spec.ratios.length, spec.gains.length, spec.decays.length);
  for (let i = 0; i < count; i += 1) {
    const jitter = spec.jitter ? 1 + (v.rand() * 2 - 1) * spec.jitter : 1;
    tone(v, {
      type: spec.type ?? 'sine',
      freq: spec.base * spec.ratios[i] * jitter,
      at: spec.at,
      attack: spec.attack ?? 0.001,
      decay: spec.decays[i],
      peak: spec.gains[i],
      pan: spec.pan,
      send: spec.send,
    });
  }
}

/** short band-limited noise tick, the building block of mechanical clicks */
export function click(
  v: VoiceContext,
  spec: { at?: number; freq: number; q?: number; peak: number; decay: number; send?: number; pan?: number },
): void {
  noise(v, {
    at: spec.at,
    attack: 0.0004,
    decay: spec.decay,
    peak: spec.peak,
    filters: [{ type: 'bandpass', freq: spec.freq, q: spec.q ?? 3 }],
    send: spec.send,
    pan: spec.pan,
  });
}

function layerTiming(
  v: VoiceContext,
  spec: LayerTiming,
): { start: number; end: number; attack: number; hold: number; decay: number; peak: number } | null {
  if (!(spec.peak > 0)) {
    return null;
  }
  const start = v.t + Math.max(0, spec.at ?? 0);
  const attack = Math.max(0.0003, spec.attack ?? 0.002);
  const hold = Math.max(0, spec.hold ?? 0);
  const decay = Math.max(0.004, spec.decay);
  return { start, end: start + attack + hold + decay, attack, hold, decay, peak: spec.peak };
}

function envelope(
  param: AudioParam,
  timing: { start: number; attack: number; hold: number; decay: number; peak: number },
): void {
  const { start, attack, hold, decay, peak } = timing;
  param.setValueAtTime(SILENCE, start);
  param.linearRampToValueAtTime(peak, start + attack);
  if (hold > 0) {
    param.setValueAtTime(peak, start + attack + hold);
  }
  param.exponentialRampToValueAtTime(SILENCE, start + attack + hold + decay);
}

function route(v: VoiceContext, amp: GainNode, spec: LayerTiming, start: number, end: number): void {
  let tail: AudioNode = amp;
  if (spec.pan !== undefined) {
    const panner = v.ctx.createStereoPanner();
    if (typeof spec.pan === 'number') {
      panner.pan.value = clampPan(spec.pan);
    } else {
      const [from, to] = spec.pan as readonly [number, number];
      panner.pan.setValueAtTime(clampPan(from), start);
      panner.pan.linearRampToValueAtTime(clampPan(to), end);
    }
    tail = amp.connect(panner);
  }
  tail.connect(v.out);
  if (v.reverb && spec.send && spec.send > 0) {
    const send = v.ctx.createGain();
    send.gain.value = spec.send;
    tail.connect(send).connect(v.reverb);
  }
}

function makeFilter(ctx: BaseAudioContext, spec: FilterSpec, start: number, end: number): BiquadFilterNode {
  const filter = ctx.createBiquadFilter();
  filter.type = spec.type;
  filter.Q.value = spec.q ?? Math.SQRT1_2;
  if (spec.gain !== undefined) {
    filter.gain.value = spec.gain;
  }
  if (spec.points && spec.points.length > 0) {
    const [firstAt, firstHz] = spec.points[0];
    filter.frequency.setValueAtTime(clampHz(ctx, firstHz), start + firstAt);
    for (let i = 1; i < spec.points.length; i += 1) {
      const [at, hz] = spec.points[i];
      filter.frequency.exponentialRampToValueAtTime(clampHz(ctx, hz), start + Math.max(at, 0.001));
    }
  } else {
    filter.frequency.setValueAtTime(clampHz(ctx, spec.freq), start);
    if (spec.to !== undefined) {
      const sweep = spec.sweep ?? end - start;
      filter.frequency.exponentialRampToValueAtTime(clampHz(ctx, spec.to), start + Math.max(0.001, sweep));
    }
  }
  return filter;
}

function clampHz(ctx: BaseAudioContext, hz: number): number {
  return Math.min(ctx.sampleRate * 0.45, Math.max(20, Number.isFinite(hz) ? hz : 20));
}

function clampPan(pan: number): number {
  return Math.max(-1, Math.min(1, pan));
}

function softClipCurve(ctx: BaseAudioContext, drive: number): Float32Array<ArrayBuffer> {
  let curves = shaperCurves.get(ctx);
  if (!curves) {
    curves = new Map();
    shaperCurves.set(ctx, curves);
  }
  const key = Math.round(drive * 100) / 100;
  const cached = curves.get(key);
  if (cached) {
    return cached;
  }
  const size = 1024;
  const curve = new Float32Array(size);
  const norm = Math.tanh(key);
  for (let i = 0; i < size; i += 1) {
    const x = (i / (size - 1)) * 2 - 1;
    curve[i] = Math.tanh(key * x) / norm;
  }
  curves.set(key, curve);
  return curve;
}

function buildNoiseBank(ctx: BaseAudioContext): NoiseBank {
  const length = Math.max(1, Math.floor(ctx.sampleRate * NOISE_SECONDS));
  const white = ctx.createBuffer(1, length, ctx.sampleRate);
  const pink = ctx.createBuffer(1, length, ctx.sampleRate);
  const brown = ctx.createBuffer(1, length, ctx.sampleRate);
  const w = white.getChannelData(0);
  const p = pink.getChannelData(0);
  const b = brown.getChannelData(0);
  // paul kellet's economy pink filter and a leaky integrator for brown
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let last = 0;
  for (let i = 0; i < length; i += 1) {
    const x = Math.random() * 2 - 1;
    w[i] = x;
    b0 = 0.99765 * b0 + x * 0.099046;
    b1 = 0.963 * b1 + x * 0.2965164;
    b2 = 0.57 * b2 + x * 1.0526913;
    p[i] = (b0 + b1 + b2 + x * 0.1848) * 0.2;
    last = (last + 0.02 * x) / 1.02;
    b[i] = last * 3.5;
  }
  return { white, pink, brown };
}
