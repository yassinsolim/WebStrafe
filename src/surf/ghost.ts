/**
 * ghost replays: feet position + yaw sampled every few fixed ticks, stored as
 * quantized int16 deltas (cm and yaw steps) so a 5 minute run is ~70 KB of
 * base64. a delta that doesn't fit int16 (a teleport) is written as an escape
 * frame followed by the absolute int32 values.
 */

import { RUN_TICK_RATE } from './RunTimer';

/** one sample every 6 ticks, ~21 Hz */
export const GHOST_TICKS_PER_FRAME = 6;
export const GHOST_FORMAT_VERSION = 1;
/** hard cap so a stuck run can't grow without bound (~30 min) */
export const GHOST_MAX_FRAMES = 40_000;

const ESCAPE = -32768;
const YAW_SCALE = 32767 / Math.PI;

export interface GhostFrame {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface Ghost {
  ticksPerFrame: number;
  frames: GhostFrame[];
}

function wrapYaw(yaw: number): number {
  const twoPi = Math.PI * 2;
  let y = ((yaw + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
  if (y >= Math.PI) y -= twoPi;
  return y;
}

export class GhostRecorder {
  private frames: GhostFrame[] = [];
  private ticks = 0;

  reset(): void {
    this.frames = [];
    this.ticks = 0;
  }

  /** call once per running tick */
  sample(x: number, y: number, z: number, yaw: number): void {
    if (this.ticks % GHOST_TICKS_PER_FRAME === 0 && this.frames.length < GHOST_MAX_FRAMES) {
      this.frames.push({ x, y, z, yaw: wrapYaw(yaw) });
    }
    this.ticks += 1;
  }

  take(): Ghost {
    return { ticksPerFrame: GHOST_TICKS_PER_FRAME, frames: this.frames.slice() };
  }
}

export function encodeGhost(ghost: Ghost): string {
  const words: number[] = [GHOST_FORMAT_VERSION, ghost.ticksPerFrame];
  let px = 0;
  let py = 0;
  let pz = 0;
  let pw = 0;
  let first = true;
  for (const f of ghost.frames) {
    const qx = Math.round(f.x * 100);
    const qy = Math.round(f.y * 100);
    const qz = Math.round(f.z * 100);
    const qw = Math.round(wrapYaw(f.yaw) * YAW_SCALE);
    const dx = qx - px;
    const dy = qy - py;
    const dz = qz - pz;
    const dw = qw - pw;
    const fits = (v: number) => v > ESCAPE && v <= 32767;
    if (first || !fits(dx) || !fits(dy) || !fits(dz) || !fits(dw)) {
      words.push(ESCAPE, qx >> 16, qx & 0xffff, qy >> 16, qy & 0xffff, qz >> 16, qz & 0xffff, qw);
      first = false;
    } else {
      words.push(dx, dy, dz, dw);
    }
    px = qx;
    py = qy;
    pz = qz;
    pw = qw;
  }
  const buf = new Int16Array(words.length);
  for (let i = 0; i < words.length; i += 1) buf[i] = words[i];
  const bytes = new Uint8Array(buf.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function decodeGhost(data: string): Ghost | null {
  try {
    const bin = atob(data);
    if (bin.length % 2 !== 0 || bin.length < 4) return null;
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const w = new Int16Array(bytes.buffer);
    if (w[0] !== GHOST_FORMAT_VERSION || w[1] <= 0) return null;
    const frames: GhostFrame[] = [];
    let qx = 0;
    let qy = 0;
    let qz = 0;
    let qw = 0;
    let i = 2;
    const int32 = (hi: number, lo: number) => hi * 65536 + (lo & 0xffff);
    while (i < w.length && frames.length < GHOST_MAX_FRAMES) {
      if (w[i] === ESCAPE) {
        if (i + 8 > w.length) return null;
        qx = int32(w[i + 1], w[i + 2]);
        qy = int32(w[i + 3], w[i + 4]);
        qz = int32(w[i + 5], w[i + 6]);
        qw = w[i + 7];
        i += 8;
      } else {
        if (i + 4 > w.length) return null;
        qx += w[i];
        qy += w[i + 1];
        qz += w[i + 2];
        qw += w[i + 3];
        i += 4;
      }
      frames.push({ x: qx / 100, y: qy / 100, z: qz / 100, yaw: qw / YAW_SCALE });
    }
    return { ticksPerFrame: w[1], frames };
  } catch {
    return null;
  }
}

/** interpolated ghost pose at a run time, null once the ghost has finished */
export function ghostPoseAt(ghost: Ghost, runMs: number): GhostFrame | null {
  if (ghost.frames.length === 0 || runMs < 0) return null;
  const frameMs = (ghost.ticksPerFrame * 1000) / RUN_TICK_RATE;
  const pos = runMs / frameMs;
  const i = Math.floor(pos);
  if (i >= ghost.frames.length - 1) {
    return i === ghost.frames.length - 1 ? { ...ghost.frames[i] } : null;
  }
  const a = ghost.frames[i];
  const b = ghost.frames[i + 1];
  const t = pos - i;
  // a teleport shows up as a big jump, snap instead of sliding across the map
  if (Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) > 12) return { ...(t < 0.5 ? a : b) };
  let dYaw = b.yaw - a.yaw;
  if (dYaw > Math.PI) dYaw -= Math.PI * 2;
  if (dYaw < -Math.PI) dYaw += Math.PI * 2;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    yaw: a.yaw + dYaw * t,
  };
}
