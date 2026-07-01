import { describe, expect, it } from 'vitest';
import { KillFeed } from '../KillFeed';

const entry = { killer: 'A', victim: 'B', weaponId: 'awp', headshot: true };

describe('KillFeed', () => {
  it('shows a freshly added entry', () => {
    const kf = new KillFeed(6000, 5);
    kf.add(entry, 1000);
    expect(kf.visible(1000)).toHaveLength(1);
    expect(kf.visible(1000)[0].killer).toBe('A');
  });

  it('hides entries past their TTL', () => {
    const kf = new KillFeed(6000, 5);
    kf.add(entry, 1000);
    expect(kf.visible(1000 + 5999)).toHaveLength(1);
    expect(kf.visible(1000 + 6000)).toHaveLength(0);
  });

  it('caps the number of retained entries', () => {
    const kf = new KillFeed(60000, 3);
    for (let i = 0; i < 5; i++) kf.add({ ...entry, victim: `v${i}` }, 1000 + i);
    // Only the last 3 are kept.
    const vis = kf.visible(1000 + 5);
    expect(vis).toHaveLength(3);
    expect(vis.map((e) => e.victim)).toEqual(['v2', 'v3', 'v4']);
  });

  it('prune removes only expired entries', () => {
    const kf = new KillFeed(6000, 5);
    kf.add({ ...entry, victim: 'old' }, 0);
    kf.add({ ...entry, victim: 'new' }, 5000);
    kf.prune(6500); // old (age 6500) expired, new (age 1500) kept
    expect(kf.visible(6500).map((e) => e.victim)).toEqual(['new']);
  });

  it('clear empties the feed', () => {
    const kf = new KillFeed();
    kf.add(entry, 0);
    kf.clear();
    expect(kf.visible(0)).toHaveLength(0);
  });
});
