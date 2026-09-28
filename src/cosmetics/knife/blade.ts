import { BufferGeometry, Vector3 } from 'three';
import type { GrindStyle } from '../../combat/knives';
import { lerp, MeshBuilder, resample, smoothstep, type Vec2 } from './meshBuilder';
import type { BladeCurves } from './profiles';

export interface BladeOptions {
  curves: BladeCurves;
  /** spine thickness at the heel, metres */
  thickness: number;
  grind: GrindStyle;
  /** 0..1 of the section height where the primary grind meets the flat */
  grindHeight: number;
  /** blade fraction where the grind is fully developed (the plunge) */
  ricasso: number;
  stations?: number;
  fuller?: { from: number; to: number; low: number; high: number; depth: number };
  /** sawback teeth on the spine between two x positions (metres) */
  serrations?: { from: number; to: number; teeth: number; height: number };
  /** fraction of spine thickness removed at a clip point's false edge */
  swedgeDepth?: number;
}

export interface BladeResult {
  /** groups: 0 = flats and grind, 1 = polished edge bevels */
  geometry: BufferGeometry;
  teeth: BufferGeometry | null;
  tip: Vector3;
}

/** height of the secondary (sharpening) bevel, metres */
const EDGE_BEVEL = 0.0011;
/** thickness where the secondary bevel meets the primary grind */
const EDGE_SHOULDER = 0.0006;
const TEX_SCALE = 0.05;

interface Band {
  from: (s: Station) => number;
  to: (s: Station) => number;
  segs: number;
  slot: number;
}

interface Station {
  u: number;
  e: Vec2;
  s: Vec2;
  h: number;
  vb: number;
  vg: number;
}

/**
 * builds a blade with a real cross section: sharp edge with a secondary
 * bevel, flat or hollow primary grind, full thickness flat up to the spine,
 * distal taper, optional fuller groove, swedge on clip points, and a second
 * edge for daggers. every facet band has its own vertices so the grind line
 * and edge bevel stay crisp.
 */
export function buildBlade(opts: BladeOptions): BladeResult {
  const nu = opts.stations ?? 56;
  const edge = resample(opts.curves.edge, nu);
  const spine = resample(opts.curves.spine, nu);
  const heelHeight = Math.hypot(spine[0][0] - edge[0][0], spine[0][1] - edge[0][1]);
  const doubleFrom = opts.curves.doubleEdgeFrom;
  const swedgeFrom = opts.curves.swedgeFrom;
  const hook = opts.curves.hook;
  const swedgeDepth = opts.swedgeDepth ?? 0.62;
  const fuller = opts.fuller;

  const stations: Station[] = edge.map((e, i) => {
    const s = spine[i];
    const h = Math.hypot(s[0] - e[0], s[1] - e[1]);
    const vb = h > 1e-6 ? Math.min(0.3, Math.max(0.04, EDGE_BEVEL / h)) : 0.3;
    const vg = Math.max(vb + 0.05, Math.min(0.98, opts.grindHeight));
    return { u: i / (nu - 1), e, s, h, vb, vg };
  });

  // band layout across the section, edge (v = 0) to spine (v = 1)
  const bands: Band[] = [
    { from: () => 0, to: (st) => st.vb, segs: 1, slot: 1 },
    { from: (st) => st.vb, to: (st) => st.vg, segs: opts.grind === 'hollow' ? 3 : 1, slot: 0 },
  ];
  let top = (st: Station) => st.vg;
  if (fuller) {
    bands.push({ from: top, to: () => fuller.low, segs: 1, slot: 0 });
    bands.push({ from: () => fuller.low, to: () => fuller.high, segs: 3, slot: 0 });
    top = () => fuller.high;
  }
  if (doubleFrom !== undefined) {
    const t0 = top;
    bands.push({ from: t0, to: (st) => 1 - st.vg, segs: 1, slot: 0 });
    bands.push({ from: (st) => 1 - st.vg, to: (st) => 1 - st.vb, segs: opts.grind === 'hollow' ? 3 : 1, slot: 0 });
    bands.push({ from: (st) => 1 - st.vb, to: () => 1, segs: 1, slot: 1 });
  } else if (swedgeFrom !== undefined || hook) {
    const t0 = top;
    bands.push({ from: t0, to: () => 0.74, segs: 1, slot: 0 });
    bands.push({ from: () => 0.74, to: () => 1, segs: 1, slot: 0 });
  } else {
    bands.push({ from: top, to: () => 1, segs: 1, slot: 0 });
  }

  const thicknessAt = (st: Station, v: number): number => {
    const u = st.u;
    // distal taper, and the point closes to nothing in every direction
    let ts = opts.thickness * Math.max(0.3, 1 - 0.62 * Math.pow(u, 1.5));
    ts *= Math.pow(Math.min(1, st.h / (0.35 * heelHeight)), 0.6);
    const tb = Math.min(ts, EDGE_SHOULDER);
    const ground = (w: number) => {
      if (w <= st.vb) return tb * (w / st.vb);
      if (w <= st.vg) {
        const f = (w - st.vb) / (st.vg - st.vb);
        return tb + (ts - tb) * (opts.grind === 'hollow' ? Math.pow(f, 1.8) : f);
      }
      return ts;
    };
    const plunge = smoothstep(0, opts.ricasso, u);
    let t = lerp(ts, ground(v), plunge);
    if (doubleFrom !== undefined) {
      const de = smoothstep(doubleFrom, doubleFrom + 0.1, u) * plunge;
      t = Math.min(t, lerp(ts, ground(1 - v), de));
    }
    let sw = swedgeFrom !== undefined ? smoothstep(swedgeFrom, swedgeFrom + 0.08, u) * swedgeDepth : 0;
    if (hook) sw = Math.max(sw, smoothstep(hook[0] - 0.02, hook[0] + 0.03, u) * (1 - smoothstep(hook[1] - 0.03, hook[1] + 0.02, u)));
    if (sw > 0 && v > 0.74) t = Math.min(t, ts * (1 - sw * ((v - 0.74) / 0.26)));
    if (fuller && v > fuller.low && v < fuller.high) {
      const ramp = smoothstep(fuller.from, fuller.from + 0.06, u) * (1 - smoothstep(fuller.to - 0.06, fuller.to, u));
      const across = Math.sin((Math.PI * (v - fuller.low)) / (fuller.high - fuller.low));
      t -= 2 * fuller.depth * ramp * across;
    }
    return Math.max(0, t);
  };

  const mb = new MeshBuilder();
  const edgeLength = stations.reduce((acc, st, i) => (i === 0 ? 0 : acc + Math.hypot(st.e[0] - stations[i - 1].e[0], st.e[1] - stations[i - 1].e[1])), 0);
  // rows[b][r][i] -> [right vertex, left vertex]
  const rows: [number, number][][][] = bands.map((band) => {
    const out: [number, number][][] = [];
    for (let r = 0; r <= band.segs; r += 1) {
      const row: [number, number][] = [];
      for (const st of stations) {
        const v = lerp(band.from(st), band.to(st), r / band.segs);
        const x = lerp(st.e[0], st.s[0], v);
        const y = lerp(st.e[1], st.s[1], v);
        const half = thicknessAt(st, v) / 2;
        const tu = (st.u * edgeLength) / TEX_SCALE;
        const tv = (v * st.h) / TEX_SCALE;
        row.push([mb.vertex(x, y, half, tu, tv), mb.vertex(x, y, -half, tu, tv)]);
      }
      out.push(row);
    }
    return out;
  });

  bands.forEach((band, b) => {
    mb.material(band.slot);
    for (let r = 0; r < band.segs; r += 1) {
      const lo = rows[b][r];
      const hi = rows[b][r + 1];
      for (let i = 0; i < nu - 1; i += 1) {
        mb.quad(lo[i][0], lo[i + 1][0], hi[i + 1][0], hi[i][0]);
        mb.quad(lo[i][1], hi[i][1], hi[i + 1][1], lo[i + 1][1]);
      }
    }
  });

  // spine and edge strips close the solid where the section has thickness.
  // they get their own vertices so the spine corners stay crisp
  mb.material(0);
  const own = (row: [number, number][]) => row.map(([r, l]) => [mb.clone(r), mb.clone(l)] as [number, number]);
  const topRow = own(rows[rows.length - 1][bands[bands.length - 1].segs]);
  const bottomRow = own(rows[0][0]);
  for (let i = 0; i < nu - 1; i += 1) {
    mb.quad(topRow[i][0], topRow[i + 1][0], topRow[i + 1][1], topRow[i][1]);
    mb.quad(bottomRow[i][0], bottomRow[i][1], bottomRow[i + 1][1], bottomRow[i + 1][0]);
  }
  // heel cap (hidden in the guard or handle)
  const loop: number[] = [];
  bands.forEach((band, b) => {
    for (let r = 0; r <= band.segs; r += 1) loop.push(mb.clone(rows[b][r][0][0]));
  });
  for (let b = bands.length - 1; b >= 0; b -= 1) {
    for (let r = bands[b].segs; r >= 0; r -= 1) loop.push(mb.clone(rows[b][r][0][1]));
  }
  const h0 = stations[0];
  const center = mb.vertex((h0.e[0] + h0.s[0]) / 2, (h0.e[1] + h0.s[1]) / 2, 0);
  mb.fan(center, loop);

  const last = stations[stations.length - 1];
  return {
    geometry: mb.build(true),
    teeth: opts.serrations ? buildTeeth(opts.curves.spine, opts.serrations, (x) => {
      // spine thickness where the teeth sit, same taper as the blade
      const frac = Math.min(1, Math.max(0, x / Math.max(1e-6, last.e[0])));
      return opts.thickness * Math.max(0.3, 1 - 0.62 * Math.pow(frac, 1.5));
    }) : null,
    tip: new Vector3(last.e[0], last.e[1], 0),
  };
}

/** sawback teeth riding on the spine, raked toward the tip like a saw */
function buildTeeth(spine: readonly Vec2[], s: NonNullable<BladeOptions['serrations']>, thicknessAt: (x: number) => number): BufferGeometry {
  const at = (x: number): { p: Vec2; n: Vec2 } => {
    for (let i = 1; i < spine.length; i += 1) {
      const a = spine[i - 1];
      const b = spine[i];
      if ((x >= a[0] && x <= b[0]) || i === spine.length - 1) {
        const t = b[0] === a[0] ? 0 : Math.min(1, Math.max(0, (x - a[0]) / (b[0] - a[0])));
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const len = Math.hypot(dx, dy) || 1;
        return { p: [lerp(a[0], b[0], t), lerp(a[1], b[1], t)], n: [-dy / len, dx / len] };
      }
    }
    return { p: spine[0], n: [0, 1] };
  };
  const mb = new MeshBuilder();
  const w = (s.to - s.from) / s.teeth;
  for (let j = 0; j < s.teeth; j += 1) {
    const xa = s.from + j * w;
    const xb = xa + w;
    const A = at(xa);
    const B = at(xb);
    const P = at(xa + w * 0.62);
    const t = thicknessAt(xa) * 0.46;
    const sink = 0.0003;
    const a: Vec2 = [A.p[0] - A.n[0] * sink, A.p[1] - A.n[1] * sink];
    const b: Vec2 = [B.p[0] - B.n[0] * sink, B.p[1] - B.n[1] * sink];
    const p: Vec2 = [P.p[0] + P.n[0] * s.height, P.p[1] + P.n[1] * s.height];
    const tp = t * 0.35;
    const ar = [a[0], a[1], t] as const;
    const al = [a[0], a[1], -t] as const;
    const br = [b[0], b[1], t] as const;
    const bl = [b[0], b[1], -t] as const;
    const pr = [p[0], p[1], tp] as const;
    const pl = [p[0], p[1], -tp] as const;
    // each face flat shaded so the small teeth read crisp
    mb.facet([ar, br, pr]).facet([al, pl, bl]);
    mb.facet([ar, pr, pl, al]);
    mb.facet([pr, br, bl, pl]);
    mb.facet([ar, al, bl, br]);
  }
  return mb.build(true);
}
