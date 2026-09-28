import { describe, expect, it } from 'vitest';
import { CombatArena } from '../CombatArena';

// target strafes along +x at 16 m/s; shooter stands 10 m back on z
const SPEED = 16;
function feetAt(tMs: number): [number, number, number] {
  return [(tMs / 1000) * SPEED, 0, 0];
}

function setup(targetClockOffsetMs: number) {
  const arena = new CombatArena();
  arena.addPlayer('shooter', 'm', 'deagle');
  arena.addPlayer('target', 'm', 'knife');
  arena.setPosition('shooter', [0, 0, 10], 'm', 0);
  // target history is stamped in the target's own clock
  for (let t = 0; t <= 1000; t += 50) {
    arena.setPosition('target', feetAt(t), 'm', t + targetClockOffsetMs, [SPEED, 0, 0]);
  }
  return arena;
}

function aimAt(x: number): { origin: [number, number, number]; dir: [number, number, number] } {
  const origin: [number, number, number] = [0, 1.6, 10];
  const dx = x;
  const dy = 1.0 - 1.6;
  const dz = -10;
  const len = Math.hypot(dx, dy, dz);
  return { origin, dir: [dx / len, dy / len, dz / len] };
}

describe('lag compensated hits', () => {
  it('hits where the shooter saw the target, not where it is now', () => {
    const arena = setup(0);
    const seenAt = 875; // between two samples, 125 ms behind the newest
    const { origin, dir } = aimAt(feetAt(seenAt)[0]);
    const outcome = arena.handleFire('shooter', origin, dir, 10_000, undefined, undefined, {
      targetTimes: { target: seenAt },
    });
    expect(outcome.hit?.targetId).toBe('target');
  });

  it('misses that same shot without rewind (target moved 2 m)', () => {
    const arena = setup(0);
    const { origin, dir } = aimAt(feetAt(875)[0]);
    const outcome = arena.handleFire('shooter', origin, dir, 10_000);
    expect(outcome.hit).toBeUndefined();
  });

  it('works when the target clock is seconds away from the authority clock', () => {
    const offset = 7_300;
    const arena = setup(offset);
    const { origin, dir } = aimAt(feetAt(640)[0]);
    const outcome = arena.handleFire('shooter', origin, dir, 10_000, undefined, undefined, {
      targetTimes: { target: 640 + offset },
    });
    expect(outcome.hit?.targetId).toBe('target');
  });

  it('clamps rewind to the lag compensation window', () => {
    const arena = setup(0);
    // asks for 1.5 s back; only 1 s is honoured, so the target sits at t=0 not t=-500
    const { origin, dir } = aimAt(feetAt(-500)[0]);
    const outcome = arena.handleFire('shooter', origin, dir, 10_000, undefined, undefined, {
      targetTimes: { target: -500 },
    });
    expect(outcome.hit).toBeUndefined();
  });

  it('follows the same short extrapolation the shooter rendered past the newest sample', () => {
    const arena = setup(0);
    // newest sample is t=1000; the shooter's renderer carried it 150 ms forward
    const { origin, dir } = aimAt(feetAt(1150)[0]);
    const outcome = arena.handleFire('shooter', origin, dir, 10_000, undefined, undefined, {
      targetTimes: { target: 1150 },
    });
    expect(outcome.hit?.targetId).toBe('target');
  });

  it('accepts a fast shooter whose origin is ahead of their last sample', () => {
    const arena = new CombatArena();
    arena.addPlayer('shooter', 'm', 'deagle');
    arena.addPlayer('target', 'm', 'knife');
    // shooter surfing at 30 m/s, last sample 200 ms old -> 6 m behind the real eye
    arena.setPosition('shooter', [0, 0, 10], 'm', 1000, [30, 0, 0]);
    arena.setPosition('target', [6, 0, 0], 'm', 1000);
    const origin: [number, number, number] = [6, 1.6, 10];
    const dir: [number, number, number] = [0, -0.06, -1];
    const len = Math.hypot(...dir);
    const unit: [number, number, number] = [dir[0] / len, dir[1] / len, dir[2] / len];
    const rejected = arena.handleFire('shooter', origin, unit, 5_000);
    expect(rejected.hit).toBeUndefined();
    arena.reload('shooter', 0);
    const arena2 = new CombatArena();
    arena2.addPlayer('shooter', 'm', 'deagle');
    arena2.addPlayer('target', 'm', 'knife');
    arena2.setPosition('shooter', [0, 0, 10], 'm', 1000, [30, 0, 0]);
    arena2.setPosition('target', [6, 0, 0], 'm', 1000);
    const accepted = arena2.handleFire('shooter', origin, unit, 5_000, undefined, undefined, {
      shooterTimeMs: 1200,
    });
    expect(accepted.hit?.targetId).toBe('target');
  });
});
