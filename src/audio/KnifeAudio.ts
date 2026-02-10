export type KnifeSwingSoundKind = 'primary' | 'secondary';

export class KnifeAudio {
  private readonly primaryBaseVolume = 0.46;
  private readonly secondaryBaseVolume = 0.46;
  private readonly primaryPool: HTMLAudioElement[];
  private readonly secondaryPool: HTMLAudioElement[];
  private primaryIndex = 0;
  private secondaryIndex = 0;

  constructor() {
    this.primaryPool = this.createPool('/audio/knife_swing_1.ogg', 4, this.primaryBaseVolume);
    this.secondaryPool = this.createPool('/audio/knife_swing_2.ogg', 4, this.secondaryBaseVolume);
  }

  public play(kind: KnifeSwingSoundKind, volumeScale = 1): void {
    if (kind === 'primary') {
      this.playFromPool(this.primaryPool, 'primary', volumeScale);
      return;
    }
    this.playFromPool(this.secondaryPool, 'secondary', volumeScale);
  }

  private createPool(path: string, size: number, volume: number): HTMLAudioElement[] {
    const pool: HTMLAudioElement[] = [];
    for (let i = 0; i < size; i += 1) {
      const audio = new Audio(path);
      audio.preload = 'auto';
      audio.volume = volume;
      pool.push(audio);
    }
    return pool;
  }

  private playFromPool(
    pool: HTMLAudioElement[],
    lane: 'primary' | 'secondary',
    volumeScale: number,
  ): void {
    const index = lane === 'primary' ? this.primaryIndex : this.secondaryIndex;
    const audio = pool[index % pool.length];
    if (lane === 'primary') {
      this.primaryIndex = (index + 1) % pool.length;
    } else {
      this.secondaryIndex = (index + 1) % pool.length;
    }

    const baseVolume = lane === 'primary' ? this.primaryBaseVolume : this.secondaryBaseVolume;
    const clampedVolume = Math.max(0, Math.min(1, baseVolume * Math.max(0, volumeScale)));
    audio.volume = clampedVolume;
    audio.currentTime = 0;
    audio.playbackRate = 0.95 + Math.random() * 0.13;
    void audio.play().catch(() => {
      // Ignore autoplay/user-gesture restrictions; next input usually succeeds.
    });
  }
}
