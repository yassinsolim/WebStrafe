import { describe, expect, it } from 'vitest';
import { defaultCrosshair, type CrosshairSettings } from '../SettingsStore';
import { MAX_SPREAD_PX, computeCrosshairLayout, crosshairScale, snapRect, spreadToPixels } from '../hud/crosshairGeometry';

const classic: CrosshairSettings = { ...defaultCrosshair, style: 'classic', size: 6, gap: 3, thickness: 2, outline: true };

describe('spreadToPixels', () => {
  it('maps the cone edge through the vertical fov', () => {
    // at 90 degrees vertical fov, tan(45) = 1, so a 45 degree cone reaches the top edge
    expect(spreadToPixels(Math.PI / 4, 90, 1000)).toBeCloseTo(Math.min(MAX_SPREAD_PX, 500));
    const small = spreadToPixels(0.01, 90, 1000);
    expect(small).toBeCloseTo(Math.tan(0.01) * 500, 6);
  });

  it('grows with narrower fov and taller screens', () => {
    expect(spreadToPixels(0.01, 60, 1000)).toBeGreaterThan(spreadToPixels(0.01, 100, 1000));
    expect(spreadToPixels(0.01, 90, 2000)).toBeCloseTo(spreadToPixels(0.01, 90, 1000) * 2);
  });

  it('is zero for no spread or junk input and never exceeds the cap', () => {
    expect(spreadToPixels(0, 90, 1000)).toBe(0);
    expect(spreadToPixels(-1, 90, 1000)).toBe(0);
    expect(spreadToPixels(Number.NaN, 90, 1000)).toBe(0);
    expect(spreadToPixels(0.1, 90, 0)).toBe(0);
    expect(spreadToPixels(1.5, 20, 4000)).toBe(MAX_SPREAD_PX);
  });
});

describe('computeCrosshairLayout', () => {
  it('lays out four arms around the gap', () => {
    const layout = computeCrosshairLayout(classic);
    expect(layout.arms).toEqual([
      { x: -1, y: -9, w: 2, h: 6 },
      { x: 3, y: -1, w: 6, h: 2 },
      { x: -1, y: 3, w: 2, h: 6 },
      { x: -9, y: -1, w: 6, h: 2 },
    ]);
    expect(layout.dot).toBeNull();
    expect(layout.extent).toBe(10);
  });

  it('pushes the arms out by the spread only when dynamic spread is on', () => {
    const wide = computeCrosshairLayout(classic, 12);
    expect(wide.arms[1].x).toBe(15);
    expect(wide.arms[3].x).toBe(-21);
    const fixed = computeCrosshairLayout({ ...classic, dynamicSpread: false }, 12);
    expect(fixed.arms[1].x).toBe(3);
  });

  it('scales the authored sizes but not the spread, which is already in screen px', () => {
    const scaled = computeCrosshairLayout(classic, 12, 1.5);
    expect(scaled.arms[1]).toEqual({ x: 3 * 1.5 + 12, y: -1.5, w: 9, h: 3 });
    expect(crosshairScale(1080)).toBe(1);
    expect(crosshairScale(1440)).toBeCloseTo(4 / 3, 6);
    expect(crosshairScale(480)).toBe(0.75);
    expect(crosshairScale(0)).toBe(1);
  });

  it('keeps arms symmetric with a negative gap', () => {
    const layout = computeCrosshairLayout({ ...classic, gap: -2 });
    expect(layout.arms[0].y + layout.arms[0].h).toBe(2);
    expect(layout.arms[2].y).toBe(-2);
  });

  it('draws a centred dot for the dot style', () => {
    const layout = computeCrosshairLayout({ ...classic, style: 'dot', thickness: 3 });
    expect(layout.arms).toEqual([]);
    expect(layout.dot).toEqual({ x: -1.5, y: -1.5, w: 3, h: 3 });
  });

  it('sizes the circle from gap plus size and widens it with spread', () => {
    const layout = computeCrosshairLayout({ ...classic, style: 'circle-dot' }, 4);
    expect(layout.circle).toEqual({ radius: 13, thickness: 2 });
    expect(layout.dot).not.toBeNull();
    expect(layout.extent).toBe(15);
  });

  it('draws nothing for a zero length classic crosshair', () => {
    expect(computeCrosshairLayout({ ...classic, size: 0 }).arms).toEqual([]);
    expect(computeCrosshairLayout({ ...classic, size: 0 }).dot).toBeNull();
  });

  it('adds a centre dot to the classic style when asked', () => {
    const layout = computeCrosshairLayout({ ...classic, dot: true });
    expect(layout.arms).toHaveLength(4);
    expect(layout.dot).toEqual({ x: -1, y: -1, w: 2, h: 2 });
    // a dot alone survives a zero arm length
    expect(computeCrosshairLayout({ ...classic, dot: true, size: 0 }).dot).not.toBeNull();
  });

  it('drops the top arm for the t style', () => {
    const layout = computeCrosshairLayout({ ...classic, tStyle: true });
    expect(layout.arms).toEqual([
      { x: 3, y: -1, w: 6, h: 2 },
      { x: -1, y: 3, w: 2, h: 6 },
      { x: -9, y: -1, w: 6, h: 2 },
    ]);
  });

  it('grows the extent with the outline thickness and ignores it without an outline', () => {
    expect(computeCrosshairLayout({ ...classic, outlineThickness: 2.5 }).extent).toBe(11.5);
    expect(computeCrosshairLayout({ ...classic, outline: false, outlineThickness: 2.5 }).extent).toBe(9);
  });
});

describe('snapRect', () => {
  it('snaps edges to device pixels without collapsing thin lines', () => {
    expect(snapRect({ x: -0.75, y: -9.2, w: 1.5, h: 6 }, 1)).toEqual({ x: -1, y: -9, w: 2, h: 6 });
    // one device pixel wide on a 2x screen
    expect(snapRect({ x: -0.25, y: 0, w: 0.5, h: 4 }, 2)).toEqual({ x: 0, y: 0, w: 0.5, h: 4 });
    expect(snapRect({ x: 0.1, y: 0, w: 0.1, h: 1 }, 1).w).toBe(1);
  });
});
