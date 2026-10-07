import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../AudioEngine';
import { KnifeAudio } from '../KnifeAudio';
import { mulberry32 } from '../audioMath';
import { FakeAudioContext, asContext } from './fakeAudioContext';

function readyKnifeAudio() {
  const fake = new FakeAudioContext();
  const engine = new AudioEngine({ createContext: () => asContext(fake), random: mulberry32(9) });
  engine.unlock();
  vi.spyOn(engine, 'loadSample').mockResolvedValue(null);
  return { audio: new KnifeAudio(engine), engine, fake };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('KnifeAudio presentation', () => {
  it('falls back to synthesis while recordings are unavailable', () => {
    const { audio, engine } = readyKnifeAudio();
    const play = vi.spyOn(engine, 'play');
    audio.play('primary');
    audio.play('secondary', 1, 'knifeGloves2');
    expect(play.mock.calls).toEqual([
      ['knifeSwing', { volume: 1, variant: 0 }],
      ['knifeStab', { volume: 0.94, variant: 1 }],
    ]);
    expect(play.mock.results.every((result) => result.value !== null)).toBe(true);
  });

  it('plays loaded recordings instead of synthesis and cancels them on switches', () => {
    const { audio, engine } = readyKnifeAudio();
    const stop = vi.fn();
    const sample = vi.spyOn(engine, 'playSample').mockReturnValue({ endTime: 3, stop });
    const synth = vi.spyOn(engine, 'play');
    audio.play('primary');
    expect(sample).toHaveBeenCalledWith('/audio/knife/slash-1.mp3', {
      volume: 0.55,
      playbackRate: 1,
      delay: expect.closeTo(0.03, 5),
      fadeIn: 0.002,
      fadeOut: 0.015,
    });
    expect(synth).not.toHaveBeenCalled();
    audio.stopAll();
    expect(stop).toHaveBeenCalledWith(0.03);
  });

  it('alternates recorded takes and keeps remote playback positional', () => {
    const { audio, engine } = readyKnifeAudio();
    const sample = vi.spyOn(engine, 'playSample').mockReturnValue({ endTime: 3, stop: vi.fn() });
    const synth = vi.spyOn(engine, 'playAt');
    for (let index = 0; index < 4; index += 1) audio.play('secondary', 0.48, 'knifeGloves2', [1, 2, 3]);
    expect(sample.mock.calls.map(([url]) => url)).toEqual([
      '/audio/knife/stab-1.mp3', '/audio/knife/stab-2.mp3', '/audio/knife/stab-3.mp3', '/audio/knife/stab-1.mp3',
    ]);
    expect(sample).toHaveBeenLastCalledWith('/audio/knife/stab-1.mp3', expect.objectContaining({
      volume: expect.closeTo(0.48 * 0.94 * 0.7, 5),
      playbackRate: 0.97,
      position: [1, 2, 3],
      refDistance: 3,
      rolloff: 1,
    }));
    expect(synth).not.toHaveBeenCalled();
  });

  it('aligns the recorded peak to a late stab and cancels the queued sound', () => {
    const { audio, engine } = readyKnifeAudio();
    const stop = vi.fn();
    const sample = vi.spyOn(engine, 'playSample').mockReturnValue({ endTime: 3, stop });
    audio.play('secondary', 1, undefined, undefined, 0.3);
    expect(sample).toHaveBeenCalledWith('/audio/knife/stab-1.mp3', expect.objectContaining({
      delay: expect.closeTo(0.21, 5),
      playbackRate: 1,
    }));
    audio.stopAll();
    expect(stop).toHaveBeenCalledWith(0.03);
  });

  it('aligns the fallback peak to the same contact time', () => {
    const { audio, engine } = readyKnifeAudio();
    const synth = vi.spyOn(engine, 'play');
    audio.play('secondary', 1, undefined, undefined, 0.3);
    expect(synth).toHaveBeenCalledWith('knifeStab', expect.objectContaining({ delay: expect.closeTo(0.17, 5) }));
  });

  it('preloads each recording only once', () => {
    const { audio, engine } = readyKnifeAudio();
    audio.preload();
    audio.preload();
    expect(engine.loadSample).toHaveBeenCalledTimes(32);
    const urls = vi.mocked(engine.loadSample).mock.calls.map(([url]) => url);
    expect(new Set(urls).size).toBe(urls.length);
    for (const url of urls) expect(existsSync(new URL(`../../../public${url}`, import.meta.url)), url).toBe(true);
  });

  it('uses different recorded mechanisms and successive butterfly contacts', () => {
    const { audio, engine } = readyKnifeAudio();
    const sample = vi.spyOn(engine, 'playSample').mockReturnValue({ endTime: 3, stop: vi.fn() });
    audio.playHandling('knifeOpen', 'butterfly');
    audio.playHandling('knifeOpen', 'butterfly');
    audio.playHandling('knifeOpen', 'butterfly');
    audio.playHandling('knifeOpen', 'flip');
    audio.playHandling('knifeOpen', 'stiletto');
    audio.playHandling('knifeClose', 'stiletto');
    expect(sample.mock.calls.map(([url]) => url)).toEqual([
      '/audio/knife/balisong-1.mp3', '/audio/knife/balisong-2.mp3', '/audio/knife/balisong-3.mp3',
      '/audio/knife/open-1.mp3', '/audio/knife/switch-open.mp3', '/audio/knife/close.mp3',
    ]);
  });

  it('cancels handling on attack without cancelling confirmed world impacts', () => {
    const { audio, engine } = readyKnifeAudio();
    const handlingStop = vi.fn();
    const impactStop = vi.fn();
    const swingStop = vi.fn();
    vi.spyOn(engine, 'playSample')
      .mockReturnValueOnce({ endTime: 3, stop: handlingStop })
      .mockReturnValueOnce({ endTime: 3, stop: impactStop })
      .mockReturnValueOnce({ endTime: 3, stop: swingStop });
    audio.playHandling('knifeOpen', 'flip');
    audio.playImpact('knifeHitFlesh');
    audio.play('primary');
    expect(handlingStop).toHaveBeenCalledWith(0.015);
    audio.stopAll();
    expect(swingStop).toHaveBeenCalledWith(0.03);
    expect(impactStop).not.toHaveBeenCalled();
  });

  it('schedules a positional backstab entry, second contact and withdrawal', () => {
    const { audio, engine } = readyKnifeAudio();
    const sample = vi.spyOn(engine, 'playSample').mockReturnValue({ endTime: 3, stop: vi.fn() });
    audio.playImpact('backstab', 0.8, [1, 2, 3], 0.1);
    expect(sample.mock.calls.map(([url]) => url)).toEqual([
      '/audio/knife/flesh-1.mp3', '/audio/knife/flesh-2.mp3', '/audio/knife/withdraw.mp3',
    ]);
    expect(sample.mock.calls[0][1]).toMatchObject({ position: [1, 2, 3], delay: 0.1, volume: 0.8 });
    expect(sample.mock.calls[1][1]).toMatchObject({ delay: expect.closeTo(0.28, 5), volume: expect.closeTo(0.36, 5) });
    expect(sample.mock.calls[2][1]).toMatchObject({ delay: expect.closeTo(0.45, 5), volume: expect.closeTo(0.56, 5) });
  });

  it('keeps one fallback voice when an impact recording is unavailable', () => {
    const { audio, engine } = readyKnifeAudio();
    const synth = vi.spyOn(engine, 'playAt');
    audio.playImpact('backstab', 0.8, [1, 2, 3], 0.1);
    expect(synth).toHaveBeenCalledExactlyOnceWith('backstab', [1, 2, 3], { volume: 0.8, delay: 0.1 });
  });

  it('scales volume and can place remote swings in the world', () => {
    const { audio, engine } = readyKnifeAudio();
    const playAt = vi.spyOn(engine, 'playAt');
    audio.setProfile('knifeGloves2');
    audio.play('primary', 0.48, undefined, [1, 2, 3]);
    expect(playAt).toHaveBeenCalledWith('knifeSwing', [1, 2, 3], { volume: expect.closeTo(0.4512, 4), variant: 1 });
  });

  it('stops live swings on death or weapon switch', () => {
    const { audio, engine } = readyKnifeAudio();
    const play = vi.spyOn(engine, 'play');
    audio.play('primary');
    const handle = play.mock.results[0].value as { stop: () => void };
    const stop = vi.spyOn(handle, 'stop');
    audio.stopAll();
    expect(stop).toHaveBeenCalledOnce();
    audio.stopAll();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('stays silent without throwing before audio is unlocked', () => {
    const engine = new AudioEngine({ createContext: () => asContext(new FakeAudioContext()) });
    vi.spyOn(engine, 'loadSample').mockResolvedValue(null);
    const audio = new KnifeAudio(engine);
    expect(() => audio.play('primary')).not.toThrow();
    expect(engine.getContext()).toBeNull();
  });
});
