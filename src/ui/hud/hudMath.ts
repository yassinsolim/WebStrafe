type Vec3Tuple = readonly [number, number, number];
type Vec3Obj = { x: number; y: number; z: number };

function xz(value: Vec3Tuple | Vec3Obj): [number, number] {
  if (Array.isArray(value)) {
    const tuple = value as Vec3Tuple;
    return [tuple[0], tuple[2]];
  }
  const obj = value as Vec3Obj;
  return [obj.x, obj.z];
}

/**
 * Where damage came from relative to the view: radians clockwise from
 * straight ahead (0 front, +pi/2 right, pi behind). Uses the movement yaw
 * convention, forward = (-sin yaw, 0, -cos yaw). Null when the attacker is on
 * top of the player and there is no meaningful direction.
 */
export function damageDirection(
  local: Vec3Tuple | Vec3Obj,
  localYawRad: number,
  attacker: Vec3Tuple | Vec3Obj,
): number | null {
  const [lx, lz] = xz(local);
  const [ax, az] = xz(attacker);
  const dx = ax - lx;
  const dz = az - lz;
  if (!Number.isFinite(dx) || !Number.isFinite(dz) || Math.hypot(dx, dz) < 0.1 || !Number.isFinite(localYawRad)) {
    return null;
  }
  const forward = -Math.sin(localYawRad) * dx - Math.cos(localYawRad) * dz;
  const right = Math.cos(localYawRad) * dx - Math.sin(localYawRad) * dz;
  return Math.atan2(right, forward);
}

/** rolling fps and frame time over a short window */
export class FrameStats {
  private readonly samples: Array<{ at: number; ms: number }> = [];

  constructor(private readonly windowMs = 1000) {}

  push(frameMs: number, nowMs: number): void {
    if (!Number.isFinite(frameMs) || frameMs < 0) {
      return;
    }
    this.samples.push({ at: nowMs, ms: frameMs });
    const cutoff = nowMs - this.windowMs;
    while (this.samples.length > 0 && this.samples[0].at < cutoff) {
      this.samples.shift();
    }
  }

  get(): { fps: number; avgMs: number; maxMs: number; samples: number } {
    const count = this.samples.length;
    if (count === 0) {
      return { fps: 0, avgMs: 0, maxMs: 0, samples: 0 };
    }
    let total = 0;
    let max = 0;
    for (const sample of this.samples) {
      total += sample.ms;
      max = Math.max(max, sample.ms);
    }
    const avg = total / count;
    return { fps: avg > 0 ? 1000 / avg : 0, avgMs: avg, maxMs: max, samples: count };
  }

  clear(): void {
    this.samples.length = 0;
  }
}

/** 0 when healthy, rising to 1 as health drops under the threshold */
export function lowHealthIntensity(health: number, threshold = 35): number {
  if (!Number.isFinite(health) || health >= threshold) {
    return 0;
  }
  if (health <= 0) {
    return 1;
  }
  return Math.min(1, Math.max(0, 1 - health / threshold));
}

/** run time as m:ss.mmm (or s.mmm under a minute) */
export function formatRunTime(totalMs: number): string {
  const clamped = Math.max(0, Number.isFinite(totalMs) ? totalMs : 0);
  const ms = Math.floor(clamped % 1000);
  const totalSeconds = Math.floor(clamped / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60);
  const secondText = minutes > 0 ? seconds.toString().padStart(2, '0') : seconds.toString();
  return `${minutes > 0 ? `${minutes}:` : ''}${secondText}.${ms.toString().padStart(3, '0')}`;
}
