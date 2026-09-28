import { describe, expect, it } from 'vitest';
import { createSeededRandom } from '../Inaccuracy';
import { Recoil, RECOIL_PROFILES, RECOIL_TUNING } from '../Recoil';

const TICK = 1 / 128;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

function trace(recoil: Recoil, seconds: number): Array<{ t: number; aim: number; view: number; yaw: number }> {
  const out = [];
  for (let t = TICK; t <= seconds + 1e-9; t += TICK) {
    recoil.tick(TICK);
    const aim = recoil.getAimOffset();
    out.push({ t, aim: toDeg(aim.pitch), view: toDeg(recoil.getViewOffset().pitch), yaw: toDeg(aim.yaw) });
  }
  return out;
}

/** random source that always returns the same value, so the kick has no variance */
const centered = () => 0.5;

describe('Recoil', () => {
  it('kicks the deagle up hard and recovers within about 0.3 to 0.5 s', () => {
    const recoil = new Recoil(centered);
    recoil.kick(RECOIL_PROFILES.deagle);
    const samples = trace(recoil, 0.8);
    const peak = samples.reduce((best, s) => (s.aim > best.aim ? s : best));
    expect(peak.aim).toBeGreaterThan(2);
    expect(peak.aim).toBeLessThan(4);
    expect(peak.t).toBeLessThan(0.2);
    const recovered = samples.find((s) => s.t > peak.t && s.aim < peak.aim * 0.05);
    expect(recovered?.t).toBeGreaterThan(0.3);
    expect(recovered?.t).toBeLessThan(0.5);
    expect(Math.abs(samples.at(-1)!.aim)).toBeLessThan(0.05);
  });

  it('shows a sharp visual kick that fades before the tracked punch', () => {
    const recoil = new Recoil(centered);
    recoil.kick(RECOIL_PROFILES.deagle);
    recoil.tick(TICK);
    const first = toDeg(recoil.getViewOffset().pitch);
    expect(first).toBeGreaterThan(RECOIL_PROFILES.deagle.magnitude * RECOIL_TUNING.viewPunchExtra * 0.8);
    const later = trace(recoil, 0.3).at(-1)!;
    // once the extra kick is gone the camera shows 45% of where bullets go
    expect(later.view).toBeCloseTo(later.aim * RECOIL_TUNING.viewTracking, 1);
  });

  it('drifts sideways inside the cs angle variance', () => {
    const recoil = new Recoil(createSeededRandom(3));
    let maxSide = 0;
    for (let shot = 0; shot < 20; shot += 1) {
      recoil.reset();
      recoil.kick(RECOIL_PROFILES.deagle);
      const samples = trace(recoil, 0.12);
      const last = samples.at(-1)!;
      maxSide = Math.max(maxSide, Math.abs(last.yaw));
      // never more sideways than up: +-60 degrees around vertical
      expect(Math.abs(last.yaw)).toBeLessThanOrEqual(Math.tan((60 * Math.PI) / 180) * last.aim + 1e-9);
    }
    expect(maxSide).toBeGreaterThan(0.3);
  });

  it('gives the awp a heavier single kick than the deagle', () => {
    const deagle = new Recoil(centered);
    deagle.kick(RECOIL_PROFILES.deagle);
    const awp = new Recoil(centered);
    awp.kick(RECOIL_PROFILES.awp);
    const deaglePeak = Math.max(...trace(deagle, 0.4).map((s) => s.aim));
    const awpPeak = Math.max(...trace(awp, 0.4).map((s) => s.aim));
    expect(awpPeak).toBeGreaterThan(deaglePeak * 1.8);
  });

  it('is deterministic for a seed and clears on reset', () => {
    const a = new Recoil(createSeededRandom(9));
    const b = new Recoil(createSeededRandom(9));
    a.kick(RECOIL_PROFILES.deagle);
    b.kick(RECOIL_PROFILES.deagle);
    expect(trace(a, 0.2)).toEqual(trace(b, 0.2));
    a.reset();
    expect(a.getAimOffset()).toEqual({ pitch: 0, yaw: 0 });
    expect(a.isSettled()).toBe(true);
  });
});
