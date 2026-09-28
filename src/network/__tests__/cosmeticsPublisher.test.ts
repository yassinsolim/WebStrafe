import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CosmeticsPublisher } from '../cosmeticsPublisher';
import type { PlayerCosmetics } from '../cosmetics';

const pick = (seed: number): PlayerCosmetics => ({ knife: { id: 'butterfly', finish: 'fade', wear: 0.02, seed } });

describe('CosmeticsPublisher', () => {
  let sent: Array<PlayerCosmetics | null>;
  let pub: CosmeticsPublisher;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(50_000);
    sent = [];
    pub = new CosmeticsPublisher((c) => sent.push(c), { debounceMs: 400, minIntervalMs: 1000 });
  });
  afterEach(() => {
    pub.dispose();
    vi.useRealTimers();
  });

  it('sends a burst of changes once, after the quiet time, with the last pick', () => {
    for (let i = 0; i < 20; i += 1) {
      pub.set(pick(i));
      vi.advanceTimersByTime(50);
    }
    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(400);
    expect(sent).toEqual([pick(19)]);
  });

  it('keeps two sends at least the minimum interval apart', () => {
    pub.set(pick(1));
    vi.advanceTimersByTime(400);
    expect(sent).toHaveLength(1);
    pub.set(pick(2));
    vi.advanceTimersByTime(400);
    expect(sent).toHaveLength(1);
    // the first went out at 400 ms, so the second waits until 1400 ms
    vi.advanceTimersByTime(599);
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual([pick(1), pick(2)]);
  });

  it('the join carries the latest pick and counts as a send', () => {
    pub.set(pick(3));
    expect(pub.joined()).toEqual(pick(3));
    vi.advanceTimersByTime(5000);
    expect(sent).toHaveLength(0);
    pub.set(pick(4));
    vi.advanceTimersByTime(399);
    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual([pick(4)]);
  });

  it('going back to what peers already have cancels the pending send', () => {
    pub.set(pick(5));
    pub.joined();
    pub.set(pick(6));
    pub.set(pick(5));
    vi.advanceTimersByTime(5000);
    expect(sent).toHaveLength(0);
  });

  it('clearing cosmetics is a change too', () => {
    pub.set(pick(7));
    pub.joined();
    vi.advanceTimersByTime(2000);
    pub.set(null);
    vi.advanceTimersByTime(400);
    expect(sent).toEqual([null]);
  });
});
