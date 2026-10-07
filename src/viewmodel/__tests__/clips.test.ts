import { describe, expect, it } from 'vitest';
import { KNIVES } from '../../combat/knives';
import { applyEase, retime, sampleKeys, sampleSeq, type SeqSample } from '../clips';
import { AWP_CLIPS, DEAGLE_CLIPS } from '../viewmodelClips';
import { knifeClip, knifeDrawStyle, knifeInspectCount, knifeInspectStyle } from '../knifeClips';
import { KNIFE_ATTACK_FITS } from '../knifeAttackFits';
import { fittedAttackPoses, KNIFE_POSES } from '../knifePoses';
import { gripKindFor } from '../knifeGrips';
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

  it('samples a pose sequence as a segment with its neighbours', () => {
    const seq = [[0, 'idle'], [0.1, 'wind', 'linear'], [0.2, 'cut', 'linear'], [0.5, 'idle', 'linear']] as const;
    const at: SeqSample = { before: '', a: '', b: '', after: '', u: 0 };
    expect(sampleSeq(seq, 0.15, at)).toEqual({ before: 'idle', a: 'wind', b: 'cut', after: 'idle', u: expect.closeTo(0.5, 5) });
    expect(sampleSeq(seq, -1, at)).toMatchObject({ a: 'idle', b: 'idle', u: 0 });
    expect(sampleSeq(seq, 9, at)).toMatchObject({ a: 'idle', b: 'idle', u: 1 });
    expect(retime({ duration: 0.5, tracks: {}, seq }, 1).seq?.[2][0]).toBeCloseTo(0.4);
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
        for (const channel of ['px', 'py', 'pz', 'rx', 'ry', 'rz', 'tossY', 'gripOpen', 'watch', 'ringHold', 'thumbOpener', 'leftDrop',
          'raise', 'show', 'showB', 'hook', 'hookB', 'cock', 'strike']) {
          const keys = clip.tracks[channel];
          if (keys) expect(sampleKeys(keys, clip.duration), `${def.id} ${name} ${channel}`).toBeCloseTo(0, 5);
        }
      }
    }
  });

  it('walks every knife clip through poses its grip has, ending at rest', () => {
    for (const def of KNIVES) {
      const poses = { ...KNIFE_POSES[gripKindFor(def)].poses, ...fittedAttackPoses(def.id) };
      for (const name of ['draw', 'inspect', 'slashA', 'slashB', 'stab', 'backstab'] as const) {
        for (const variant of [0, 1]) {
          const clip = knifeClip(def, name, variant);
          for (const seq of [clip.seq, clip.seqL]) {
            if (!seq) continue;
            for (const [t, pose] of seq) {
              expect(pose === 'idle' || pose in poses, `${def.id} ${name} ${pose}`).toBe(true);
              expect(t).toBeLessThanOrEqual(clip.duration);
            }
            expect(seq[seq.length - 1][1], `${def.id} ${name} ends`).toBe('idle');
            for (let i = 1; i < seq.length; i += 1) expect(seq[i][0]).toBeGreaterThanOrEqual(seq[i - 1][0]);
          }
          if (name === 'draw') expect(clip.seq?.[0][1], `${def.id} draws from low`).toBe('low');
        }
      }
    }
  });

  it('cuts through the crosshair fast enough to read as the hit', () => {
    for (const def of KNIVES) {
      for (const name of ['slashA', 'slashB'] as const) {
        const fit = KNIFE_ATTACK_FITS[def.id]?.[name];
        if (fit) {
          // fitted to cs2: the hand or the blade tip passes near the middle of the screen by then
          // (a ring knife's claw trails the hand)
          const near = fit.keys.some((k) => {
            const tipX = k[1] + k[4] * 0.18;
            const tipZ = k[3] + k[6] * 0.18;
            const across = (x: number, z: number) => Math.abs(x / (-z * 1.199)) < 0.35;
            return k[0] <= 0.16 && (across(tipX, tipZ) || across(k[1], k[3]));
          });
          expect(near, `${def.id} ${name}`).toBe(true);
          continue;
        }
        const clip = knifeClip(def, name);
        const keys = [...(clip.seq ?? []), ...(clip.seqL ?? [])];
        const cut = keys.find(([, pose]) => pose.startsWith('cut') || pose === 'jab');
        expect(cut, `${def.id} ${name}`).toBeDefined();
        expect(cut![0], `${def.id} ${name}`).toBeLessThanOrEqual(0.16);
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
    expect(knifeDrawStyle(byId.get('bowie')!)).toBe('toss_flip');
    expect(knifeDrawStyle(byId.get('gut')!)).toBe('unsheathe');
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
