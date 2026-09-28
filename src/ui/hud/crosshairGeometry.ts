import type { CrosshairSettings } from '../SettingsStore';

/** rect relative to the screen centre, css px */
export interface CrosshairRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CrosshairLayout {
  /** top, right, bottom, left (t style drops the top), empty when the style has no arms */
  arms: CrosshairRect[];
  dot: CrosshairRect | null;
  circle: { radius: number; thickness: number } | null;
  /** half size of a box that holds everything, outline included */
  extent: number;
}

/** the widest the dynamic gap is allowed to grow, css px */
export const MAX_SPREAD_PX = 160;

/**
 * Screen distance of a cone edge from the centre: a ray `spreadRad` off the
 * view axis lands tan(spread) / tan(vfov / 2) of half the screen height away.
 */
export function spreadToPixels(spreadRad: number, verticalFovDeg: number, viewportHeightPx: number): number {
  if (!Number.isFinite(spreadRad) || spreadRad <= 0 || !(viewportHeightPx > 0)) {
    return 0;
  }
  const halfFov = (Math.max(1, Math.min(179, verticalFovDeg)) * Math.PI) / 360;
  const spread = Math.min(spreadRad, Math.PI / 2 - 0.01);
  const px = (Math.tan(spread) / Math.tan(halfFov)) * (viewportHeightPx / 2);
  return Math.min(MAX_SPREAD_PX, px);
}

export function computeCrosshairLayout(settings: CrosshairSettings, spreadPx = 0): CrosshairLayout {
  const spread = settings.dynamicSpread ? Math.max(0, spreadPx) : 0;
  const t = Math.max(0.5, settings.thickness);
  const outline = settings.outline ? Math.max(0, settings.outlineThickness ?? 1) : 0;
  const dotSize = Math.max(t, 2);

  if (settings.style === 'dot') {
    const dot = centered(dotSize);
    return { arms: [], dot, circle: null, extent: dotSize / 2 + outline };
  }

  if (settings.style === 'circle-dot') {
    const radius = Math.max(3, settings.gap + settings.size + spread);
    return {
      arms: [],
      dot: centered(dotSize),
      circle: { radius, thickness: t },
      extent: radius + t / 2 + outline,
    };
  }

  const gap = settings.gap + spread;
  const length = Math.max(0, settings.size);
  const dot = settings.dot ? centered(dotSize) : null;
  if (length <= 0) {
    return { arms: [], dot, circle: null, extent: (dot ? dotSize / 2 : 0) + outline };
  }
  const half = t / 2;
  const arms: CrosshairRect[] = [
    { x: -half, y: -(gap + length), w: t, h: length },
    { x: gap, y: -half, w: length, h: t },
    { x: -half, y: gap, w: t, h: length },
    { x: -(gap + length), y: -half, w: length, h: t },
  ];
  if (settings.tStyle) {
    arms.shift();
  }
  const extent = Math.max(Math.abs(gap + length), Math.abs(gap), half, dot ? dotSize / 2 : 0) + outline;
  return { arms, dot, circle: null, extent };
}

/** snaps a rect to the device pixel grid so thin lines stay crisp */
export function snapRect(rect: CrosshairRect, devicePixelRatio: number): CrosshairRect {
  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
  const snap = (value: number) => Math.round(value * dpr) / dpr || 0;
  const x = snap(rect.x);
  const y = snap(rect.y);
  return {
    x,
    y,
    w: Math.max(1 / dpr, snap(rect.x + rect.w) - x),
    h: Math.max(1 / dpr, snap(rect.y + rect.h) - y),
  };
}

function centered(size: number): CrosshairRect {
  return { x: -size / 2, y: -size / 2, w: size, h: size };
}
