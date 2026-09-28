import { describe, expect, it } from 'vitest';
import { GhostRecorder, GHOST_TICKS_PER_FRAME, decodeGhost, encodeGhost, ghostPoseAt } from '../ghost';
import { RUN_TICK_RATE } from '../RunTimer';

function recordLine(ticks: number, speed = 30): GhostRecorder {
  const rec = new GhostRecorder();
  for (let i = 0; i < ticks; i += 1) {
    const t = i / RUN_TICK_RATE;
    rec.sample(-1200 + t * speed, 300 - t * 4, 50 + Math.sin(t) * 20, t * 2);
  }
  return rec;
}

describe('ghost encoding', () => {
  it('round trips within 1 cm and one yaw step', () => {
    const ghost = recordLine(128 * 20).take();
    const back = decodeGhost(encodeGhost(ghost))!;
    expect(back.ticksPerFrame).toBe(GHOST_TICKS_PER_FRAME);
    expect(back.frames).toHaveLength(ghost.frames.length);
    for (let i = 0; i < ghost.frames.length; i += 1) {
      const a = ghost.frames[i];
      const b = back.frames[i];
      expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(0.005 + 1e-9);
      expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(0.005 + 1e-9);
      expect(Math.abs(a.z - b.z)).toBeLessThanOrEqual(0.005 + 1e-9);
      expect(Math.abs(Math.atan2(Math.sin(a.yaw - b.yaw), Math.cos(a.yaw - b.yaw)))).toBeLessThan(1e-3);
    }
  });

  it('survives teleports with an escape frame and stays small', () => {
    const rec = new GhostRecorder();
    for (let i = 0; i < 128 * 300; i += 1) {
      const teleported = i > 128 * 150 ? 900 : 0;
      rec.sample(i * 0.2 - teleported, 10, -teleported, 0);
    }
    const encoded = encodeGhost(rec.take());
    // a 5 minute run: 8 bytes per frame, well under 100 KB of base64
    expect(encoded.length).toBeLessThan(100_000);
    const back = decodeGhost(encoded)!;
    const last = back.frames.at(-1)!;
    expect(last.x).toBeCloseTo((128 * 300 - GHOST_TICKS_PER_FRAME) * 0.2 - 900, 1);
    expect(last.z).toBeCloseTo(-900, 2);
  });

  it('rejects junk', () => {
    expect(decodeGhost('not base64 !!')).toBeNull();
    expect(decodeGhost(btoa('\u0009\u0000\u0006\u0000'))).toBeNull();
  });

  it('interpolates poses and ends after the last frame', () => {
    const ghost = recordLine(128 * 2, 30).take();
    const mid = ghostPoseAt(ghost, 500)!;
    expect(mid.x).toBeCloseTo(-1200 + 0.5 * 30, 1);
    expect(ghostPoseAt(ghost, 60_000)).toBeNull();
  });
});
