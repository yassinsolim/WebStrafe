export type KnifeSwingSoundKind = 'primary' | 'secondary';
export type KnifeSoundProfile = 'knifeGloves1' | 'knifeGloves2';

interface AudioLaneConfig {
  primary: string[];
  secondary: string[];
  baseVolume: number;
}

const SOUND_CONFIG: Record<KnifeSoundProfile, AudioLaneConfig> = {
  knifeGloves1: {
    primary: ['/audio/knife1_primary_1.ogg', '/audio/knife1_primary_2.ogg'],
    secondary: ['/audio/knife1_secondary_1.ogg', '/audio/knife1_secondary_2.ogg'],
    baseVolume: 0.5,
  },
  knifeGloves2: {
    primary: ['/audio/knife2_primary_1.ogg', '/audio/knife2_primary_2.ogg'],
    secondary: ['/audio/knife2_secondary_1.ogg', '/audio/knife2_secondary_2.ogg'],
    baseVolume: 0.48,
  },
};

interface ProfilePool {
  primary: HTMLAudioElement[];
  secondary: HTMLAudioElement[];
  primaryIndex: number;
  secondaryIndex: number;
}

export class KnifeAudio {
  private readonly pools: Record<KnifeSoundProfile, ProfilePool>;
  private currentProfile: KnifeSoundProfile = 'knifeGloves1';

  constructor() {
    this.pools = {
      knifeGloves1: this.createProfilePool('knifeGloves1'),
      knifeGloves2: this.createProfilePool('knifeGloves2'),
    };
  }

  public setProfile(profile: KnifeSoundProfile): void {
    this.currentProfile = profile;
  }

  public play(kind: KnifeSwingSoundKind, volumeScale = 1, profileOverride?: KnifeSoundProfile): void {
    const profile = profileOverride ?? this.currentProfile;
    const pool = this.pools[profile];
    const lane = kind === 'primary' ? 'primary' : 'secondary';

    const index = lane === 'primary' ? pool.primaryIndex : pool.secondaryIndex;
    const collection = lane === 'primary' ? pool.primary : pool.secondary;
    const audio = collection[index % collection.length];

    if (lane === 'primary') {
      pool.primaryIndex = (index + 1) % collection.length;
    } else {
      pool.secondaryIndex = (index + 1) % collection.length;
    }

    const baseVolume = SOUND_CONFIG[profile].baseVolume;
    const clampedVolume = Math.max(0, Math.min(1, baseVolume * Math.max(0, volumeScale)));
    audio.volume = clampedVolume;
    audio.currentTime = 0;
    audio.playbackRate = 0.95 + Math.random() * 0.12;
    void audio.play().catch(() => {
      // Ignore autoplay/user-gesture restrictions; next user input usually succeeds.
    });
  }

  private createProfilePool(profile: KnifeSoundProfile): ProfilePool {
    const config = SOUND_CONFIG[profile];
    return {
      primary: config.primary.map((path) => this.createAudio(path, config.baseVolume)),
      secondary: config.secondary.map((path) => this.createAudio(path, config.baseVolume)),
      primaryIndex: 0,
      secondaryIndex: 0,
    };
  }

  private createAudio(path: string, volume: number): HTMLAudioElement {
    const audio = new Audio(path);
    audio.preload = 'auto';
    audio.volume = volume;
    return audio;
  }
}
