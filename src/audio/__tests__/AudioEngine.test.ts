import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../AudioEngine';
import { distanceGain, mulberry32 } from '../audioMath';
import { SFX, SFX_NAMES } from '../ProceduralSfx';
import {
  FakeAudioContext,
  asContext,
  reaches,
  type FakeBufferSource,
  type FakeGain,
  type FakeNode,
  type FakePanner,
  type FakeScheduledSource,
} from './fakeAudioContext';

function engineWith(fake = new FakeAudioContext(), extra: { now?: () => number; bytes?: Record<string, number> } = {}) {
  const fetchArrayBuffer = vi.fn(async (url: string) => {
    const size = extra.bytes?.[url] ?? 1000;
    const data = new Uint8Array(size);
    data[0] = url.length % 256;
    return data.buffer;
  });
  const engine = new AudioEngine({
    createContext: () => asContext(fake),
    fetchArrayBuffer,
    random: mulberry32(1),
    now: extra.now,
  });
  return { engine, fake, fetchArrayBuffer };
}

function sources(fake: FakeAudioContext): FakeScheduledSource[] {
  return fake.nodes.filter((node) => node.kind === 'bufferSource' || node.kind === 'oscillator') as FakeScheduledSource[];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AudioEngine lifecycle', () => {
  it('stays silent and creates nothing before a gesture', () => {
    const create = vi.fn(() => asContext(new FakeAudioContext()));
    const engine = new AudioEngine({ createContext: create });
    expect(engine.status).toBe('suspended');
    expect(engine.play('headshot')).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('creates one context and resumes it from a gesture', async () => {
    const fake = new FakeAudioContext();
    fake.state = 'suspended';
    const create = vi.fn(() => asContext(fake));
    const engine = new AudioEngine({ createContext: create });
    await expect(engine.resume()).resolves.toBe('running');
    engine.unlock();
    await engine.resume();
    expect(create).toHaveBeenCalledOnce();
    expect(engine.getContext()).toBe(fake);
  });

  it('unlocks on the first pointer or key event and then detaches', () => {
    const fake = new FakeAudioContext();
    const target = new EventTarget();
    const add = vi.spyOn(target, 'addEventListener');
    const remove = vi.spyOn(target, 'removeEventListener');
    const { engine } = engineWith(fake);
    engine.installGestureUnlock(target);
    expect(add).toHaveBeenCalledTimes(4);
    target.dispatchEvent(new Event('keydown'));
    expect(engine.status).toBe('running');
    expect(remove).toHaveBeenCalledTimes(4);
  });

  it('reports unavailable web audio once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const engine = new AudioEngine({ createContext: () => null });
    await expect(engine.resume()).resolves.toBe('unavailable');
    await expect(engine.resume()).resolves.toBe('unavailable');
    expect(engine.status).toBe('unavailable');
    expect(warn).toHaveBeenCalledOnce();
  });

  it('applies slider volumes with the perceptual taper', () => {
    const { engine, fake } = engineWith();
    engine.unlock();
    engine.setVolumes({ master: 0.5, effects: 1, ui: 0 });
    const master = engine.getBus('master') as unknown as FakeGain;
    const effects = engine.getBus('effects') as unknown as FakeGain;
    const ui = engine.getBus('ui') as unknown as FakeGain;
    expect(master.gain.value).toBeCloseTo(0.25);
    expect(effects.gain.value).toBe(1);
    expect(ui.gain.value).toBe(0);
    expect(reaches(master, fake.destination)).toBe(true);
    expect(reaches(ui, master)).toBe(true);
  });
});

describe('AudioEngine procedural sounds', () => {
  it('builds every recipe with finite, valid automation', () => {
    let now = 0;
    const { engine, fake } = engineWith(undefined, { now: () => (now += 1000) });
    engine.unlock();
    for (const name of SFX_NAMES) {
      for (const intensity of [0, 0.5, 1]) {
        for (const variant of [0, 1, 2]) {
          fake.currentTime += 1;
          const before = sources(fake).length;
          const handle = engine.play(name, { intensity, variant });
          expect(handle, name).not.toBeNull();
          expect(sources(fake).length, name).toBeGreaterThan(before);
          expect(Number.isFinite(handle!.endTime)).toBe(true);
          expect(handle!.endTime).toBeGreaterThan(fake.currentTime);
          // every one of these is a short one-shot
          expect(handle!.endTime - fake.currentTime).toBeLessThan(2);
        }
      }
    }
  });

  it('routes ui sounds to the ui bus and game sounds to the effects bus', () => {
    const { engine, fake } = engineWith();
    engine.unlock();
    const effects = engine.getBus('effects') as unknown as FakeNode;
    const ui = engine.getBus('ui') as unknown as FakeNode;
    const count = fake.nodes.length;
    engine.play('uiClick');
    const uiVoice = fake.nodes.slice(count).find((node) => node.kind === 'oscillator')!;
    expect(reaches(uiVoice, ui)).toBe(true);
    expect(reaches(uiVoice, effects)).toBe(false);

    const next = fake.nodes.length;
    engine.play('headshot');
    const hsVoice = fake.nodes.slice(next).find((node) => node.kind === 'oscillator')!;
    expect(reaches(hsVoice, effects)).toBe(true);
    expect(SFX.uiClick.bus).toBe('ui');
  });

  it('places positional sounds with a panner and hand-rolled attenuation', () => {
    const { engine, fake } = engineWith();
    engine.unlock();
    engine.setListener([0, 0, 0], [0, 0, -1]);
    const count = fake.nodes.length;
    engine.playAt('knifeHitWall', [0, 0, -40], { refDistance: 4, rolloff: 1 });
    const created = fake.nodes.slice(count);
    const panner = created.find((node) => node.kind === 'panner') as FakePanner;
    expect(panner.positionZ.value).toBe(-40);
    expect(panner.rolloffFactor).toBe(0);
    expect(panner.panningModel).toBe('HRTF');
    const attenuation = panner.inputs[0].inputs[0] as FakeGain;
    expect(attenuation.gain.value).toBeCloseTo(distanceGain(40, 4, 1));
    expect(reaches(panner, engine.getBus('effects') as unknown as FakeNode)).toBe(true);
  });

  it('throttles rapid repeats of the same sound', () => {
    let now = 0;
    const { engine } = engineWith(undefined, { now: () => now });
    engine.unlock();
    expect(engine.play('uiHover')).not.toBeNull();
    now += 10;
    expect(engine.play('uiHover')).toBeNull();
    now += SFX.uiHover.minIntervalMs;
    expect(engine.play('uiHover')).not.toBeNull();
  });

  it('cuts the oldest voice past the voice cap', () => {
    let now = 0;
    const { engine, fake } = engineWith(undefined, { now: () => now });
    engine.unlock();
    const count = fake.nodes.length;
    engine.play('footstep');
    const firstVoice = sources(fake).filter((source) => fake.nodes.indexOf(source) >= count);
    for (let i = 0; i < SFX.footstep.maxVoices; i += 1) {
      now += 1000;
      expect(engine.play('footstep')).not.toBeNull();
    }
    // the natural stop plus the early cut
    expect(firstVoice.every((source) => source.stops.length === 2)).toBe(true);
    expect(firstVoice.every((source) => source.stops[1] <= fake.currentTime + 0.03)).toBe(true);
  });

  it('schedules delayed sounds on the context clock', () => {
    const { engine, fake } = engineWith();
    engine.unlock();
    const count = fake.nodes.length;
    engine.play('awpBoltDown', { delay: 0.5 });
    const started = fake.nodes.slice(count).filter((node) => node.kind === 'oscillator' || node.kind === 'bufferSource') as FakeScheduledSource[];
    expect(Math.min(...started.map((source) => source.starts[0].when))).toBeGreaterThanOrEqual(fake.currentTime + 0.5);
  });

  it('fades and stops a voice through its handle', () => {
    const { engine, fake } = engineWith();
    engine.unlock();
    const count = fake.nodes.length;
    const handle = engine.play('respawn')!;
    handle.stop(0.05);
    const created = fake.nodes.slice(count);
    const played = created.filter((node) => node.kind === 'oscillator' || node.kind === 'bufferSource') as FakeScheduledSource[];
    expect(played.every((source) => source.stops.at(-1)! <= fake.currentTime + 0.06)).toBe(true);
    const out = created[0] as FakeGain;
    expect(out.gain.events.at(-1)).toMatchObject({ type: 'linear', value: 0 });
  });
});

describe('AudioEngine samples', () => {
  it('fetches before the gesture and decodes once a context exists', async () => {
    const { engine, fake, fetchArrayBuffer } = engineWith(undefined, { bytes: { '/a.mp3': 3000 } });
    const early = engine.loadSample('/a.mp3');
    expect(fetchArrayBuffer).toHaveBeenCalledOnce();
    await early;
    expect(engine.getSample('/a.mp3')).toBeNull();
    engine.unlock();
    const buffer = await engine.loadSample('/a.mp3');
    expect(buffer?.duration).toBe(3);
    expect(fetchArrayBuffer).toHaveBeenCalledOnce();

    const count = fake.nodes.length;
    engine.playSample('/a.mp3', { offset: 1, duration: 0.5, delay: 0.25, volume: 0.4, fadeOut: 0.05 });
    const source = fake.nodes.slice(count).find((node) => node.kind === 'bufferSource') as FakeBufferSource;
    expect(source.starts[0].offset).toBe(1);
    expect(source.starts[0].duration).toBeCloseTo(0.5);
    expect(source.starts[0].when).toBeCloseTo(fake.currentTime + 0.252);
  });

  it('ignores playback of samples that are not decoded yet', () => {
    const { engine } = engineWith();
    engine.unlock();
    expect(engine.playSample('/missing.mp3')).toBeNull();
  });
});
