import { describe, expect, it } from 'vitest';
import { blendHandPose, createHandPose, HAND_POSES, type HandPoseName } from '../handPoses';

const DIGITS = ['index', 'middle', 'ring', 'pinky', 'thumb'] as const;

describe('hand poses', () => {
  it('keep every joint inside what the glove rig bends to', () => {
    for (const [name, pose] of Object.entries(HAND_POSES)) {
      for (const digit of DIGITS) {
        for (const angle of pose[digit]) {
          expect(Number.isFinite(angle), `${name} ${digit}`).toBe(true);
          // fingers curl, they barely hyperextend; the thumb swings both ways
          const [lo, hi] = digit === 'thumb' ? [-60, 90] : [-15, 105];
          expect(angle, `${name} ${digit}`).toBeGreaterThanOrEqual(lo);
          expect(angle, `${name} ${digit}`).toBeLessThanOrEqual(hi);
        }
      }
    }
  });

  it('leave the knife and shared poses as they were', () => {
    // the arms rig is shared with the knives; gun fitting must not move these
    expect(HAND_POSES.knife).toEqual({
      index: [50, 64, 30], middle: [68, 84, 40], ring: [72, 86, 42], pinky: [76, 84, 40], thumb: [20, 34, 10],
    });
    expect(HAND_POSES.knifeReverse).toEqual({
      index: [60, 70, 34], middle: [70, 86, 40], ring: [74, 88, 42], pinky: [78, 86, 40], thumb: [26, 40, 12],
    });
    expect(HAND_POSES.fist).toEqual({
      index: [42, 58, 26], middle: [78, 92, 42], ring: [80, 94, 44], pinky: [84, 92, 42], thumb: [22.5, 38.6, 9.5],
    });
    expect(HAND_POSES.relaxed.index).toEqual([10, 16, 10]);
    expect(HAND_POSES.open.index).toEqual([2, 4, 2]);
  });

  it('has a fitted pose for every gun grip', () => {
    const gun: HandPoseName[] = ['deagle', 'deagleSupport', 'deagleMag', 'awp', 'awpForend', 'awpMag', 'awpBolt', 'awpBoltClosed', 'watchGun'];
    for (const name of gun) expect(HAND_POSES[name], name).toBeDefined();
    // the trigger fingers curl at the middle joint onto the trigger face, the others wrap
    expect(HAND_POSES.deagle.index[1]).toBeGreaterThan(60);
    expect(HAND_POSES.awp.index[1]).toBeGreaterThan(60);
    expect(HAND_POSES.deagle.middle[0]).toBeGreaterThan(30);
  });

  it('blends endpoints exactly', () => {
    const out = createHandPose();
    blendHandPose(HAND_POSES.awpBoltClosed, HAND_POSES.awpBolt, 0, out);
    expect(out.index).toEqual([...HAND_POSES.awpBoltClosed.index]);
    blendHandPose(HAND_POSES.awpBoltClosed, HAND_POSES.awpBolt, 1, out);
    expect(out.thumb).toEqual([...HAND_POSES.awpBolt.thumb]);
  });
});
