import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../AudioEngine';
import { KnifeAudio } from '../KnifeAudio';
import { mulberry32 } from '../audioMath';
import { FakeAudioContext, asContext } from './fakeAudioContext';

function readyKnifeAudio() {
  const fake = new FakeAudioContext();
  const engine = new AudioEngine({ createContext: () => asContext(fake), random: mulberry32(9) });
  engine.unlock();
  return { audio: new KnifeAudio(engine), engine, fake };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('KnifeAudio presentation', () => {
  it('synthesizes a slash for primary and a heavier stab for secondary', () => {
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
    const audio = new KnifeAudio(engine);
    expect(() => audio.play('primary')).not.toThrow();
    expect(engine.getContext()).toBeNull();
  });
});
