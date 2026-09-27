import {
  airAbsorptionHz,
  distance3,
  distanceGain,
  reverbSendForDistance,
  toVec3,
  vary,
  volumeToGain,
  type Vec3,
  type Vec3Like,
} from './audioMath';
import { SFX, type AudioBus, type SfxName, type SfxRecipe } from './ProceduralSfx';
import { createVoice } from './synth';

export type { AudioBus, SfxName } from './ProceduralSfx';
export type { Vec3Like } from './audioMath';

/**
 * The one audio engine for the whole game.
 *
 * Hook API (for gameplay code, everything is safe to call before audio is
 * unlocked, it just stays silent):
 *
 *   import { getAudioEngine } from '../audio/AudioEngine';
 *   const audio = getAudioEngine();
 *
 *   audio.play('headshot');                          // 2d, on the sound's bus
 *   audio.play('land', { intensity: 0.8 });          // recipe params
 *   audio.play('scopeZoom', { variant: 1 });         // 0 in, 1 second level, 2 out
 *   audio.play('awpBoltUp', { delay: 0.48 });        // schedule ahead, seconds
 *   audio.playAt('knifeHitWall', [x, y, z]);         // positional (PannerNode)
 *   audio.playAt('footstep', position, { volume: 0.5 });
 *   const h = audio.play('respawn'); h?.stop(0.05);  // every play returns a handle
 *
 * Options: volume (linear), pitch (multiplier), intensity (0..1), variant
 * (recipe specific), delay (seconds). playAt also takes refDistance/rolloff.
 * Sound names are the keys of SFX in ProceduralSfx.ts: footstep, jump, land,
 * knifeSwing, knifeStab, knifeHitFlesh, knifeHitWall, backstab, awpBoltUp,
 * awpBoltBack, awpBoltForward, awpBoltDown, deagleSlideRack,
 * deagleSlideRelease, dryFire, scopeZoom, weaponDraw, hitmarker, headshot,
 * killConfirm, respawn, uiHover, uiClick, uiConfirm.
 *
 * Recorded samples go through loadSample/playSample (see GunAudio). GameApp
 * owns the lifecycle: installGestureUnlock() once, resume() on Play,
 * setVolumes() from settings and setListener() every frame.
 */

export type AudioEngineStatus = 'running' | 'suspended' | 'unavailable' | 'error';

export interface AudioVolumes {
  /** slider values 0..1, a perceptual taper is applied here */
  master: number;
  effects: number;
  ui: number;
}

export interface SfxOptions {
  volume?: number;
  pitch?: number;
  intensity?: number;
  variant?: number;
  delay?: number;
}

export interface PositionalOptions extends SfxOptions {
  refDistance?: number;
  rolloff?: number;
}

export interface SampleOptions {
  bus?: AudioBus;
  volume?: number;
  delay?: number;
  /** start offset into the sample, seconds */
  offset?: number;
  /** play only this long, seconds */
  duration?: number;
  playbackRate?: number;
  fadeIn?: number;
  fadeOut?: number;
  position?: Vec3Like;
  refDistance?: number;
  rolloff?: number;
  /** extra room send on top of the distance based one */
  reverb?: number;
}

export interface SoundHandle {
  /** context time when the sound is done */
  readonly endTime: number;
  stop(fadeSec?: number): void;
}

export interface AudioEngineOptions {
  createContext?: () => AudioContext | null;
  fetchArrayBuffer?: (url: string) => Promise<ArrayBuffer>;
  random?: () => number;
  now?: () => number;
}

interface ActiveVoice {
  handle: SoundHandle;
  /** nodes to disconnect once the voice is over */
  nodes: AudioNode[];
  endTime: number;
}

type AudioContextConstructor = new (options?: AudioContextOptions) => AudioContext;

const GESTURE_EVENTS = ['pointerdown', 'mousedown', 'keydown', 'touchend'] as const;
const DEFAULT_VOLUMES: AudioVolumes = { master: 0.8, effects: 1, ui: 0.7 };

export class AudioEngine {
  private context: AudioContext | null = null;
  private failure: 'unavailable' | 'error' | null = null;
  private warnedUnavailable = false;
  private master: GainNode | null = null;
  private effectsBus: GainNode | null = null;
  private uiBus: GainNode | null = null;
  private reverbIn: GainNode | null = null;
  private volumes: AudioVolumes = { ...DEFAULT_VOLUMES };
  private readonly listenerPosition: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly listenerForward: Vec3 = { x: 0, y: 0, z: -1 };
  private readonly listenerUp: Vec3 = { x: 0, y: 1, z: 0 };
  private readonly voices = new Map<string, ActiveVoice[]>();
  private readonly lastPlayedAtMs = new Map<string, number>();
  private readonly sampleBytes = new Map<string, Promise<ArrayBuffer | null>>();
  private readonly sampleBuffers = new Map<string, AudioBuffer>();
  private readonly sampleDecodes = new Map<string, Promise<AudioBuffer | null>>();
  private readonly createContextImpl: () => AudioContext | null;
  private readonly fetchArrayBuffer: (url: string) => Promise<ArrayBuffer>;
  private readonly random: () => number;
  private readonly nowMs: () => number;
  private removeGestureListeners: (() => void) | null = null;

  constructor(options: AudioEngineOptions = {}) {
    this.createContextImpl = options.createContext ?? createBrowserContext;
    this.fetchArrayBuffer = options.fetchArrayBuffer ?? defaultFetch;
    this.random = options.random ?? Math.random;
    this.nowMs = options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  }

  get status(): AudioEngineStatus {
    if (this.failure) {
      return this.failure;
    }
    if (!this.context) {
      return 'suspended';
    }
    if (this.context.state === 'running') {
      return 'running';
    }
    return this.context.state === 'closed' ? 'error' : 'suspended';
  }

  /** the shared context, or null before the first gesture */
  getContext(): AudioContext | null {
    return this.context;
  }

  currentTime(): number {
    return this.context?.currentTime ?? 0;
  }

  /** bus input node, for routing custom sources through the volume settings */
  getBus(bus: AudioBus | 'master'): AudioNode | null {
    if (bus === 'master') {
      return this.master;
    }
    return bus === 'ui' ? this.uiBus : this.effectsBus;
  }

  /**
   * Creates or resumes the context. Call it from inside a user gesture
   * handler (click, key) so the browser lets audio start.
   */
  unlock(): void {
    const context = this.ensureContext();
    if (context && context.state === 'suspended') {
      void context.resume().catch(() => undefined);
    }
  }

  async resume(): Promise<AudioEngineStatus> {
    const context = this.ensureContext();
    if (!context) {
      return this.failure ?? 'unavailable';
    }
    if (context.state === 'closed') {
      console.warn('[Audio] Audio context is closed; sound is unavailable.');
      return 'error';
    }
    if (context.state !== 'running') {
      try {
        await context.resume();
      } catch (error) {
        console.warn('[Audio] Audio context could not resume after a user gesture.', error);
        return 'error';
      }
    }
    return (context as { readonly state: AudioContextState }).state === 'running' ? 'running' : 'suspended';
  }

  /**
   * Unlocks audio on the first click or key press anywhere, so menu sounds
   * work before Play. Returns a function that removes the listeners.
   */
  installGestureUnlock(target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> = window): () => void {
    this.removeGestureListeners?.();
    const onGesture = (): void => {
      this.unlock();
      if (this.status === 'running' || this.status === 'unavailable' || this.status === 'error') {
        remove();
      }
    };
    const remove = (): void => {
      for (const type of GESTURE_EVENTS) {
        target.removeEventListener(type, onGesture, true);
      }
      if (this.removeGestureListeners === remove) {
        this.removeGestureListeners = null;
      }
    };
    for (const type of GESTURE_EVENTS) {
      target.addEventListener(type, onGesture, true);
    }
    this.removeGestureListeners = remove;
    return remove;
  }

  setVolumes(volumes: Partial<AudioVolumes>): void {
    this.volumes = { ...this.volumes, ...volumes };
    this.applyVolumes(0.03);
  }

  getVolumes(): AudioVolumes {
    return { ...this.volumes };
  }

  /** camera position and orientation, call once per frame */
  setListener(position: Vec3Like, forward: Vec3Like, up: Vec3Like = [0, 1, 0]): void {
    Object.assign(this.listenerPosition, toVec3(position));
    Object.assign(this.listenerForward, toVec3(forward));
    Object.assign(this.listenerUp, toVec3(up));
    const context = this.context;
    if (context && context.state === 'running') {
      writeListener(context.listener, this.listenerPosition, this.listenerForward, this.listenerUp);
    }
    this.sweepVoices();
  }

  getListenerPosition(): Vec3 {
    return { ...this.listenerPosition };
  }

  play(name: SfxName, options: SfxOptions = {}): SoundHandle | null {
    return this.startSfx(name, options, null);
  }

  playAt(name: SfxName, position: Vec3Like, options: PositionalOptions = {}): SoundHandle | null {
    return this.startSfx(name, options, toVec3(position), options.refDistance, options.rolloff);
  }

  /** stops every live voice of one sound */
  stopAll(name?: SfxName, fadeSec = 0.03): void {
    for (const [key, list] of this.voices) {
      if (name && key !== name) {
        continue;
      }
      for (const voice of list) {
        voice.handle.stop(fadeSec);
      }
    }
  }

  /** fetch now, decode as soon as a context exists */
  loadSample(url: string): Promise<AudioBuffer | null> {
    const ready = this.sampleBuffers.get(url);
    if (ready) {
      return Promise.resolve(ready);
    }
    if (!this.sampleBytes.has(url)) {
      this.sampleBytes.set(
        url,
        this.fetchArrayBuffer(url).catch((error) => {
          console.warn(`[Audio] Sample ${url} could not be fetched.`, error);
          return null;
        }),
      );
    }
    const context = this.context;
    if (!context) {
      return this.sampleBytes.get(url)!.then(() => this.sampleBuffers.get(url) ?? null);
    }
    return this.decodeSample(context, url);
  }

  getSample(url: string): AudioBuffer | null {
    return this.sampleBuffers.get(url) ?? null;
  }

  playSample(url: string, options: SampleOptions = {}): SoundHandle | null {
    const context = this.readyContext();
    const buffer = this.sampleBuffers.get(url);
    if (!context || !buffer) {
      if (!buffer) {
        void this.loadSample(url);
      }
      return null;
    }
    const volume = options.volume ?? 1;
    if (!(volume > 0)) {
      return null;
    }
    const start = context.currentTime + 0.002 + Math.max(0, options.delay ?? 0);
    const offset = Math.max(0, Math.min(buffer.duration, options.offset ?? 0));
    const rate = options.playbackRate ?? 1;
    const available = (buffer.duration - offset) / rate;
    const duration = Math.max(0.005, Math.min(options.duration ?? available, available));
    const end = start + duration;
    const fadeIn = Math.max(0, Math.min(options.fadeIn ?? 0, duration / 2));
    const fadeOut = Math.max(0, Math.min(options.fadeOut ?? 0, duration / 2));

    const src = context.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const out = context.createGain();
    if (fadeIn > 0) {
      out.gain.setValueAtTime(0, start);
      out.gain.linearRampToValueAtTime(volume, start + fadeIn);
    } else {
      out.gain.setValueAtTime(volume, start);
    }
    if (fadeOut > 0) {
      out.gain.setValueAtTime(volume, end - fadeOut);
      out.gain.linearRampToValueAtTime(0, end);
    }
    src.connect(out);
    const bus = options.bus === 'ui' ? this.uiBus! : this.effectsBus!;
    let reverbAmount = options.reverb ?? 0;
    const nodes: AudioNode[] = [out];
    if (options.position) {
      const chain = this.positionalChain(
        context,
        toVec3(options.position),
        options.refDistance ?? 10,
        options.rolloff ?? 1,
      );
      out.connect(chain.input);
      chain.output.connect(bus);
      nodes.push(chain.output);
      reverbAmount += reverbSendForDistance(chain.distance);
    } else {
      out.connect(bus);
    }
    if (reverbAmount > 0 && this.reverbIn && options.bus !== 'ui') {
      const send = context.createGain();
      send.gain.value = reverbAmount;
      out.connect(send).connect(this.reverbIn);
    }
    src.start(start, offset, duration * rate);
    src.stop(end + 0.01);
    const handle = makeHandle(context, out, [src], end);
    this.track(`sample:${url}`, handle, nodes, 8);
    return handle;
  }

  dispose(): void {
    this.removeGestureListeners?.();
    this.stopAll(undefined, 0.01);
    this.voices.clear();
    const context = this.context;
    this.context = null;
    this.master = null;
    this.effectsBus = null;
    this.uiBus = null;
    this.reverbIn = null;
    this.sampleBuffers.clear();
    this.sampleDecodes.clear();
    if (context && context.state !== 'closed') {
      void context.close().catch(() => undefined);
    }
  }

  private startSfx(
    name: SfxName,
    options: SfxOptions,
    position: Vec3 | null,
    refDistance?: number,
    rolloff?: number,
  ): SoundHandle | null {
    const recipe: SfxRecipe | undefined = SFX[name];
    if (!recipe) {
      return null;
    }
    const context = this.readyContext();
    if (!context) {
      return null;
    }
    const nowMs = this.nowMs();
    if (recipe.minIntervalMs) {
      const last = this.lastPlayedAtMs.get(name);
      if (last !== undefined && nowMs - last < recipe.minIntervalMs) {
        return null;
      }
    }
    const gain = (options.volume ?? 1) * recipe.gain * (recipe.gainSpread ? vary(1, recipe.gainSpread, this.random) : 1);
    if (!(gain > 0)) {
      return null;
    }
    this.lastPlayedAtMs.set(name, nowMs);

    const t = context.currentTime + 0.002 + Math.max(0, options.delay ?? 0);
    const out = context.createGain();
    out.gain.value = gain;
    const bus = recipe.bus === 'ui' ? this.uiBus! : this.effectsBus!;
    const reverb = recipe.bus === 'ui' ? null : this.reverbIn;
    const nodes: AudioNode[] = [out];
    if (position) {
      const chain = this.positionalChain(
        context,
        position,
        refDistance ?? recipe.refDistance ?? 4,
        rolloff ?? recipe.rolloff ?? 1,
      );
      out.connect(chain.input);
      chain.output.connect(bus);
      nodes.push(chain.output);
      if (reverb) {
        const send = context.createGain();
        send.gain.value = reverbSendForDistance(chain.distance);
        out.connect(send).connect(reverb);
      }
    } else {
      out.connect(bus);
    }

    const pitch = Math.max(0.05, (options.pitch ?? 1) * (recipe.pitchSpread ? vary(1, recipe.pitchSpread, this.random) : 1));
    const voice = createVoice(context, out, t, {
      pitch,
      intensity: Math.max(0, Math.min(1, options.intensity ?? 1)),
      variant: options.variant ?? 0,
      reverb,
      rand: this.random,
    });
    recipe.build(voice);
    const handle = makeHandle(context, out, voice.sources, voice.end);
    this.track(name, handle, nodes, recipe.maxVoices ?? 6);
    return handle;
  }

  private positionalChain(
    context: AudioContext,
    position: Vec3,
    refDistance: number,
    rolloff: number,
  ): { input: AudioNode; output: AudioNode; distance: number } {
    const distance = distance3(position, this.listenerPosition);
    const attenuation = context.createGain();
    attenuation.gain.value = distanceGain(distance, refDistance, rolloff);
    const air = context.createBiquadFilter();
    air.type = 'lowpass';
    air.frequency.value = Math.min(context.sampleRate * 0.45, airAbsorptionHz(distance));
    air.Q.value = 0.5;
    const panner = context.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1;
    // distance attenuation is done above, the panner only places the sound
    panner.rolloffFactor = 0;
    writePannerPosition(panner, position);
    attenuation.connect(air).connect(panner);
    return { input: attenuation, output: panner, distance };
  }

  private track(key: string, handle: SoundHandle, nodes: AudioNode[], maxVoices: number): void {
    this.sweepVoices();
    let list = this.voices.get(key);
    if (!list) {
      list = [];
      this.voices.set(key, list);
    }
    list.push({ handle, nodes, endTime: handle.endTime });
    while (list.length > Math.max(1, maxVoices)) {
      const oldest = list.shift();
      oldest?.handle.stop(0.015);
    }
  }

  private sweepVoices(): void {
    const context = this.context;
    if (!context) {
      return;
    }
    const cutoff = context.currentTime - 0.1;
    for (const [key, list] of this.voices) {
      const alive = list.filter((voice) => {
        if (voice.endTime >= cutoff) {
          return true;
        }
        for (const node of voice.nodes) {
          try {
            node.disconnect();
          } catch {
            // already disconnected
          }
        }
        return false;
      });
      if (alive.length === 0) {
        this.voices.delete(key);
      } else if (alive.length !== list.length) {
        this.voices.set(key, alive);
      }
    }
  }

  private readyContext(): AudioContext | null {
    const context = this.context;
    if (!context || context.state !== 'running' || !this.effectsBus || !this.uiBus) {
      return null;
    }
    return context;
  }

  private ensureContext(): AudioContext | null {
    if (this.context) {
      return this.context;
    }
    if (this.failure) {
      return null;
    }
    let context: AudioContext | null;
    try {
      context = this.createContextImpl();
    } catch (error) {
      this.failure = 'error';
      console.warn('[Audio] Audio context could not be created.', error);
      return null;
    }
    if (!context) {
      this.failure = 'unavailable';
      if (!this.warnedUnavailable) {
        this.warnedUnavailable = true;
        console.warn('[Audio] Web Audio is unavailable; the game will run without sound.');
      }
      return null;
    }
    this.context = context;
    this.buildGraph(context);
    for (const url of this.sampleBytes.keys()) {
      void this.decodeSample(context, url);
    }
    return context;
  }

  private buildGraph(context: AudioContext): void {
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 8;
    limiter.ratio.value = 10;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    limiter.connect(context.destination);

    this.master = context.createGain();
    this.master.connect(limiter);
    this.effectsBus = context.createGain();
    this.effectsBus.connect(this.master);
    this.uiBus = context.createGain();
    this.uiBus.connect(this.master);

    // small shared room, fed by world sounds, returned into the effects bus
    const convolver = context.createConvolver();
    convolver.buffer = roomImpulse(context);
    const wet = context.createGain();
    wet.gain.value = 0.55;
    this.reverbIn = context.createGain();
    this.reverbIn.connect(convolver).connect(wet).connect(this.effectsBus);
    this.applyVolumes(0);
  }

  private applyVolumes(smoothingSec: number): void {
    const context = this.context;
    if (!context || !this.master || !this.effectsBus || !this.uiBus) {
      return;
    }
    const now = context.currentTime;
    setParam(this.master.gain, volumeToGain(this.volumes.master), now, smoothingSec);
    setParam(this.effectsBus.gain, volumeToGain(this.volumes.effects), now, smoothingSec);
    setParam(this.uiBus.gain, volumeToGain(this.volumes.ui), now, smoothingSec);
  }

  private decodeSample(context: AudioContext, url: string): Promise<AudioBuffer | null> {
    const existing = this.sampleDecodes.get(url);
    if (existing) {
      return existing;
    }
    const bytes = this.sampleBytes.get(url) ?? Promise.resolve(null);
    const decode = bytes.then(async (data) => {
      if (!data) {
        return null;
      }
      try {
        // decodeAudioData detaches its input, keep the fetched copy intact
        const buffer = await context.decodeAudioData(data.slice(0));
        if (this.context === context) {
          this.sampleBuffers.set(url, buffer);
        }
        return buffer;
      } catch (error) {
        console.warn(`[Audio] Sample ${url} could not be decoded.`, error);
        return null;
      }
    });
    this.sampleDecodes.set(url, decode);
    return decode;
  }
}

let shared: AudioEngine | null = null;

/** the page-wide engine every sound goes through */
export function getAudioEngine(): AudioEngine {
  if (!shared) {
    shared = new AudioEngine();
  }
  return shared;
}

function makeHandle(
  context: BaseAudioContext,
  out: GainNode,
  sources: readonly AudioScheduledSourceNode[],
  endTime: number,
): SoundHandle {
  let stopped = false;
  return {
    endTime,
    stop(fadeSec = 0.02): void {
      if (stopped) {
        return;
      }
      stopped = true;
      const now = context.currentTime;
      const fade = Math.max(0.002, fadeSec);
      out.gain.cancelScheduledValues(now);
      out.gain.setValueAtTime(out.gain.value, now);
      out.gain.linearRampToValueAtTime(0, now + fade);
      for (const source of sources) {
        try {
          source.stop(now + fade + 0.005);
        } catch {
          // already stopped
        }
      }
    },
  };
}

function setParam(param: AudioParam, value: number, now: number, smoothingSec: number): void {
  if (smoothingSec <= 0) {
    param.cancelScheduledValues(now);
    param.setValueAtTime(value, now);
    return;
  }
  param.cancelScheduledValues(now);
  param.setTargetAtTime(value, now, smoothingSec);
}

function writeListener(listener: AudioListener, position: Vec3, forward: Vec3, up: Vec3): void {
  if (listener.positionX) {
    listener.positionX.value = position.x;
    listener.positionY.value = position.y;
    listener.positionZ.value = position.z;
    listener.forwardX.value = forward.x;
    listener.forwardY.value = forward.y;
    listener.forwardZ.value = forward.z;
    listener.upX.value = up.x;
    listener.upY.value = up.y;
    listener.upZ.value = up.z;
    return;
  }
  // firefox still only has the old setters
  const legacy = listener as AudioListener & {
    setPosition?: (x: number, y: number, z: number) => void;
    setOrientation?: (x: number, y: number, z: number, ux: number, uy: number, uz: number) => void;
  };
  legacy.setPosition?.(position.x, position.y, position.z);
  legacy.setOrientation?.(forward.x, forward.y, forward.z, up.x, up.y, up.z);
}

function writePannerPosition(panner: PannerNode, position: Vec3): void {
  if (panner.positionX) {
    panner.positionX.value = position.x;
    panner.positionY.value = position.y;
    panner.positionZ.value = position.z;
    return;
  }
  (panner as PannerNode & { setPosition?: (x: number, y: number, z: number) => void })
    .setPosition?.(position.x, position.y, position.z);
}

/** stereo decaying noise, lowpassed as it decays, about 0.9 s */
function roomImpulse(context: BaseAudioContext): AudioBuffer {
  const seconds = 0.9;
  const length = Math.max(1, Math.floor(context.sampleRate * seconds));
  const impulse = context.createBuffer(2, length, context.sampleRate);
  const preDelay = Math.floor(context.sampleRate * 0.008);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);
    let smoothed = 0;
    for (let i = preDelay; i < length; i += 1) {
      const k = (i - preDelay) / (length - preDelay);
      const decay = (1 - k) ** 3.2;
      const cutoff = 0.55 - 0.45 * k;
      smoothed += cutoff * ((Math.random() * 2 - 1) - smoothed);
      data[i] = smoothed * decay;
    }
  }
  return impulse;
}

function createBrowserContext(): AudioContext | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const constructor = (
    window.AudioContext
    ?? (window as Window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext
  ) as AudioContextConstructor | undefined;
  if (!constructor) {
    return null;
  }
  return new constructor({ latencyHint: 'interactive' });
}

async function defaultFetch(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.arrayBuffer();
}
