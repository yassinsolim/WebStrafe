import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../AudioEngine';
import { AWP_BOLT_CYCLE, GunAudio } from '../GunAudio';
import { mulberry32 } from '../audioMath';
import {
  FakeAudioContext,
  asContext,
  reaches,
  type FakeBufferSource,
  type FakeGain,
  type FakeNode,
  type FakePanner,
} from './fakeAudioContext';

const SIZES: Record<string, number> = {
  '/audio/deagle_shot.mp3': 1200,
  '/audio/awp_shot.mp3': 2500,
  '/audio/deagle_reload.mp3': 1800,
  '/audio/awp_reload.mp3': 2400,
};

async function readyGunAudio(fake = new FakeAudioContext()) {
  const engine = new AudioEngine({
    createContext: () => asContext(fake),
    fetchArrayBuffer: async (url) => new Uint8Array(SIZES[url] ?? 1000).buffer,
    random: mulberry32(3),
  });
  const audio = new GunAudio(engine);
  await audio.resume();
  await Promise.all(Object.keys(SIZES).map((url) => engine.loadSample(url)));
  return { audio, engine, fake };
}

function newSources(fake: FakeAudioContext, from: number): FakeBufferSource[] {
  return fake.nodes.slice(from).filter((node) => node.kind === 'bufferSource') as FakeBufferSource[];
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('GunAudio browser readiness', () => {
  it('reports running after resuming from a player gesture', async () => {
    const fake = new FakeAudioContext();
    fake.state = 'suspended';
    const engine = new AudioEngine({ createContext: () => asContext(fake), fetchArrayBuffer: async () => new ArrayBuffer(8) });
    const audio = new GunAudio(engine);
    await expect(audio.resume()).resolves.toBe('running');
    audio.dispose();
  });

  it('surfaces unavailable Web Audio once without throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('window', {});
    const audio = new GunAudio(new AudioEngine({ fetchArrayBuffer: async () => new ArrayBuffer(8) }));

    await expect(audio.resume()).resolves.toBe('unavailable');
    await expect(audio.resume()).resolves.toBe('unavailable');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(() => audio.shot('deagle')).not.toThrow();
  });
});

describe('GunAudio playback', () => {
  it('plays each weapon recording at its own level and lets shots overlap', async () => {
    const { audio, engine, fake } = await readyGunAudio();
    const count = fake.nodes.length;
    audio.shot('deagle');
    audio.shot('deagle');
    const shots = newSources(fake, count);
    expect(shots).toHaveLength(2);
    expect(shots[0].buffer).toBe(engine.getSample('/audio/deagle_shot.mp3'));
    expect(shots.every((source) => source.stops.length === 1)).toBe(true);
    const level = shots[0].outputs[0] as FakeGain;
    expect(level.gain.value).toBeCloseTo(0.52);
    expect(reaches(shots[0], engine.getBus('effects') as unknown as FakeNode)).toBe(true);

    const next = fake.nodes.length;
    audio.boltCycleEnabled = false;
    audio.shot('awp');
    const awp = newSources(fake, next);
    expect(awp).toHaveLength(1);
    expect(awp[0].buffer).toBe(engine.getSample('/audio/awp_shot.mp3'));
    expect((awp[0].outputs[0] as FakeGain).gain.value).toBeCloseTo(0.62);
  });

  it('schedules the authored reload cues on the audio clock', async () => {
    const { audio, fake } = await readyGunAudio();
    const count = fake.nodes.length;
    audio.reload('deagle');
    const cues = newSources(fake, count);
    const t0 = fake.currentTime + 0.002;
    expect(cues.map((cue) => cue.starts[0].when - t0)).toEqual([0.28, 0.51, 1.94, 2.62].map((v) => expect.closeTo(v, 5)));
    expect(cues.map((cue) => cue.starts[0].offset)).toEqual([0, 0.5, 1.05, 1.24]);
    expect(cues.map((cue) => cue.starts[0].duration)).toEqual([0.26, 0.38, 0.19, 0.26].map((v) => expect.closeTo(v, 5)));

    const next = fake.nodes.length;
    audio.reload('awp');
    const awpCues = newSources(fake, next);
    expect(awpCues.map((cue) => cue.starts[0].when - t0)).toEqual([0.35, 0.83, 1.42, 2.79].map((v) => expect.closeTo(v, 5)));
    expect(awpCues.map((cue) => cue.starts[0].offset)).toEqual([0, 0.55, 1.25, 1.6]);
  });

  it('cancels pending reload cues on weapon switch', async () => {
    const { audio, fake } = await readyGunAudio();
    const count = fake.nodes.length;
    audio.reload('deagle');
    const cues = newSources(fake, count);
    audio.stopReload();
    for (const cue of cues) {
      // natural stop plus the cancel, which lands before the cue would start
      expect(cue.stops).toHaveLength(2);
      expect(cue.stops[1]).toBeLessThan(cue.starts[0].when);
    }
  });

  it('places remote shots in the world', async () => {
    const { audio, engine, fake } = await readyGunAudio();
    engine.setListener([0, 1.6, 0], [0, 0, -1]);
    const count = fake.nodes.length;
    audio.shotAt('awp', [30, 2, -50]);
    const panner = fake.nodes.slice(count).find((node) => node.kind === 'panner') as FakePanner;
    expect([panner.positionX.value, panner.positionY.value, panner.positionZ.value]).toEqual([30, 2, -50]);
    const source = newSources(fake, count)[0];
    expect(reaches(source, panner)).toBe(true);
  });

  it('cycles the awp bolt after a shot and cancels it on switch', async () => {
    const { audio, engine } = await readyGunAudio();
    const play = vi.spyOn(engine, 'play');
    audio.shot('awp');
    expect(play.mock.calls.map(([name, options]) => [name, options?.delay])).toEqual(
      AWP_BOLT_CYCLE.map((step) => [step.sound, step.delaySec]),
    );
    const handles = play.mock.results.map((result) => result.value as { stop: () => void });
    const stops = handles.map((handle) => vi.spyOn(handle, 'stop'));
    audio.stopReload();
    expect(stops.every((stop) => stop.mock.calls.length === 1)).toBe(true);
  });

  it('maps hit confirmations to distinct procedural cues', async () => {
    const { audio, engine } = await readyGunAudio();
    const play = vi.spyOn(engine, 'play');
    audio.confirm('normal');
    audio.confirm('headshot');
    audio.confirm('kill');
    audio.dryFire();
    expect(play.mock.calls.map(([name]) => name)).toEqual(['hitmarker', 'headshot', 'killConfirm', 'dryFire']);
  });
});
