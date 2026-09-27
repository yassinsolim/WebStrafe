import { describe, expect, it } from 'vitest';
import { landingIntensity } from '../audioMath';
import { MovementAudioTracker, type MovementAudioEvent, type MovementAudioSample } from '../MovementAudio';

const DT = 1 / 60;

function sample(overrides: Partial<MovementAudioSample> & { vx?: number; vy?: number; x?: number; y?: number } = {}): MovementAudioSample {
  return {
    grounded: overrides.grounded ?? true,
    surfing: overrides.surfing ?? false,
    velocity: { x: overrides.vx ?? 0, y: overrides.vy ?? 0, z: 0 },
    position: { x: overrides.x ?? 0, y: overrides.y ?? 0, z: 0 },
  };
}

function run(tracker: MovementAudioTracker, frames: MovementAudioSample[]): MovementAudioEvent[] {
  return frames.flatMap((frame) => tracker.update(frame, DT));
}

/** straight line run on flat ground */
function running(speed: number, seconds: number, startX = 0): MovementAudioSample[] {
  const frames: MovementAudioSample[] = [];
  const count = Math.round(seconds / DT);
  for (let i = 0; i < count; i += 1) {
    frames.push(sample({ vx: speed, x: startX + speed * DT * i }));
  }
  return frames;
}

describe('MovementAudioTracker footsteps', () => {
  it('is silent while standing still', () => {
    const tracker = new MovementAudioTracker();
    expect(run(tracker, Array.from({ length: 120 }, () => sample()))).toEqual([]);
  });

  it('steps about every 300 ms at run speed, alternating feet', () => {
    const tracker = new MovementAudioTracker();
    const steps = run(tracker, running(6.35, 3)).filter((event) => event.kind === 'footstep');
    expect(steps.length).toBeGreaterThanOrEqual(9);
    expect(steps.length).toBeLessThanOrEqual(11);
    const feet = steps.map((step) => (step.kind === 'footstep' ? step.foot : -1));
    expect(feet.every((foot, i) => i === 0 || foot !== feet[i - 1])).toBe(true);
    expect(steps.every((step) => step.kind === 'footstep' && step.intensity > 0.95)).toBe(true);
  });

  it('takes the first step soon after starting to move', () => {
    const tracker = new MovementAudioTracker();
    run(tracker, Array.from({ length: 30 }, () => sample()));
    const frames = running(6.35, 1);
    const firstStepFrame = frames.findIndex((frame) => tracker.update(frame, DT).some((event) => event.kind === 'footstep'));
    expect(firstStepFrame * DT).toBeLessThan(0.25);
  });

  it('steps slower and quieter when walking', () => {
    const tracker = new MovementAudioTracker();
    const walk = run(tracker, running(3, 3)).filter((event) => event.kind === 'footstep');
    expect(walk.length).toBeLessThan(8);
    expect(walk.every((step) => step.kind === 'footstep' && step.intensity < 0.5)).toBe(true);
  });

  it('never steps in the air or while surfing', () => {
    const tracker = new MovementAudioTracker();
    const air = running(8, 2).map((frame) => ({ ...frame, grounded: false }));
    const surf = running(15, 2).map((frame) => ({ ...frame, grounded: false, surfing: true }));
    expect(run(tracker, [...air, ...surf]).filter((event) => event.kind === 'footstep')).toEqual([]);
  });
});

describe('MovementAudioTracker jumps and landings', () => {
  it('reports a jump from the ground without a landing', () => {
    const tracker = new MovementAudioTracker();
    const events = run(tracker, [sample(), sample({ vy: 5.3, y: 0.05 })]);
    expect(events).toEqual([{ kind: 'jump' }]);
  });

  it('reports a landing scaled by fall speed', () => {
    const tracker = new MovementAudioTracker();
    const events = run(tracker, [
      sample({ grounded: false, vy: -8, y: 1 }),
      sample({ grounded: true, vy: 0, y: 0.9 }),
    ]);
    expect(events).toEqual([{ kind: 'land', intensity: landingIntensity(8), withJump: false }]);
  });

  it('ignores tiny drops like stairs and ground snapping', () => {
    const tracker = new MovementAudioTracker();
    const events = run(tracker, [
      sample({ grounded: false, vy: -1.5, y: 0.2 }),
      sample({ grounded: true, vy: 0, y: 0.18 }),
    ]);
    expect(events).toEqual([]);
  });

  it('reports landing and jump together for a bhop between two frames', () => {
    const tracker = new MovementAudioTracker();
    const events = run(tracker, [
      sample({ grounded: false, vy: -5.4, vx: 9, y: 0.2 }),
      sample({ grounded: true, vy: 5.2, vx: 9, x: 0.15, y: 0.1 }),
    ]);
    expect(events.map((event) => event.kind)).toEqual(['land', 'jump']);
    expect(events[0]).toMatchObject({ withJump: true });
  });

  it('does not mistake a surf ramp deflection for a jump', () => {
    const tracker = new MovementAudioTracker();
    const events = run(tracker, [
      sample({ grounded: false, vy: -12, vx: 20, y: 30 }),
      sample({ grounded: false, surfing: true, vy: 4, vx: 20, x: 0.33, y: 29.9 }),
    ]);
    expect(events).toEqual([]);
  });

  it('stays quiet across a respawn teleport even while falling fast', () => {
    const tracker = new MovementAudioTracker();
    const events = run(tracker, [
      sample({ grounded: false, vy: -30, y: -200 }),
      sample({ grounded: true, vy: 0, x: 0, y: 144 }),
    ]);
    expect(events).toEqual([]);
  });

  it('forgets history on reset', () => {
    const tracker = new MovementAudioTracker();
    tracker.update(sample({ grounded: false, vy: -9, y: 3 }), DT);
    tracker.reset();
    expect(tracker.update(sample({ grounded: true }), DT)).toEqual([]);
  });
});
