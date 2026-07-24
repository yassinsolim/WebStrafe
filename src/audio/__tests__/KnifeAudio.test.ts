import { afterEach, describe, expect, it, vi } from 'vitest';
import { KnifeAudio } from '../KnifeAudio';

class FakeAudio {
  public static instances: FakeAudio[] = [];
  public preload = '';
  public volume = 1;
  public currentTime = 0;
  public playbackRate = 1;
  public readonly play = vi.fn(async () => undefined);
  public readonly pause = vi.fn();

  constructor(public readonly src: string) {
    FakeAudio.instances.push(this);
  }
}

afterEach(() => {
  FakeAudio.instances = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('KnifeAudio presentation', () => {
  it('plays both profiles quietly with narrow, softened pitch variation', () => {
    vi.stubGlobal('Audio', FakeAudio);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const audio = new KnifeAudio();

    audio.play('primary');
    audio.play('secondary', 1, 'knifeGloves2');

    const firstProfile = FakeAudio.instances.find((entry) => entry.src.endsWith('knife1_primary_1.ogg'));
    const secondProfile = FakeAudio.instances.find((entry) => entry.src.endsWith('knife2_secondary_1.ogg'));
    expect(firstProfile).toMatchObject({ volume: 0.32, currentTime: 0, playbackRate: 0.92 });
    expect(secondProfile).toMatchObject({ volume: 0.3, currentTime: 0, playbackRate: 0.92 });
    expect(firstProfile?.play).toHaveBeenCalledOnce();
    expect(secondProfile?.play).toHaveBeenCalledOnce();
  });
});
