import { Shape } from 'three';
import type { BladeProfile } from '../../combat/knives';
import { lineTo, quadTo, type Vec2 } from './meshBuilder';

/**
 * Blade outlines as two curves that meet at the tip: the edge (from the heel of
 * the edge at the guard, y = 0) and the spine (from the spine at the guard,
 * y = h). x runs from the guard (0) to the tip (about L).
 */
export interface BladeCurves {
  edge: Vec2[];
  spine: Vec2[];
  /** spine side ground to a false edge from this fraction of the spine (clip points) */
  swedgeFrom?: number;
  /** the spine side is a real second edge from this fraction (daggers) */
  doubleEdgeFrom?: number;
  /** spine fraction range that is a sharpened hook (gut knife) */
  hook?: [number, number];
}

function arcFraction(points: readonly Vec2[], index: number): number {
  let total = 0;
  let upTo = 0;
  for (let i = 1; i < points.length; i += 1) {
    const d = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    total += d;
    if (i <= index) upTo += d;
  }
  return total > 0 ? upTo / total : 0;
}

export function bladeCurves(profile: BladeProfile, L: number, h: number): BladeCurves {
  const E: Vec2 = [0, 0];
  const S: Vec2 = [0, h];
  const path = (start: Vec2, ...parts: Vec2[][]) => [start, ...parts.flat()];
  switch (profile) {
    case 'spear': {
      const tip: Vec2 = [L, h * 0.5];
      return {
        edge: path(E, lineTo(E, [L * 0.68, h * 0.04], 6), quadTo([L * 0.68, h * 0.04], [L * 0.92, h * 0.2], tip, 10)),
        spine: path(S, lineTo(S, [L * 0.68, h * 0.96], 6), quadTo([L * 0.68, h * 0.96], [L * 0.92, h * 0.8], tip, 10)),
        doubleEdgeFrom: 0.52,
      };
    }
    case 'drop': {
      const tip: Vec2 = [L, h * 0.42];
      return {
        edge: path(E, lineTo(E, [L * 0.72, 0], 6), quadTo([L * 0.72, 0], [L * 0.96, h * 0.04], tip, 12)),
        spine: path(S, lineTo(S, [L * 0.62, h], 6), quadTo([L * 0.62, h], [L * 0.9, h * 0.92], tip, 12)),
      };
    }
    case 'clip': {
      const tip: Vec2 = [L, h * 0.56];
      const spine = path(S, lineTo(S, [L * 0.52, h], 6), lineTo([L * 0.52, h], [L * 0.6, h * 0.86], 2),
        quadTo([L * 0.6, h * 0.86], [L * 0.8, h * 0.66], tip, 10));
      return {
        edge: path(E, lineTo(E, [L * 0.7, 0], 6), quadTo([L * 0.7, 0], [L * 0.97, h * 0.06], tip, 12)),
        spine,
        swedgeFrom: arcFraction(spine, 6),
      };
    }
    case 'tanto': {
      const tip: Vec2 = [L, h * 0.64];
      return {
        edge: path(E, lineTo(E, [L * 0.8, 0], 8), lineTo([L * 0.8, 0], tip, 5)),
        spine: path(S, lineTo(S, [L * 0.9, h], 9), lineTo([L * 0.9, h], tip, 4)),
      };
    }
    case 'needle': {
      const tip: Vec2 = [L, h * 0.52];
      return {
        edge: path(E, quadTo(E, [L * 0.6, h * 0.1], tip, 16)),
        spine: path(S, quadTo(S, [L * 0.6, h * 0.94], tip, 16)),
        doubleEdgeFrom: 0.3,
      };
    }
    case 'hawkbill': {
      const tip: Vec2 = [L, -h * 1.1];
      const spine = path(S, quadTo(S, [L * 0.72, h * 1.05], tip, 20));
      return {
        edge: path(E, quadTo(E, [L * 0.6, h * 0.1], tip, 20)),
        spine,
        swedgeFrom: 0.78,
      };
    }
    case 'recurve': {
      const tip: Vec2 = [L, h * 0.3];
      return {
        edge: path(E, quadTo(E, [L * 0.42, h * 0.3], [L * 0.72, -h * 0.18], 10),
          quadTo([L * 0.72, -h * 0.18], [L * 0.98, -h * 0.34], tip, 10)),
        spine: path(S, lineTo(S, [L * 0.3, h * 1.08], 4), quadTo([L * 0.3, h * 1.08], [L * 0.82, h * 1.18], tip, 14)),
        swedgeFrom: 0.85,
      };
    }
    case 'cleaver': {
      const tip: Vec2 = [L, h * 0.74];
      return {
        edge: path(E, quadTo(E, [L * 0.66, -h * 0.3], tip, 18)),
        spine: path(S, lineTo(S, [L * 0.5, h], 5), quadTo([L * 0.5, h], [L * 0.86, h * 1.02], tip, 12)),
        swedgeFrom: 0.8,
      };
    }
    case 'gut': {
      const tip: Vec2 = [L, h * 0.4];
      const a = lineTo(S, [L * 0.44, h], 5);
      const b = lineTo([L * 0.44, h], [L * 0.48, h * 0.78], 2);
      const c = quadTo([L * 0.48, h * 0.78], [L * 0.56, h * 0.6], [L * 0.62, h], 6);
      const d = lineTo([L * 0.62, h], [L * 0.7, h], 2);
      const e = quadTo([L * 0.7, h], [L * 0.92, h * 0.88], tip, 10);
      const spine = path(S, a, b, c, d, e);
      return {
        edge: path(E, lineTo(E, [L * 0.74, 0], 6), quadTo([L * 0.74, 0], [L * 0.97, h * 0.05], tip, 12)),
        spine,
        hook: [arcFraction(spine, a.length), arcFraction(spine, a.length + b.length + c.length)],
      };
    }
    default: {
      const tip: Vec2 = [L, h * 0.5];
      return { edge: path(E, lineTo(E, tip, 8)), spine: path(S, lineTo(S, tip, 8)) };
    }
  }
}

/** 2D outline in (x along blade, y from edge=0 to spine=h). */
export function bladeShape(profile: BladeProfile, L: number, h: number): Shape {
  const { edge, spine } = bladeCurves(profile, L, h);
  const shape = new Shape();
  shape.moveTo(edge[0][0], edge[0][1]);
  for (let i = 1; i < edge.length; i += 1) shape.lineTo(edge[i][0], edge[i][1]);
  for (let i = spine.length - 2; i >= 0; i -= 1) shape.lineTo(spine[i][0], spine[i][1]);
  shape.closePath();
  return shape;
}
