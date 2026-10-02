import { describe, expect, it } from 'vitest';
import { KNIVES } from '../../combat/knives';
import { applyEase, retime, sampleKeys } from '../clips';
import { AWP_CLIPS, DEAGLE_CLIPS, knifeClip, knifeDrawStyle, knifeInspectCount, knifeInspectStyle } from '../viewmodelClips';
import { FIREARM_TIMINGS } from '../../combat/FirearmTiming';

describe('clip sampling', () => {
  it('holds the ends and interpolates with eases', () => {
    const keys = [[0, 0], [1, 10, 'linear'], [2, 0, 'inOut']] as const;
    expect(sampleKeys(keys, -1)).toBe(0);
    expect(sampleKeys(keys, 0.5)).toBeCloseTo(5);
    expect(sampleKeys(keys, 1.5)).toBeCloseTo(5);
    expect(sampleKeys(keys, 5)).toBe(0);
    expect(applyEase('out', 0.5)).toBeGreaterThan(0.5);
    expect(applyEase('step', 0.99)).toBe(0);
  });

  it('retimes keys and events', () => {
    const clip = retime(DEAGLE_CLIPS.reload, 1.665);
    expect(clip.duration).toBeCloseTo(1.665);
    expect(clip.events?.[0][0]).toBeCloseTo(DEAGLE_CLIPS.reload.events![0][0] / 2);
  });
});

describe('viewmodel clips', () => {
  it('finish every gun clip before the gun can act again', () => {
    expect(DEAGLE_CLIPS.fire.duration * 1000).toBeLessThanOrEqual(FIREARM_TIMINGS.deagle.fireIntervalMs);
    expect(AWP_CLIPS.fire.duration * 1000).toBeLessThanOrEqual(FIREARM_TIMINGS.awp.fireIntervalMs);
    expect(DEAGLE_CLIPS.reload.duration * 1000).toBeCloseTo(FIREARM_TIMINGS.deagle.reloadMs, -1);
    expect(AWP_CLIPS.reload.duration * 1000).toBeCloseTo(FIREARM_TIMINGS.awp.reloadMs, -1);
  });

  it('closes the awp bolt and returns the hand before the next shot', () => {
    const fire = AWP_CLIPS.fire;
    const end = fire.duration;
    expect(sampleKeys(fire.tracks.boltBack, end)).toBe(0);
    expect(sampleKeys(fire.tracks.boltLift, end)).toBe(0);
    expect(sampleKeys(fire.tracks.rightOnBolt, end)).toBe(0);
    expect(Math.max(...fire.tracks.boltBack.map((k) => k[1]))).toBe(1);
  });

  it('gives every knife a draw, an inspect and attacks that end at rest', () => {
    for (const def of KNIVES) {
      const clips = (['draw', 'inspect', 'slashA', 'slashB', 'stab', 'backstab'] as const).map((name) => [name, knifeClip(def, name)] as const);
      clips.push(['inspect', knifeClip(def, 'inspect', 1)]);
      for (const [name, clip] of clips) {
        expect(clip.duration, `${def.id} ${name}`).toBeGreaterThan(0.3);
        for (const channel of ['px', 'py', 'pz', 'rx', 'ry', 'rz', 'tossY', 'gripOpen', 'watch', 'ringHold', 'thumbOpener',
          'raise', 'show', 'showB', 'hook', 'hookB', 'cock', 'strike']) {
          const keys = clip.tracks[channel];
          if (keys) expect(sampleKeys(keys, clip.duration), `${def.id} ${name} ${channel}`).toBeCloseTo(0, 5);
        }
      }
    }
  });

  it('gives every knife but the push daggers a rare inspect of its own', () => {
    for (const def of KNIVES) {
      const rare = knifeClip(def, 'inspect', 1);
      if (def.shape.pair) {
        expect(knifeInspectCount(def), def.id).toBe(1);
        continue;
      }
      if (def.id === 'skeleton') continue;
      expect(knifeInspectCount(def), def.id).toBe(2);
      expect(rare, def.id).not.toBe(knifeClip(def, 'inspect'));
    }
  });

  it('matches knife mechanisms to fitting styles', () => {
    const byId = new Map(KNIVES.map((def) => [def.id, def]));
    expect(knifeDrawStyle(byId.get('butterfly')!)).toBe('balisong_open');
    expect(knifeInspectStyle(byId.get('butterfly')!)).toBe('balisong');
    expect(knifeInspectStyle(byId.get('karambit')!)).toBe('ring_spin');
    expect(knifeDrawStyle(byId.get('flip')!)).toBe('flip_open');
    expect(knifeInspectStyle(byId.get('shadow_daggers')!)).toBe('dagger_pair');
    expect(knifeInspectStyle(byId.get('bowie')!)).toBe('heavy_show');
    expect(knifeDrawStyle(byId.get('stiletto')!)).toBe('switch_open');
    expect(knifeDrawStyle(byId.get('navaja')!)).toBe('flick_open');
    expect(knifeDrawStyle(byId.get('m9_bayonet')!)).toBe('spin_draw');
    expect(knifeInspectStyle(byId.get('m9_bayonet')!)).toBe('twirl');
    expect(knifeDrawStyle(byId.get('karambit')!)).toBe('spin_in');
    expect(knifeDrawStyle(byId.get('talon')!)).toBe('spin_in');
    expect(knifeDrawStyle(byId.get('skeleton')!)).toBe('skeleton_spin');
    expect(knifeInspectStyle(byId.get('skeleton')!)).toBe('skeleton_ring');
  });

  it('shows the watch in every gun inspect', () => {
    for (const clip of [DEAGLE_CLIPS.inspect, AWP_CLIPS.inspect]) {
      expect(Math.max(...clip.tracks.watch.map((k) => k[1]))).toBe(1);
    }
  });
});
