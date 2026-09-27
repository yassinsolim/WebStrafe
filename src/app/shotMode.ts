import type { WeaponId } from '../combat/weapons';

/**
 * dev and preview screenshot mode, from the query string:
 * ?shot=<mapId>&weapon=knife|deagle|awp&knife=<id>&clip=idle|draw|inspect|fire|reload&t=<s>
 * &yaw=<deg>&pitch=<deg>&pos=x,y,z&time=HH:MM:SS&hud=0
 * &perf=<s> (frame timing, clip keeps looping)&scope=1|2&pr=<pixel ratio>
 * &dpr=<screen ratio to emulate>&adaptive=0|1
 * it drops straight into the map without pointer lock, poses the viewmodel,
 * freezes it and sets window.__shotReady once a few frames have drawn.
 */
export interface ShotRequest {
  mapId: string;
  weapon: WeaponId | null;
  knife: string | null;
  clip: string;
  t: number;
  yawDeg: number | null;
  pitchDeg: number | null;
  position: [number, number, number] | null;
  time: Date | null;
  hud: boolean;
  /** seconds of frame timing to collect, 0 = off */
  perfSeconds: number;
  /** awp zoom level to hold, 0 = unscoped */
  scope: number;
  /** override the renderer pixel ratio */
  pixelRatio: number | null;
  /** pretend the screen has this device pixel ratio (adaptive resolution stays on) */
  dpr: number | null;
  /** adaptive resolution on or off for this run (default: the saved setting) */
  adaptive: boolean | null;
  /** adaptive step-down threshold for testing the low-power path */
  adaptiveLowFps: number | null;
}

export function parseShotRequest(search: string): ShotRequest | null {
  const params = new URLSearchParams(search);
  const mapId = params.get('shot');
  if (!mapId) return null;
  const weapon = params.get('weapon');
  const num = (key: string): number | null => {
    const raw = params.get(key);
    if (raw === null || raw === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };
  const pos = params.get('pos')?.split(',').map(Number);
  let time: Date | null = null;
  const clock = params.get('time');
  if (clock) {
    const [h, m, s] = clock.split(':').map(Number);
    time = new Date();
    time.setHours(h || 0, m || 0, s || 0, 0);
  }
  return {
    mapId,
    weapon: weapon === 'knife' || weapon === 'deagle' || weapon === 'awp' ? weapon : null,
    knife: params.get('knife'),
    clip: params.get('clip') ?? 'idle',
    t: num('t') ?? 0,
    yawDeg: num('yaw'),
    pitchDeg: num('pitch'),
    position: pos && pos.length === 3 && pos.every(Number.isFinite) ? [pos[0], pos[1], pos[2]] : null,
    time,
    hud: params.get('hud') !== '0',
    perfSeconds: num('perf') ?? 0,
    scope: num('scope') ?? 0,
    pixelRatio: num('pr'),
    dpr: num('dpr'),
    adaptiveLowFps: num('adaptiveLow'),
    adaptive: params.has('adaptive') ? params.get('adaptive') !== '0' : null,
  };
}
