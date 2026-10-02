import { SKIN_INFO, SWATCHES, type ArmorSlot, type BodyId } from '../../characters/catalog';
import { looksEqual, type CharacterLook } from '../../characters/look';

/**
 * the dom free half of the customize screen: orbit camera math, the slot
 * focus shots, undo history and a few look helpers. kept pure so it runs in
 * node tests.
 */

// --- orbit camera ------------------------------------------------------------

/** where the preview camera sits, as an orbit around a point on the y axis */
export interface OrbitView {
  /** radians around +y, 0 puts the camera on +z in front of the character, unbounded */
  yaw: number;
  /** radians above the target, negative looks up from below */
  pitch: number;
  /** metres from the camera to the target */
  distance: number;
  /** height of the point the camera looks at, metres */
  targetY: number;
}

export interface OrbitLimits {
  minPitch: number;
  maxPitch: number;
  minDistance: number;
  maxDistance: number;
  minTargetY: number;
  maxTargetY: number;
  /** the camera never goes lower than this, so it can't look up through the floor */
  minCameraY: number;
}

export const ORBIT_LIMITS: OrbitLimits = {
  minPitch: -0.3,
  maxPitch: 1.15,
  minDistance: 0.6,
  maxDistance: 7,
  minTargetY: 0.2,
  maxTargetY: 1.75,
  minCameraY: 0.1,
};

/** radians of orbit per css pixel of drag */
export const ORBIT_RAD_PER_PX = 0.0085;
/** how fast the camera catches up with where it should be, per second */
export const VIEW_DAMPING = 9;
/** how fast a flicked spin slows down, per second */
export const SPIN_FRICTION = 3.2;
/** spins slower than this (rad/s) just stop */
const MIN_SPIN = 0.05;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** lowest pitch that keeps the camera above `minCameraY` for this target and distance */
export function floorPitch(targetY: number, distance: number, limits: OrbitLimits = ORBIT_LIMITS): number {
  if (distance <= 0) return limits.minPitch;
  return Math.asin(clamp((limits.minCameraY - targetY) / distance, -1, 1));
}

/** distance, target height and pitch pulled back inside the limits; yaw is left alone */
export function clampView(view: OrbitView, limits: OrbitLimits = ORBIT_LIMITS): OrbitView {
  const distance = clamp(view.distance, limits.minDistance, limits.maxDistance);
  const targetY = clamp(view.targetY, limits.minTargetY, limits.maxTargetY);
  const minPitch = Math.max(limits.minPitch, floorPitch(targetY, distance, limits));
  return {
    yaw: view.yaw,
    pitch: clamp(view.pitch, minPitch, limits.maxPitch),
    distance,
    targetY,
  };
}

/** drag right spins the character right, drag down raises the camera */
export function orbitByDrag(view: OrbitView, dxPx: number, dyPx: number, radPerPx = ORBIT_RAD_PER_PX): OrbitView {
  return clampView({ ...view, yaw: view.yaw - dxPx * radPerPx, pitch: view.pitch + dyPx * radPerPx * 0.75 });
}

/** vertical pan that keeps the point under the cursor under the cursor */
export function panByDrag(view: OrbitView, dyPx: number, viewportHeightPx: number, fovDeg: number): OrbitView {
  const halfFov = (fovDeg * Math.PI) / 360;
  const metresPerPx = (2 * view.distance * Math.tan(halfFov)) / Math.max(1, viewportHeightPx);
  return clampView({ ...view, targetY: view.targetY + dyPx * metresPerPx });
}

/**
 * wheel delta to a distance multiplier. deltaMode 1 is lines, 2 is pages;
 * ctrl+wheel is how trackpad pinches arrive, those deltas are small so they
 * get a bigger gain
 */
export function wheelZoomFactor(deltaY: number, deltaMode = 0, pinch = false): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  const gain = pinch ? 0.01 : 0.0015;
  return Math.exp(clamp(px * gain, -0.5, 0.5));
}

export function zoomView(view: OrbitView, factor: number): OrbitView {
  return clampView({ ...view, distance: view.distance * factor });
}

/** two finger pinch: fingers twice as far apart halves the distance */
export function pinchView(start: OrbitView, startGapPx: number, gapPx: number): OrbitView {
  if (startGapPx <= 0 || gapPx <= 0) return clampView(start);
  return zoomView(start, startGapPx / gapPx);
}

/** framerate independent ease of `current` towards `goal`, `rate` per second */
export function damp(current: number, goal: number, rate: number, dt: number): number {
  return current + (goal - current) * (1 - Math.exp(-rate * Math.max(0, dt)));
}

export function dampView(current: OrbitView, goal: OrbitView, dt: number, rate = VIEW_DAMPING): OrbitView {
  return {
    yaw: damp(current.yaw, goal.yaw, rate, dt),
    pitch: damp(current.pitch, goal.pitch, rate, dt),
    distance: damp(current.distance, goal.distance, rate, dt),
    targetY: damp(current.targetY, goal.targetY, rate, dt),
  };
}

/** whether two views are close enough that nobody would see the difference */
export function viewsSettled(a: OrbitView, b: OrbitView, epsilon = 1e-3): boolean {
  return (
    Math.abs(a.yaw - b.yaw) < epsilon
    && Math.abs(a.pitch - b.pitch) < epsilon
    && Math.abs(a.distance - b.distance) < epsilon
    && Math.abs(a.targetY - b.targetY) < epsilon
  );
}

/**
 * one frame of a flicked spin: how much yaw to add and the slower velocity
 * for next frame. integrates v * e^(-friction * t) exactly so it doesn't
 * depend on the frame rate
 */
export function stepSpin(velocity: number, dt: number, friction = SPIN_FRICTION): { delta: number; velocity: number } {
  if (Math.abs(velocity) < MIN_SPIN) return { delta: 0, velocity: 0 };
  if (dt <= 0) return { delta: 0, velocity };
  const decay = Math.exp(-friction * dt);
  return { delta: (velocity * (1 - decay)) / friction, velocity: velocity * decay };
}

/** `angle` moved by whole turns so it lands as close as possible to `reference` */
export function nearestAngle(reference: number, angle: number): number {
  const turn = Math.PI * 2;
  return angle + Math.round((reference - angle) / turn) * turn;
}

export function viewCameraPosition(view: OrbitView): { x: number; y: number; z: number } {
  const flat = view.distance * Math.cos(view.pitch);
  return {
    x: flat * Math.sin(view.yaw),
    y: view.targetY + view.distance * Math.sin(view.pitch),
    z: flat * Math.cos(view.yaw),
  };
}

// --- slot focus ----------------------------------------------------------------

/** what the camera frames: the whole character or one armor slot */
export type ViewFocus = 'full' | ArmorSlot;

export interface FocusShot {
  /** height the camera looks at, metres (feet at 0, about 1.8 tall) */
  targetY: number;
  /** metres of character that must fit top to bottom */
  frameHeight: number;
  /** metres that must fit side to side */
  frameWidth: number;
  yaw: number;
  pitch: number;
}

// negative yaw swings the camera to the character's right side, where the knife hand is
export const FOCUS_SHOTS: Record<ViewFocus, FocusShot> = {
  full: { targetY: 0.93, frameHeight: 2.2, frameWidth: 1.3, yaw: -0.38, pitch: 0.06 },
  helmet: { targetY: 1.64, frameHeight: 0.72, frameWidth: 0.66, yaw: -0.5, pitch: 0.05 },
  arms: { targetY: 1.22, frameHeight: 1.08, frameWidth: 1.05, yaw: -0.8, pitch: 0.1 },
  chest: { targetY: 1.3, frameHeight: 0.9, frameWidth: 0.85, yaw: -0.22, pitch: 0.05 },
  legs: { targetY: 0.52, frameHeight: 1.22, frameWidth: 0.85, yaw: -0.3, pitch: 0.1 },
  // capes and cloaks hang at the back, so this one looks from behind
  classItem: { targetY: 1.05, frameHeight: 1.6, frameWidth: 1.05, yaw: -(Math.PI - 0.55), pitch: 0.12 },
};

/** camera distance that fits a frameWidth x frameHeight window at the target */
export function fitDistance(frameHeight: number, frameWidth: number, aspect: number, fovDeg: number): number {
  const halfV = (fovDeg * Math.PI) / 360;
  const halfH = Math.atan(Math.tan(halfV) * Math.max(0.1, aspect));
  return Math.max(frameHeight / 2 / Math.tan(halfV), frameWidth / 2 / Math.tan(halfH));
}

/**
 * the view for a focus. `fromYaw` is where the camera is now, the shot's yaw
 * is moved by whole turns to the nearest match so a spun camera doesn't unwind
 */
export function focusView(focus: ViewFocus, aspect: number, fovDeg: number, fromYaw = 0): OrbitView {
  const shot = FOCUS_SHOTS[focus];
  return clampView({
    yaw: nearestAngle(fromYaw, shot.yaw),
    pitch: shot.pitch,
    distance: fitDistance(shot.frameHeight, shot.frameWidth, aspect, fovDeg),
    targetY: shot.targetY,
  });
}

/** keeps the user's zoom when the stage changes shape: scales the distance by the new fit */
export function refitView(view: OrbitView, focus: ViewFocus, oldAspect: number, newAspect: number, fovDeg: number): OrbitView {
  const shot = FOCUS_SHOTS[focus];
  const before = fitDistance(shot.frameHeight, shot.frameWidth, oldAspect, fovDeg);
  const after = fitDistance(shot.frameHeight, shot.frameWidth, newAspect, fovDeg);
  return clampView({ ...view, distance: view.distance * (after / before) });
}

// --- edit history --------------------------------------------------------------

/**
 * undo and redo over whole looks. edits that share a `group` in a row (a
 * colour picker drag, typing a tag) fold into one step
 */
export class LookHistory {
  private entries: CharacterLook[];
  private index = 0;
  private group: string | null = null;

  constructor(initial: CharacterLook, private readonly limit = 60) {
    this.entries = [{ ...initial }];
  }

  get current(): CharacterLook {
    return { ...this.entries[this.index] };
  }

  get canUndo(): boolean {
    return this.index > 0;
  }

  get canRedo(): boolean {
    return this.index < this.entries.length - 1;
  }

  reset(look: CharacterLook): void {
    this.entries = [{ ...look }];
    this.index = 0;
    this.group = null;
  }

  /** returns false when the look didn't actually change */
  record(look: CharacterLook, group: string | null = null): boolean {
    if (looksEqual(look, this.entries[this.index])) return false;
    this.entries.length = this.index + 1;
    if (group !== null && group === this.group && this.index > 0) {
      this.entries[this.index] = { ...look };
      // dragged back to where the group started: nothing left to undo
      if (looksEqual(look, this.entries[this.index - 1])) {
        this.entries.pop();
        this.index -= 1;
        this.group = null;
      }
      return true;
    }
    this.entries.push({ ...look });
    this.index += 1;
    this.group = group;
    while (this.entries.length > this.limit) {
      this.entries.shift();
      this.index -= 1;
    }
    return true;
  }

  /** the next edit starts a new step even if it has the same group */
  endGroup(): void {
    this.group = null;
  }

  undo(): CharacterLook | null {
    this.group = null;
    if (!this.canUndo) return null;
    this.index -= 1;
    return this.current;
  }

  redo(): CharacterLook | null {
    this.group = null;
    if (!this.canRedo) return null;
    this.index += 1;
    return this.current;
  }
}

// --- look helpers --------------------------------------------------------------

/** same pieces, paint, finish and emblem; the tag and the watch don't count */
export function sameStyle(a: CharacterLook, b: CharacterLook): boolean {
  return looksEqual({ ...a, tag: '', watch: true }, { ...b, tag: '', watch: true });
}

/**
 * puts a preset on. built-in presets (and random rolls) keep the player's own
 * tag and watch, saved looks bring back everything they stored
 */
export function applyPreset(current: CharacterLook, preset: CharacterLook, keepPersonal: boolean): CharacterLook {
  return keepPersonal ? { ...preset, tag: current.tag, watch: current.watch } : { ...preset };
}

/**
 * switches the body. a skin starts in its own paint, to repaint from there
 * (worn and camo are kit paint jobs, skins go satin); the kit keeps the
 * current colours and pieces
 */
export function withBody(look: CharacterLook, body: BodyId): CharacterLook {
  if (body === look.skin) return look;
  if (body === 'kit') return { ...look, skin: 'kit' };
  const finish = look.finish === 'worn' || look.finish === 'camo' ? 'satin' : look.finish;
  return { ...look, skin: body, ...SKIN_INFO[body].paint, finish };
}

/** '#abc', 'abc', '#AABBCC' or 'aabbcc' to '#aabbcc'; anything else is null */
export function parseHexInput(value: string): string | null {
  const raw = value.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{6}$/.test(raw)) return `#${raw}`;
  if (/^[0-9a-f]{3}$/.test(raw)) return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`;
  return null;
}

/** the palette name for a colour, null for custom colours */
export function swatchName(hex: string): string | null {
  const lower = hex.toLowerCase();
  return SWATCHES.find((swatch) => swatch.hex === lower)?.name ?? null;
}

/** first free "Look N" name for the save box */
export function nextSavedName(existing: readonly string[]): string {
  const taken = new Set(existing.map((name) => name.trim().toLowerCase()));
  for (let n = 1; ; n += 1) {
    const name = `Look ${n}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}
