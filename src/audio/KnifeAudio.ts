import { getKnife, type KnifeId } from '../combat/knives';
import type { Vec3Like } from './audioMath';
import { getAudioEngine, type AudioEngine, type SfxName, type SoundHandle } from './AudioEngine';

export type KnifeSwingSoundKind = 'primary' | 'secondary';
export type KnifeSoundProfile = 'knifeGloves1' | 'knifeGloves2';
export type KnifeHandlingSound = 'knifeDeploy' | 'knifeOpen' | 'knifeClose' | 'knifeFlick' | 'knifeCatch' | 'knifeCloth';
export type KnifeImpactSound = 'knifeHitFlesh' | 'knifeHitWall' | 'backstab';

interface ProfileConfig {
  baseVolume: number;
  /** recipe variant, shifts the whoosh pitch a little */
  variant: number;
}

const PROFILE_CONFIG: Record<KnifeSoundProfile, ProfileConfig> = {
  knifeGloves1: { baseVolume: 1, variant: 0 },
  knifeGloves2: { baseVolume: 0.94, variant: 1 },
};

const SWING_SOUND: Record<KnifeSwingSoundKind, SfxName> = {
  primary: 'knifeSwing',
  secondary: 'knifeStab',
};

const SWING_SAMPLES: Record<KnifeSwingSoundKind, { urls: readonly string[]; volume: number; peakAt: number; synthPeakAt: number }> = {
  primary: {
    urls: ['/audio/knife/slash-1.mp3', '/audio/knife/slash-2.mp3', '/audio/knife/slash-3.mp3'],
    volume: 0.55,
    peakAt: 0.07,
    synthPeakAt: 0.105,
  },
  secondary: {
    urls: ['/audio/knife/stab-1.mp3', '/audio/knife/stab-2.mp3', '/audio/knife/stab-3.mp3'],
    volume: 0.7,
    peakAt: 0.09,
    synthPeakAt: 0.13,
  },
};

const sampleUrls = (name: string, count: number): string[] =>
  Array.from({ length: count }, (_, index) => `/audio/knife/${name}-${index + 1}.mp3`);

const FOLEY_SAMPLES = {
  fixedDraw: sampleUrls('draw-fixed', 2),
  ringDraw: sampleUrls('draw-ring', 2),
  folderOpen: sampleUrls('open', 3),
  switchOpen: ['/audio/knife/switch-open.mp3'],
  balisong: sampleUrls('balisong', 3),
  close: ['/audio/knife/close.mp3'],
  cloth: sampleUrls('cloth', 2),
  catch: sampleUrls('catch', 2),
  flick: sampleUrls('flick', 3),
  flesh: sampleUrls('flesh', 3),
  wall: sampleUrls('wall', 3),
  withdraw: ['/audio/knife/withdraw.mp3'],
};
type FoleyGroup = keyof typeof FOLEY_SAMPLES;

export class KnifeAudio {
  private currentProfile: KnifeSoundProfile = 'knifeGloves1';
  private readonly active = new Set<SoundHandle>();
  private readonly handling = new Set<SoundHandle>();
  private readonly foleyTake = new Map<FoleyGroup, number>();
  private readonly nextTake: Record<KnifeSwingSoundKind, number> = { primary: 0, secondary: 0 };
  private preloaded = false;

  constructor(private readonly engine: AudioEngine = getAudioEngine()) {}

  public preload(): void {
    if (this.preloaded) return;
    this.preloaded = true;
    const urls = new Set([
      ...Object.values(SWING_SAMPLES).flatMap(sample => sample.urls),
      ...Object.values(FOLEY_SAMPLES).flat(),
    ]);
    for (const url of urls) void this.engine.loadSample(url);
  }

  public setProfile(profile: KnifeSoundProfile): void {
    this.currentProfile = profile;
  }

  /** `position` makes the swing positional (remote players) */
  public play(
    kind: KnifeSwingSoundKind,
    volumeScale = 1,
    profileOverride?: KnifeSoundProfile,
    position?: Vec3Like,
    contactTime = kind === 'primary' ? 0.1 : 0.13,
  ): void {
    this.stopHandling();
    this.preload();
    const profile = PROFILE_CONFIG[profileOverride ?? this.currentProfile];
    const volume = Math.max(0, Math.min(1.5, profile.baseVolume * Math.max(0, volumeScale)));
    const sample = SWING_SAMPLES[kind];
    const url = sample.urls[this.nextTake[kind]];
    this.nextTake[kind] = (this.nextTake[kind] + 1) % sample.urls.length;
    const playbackRate = profile.variant === 1 ? 0.97 : 1;
    const recorded = this.engine.playSample(url, {
      volume: volume * sample.volume,
      playbackRate,
      delay: Math.max(0, contactTime - sample.peakAt / playbackRate),
      ...(position ? { position, refDistance: 3, rolloff: 1 } : {}),
      fadeIn: 0.002,
      fadeOut: 0.015,
    });
    const delay = Math.max(0, contactTime - sample.synthPeakAt);
    const options = { volume, variant: profile.variant, ...(delay > 0 ? { delay } : {}) };
    const handle = recorded ?? (position
      ? this.engine.playAt(SWING_SOUND[kind], position, options)
      : this.engine.play(SWING_SOUND[kind], options));
    if (handle) {
      this.pruneFinished();
      this.active.add(handle);
    }
  }

  public playHandling(name: KnifeHandlingSound, knifeId: KnifeId): void {
    if (name === 'knifeDeploy') this.stopHandling();
    this.preload();
    this.pruneFinished();
    const def = getKnife(knifeId);
    const mechanism = def.shape.mechanism ?? 'fixed';
    let group: FoleyGroup;
    switch (name) {
      case 'knifeDeploy':
        group = def.shape.pair || def.shape.fingerRing ? 'ringDraw' : mechanism === 'fixed' ? 'fixedDraw' : 'cloth';
        break;
      case 'knifeOpen':
        group = mechanism === 'balisong' ? 'balisong' : def.id === 'stiletto' ? 'switchOpen' : 'folderOpen';
        break;
      case 'knifeClose':
        group = mechanism === 'balisong' ? 'balisong' : 'close';
        break;
      case 'knifeFlick':
        group = 'flick';
        break;
      case 'knifeCatch':
        group = 'catch';
        break;
      case 'knifeCloth':
        group = 'cloth';
        break;
    }
    const recorded = this.playFoley(group);
    if (recorded) {
      this.trackHandling(recorded);
      if (name === 'knifeDeploy') {
        if (group !== 'cloth') this.trackHandling(this.playFoley('cloth', 0.6));
        if (def.shape.pair) this.trackHandling(this.playFoley('ringDraw', 0.8, undefined, 0.06));
        if (mechanism === 'balisong') this.trackHandling(this.playFoley('balisong', 0.32, undefined, 0.035));
      } else if (name === 'knifeCatch') {
        this.trackHandling(this.playFoley('cloth', 0.5));
      }
      return;
    }
    const fallback = name === 'knifeClose' ? 'knifeOpen' : name === 'knifeCloth' ? 'knifeCatch' : name;
    const variant = name === 'knifeDeploy'
      ? def.shape.pair ? 4 : def.shape.fingerRing ? 3 : mechanism === 'balisong' ? 2 : mechanism === 'folder' ? 1 : 0
      : mechanism === 'balisong' ? 1 : 0;
    const volume = name === 'knifeCloth' ? 0.25 : name === 'knifeClose' ? 0.6 : 1;
    this.trackHandling(this.engine.play(fallback, { variant, volume }));
  }

  public playImpact(name: KnifeImpactSound, volume = 1, position?: Vec3Like, delay = 0): void {
    this.preload();
    const recorded = this.playFoley(name === 'knifeHitWall' ? 'wall' : 'flesh', volume, position, delay);
    if (!recorded) {
      const options = { volume, delay };
      if (position) this.engine.playAt(name, position, options);
      else this.engine.play(name, options);
      return;
    }
    if (name === 'backstab') {
      this.playFoley('flesh', volume * 0.45, position, delay + 0.18);
      this.playFoley('withdraw', volume * 0.7, position, delay + 0.35);
    }
  }

  public stopHandling(): void {
    for (const handle of this.handling) handle.stop(0.015);
    this.handling.clear();
  }

  public stopAll(): void {
    this.stopHandling();
    for (const handle of this.active) {
      handle.stop(0.03);
    }
    this.active.clear();
  }

  public dispose(): void {
    this.stopAll();
  }

  private pruneFinished(): void {
    const now = this.engine.currentTime();
    for (const handles of [this.active, this.handling]) {
      for (const handle of handles) {
        if (handle.endTime < now) handles.delete(handle);
      }
    }
  }

  private playFoley(group: FoleyGroup, volume = 1, position?: Vec3Like, delay = 0): SoundHandle | null {
    const samples = FOLEY_SAMPLES[group];
    const index = this.foleyTake.get(group) ?? 0;
    this.foleyTake.set(group, (index + 1) % samples.length);
    return this.engine.playSample(samples[index], {
      volume: Math.max(0, Math.min(1.5, volume)),
      delay,
      fadeIn: 0.001,
      fadeOut: 0.012,
      ...(position ? { position, refDistance: 4, rolloff: 1 } : {}),
    });
  }

  private trackHandling(handle: SoundHandle | null): void {
    if (handle) this.handling.add(handle);
  }
}
