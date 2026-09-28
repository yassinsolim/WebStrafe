import type { FirearmId as GunId } from '../combat/FirearmTiming';
import type { HitmarkerKind } from '../ui/HitmarkerFeedback';
import { vary, type Vec3Like } from './audioMath';
import { getAudioEngine, type AudioEngine, type SfxName, type SoundHandle } from './AudioEngine';

export type GunAudioStatus = 'running' | 'suspended' | 'unavailable' | 'error';

interface ReloadCue {
  offsetMs: number;
  sampleStartSec: number;
  durationMs: number;
  volume: number;
}

interface ShotSample {
  url: string;
  volume: number;
}

const SHOT_SAMPLES: Record<GunId, ShotSample> = {
  deagle: { url: '/audio/deagle_shot.mp3', volume: 0.52 },
  awp: { url: '/audio/awp_shot.mp3', volume: 0.62 },
};

const RELOAD_SAMPLES: Record<GunId, { url: string; cues: readonly ReloadCue[] }> = {
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

/** procedural bolt cycle after an awp shot, inside its 1.5 s fire interval */
export const AWP_BOLT_CYCLE: ReadonlyArray<{ sound: SfxName; delaySec: number }> = [
  { sound: 'awpBoltUp', delaySec: 0.48 },
  { sound: 'awpBoltBack', delaySec: 0.58 },
  { sound: 'awpBoltForward', delaySec: 0.8 },
  { sound: 'awpBoltDown', delaySec: 0.93 },
];

const REMOTE_SHOT_REF_DISTANCE = 14;
const REMOTE_SHOT_ROLLOFF = 0.9;

const CONFIRM_SOUND: Record<HitmarkerKind, SfxName> = {
  normal: 'hitmarker',
  headshot: 'headshot',
  kill: 'killConfirm',
};

/**
 * Firearm audio: the CC0 shot/reload recordings (see public/audio/README.md)
 * decoded into the shared engine, plus procedural confirms, dry fire and the
 * awp bolt. Local shots are 2d, remote shots are positional.
 */
export class GunAudio {
  /** turn off if the viewmodel starts driving bolt sounds from animation events */
  public boltCycleEnabled = true;
  private readonly mechanicalCues = new Set<SoundHandle>();
  private preloaded = false;

  constructor(private readonly engine: AudioEngine = getAudioEngine()) {}

  public async resume(): Promise<GunAudioStatus> {
    const status = await this.engine.resume();
    this.preload();
    return status;
  }

  /** starts fetching and decoding the recordings */
  public preload(): void {
    if (this.preloaded) {
      return;
    }
    this.preloaded = true;
    for (const sample of Object.values(SHOT_SAMPLES)) {
      void this.engine.loadSample(sample.url);
    }
    for (const sample of Object.values(RELOAD_SAMPLES)) {
      void this.engine.loadSample(sample.url);
    }
  }

  /** local player's shot, non-positional */
  public shot(weaponId: GunId): void {
    this.preload();
    const sample = SHOT_SAMPLES[weaponId];
    this.engine.playSample(sample.url, {
      volume: sample.volume,
      playbackRate: vary(1, 0.015, Math.random),
    });
    if (weaponId === 'awp' && this.boltCycleEnabled) {
      this.scheduleBoltCycle();
    }
  }

  /** someone else's shot, placed in the world */
  public shotAt(weaponId: GunId, position: Vec3Like): void {
    this.preload();
    const sample = SHOT_SAMPLES[weaponId];
    this.engine.playSample(sample.url, {
      volume: sample.volume,
      position,
      refDistance: REMOTE_SHOT_REF_DISTANCE,
      rolloff: REMOTE_SHOT_ROLLOFF,
      playbackRate: vary(1, 0.02, Math.random),
    });
  }

  public reload(weaponId: GunId): void {
    this.stopReload();
    this.preload();
    const config = RELOAD_SAMPLES[weaponId];
    for (const cue of config.cues) {
      const handle = this.engine.playSample(config.url, {
        delay: cue.offsetMs / 1000,
        offset: cue.sampleStartSec,
        duration: cue.durationMs / 1000,
        volume: cue.volume,
        fadeIn: 0.004,
        fadeOut: 0.03,
      });
      if (handle) {
        this.mechanicalCues.add(handle);
      }
    }
  }

  /** cancels pending reload and bolt cues, e.g. on weapon switch */
  public stopReload(): void {
    for (const handle of this.mechanicalCues) {
      handle.stop(0.02);
    }
    this.mechanicalCues.clear();
  }

  public confirm(kind: HitmarkerKind): void {
    this.engine.play(CONFIRM_SOUND[kind]);
  }

  /** trigger pulled on an empty or reloading gun */
  public dryFire(): void {
    this.engine.play('dryFire');
  }

  public dispose(): void {
    this.stopReload();
  }

  private scheduleBoltCycle(): void {
    for (const step of AWP_BOLT_CYCLE) {
      const handle = this.engine.play(step.sound, { delay: step.delaySec });
      if (handle) {
        this.mechanicalCues.add(handle);
      }
    }
  }
}
