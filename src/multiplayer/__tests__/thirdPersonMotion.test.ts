import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { BodyMotionState } from '../thirdPersonMotion';

// yaw 0 looks down -z, so running forward is -z
const run = (speed: number) => new Vector3(0, 0, -speed);

function simulate(fps: number, seconds: number, velocity: Vector3, pitch = 0, grounded: boolean | undefined = true) {
  const state = new BodyMotionState();
  for (let i = 0; i < Math.round(fps * seconds); i += 1) state.step(1 / fps, velocity, 0, pitch, grounded);
  return state;
}

describe('third person body motion', () => {
  it('stands still in the knife stance when not moving', () => {
    const { out } = simulate(60, 1, new Vector3());
    expect(out.footwork).toBeCloseTo(1, 6);
    expect(out.move).toBe(0);
    for (const leg of [out.legs.left, out.legs.right]) {
      expect(Math.abs(leg.swing)).toBeLessThan(1e-6);
      expect(Math.abs(leg.knee)).toBeLessThan(1e-6);
    }
  });

  it('strides with the legs in turn, faster and longer at a run', () => {
    const stride = (speed: number) => {
      const state = new BodyMotionState();
      let crossings = 0;
      let biggest = 0;
      let prev = 0;
      for (let i = 0; i < 240 * 3; i += 1) {
        const { legs } = state.step(1 / 240, run(speed), 0, 0, true);
        if (i > 240) {
          // the legs are always on opposite sides of the stride
          expect(Math.sign(legs.left.swing) * Math.sign(legs.right.swing)).toBeLessThanOrEqual(0);
          if (Math.sign(legs.left.swing) !== Math.sign(prev) && prev !== 0) crossings += 1;
          biggest = Math.max(biggest, Math.abs(legs.left.swing));
        }
        prev = legs.left.swing;
      }
      return { stepsPerSecond: crossings / 2, biggest };
    };
    const walk = stride(2.5);
    const sprint = stride(6.35);
    expect(walk.stepsPerSecond).toBeGreaterThan(1.5);
    expect(sprint.stepsPerSecond).toBeGreaterThan(walk.stepsPerSecond);
    expect(sprint.stepsPerSecond).toBeLessThan(3.4);
    expect(sprint.biggest).toBeGreaterThan(walk.biggest);
    expect(sprint.biggest).toBeLessThan(0.6);
  });

  it('swings the stride the other way walking backwards and steps across strafing', () => {
    const forward = simulate(120, 1, run(4)).out;
    const backward = simulate(120, 1, run(-4)).out;
    expect(Math.sign(backward.legs.left.swing)).toBe(-Math.sign(forward.legs.left.swing));
    expect(Math.abs(forward.legs.left.side)).toBeLessThan(1e-3);
    let side = 0;
    const state = new BodyMotionState();
    for (let i = 0; i < 240; i += 1) side = Math.max(side, Math.abs(state.step(1 / 120, new Vector3(4, 0, 0), 0, 0, true).legs.left.side));
    expect(side).toBeGreaterThan(0.05);
  });

  it('looks the same at any frame rate', () => {
    const slow = simulate(30, 2, run(5), 0.4).out;
    const fast = simulate(144, 2, run(5), 0.4).out;
    expect(fast.legs.left.swing).toBeCloseTo(slow.legs.left.swing, 3);
    expect(fast.legs.right.knee).toBeCloseTo(slow.legs.right.knee, 3);
    expect(fast.aimPitch).toBeCloseTo(slow.aimPitch, 6);
    expect(fast.lean).toBeCloseTo(slow.lean, 6);
  });

  it('follows the aim pitch, up to a limit', () => {
    expect(simulate(60, 1, new Vector3(), 0.5).out.aimPitch).toBeCloseTo(0.5, 3);
    expect(simulate(60, 1, new Vector3(), 1.5).out.aimPitch).toBeCloseTo(Math.PI / 3, 3);
    expect(simulate(60, 1, new Vector3(), -1.5).out.aimPitch).toBeCloseTo(-Math.PI / 3, 3);
  });

  it('tucks the legs in the air and dips on landing', () => {
    const state = new BodyMotionState();
    let out = state.out;
    for (let i = 0; i < 60; i += 1) out = state.step(1 / 60, new Vector3(0, -8, -5), 0, 0, false);
    expect(out.legs.left.knee).toBeGreaterThan(0.6);
    expect(out.footwork).toBeLessThan(0.01);
    let lean = 0;
    for (let i = 0; i < 20; i += 1) lean = Math.max(lean, state.step(1 / 60, new Vector3(), 0, 0, true).lean);
    expect(lean).toBeGreaterThan(0.05);
    for (let i = 0; i < 120; i += 1) out = state.step(1 / 60, new Vector3(), 0, 0, true);
    expect(out.lean).toBeCloseTo(0, 3);
    expect(out.legs.left.knee).toBeCloseTo(0, 3);
  });

  it('swings the knife through and back, and a new swing carries on from the last', () => {
    const state = new BodyMotionState();
    state.triggerAttack('primary');
    const values: number[] = [];
    for (let i = 0; i < 240; i += 1) {
      if (i === 60) state.triggerAttack('primary');
      values.push(state.step(1 / 240, new Vector3(), 0, 0, true).attack.upper[0]);
    }
    expect(Math.max(...values.map(Math.abs))).toBeGreaterThan(0.3);
    // the old swing restarted from nothing; now neither the arm nor its speed jumps at the new swing
    const stepAt = (i: number) => values[i] - values[i - 1];
    expect(Math.abs(values[60] - values[59])).toBeLessThan(Math.abs(stepAt(59)) + 0.005);
    expect(Math.abs(stepAt(60) - stepAt(59))).toBeLessThan(0.006);
    for (let i = 0; i < 240; i += 1) state.step(1 / 240, new Vector3(), 0, 0, true);
    expect(Math.abs(state.out.attack.upper[0])).toBeLessThan(1e-4);
    expect(Math.abs(state.out.attack.twist)).toBeLessThan(1e-4);
  });
});
