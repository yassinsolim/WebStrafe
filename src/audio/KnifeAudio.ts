import type { Vec3Like } from './audioMath';
import { getAudioEngine, type AudioEngine, type SfxName, type SoundHandle } from './AudioEngine';

export type KnifeSwingSoundKind = 'primary' | 'secondary';
export type KnifeSoundProfile = 'knifeGloves1' | 'knifeGloves2';

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

/**
 * Knife swing whooshes, synthesized by the shared engine (no files). Primary
 * is the quick slash, secondary the heavier stab. Profiles keep the two
 * glove/arm sets sounding slightly different.
 */
export class KnifeAudio {
  private currentProfile: KnifeSoundProfile = 'knifeGloves1';
  private readonly active = new Set<SoundHandle>();

  constructor(private readonly engine: AudioEngine = getAudioEngine()) {}

  public setProfile(profile: KnifeSoundProfile): void {
    this.currentProfile = profile;
  }

  /** `position` makes the swing positional (remote players) */
  public play(
    kind: KnifeSwingSoundKind,
    volumeScale = 1,
    profileOverride?: KnifeSoundProfile,
    position?: Vec3Like,
  ): void {
    const profile = PROFILE_CONFIG[profileOverride ?? this.currentProfile];
    const volume = Math.max(0, Math.min(1.5, profile.baseVolume * Math.max(0, volumeScale)));
    const options = { volume, variant: profile.variant };
    const handle = position
      ? this.engine.playAt(SWING_SOUND[kind], position, options)
      : this.engine.play(SWING_SOUND[kind], options);
    if (handle) {
      this.pruneFinished();
      this.active.add(handle);
    }
  }

  public stopAll(): void {
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
    for (const handle of this.active) {
      if (handle.endTime < now) {
        this.active.delete(handle);
      }
    }
  }
}
