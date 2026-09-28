import type { WeaponId } from '../combat/weapons';
import type { GraphicsQuality } from '../ui/SettingsStore';
import { devToolsEnabled } from './devTools';

/**
 * dev and preview screenshot mode, from the query string:
 * ?shot=<mapId>&weapon=knife|deagle|awp&knife=<id>&clip=idle|draw|inspect|fire|reload&t=<s>
 * &yaw=<deg>&pitch=<deg>&pos=x,y,z&time=HH:MM:SS&hud=0
 * &perf=<s> (frame timing, clip keeps looping)&scope=1|2&pr=<pixel ratio>
 * &dpr=<screen ratio to emulate>&adaptive=0|1&qa=1 (window.__qa test hooks)
 * &quality=low|medium|high (graphics preset for this run)
 * &hudDemo=1|board|death|low|kill|body (sample killfeed, scores and hit feedback)
 * &vm=0 (no viewmodel, for map thumbnails)&cam=x,y,z (free camera eye position, no gravity)
 * it drops straight into the map without pointer lock, poses the viewmodel,
 * freezes it and sets window.__shotReady once a few frames have drawn.
 * dev server and preview builds only. without qa=1 it plays offline; qa=1
 * joins the build's lobby (the isolated preview lobby on vercel previews).
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
  /** exposes window.__qa for automated multiplayer tests */
  qa: boolean;
  /** runs the in-engine grip check over every knife and frame (window.__gripReport) */
  gripCheck: boolean;
  /** grip check: sweep every clip at this step (seconds) instead of the key frames */
  gripStep: number;
  /** graphics preset for this run, null keeps the saved setting */
  quality: GraphicsQuality | null;
  /** fills the hud with sample data for screenshots: 1, board, death, low, kill, body */
  hudDemo: string | null;
  /** draw the gun and arms, off for map thumbnails */
  viewmodel: boolean;
  /** free camera eye position, looks along yaw/pitch */
  camera: [number, number, number] | null;
}

export function parseShotRequest(search: string, enabled = devToolsEnabled()): ShotRequest | null {
  if (!enabled) return null;
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
  const cam = params.get('cam')?.split(',').map(Number);
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
    qa: params.get('qa') === '1',
    gripCheck: params.get('gripcheck') === '1',
    gripStep: Math.max(0, Number(params.get('gripstep') ?? 0) || 0),
    adaptive: params.has('adaptive') ? params.get('adaptive') !== '0' : null,
    quality: parseQuality(params.get('quality')),
    hudDemo: params.get('hudDemo') || null,
    viewmodel: params.get('vm') !== '0',
    camera: cam && cam.length === 3 && cam.every(Number.isFinite) ? [cam[0], cam[1], cam[2]] : null,
  };
}

function parseQuality(raw: string | null): GraphicsQuality | null {
  return raw === 'low' || raw === 'medium' || raw === 'high' || raw === 'auto' ? raw : null;
}
