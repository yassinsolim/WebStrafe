import { describe, expect, it } from 'vitest';
import { SourceClock } from '../SourceClock';
import { InterpolationBuffer, MAX_EXTRAPOLATION_MS, type EntitySample } from '../InterpolationBuffer';
import { RemoteTimeline } from '../RemoteTimeline';
import { SendCadence } from '../SendCadence';
import { broadcastRateHz, roomEventsPerSecond, SUPABASE_FREE_EVENTS_PER_SEC } from '../RateBudget';

function circleSample(tMs: number, radius = 12, speed = 16): EntitySample {
  const w = speed / radius;
  const a = (tMs / 1000) * w;
  return {
    t: tMs,
    position: [Math.cos(a) * radius, 0, Math.sin(a) * radius],
    velocity: [-Math.sin(a) * speed, 0, Math.cos(a) * speed],
    yaw: a,
    pitch: 0,
  };
}

describe('SourceClock', () => {
  it('locks onto the fastest path and ignores late arrivals', () => {
    const clock = new SourceClock();
    // source clock is 5 s ahead, best one-way latency 20 ms, some packets 60 ms late
    for (let i = 0; i < 100; i += 1) {
      const sourceT = 5000 + i * 33;
      const late = i % 7 === 0 ? 60 : 0;
      clock.observe(sourceT, sourceT - 5000 + 20 + late);
    }
    expect(clock.toLocal(5000)).toBeCloseTo(20, 5);
    expect(clock.getIntervalMs()).toBeCloseTo(33, 0);
    expect(clock.getJitterMs()).toBeGreaterThan(20);
  });

  it('recommends one interval plus jitter as the render delay', () => {
    const clock = new SourceClock();
    for (let i = 0; i < 60; i += 1) clock.observe(i * 50, i * 50 + 30);
    expect(clock.getRecommendedDelayMs()).toBeCloseTo(60, 0);
  });

  it('resets when the source clock steps by seconds', () => {
    const clock = new SourceClock();
    for (let i = 0; i < 20; i += 1) clock.observe(i * 50, i * 50 + 10);
    for (let i = 0; i < 5; i += 1) clock.observe(100000 + i * 50, 1000 + i * 50 + 10);
    expect(clock.toLocal(100000)).toBeCloseTo(1010, 5);
  });
});

describe('InterpolationBuffer', () => {
  it('follows a curved path between sparse samples (hermite)', () => {
    const buffer = new InterpolationBuffer();
    for (let t = 0; t <= 1000; t += 100) buffer.push(circleSample(t));
    let worst = 0;
    for (let t = 0; t <= 1000; t += 7) {
      const s = buffer.sampleAt(t)!;
      const truth = circleSample(t);
      worst = Math.max(worst, Math.hypot(s.position[0] - truth.position[0], s.position[2] - truth.position[2]));
      expect(s.mode).toBe('interp');
    }
    // straight lerp would sag ~0.27 m at 10 Hz on this circle
    expect(worst).toBeLessThan(0.01);
  });

  it('extrapolates briefly then holds', () => {
    const buffer = new InterpolationBuffer();
    buffer.push(circleSample(0));
    buffer.push(circleSample(50));
    const ahead = buffer.sampleAt(50 + 40)!;
    expect(ahead.mode).toBe('extrap');
    const stale = buffer.sampleAt(50 + MAX_EXTRAPOLATION_MS + 500)!;
    expect(stale.mode).toBe('hold');
    expect(stale.sourceT).toBe(50 + MAX_EXTRAPOLATION_MS);
  });

  it('snaps across teleports instead of sweeping through the map', () => {
    const buffer = new InterpolationBuffer();
    buffer.push({ t: 0, position: [0, 0, 0], velocity: [0, 0, 0], yaw: 0, pitch: 0 });
    buffer.push({ t: 100, position: [50, 0, 0], velocity: [0, 0, 0], yaw: 0, pitch: 0 });
    expect(buffer.sampleAt(50)!.position[0]).toBe(0);
  });

  it('keeps order for late packets and drops duplicates', () => {
    const buffer = new InterpolationBuffer();
    expect(buffer.push(circleSample(0))).toBe(true);
    expect(buffer.push(circleSample(100))).toBe(true);
    expect(buffer.push(circleSample(50))).toBe(true);
    expect(buffer.push(circleSample(100))).toBe(false);
    expect(buffer.size()).toBe(3);
    const s = buffer.sampleAt(75)!;
    const truth = circleSample(75);
    expect(Math.hypot(s.position[0] - truth.position[0], s.position[2] - truth.position[2])).toBeLessThan(0.01);
  });
});

describe('RemoteTimeline', () => {
  it('never moves render time backwards while the delay estimate grows', () => {
    const timeline = new RemoteTimeline();
    let local = 1000;
    let last = -Infinity;
    for (let i = 0; i < 200; i += 1) {
      const sourceT = i * 33;
      // jitter burst in the middle pushes the recommended delay up
      const late = i > 80 && i < 100 ? 150 : 0;
      timeline.observe('a', sourceT, sourceT + 1000 + late);
      for (let f = 0; f < 2; f += 1) {
        local += 16.5;
        timeline.update(16.5);
        const r = timeline.renderTime('a', local)!;
        expect(r).toBeGreaterThanOrEqual(last - 1e-9);
        last = r;
      }
    }
  });
});

describe('SendCadence', () => {
  it('sends exactly the target rate from 128 Hz ticks', () => {
    const cadence = new SendCadence(30);
    let sent = 0;
    for (let tick = 0; tick < 128 * 10; tick += 1) {
      if (cadence.due((tick * 1000) / 128)) sent += 1;
    }
    expect(sent).toBeGreaterThanOrEqual(300);
    expect(sent).toBeLessThanOrEqual(301);
  });

  it('documents the old reset-to-zero rule that ran at 18.3 Hz instead of 20', () => {
    let acc = 0;
    let sent = 0;
    for (let tick = 0; tick < 128 * 10; tick += 1) {
      acc += 1 / 128;
      if (acc >= 1 / 20) {
        acc = 0;
        sent += 1;
      }
    }
    // fires every 7th tick: 128 / 7 = 18.29 Hz
    expect(sent).toBe(Math.floor((128 * 10) / 7));
  });

  it('resyncs after a long stall instead of bursting', () => {
    const cadence = new SendCadence(20);
    cadence.due(0);
    let burst = 0;
    for (let t = 5000; t < 5010; t += 1) if (cadence.due(t)) burst += 1;
    expect(burst).toBe(1);
  });
});

describe('RateBudget', () => {
  it('keeps every room size under the free-plan event cap', () => {
    for (let n = 1; n <= 6; n += 1) {
      const hz = broadcastRateHz(n);
      if (n <= 5) {
        expect(roomEventsPerSecond(n, hz)).toBeLessThan(SUPABASE_FREE_EVENTS_PER_SEC);
      }
      expect(hz).toBeGreaterThanOrEqual(2);
      expect(hz).toBeLessThanOrEqual(20);
    }
    expect(broadcastRateHz(2)).toBe(20);
    expect(broadcastRateHz(3)).toBeCloseTo(8.9, 1);
  });

  it('shows why the old traffic tripped the cap with two players', () => {
    // host: 20 Hz state + 60 Hz botstate, guest: 20 Hz state, each delivered once
    const sent = 20 + 60 + 20;
    const delivered = sent;
    expect(sent + delivered).toBe(200);
    expect(sent + delivered).toBeGreaterThan(SUPABASE_FREE_EVENTS_PER_SEC);
  });
});
