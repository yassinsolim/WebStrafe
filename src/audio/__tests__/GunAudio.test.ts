import { afterEach, describe, expect, it, vi } from 'vitest';
import { GunAudio } from '../GunAudio';

interface RecordedParam {
  values: number[];
  setValueAtTime(value: number, time: number): void;
  exponentialRampToValueAtTime(value: number, time: number): void;
}

interface RecordedOscillator {
  frequency: RecordedParam;
  startTimes: number[];
  stopTimes: Array<number | undefined>;
}

interface RecordedBufferSource {
  startTimes: number[];
  stopTimes: Array<number | undefined>;
}

class FakeReloadAudio {
  public preload = '';
  public volume = 1;
  public currentTime = 0;
  public playbackRate = 1;
  public preservesPitch = false;
  public playCount = 0;
  public pauseCount = 0;

  constructor(public readonly src: string) {}

  async play(): Promise<void> {
    this.playCount += 1;
  }

  pause(): void {
    this.pauseCount += 1;
  }
}

function recordedParam(): RecordedParam {
  return {
    values: [],
    setValueAtTime(value) {
      this.values.push(value);
    },
    exponentialRampToValueAtTime(value) {
      this.values.push(value);
    },
  };
}

class FakeAudioContext {
  public state: AudioContextState = 'running';
  public currentTime = 2;
  public sampleRate = 1000;
  public readonly destination = {} as AudioDestinationNode;
  public readonly oscillators: RecordedOscillator[] = [];
  public readonly bufferSources: RecordedBufferSource[] = [];

  async resume(): Promise<void> {
    this.state = 'running';
  }

  async close(): Promise<void> {
    this.state = 'closed';
  }

  createOscillator(): OscillatorNode {
    const recorded = {
      frequency: recordedParam(),
      startTimes: [] as number[],
      stopTimes: [] as Array<number | undefined>,
    };
    this.oscillators.push(recorded);
    return {
      type: 'sine',
      frequency: recorded.frequency,
      connect: (target: AudioNode) => target,
      start: (time?: number) => recorded.startTimes.push(time ?? 0),
      stop: (time?: number) => recorded.stopTimes.push(time),
    } as unknown as OscillatorNode;
  }

  createGain(): GainNode {
    return {
      gain: recordedParam(),
      connect: (target: AudioNode) => target,
    } as unknown as GainNode;
  }

  createBuffer(_channels: number, frameCount: number): AudioBuffer {
    const samples = new Float32Array(frameCount);
    return { getChannelData: () => samples } as unknown as AudioBuffer;
  }

  createBufferSource(): AudioBufferSourceNode {
    const recorded = {
      startTimes: [] as number[],
      stopTimes: [] as Array<number | undefined>,
    };
    this.bufferSources.push(recorded);
    return {
      buffer: null,
      connect: (target: AudioNode) => target,
      start: (time?: number) => recorded.startTimes.push(time ?? 0),
      stop: (time?: number) => recorded.stopTimes.push(time),
    } as unknown as AudioBufferSourceNode;
  }

  createBiquadFilter(): BiquadFilterNode {
    return {
      type: 'lowpass',
      frequency: recordedParam(),
      connect: (target: AudioNode) => target,
    } as unknown as BiquadFilterNode;
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('GunAudio browser readiness', () => {
  it('reports running after resuming from a player gesture', async () => {
    class SuspendedContext extends FakeAudioContext {
      public override state: AudioContextState = 'suspended';
    }
    vi.stubGlobal('window', { AudioContext: SuspendedContext });

    const audio = new GunAudio();
    await expect(audio.resume()).resolves.toBe('running');
    audio.dispose();
  });

  it('surfaces unavailable Web Audio once without throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('window', {});
    const audio = new GunAudio();

    await expect(audio.resume()).resolves.toBe('unavailable');
    await expect(audio.resume()).resolves.toBe('unavailable');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('keeps Deagle and AWP shot and reload signatures distinct', () => {
    vi.useFakeTimers();
    const samples: FakeReloadAudio[] = [];
    const createAudio = (url: string): HTMLAudioElement => {
      const audio = new FakeReloadAudio(url);
      samples.push(audio);
      return audio as unknown as HTMLAudioElement;
    };

    const deagle = new GunAudio(createAudio);
    deagle.shot('deagle');
    deagle.shot('deagle');
    expect(samples).toHaveLength(4);
    expect(samples.slice(0, 4).map((audio) => ({
      src: audio.src,
      volume: audio.volume,
      preload: audio.preload,
    }))).toEqual(Array.from({ length: 4 }, () => ({
      src: '/audio/deagle_shot.mp3',
      volume: 0.52,
      preload: 'auto',
    })));
    expect(samples[0].playCount).toBe(1);
    expect(samples[1].playCount).toBe(1);

    const awp = new GunAudio(createAudio);
    awp.shot('awp');
    expect(samples.slice(4, 6).map((audio) => ({
      src: audio.src,
      volume: audio.volume,
      preload: audio.preload,
    }))).toEqual(Array.from({ length: 2 }, () => ({
      src: '/audio/awp_shot.mp3',
      volume: 0.62,
      preload: 'auto',
    })));
    expect(samples[4].playCount).toBe(1);

    const deagleReload = new GunAudio(createAudio);
    deagleReload.reload('deagle');
    expect(samples).toHaveLength(10);
    expect(samples.slice(6).map((audio) => ({
      src: audio.src,
      volume: audio.volume,
      playbackRate: audio.playbackRate,
      preload: audio.preload,
    }))).toEqual([
      { src: '/audio/deagle_reload.mp3', volume: 0.68, playbackRate: 1, preload: 'auto' },
      { src: '/audio/deagle_reload.mp3', volume: 0.72, playbackRate: 1, preload: 'auto' },
      { src: '/audio/deagle_reload.mp3', volume: 0.7, playbackRate: 1, preload: 'auto' },
      { src: '/audio/deagle_reload.mp3', volume: 0.74, playbackRate: 1, preload: 'auto' },
    ]);
    vi.advanceTimersByTime(280);
    expect(samples[6]).toMatchObject({ playCount: 1, currentTime: 0 });
    vi.advanceTimersByTime(230);
    expect(samples[7]).toMatchObject({ playCount: 1, currentTime: 0.5 });
    vi.advanceTimersByTime(1430);
    expect(samples[8]).toMatchObject({ playCount: 1, currentTime: 1.05 });
    vi.advanceTimersByTime(680);
    expect(samples[9]).toMatchObject({ playCount: 1, currentTime: 1.24 });

    const awpReload = new GunAudio(createAudio);
    awpReload.reload('awp');
    expect(samples.slice(10).map((audio) => ({
      src: audio.src,
      volume: audio.volume,
      playbackRate: audio.playbackRate,
    }))).toEqual([
      { src: '/audio/awp_reload.mp3', volume: 0.62, playbackRate: 1 },
      { src: '/audio/awp_reload.mp3', volume: 0.68, playbackRate: 1 },
      { src: '/audio/awp_reload.mp3', volume: 0.66, playbackRate: 1 },
      { src: '/audio/awp_reload.mp3', volume: 0.72, playbackRate: 1 },
    ]);
    vi.advanceTimersByTime(350);
    expect(samples[10]).toMatchObject({ playCount: 1, currentTime: 0 });
  });

  it('cancels a pending or playing reload sample on weapon switch', () => {
    vi.useFakeTimers();
    const samples: FakeReloadAudio[] = [];
    const createReloadAudio = (url: string): HTMLAudioElement => {
      const audio = new FakeReloadAudio(url);
      samples.push(audio);
      return audio as unknown as HTMLAudioElement;
    };

    const audio = new GunAudio(createReloadAudio);
    audio.reload('deagle');
    expect(samples).toHaveLength(4);
    audio.stopReload();
    vi.advanceTimersByTime(500);
    expect(samples.every((sample) => sample.playCount === 0)).toBe(true);
    expect(samples.every((sample) => sample.pauseCount === 1)).toBe(true);
    expect(samples.every((sample) => sample.currentTime === 0)).toBe(true);

    audio.reload('awp');
    expect(samples).toHaveLength(8);
    vi.advanceTimersByTime(350);
    expect(samples[4].playCount).toBe(1);
    audio.stopReload();
    expect(samples[4].pauseCount).toBe(1);
    expect(samples[4].currentTime).toBe(0);
    vi.advanceTimersByTime(3000);
    expect(samples.slice(5).every((sample) => sample.playCount === 0)).toBe(true);
  });
});
