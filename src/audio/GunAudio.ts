import type { GunId } from '../cosmetics/WeaponViewmodels';
import type { HitmarkerKind } from '../ui/HitmarkerFeedback';

type AudioContextConstructor = new () => AudioContext;

export type GunAudioStatus = 'running' | 'suspended' | 'unavailable' | 'error';

interface ReloadCue {
  offsetMs: number;
  sampleStartSec: number;
  durationMs: number;
  volume: number;
}

interface ReloadSample {
  url: string;
  cues: readonly ReloadCue[];
}

type AudioFactory = (url: string) => HTMLAudioElement;

interface ShotSample {
  url: string;
  volume: number;
  poolSize: number;
}

const SHOT_SAMPLES: Record<GunId, ShotSample> = {
  deagle: { url: '/audio/deagle_shot.mp3', volume: 0.52, poolSize: 4 },
  awp: { url: '/audio/awp_shot.mp3', volume: 0.62, poolSize: 2 },
};

const RELOAD_SAMPLES: Record<GunId, ReloadSample> = {
  deagle: {
    url: '/audio/deagle_reload.mp3',
    cues: [
      { offsetMs: 280, sampleStartSec: 0, durationMs: 260, volume: 0.68 },
      { offsetMs: 510, sampleStartSec: 0.5, durationMs: 380, volume: 0.72 },
      { offsetMs: 1940, sampleStartSec: 1.05, durationMs: 190, volume: 0.7 },
      { offsetMs: 2620, sampleStartSec: 1.24, durationMs: 260, volume: 0.74 },
    ],
  },
  awp: {
    url: '/audio/awp_reload.mp3',
    cues: [
      { offsetMs: 350, sampleStartSec: 0, durationMs: 220, volume: 0.62 },
      { offsetMs: 830, sampleStartSec: 0.55, durationMs: 380, volume: 0.68 },
      { offsetMs: 1420, sampleStartSec: 1.25, durationMs: 380, volume: 0.66 },
      { offsetMs: 2790, sampleStartSec: 1.6, durationMs: 380, volume: 0.72 },
    ],
  },
};

/** Firearm sample playback and procedural hit-confirmation audio. */
export class GunAudio {
  private context: AudioContext | null = null;
  private warnedUnavailable = false;
  private contextFailure: Exclude<GunAudioStatus, 'running' | 'suspended'> | null = null;
  private readonly shotSamples = new Map<GunId, HTMLAudioElement[]>();
  private readonly shotSampleIndices: Record<GunId, number> = { deagle: 0, awp: 0 };
  private readonly reloadSamples = new Map<string, HTMLAudioElement>();
  private readonly reloadTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    private readonly audioFactory: AudioFactory = (url) => new Audio(url),
  ) {}

  public async resume(): Promise<GunAudioStatus> {
    const context = this.ensureContext();
    if (!context) {
      return this.contextFailure ?? 'unavailable';
    }
    if (context.state === 'running') {
      return 'running';
    }
    if (context.state === 'closed') {
      console.warn('[GunAudio] Audio context is closed; firearm feedback is unavailable.');
      return 'error';
    }
    try {
      await context.resume();
    } catch (error) {
      console.warn('[GunAudio] Audio context could not resume after user gesture.', error);
      return 'error';
    }
    const resumedState = (context as { readonly state: AudioContextState }).state;
    return resumedState === 'running' ? 'running' : 'suspended';
  }

  public shot(weaponId: GunId): void {
    const pool = this.getShotSamplePool(weaponId);
    const index = this.shotSampleIndices[weaponId] % pool.length;
    this.shotSampleIndices[weaponId] = (index + 1) % pool.length;
    const audio = pool[index];
    audio.pause();
    audio.currentTime = 0;
    void audio.play().catch((error) => {
      console.warn(`[GunAudio] ${weaponId} shot sample could not play.`, error);
    });
  }

  public reload(weaponId: GunId): void {
    this.stopReload();
    const config = RELOAD_SAMPLES[weaponId];
    for (const [cueIndex, cue] of config.cues.entries()) {
      const key = `${weaponId}:${cueIndex}`;
      const audio = this.getReloadSample(key, config.url, cue.volume);
      const startTimer = setTimeout(() => {
        this.reloadTimers.delete(startTimer);
        audio.currentTime = cue.sampleStartSec;
        void audio.play().catch((error) => {
          console.warn(`[GunAudio] ${weaponId} reload cue could not play.`, error);
        });
        const stopTimer = setTimeout(() => {
          this.reloadTimers.delete(stopTimer);
          audio.pause();
          audio.currentTime = 0;
        }, cue.durationMs);
        this.reloadTimers.add(stopTimer);
      }, cue.offsetMs);
      this.reloadTimers.add(startTimer);
    }
  }

  public stopReload(): void {
    for (const timer of this.reloadTimers) {
      clearTimeout(timer);
    }
    this.reloadTimers.clear();
    for (const audio of this.reloadSamples.values()) {
      audio.pause();
      audio.currentTime = 0;
    }
  }

  public confirm(kind: HitmarkerKind): void {
    this.run((context, now) => {
      if (kind === 'kill') {
        this.tone(context, now, 620, 0.055, 880, 'sine', 0.09);
        this.tone(context, now + 0.055, 880, 0.09, 1240, 'sine', 0.08);
      } else if (kind === 'headshot') {
        this.tone(context, now, 980, 0.07, 760, 'triangle', 0.085);
      } else {
        this.tone(context, now, 520, 0.055, 430, 'sine', 0.065);
      }
    });
  }

  public dispose(): void {
    const context = this.context;
    this.stopReload();
    for (const pool of this.shotSamples.values()) {
      for (const audio of pool) {
        audio.pause();
        audio.currentTime = 0;
      }
    }
    this.context = null;
    if (context && context.state !== 'closed') {
      void context.close().catch((error) => {
        console.warn('[GunAudio] Audio context did not close cleanly.', error);
      });
    }
  }

  private run(effect: (context: AudioContext, now: number) => void): void {
    const context = this.ensureContext();
    if (!context) {
      return;
    }
    if (context.state === 'suspended') {
      void context.resume().then(() => effect(context, context.currentTime)).catch((error) => {
        console.warn('[GunAudio] Playback blocked until a browser gesture.', error);
      });
      return;
    }
    effect(context, context.currentTime);
  }

  private getShotSamplePool(weaponId: GunId): HTMLAudioElement[] {
    const existing = this.shotSamples.get(weaponId);
    if (existing) return existing;
    const config = SHOT_SAMPLES[weaponId];
    const pool = Array.from({ length: config.poolSize }, () => {
      const audio = this.audioFactory(config.url);
      audio.preload = 'auto';
      audio.volume = config.volume;
      return audio;
    });
    this.shotSamples.set(weaponId, pool);
    return pool;
  }

  private getReloadSample(key: string, url: string, volume: number): HTMLAudioElement {
    const existing = this.reloadSamples.get(key);
    if (existing) return existing;
    const audio = this.audioFactory(url);
    audio.preload = 'auto';
    audio.volume = volume;
    audio.playbackRate = 1;
    audio.preservesPitch = true;
    this.reloadSamples.set(key, audio);
    return audio;
  }

  private ensureContext(): AudioContext | null {
    if (this.context) {
      return this.context;
    }
    const constructor = (
      window.AudioContext
      ?? (window as Window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext
    );
    if (!constructor) {
      if (!this.warnedUnavailable) {
        this.warnedUnavailable = true;
        this.contextFailure = 'unavailable';
        console.warn('[GunAudio] Web Audio is unavailable; firearm feedback will be visual only.');
      }
      return null;
    }
    try {
      this.context = new constructor();
      this.contextFailure = null;
      return this.context;
    } catch (error) {
      this.contextFailure = 'error';
      console.warn('[GunAudio] Audio context could not be created.', error);
      return null;
    }
  }

  private tone(
    context: AudioContext,
    start: number,
    startHz: number,
    duration: number,
    endHz: number,
    type: OscillatorType,
    volume: number,
  ): OscillatorNode {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(startHz, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endHz), start + duration);
    gain.gain.setValueAtTime(Math.max(0.0001, volume), start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.01);
    return oscillator;
  }

}
