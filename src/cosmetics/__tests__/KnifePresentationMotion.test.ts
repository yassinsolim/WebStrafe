import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  KNIFE_EQUIP_DURATION_SEC,
  KnifePresentationMotion,
} from '../KnifePresentationMotion';

interface KnifeManifestContract {
  knives: Array<{
    id: string;
    animationBehavior?: {
      sourceClip?: string;
      idleLoopRange?: { startSec: number; endSec: number };
      mouse1Ranges?: Array<{ startSec: number; endSec: number }>;
      mouse2Ranges?: Array<{ startSec: number; endSec: number }>;
    };
  }>;
}

describe('KnifePresentationMotion', () => {
  it('settles an agile equip delta exactly back to neutral', () => {
    const motion = new KnifePresentationMotion();
    motion.triggerEquip();

    const start = motion.sample();
    const middle = motion.update(KNIFE_EQUIP_DURATION_SEC / 2);
    const end = motion.update(KNIFE_EQUIP_DURATION_SEC / 2);

    expect(start.phase).toBe('equip');
    expect(start.position[1]).toBeLessThan(-0.1);
    expect(Math.abs(middle.position[1])).toBeLessThan(Math.abs(start.position[1]));
    expect(end).toEqual({
      phase: 'idle',
      progress: 1,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    });
  });

  it('layers distinct primary and secondary arcs over exact clip durations', () => {
    const primary = new KnifePresentationMotion();
    primary.triggerAttack('primary', 0.55);
    const primaryPeak = primary.update(0.275);

    const secondary = new KnifePresentationMotion();
    secondary.triggerAttack('secondary', 0.825);
    const secondaryPeak = secondary.update(0.4125);

    expect(primaryPeak.phase).toBe('primary');
    expect(secondaryPeak.phase).toBe('secondary');
    expect(secondaryPeak.position[2]).toBeGreaterThan(primaryPeak.position[2]);
    expect(secondaryPeak.rotation[2]).toBeLessThan(0);
    expect(primary.update(0.275).phase).toBe('idle');
    expect(secondary.update(0.4125).phase).toBe('idle');
  });

  it('is deterministic across equivalent frame partitions', () => {
    const singleStep = new KnifePresentationMotion();
    singleStep.triggerAttack('primary', 0.55);
    const expected = singleStep.update(0.22);

    const partitioned = new KnifePresentationMotion();
    partitioned.triggerAttack('primary', 0.55);
    let actual = partitioned.sample();
    for (let frame = 0; frame < 22; frame += 1) {
      actual = partitioned.update(0.01);
    }

    expect(actual.phase).toBe(expected.phase);
    expect(actual.progress).toBeCloseTo(expected.progress, 12);
    for (const [index, value] of actual.position.entries()) {
      expect(value).toBeCloseTo(expected.position[index], 12);
    }
    for (const [index, value] of actual.rotation.entries()) {
      expect(value).toBeCloseTo(expected.rotation[index], 12);
    }
  });

  it('clears interrupted attacks before rapid re-equip and lifecycle reuse', () => {
    const motion = new KnifePresentationMotion();
    motion.triggerAttack('secondary', 0.825);
    motion.update(0.2);
    motion.reset();
    expect(motion.sample().phase).toBe('idle');

    motion.triggerEquip();
    expect(motion.sample().phase).toBe('equip');
    motion.reset();
    expect(motion.sample()).toMatchObject({
      phase: 'idle',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    });
  });
});

describe('baked knife animation contract', () => {
  it('retains the authored source clip and exact primary/secondary ranges', () => {
    const path = new URL('../../../public/cosmetics/manifest.json', import.meta.url);
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as KnifeManifestContract;
    const knife = manifest.knives.find((entry) => entry.id === 'knife_animated_viewmodel');

    expect(knife?.animationBehavior).toEqual({
      sourceClip: 'anims',
      idleLoopRange: { startSec: 0, endSec: 1 },
      mouse1Ranges: [
        { startSec: 1.4, endSec: 1.95 },
        { startSec: 1.95, endSec: 2.5 },
      ],
      mouse2Ranges: [
        { startSec: 2.5, endSec: 3.325 },
        { startSec: 3.325, endSec: 4.15 },
      ],
    });
  });
});
