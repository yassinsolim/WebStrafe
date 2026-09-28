import { describe, expect, it } from 'vitest';
import { AdaptiveResolution } from '../AdaptiveResolution';

function feed(ar: AdaptiveResolution, frameMs: number, seconds: number): void {
  for (let t = 0; t < seconds * 1000; t += frameMs) ar.sample(frameMs);
}

describe('AdaptiveResolution', () => {
  it('stays at full resolution when frames are fast', () => {
    const ar = new AdaptiveResolution();
    feed(ar, 1000 / 144, 5);
    expect(ar.getScale()).toBe(1);
  });

  it('steps down under 55 fps and stops at the floor', () => {
    const ar = new AdaptiveResolution();
    feed(ar, 1000 / 40, 2.05);
    expect(ar.getScale()).toBeCloseTo(0.7);
    feed(ar, 1000 / 20, 10);
    expect(ar.getScale()).toBe(0.5);
  });

  it('only climbs back after a few good seconds', () => {
    const ar = new AdaptiveResolution();
    feed(ar, 1000 / 40, 3.05);
    const low = ar.getScale();
    feed(ar, 1000 / 120, 2);
    expect(ar.getScale()).toBe(low);
    feed(ar, 1000 / 120, 30);
    expect(ar.getScale()).toBe(1);
  });

  it('ignores stalls like tab switches', () => {
    const ar = new AdaptiveResolution();
    for (let i = 0; i < 20; i += 1) ar.sample(2000);
    expect(ar.getScale()).toBe(1);
  });
});
