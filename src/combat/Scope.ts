export type ZoomLevel = 0 | 1 | 2;

/**
 * AWP zoom from CS2's scripts/weapons.vdata (SteamTracking/GameTracking-CS2 @
 * 10f3693): m_nZoomFOV1/2 = 40 / 10 against the default 90, and
 * m_flZoomTime0/1/2 = 0.05 s.
 */
export const AWP_SCOPE = {
  zoomFovDeg: [40, 10] as const,
  referenceFovDeg: 90,
  zoomTimeSec: 0.05,
} as const;

/** cs zoom_sensitivity_ratio default */
export const DEFAULT_ZOOM_SENSITIVITY_RATIO = 1;

export interface ScopeContext {
  /** the AWP is the active weapon */
  awpHeld: boolean;
  reloading: boolean;
  alive: boolean;
}

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/**
 * Zoomed camera fov for a player's base fov. Keeps CS's magnification (the
 * tangent ratio of 40 or 10 against 90, about 2.7x and 11.4x) so the zoom
 * feels the same whatever world fov the player picked.
 */
export function zoomedFovDeg(baseFovDeg: number, level: ZoomLevel): number {
  if (level === 0) return baseFovDeg;
  const magnification = Math.tan(toRad(AWP_SCOPE.zoomFovDeg[level - 1]) / 2)
    / Math.tan(toRad(AWP_SCOPE.referenceFovDeg) / 2);
  return toDeg(2 * Math.atan(Math.tan(toRad(baseFovDeg) / 2) * magnification));
}

/**
 * AWP scope as a pure state machine. Right click cycles unscoped -> 1 -> 2 ->
 * unscoped. A shot unscopes, and once the bolt cycle is over the scope comes
 * back at the old zoom if the AWP is still out, the player is alive and not
 * reloading. The zoom can't change while the bolt cycles (cs gates the
 * secondary attack on the cycle time too). Reloads, weapon switches and death
 * cancel it. Times are ms in the caller's clock.
 */
export class ScopeState {
  private level: ZoomLevel = 0;
  private resumeLevel: ZoomLevel = 0;
  private resumePending = false;
  private boltUntilMs = Number.NEGATIVE_INFINITY;
  private fromLevel: ZoomLevel = 0;
  private transitionStartMs = Number.NEGATIVE_INFINITY;

  getLevel(): ZoomLevel {
    return this.level;
  }

  isScoped(): boolean {
    return this.level !== 0;
  }

  isBoltCycling(nowMs: number): boolean {
    return nowMs < this.boltUntilMs;
  }

  /** right click; false when the zoom may not change right now */
  cycle(nowMs: number, context: ScopeContext): boolean {
    if (!context.awpHeld || context.reloading || !context.alive || this.isBoltCycling(nowMs)) {
      return false;
    }
    this.setLevel(((this.level + 1) % 3) as ZoomLevel, nowMs);
    return true;
  }

  /** an AWP shot: unscope now, come back to this zoom after the bolt */
  onShot(nowMs: number, boltCycleMs: number): void {
    this.resumeLevel = this.level;
    this.resumePending = this.level !== 0;
    this.boltUntilMs = nowMs + Math.max(0, boltCycleMs);
    this.setLevel(0, nowMs);
  }

  /** re-scopes once the bolt cycle is over */
  update(nowMs: number, context: ScopeContext): void {
    if (!this.resumePending || this.isBoltCycling(nowMs)) {
      return;
    }
    this.resumePending = false;
    if (context.awpHeld && !context.reloading && context.alive) {
      this.setLevel(this.resumeLevel, nowMs);
    }
  }

  /** reload, weapon switch, death, pause: unscope and drop a pending re-scope */
  cancel(nowMs: number): void {
    this.resumePending = false;
    this.setLevel(0, nowMs);
  }

  reset(): void {
    this.level = 0;
    this.resumeLevel = 0;
    this.resumePending = false;
    this.boltUntilMs = Number.NEGATIVE_INFINITY;
    this.fromLevel = 0;
    this.transitionStartMs = Number.NEGATIVE_INFINITY;
  }

  /** camera fov right now, easing over the cs zoom time */
  getFovDeg(baseFovDeg: number, nowMs: number): number {
    const target = zoomedFovDeg(baseFovDeg, this.level);
    const progress = (nowMs - this.transitionStartMs) / (AWP_SCOPE.zoomTimeSec * 1000);
    if (!(progress < 1)) return target;
    const from = zoomedFovDeg(baseFovDeg, this.fromLevel);
    return from + (target - from) * Math.max(0, progress);
  }

  /**
   * Mouse sensitivity multiplier, cs style: zoomed fov over base fov, times
   * the zoom sensitivity ratio. 1 when unscoped.
   */
  getSensitivityScale(baseFovDeg: number, zoomSensitivityRatio = DEFAULT_ZOOM_SENSITIVITY_RATIO): number {
    if (this.level === 0) return 1;
    return (zoomedFovDeg(baseFovDeg, this.level) / baseFovDeg) * zoomSensitivityRatio;
  }

  private setLevel(level: ZoomLevel, nowMs: number): void {
    if (level === this.level) return;
    this.fromLevel = this.level;
    this.level = level;
    this.transitionStartMs = nowMs;
  }
}
