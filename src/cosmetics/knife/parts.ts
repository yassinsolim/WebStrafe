import { BufferGeometry, ExtrudeGeometry, Path, Shape, Vector3 } from 'three';
import { lerp, MeshBuilder, smoothstep, type Vec2 } from './meshBuilder';

/** superellipse ring in the y/z plane at x, `n` points, exponent e (2 = ellipse) */
export function ring(x: number, cy: number, halfTop: number, halfBottom: number, halfWidth: number, n: number,
  e = 2.4): Vector3[] {
  const out: Vector3[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    const s = Math.sin(a);
    const c = Math.cos(a);
    const ys = Math.sign(s) * Math.pow(Math.abs(s), 2 / e);
    const zs = Math.sign(c) * Math.pow(Math.abs(c), 2 / e);
    out.push(new Vector3(x, cy + ys * (s >= 0 ? halfTop : halfBottom), zs * halfWidth));
  }
  return out;
}

/**
 * skins closed rings (all with the same point count) into a solid with
 * optional end caps. u runs along the rings, v around them.
 */
export function loft(rings: Vector3[][], texScale = 0.03, caps: [boolean, boolean] = [true, true],
  shade?: (ringIndex: number, pointIndex: number) => number, closedAlong = false): BufferGeometry {
  const mb = new MeshBuilder();
  const n = rings[0].length;
  let along = 0;
  const ids: number[][] = rings.map((r, k) => {
    if (k > 0) along += r[0].distanceTo(rings[k - 1][0]);
    let around = 0;
    const row: number[] = [];
    for (let i = 0; i <= n; i += 1) {
      const p = r[i % n];
      if (i > 0) around += p.distanceTo(r[i - 1]);
      row.push(mb.vertex(p.x, p.y, p.z, along / texScale, around / texScale, shade ? shade(k, i % n) : 1));
    }
    return row;
  });
  for (let k = 0; k < rings.length - 1; k += 1) {
    for (let i = 0; i < n; i += 1) mb.quad(ids[k][i], ids[k][i + 1], ids[k + 1][i + 1], ids[k + 1][i]);
  }
  const cap = (k: number) => {
    const r = rings[k];
    const c = r.reduce((acc, p) => acc.add(p), new Vector3()).multiplyScalar(1 / n);
    const center = mb.vertex(c.x, c.y, c.z);
    const loop = r.map((p) => mb.vertex(p.x, p.y, p.z, p.y / texScale, p.z / texScale));
    mb.fan(center, k === 0 ? loop : [...loop].reverse());
  };
  if (caps[0]) cap(0);
  if (caps[1]) cap(rings.length - 1);
  const geo = mb.build(true);
  // the uv seam duplicates vertices, weld their normals so no shading line shows
  const normals = geo.getAttribute('normal');
  const weld = (a: number, b: number) => {
    const x = normals.getX(a) + normals.getX(b);
    const y = normals.getY(a) + normals.getY(b);
    const z = normals.getZ(a) + normals.getZ(b);
    const len = Math.hypot(x, y, z) || 1;
    normals.setXYZ(a, x / len, y / len, z / len);
    normals.setXYZ(b, x / len, y / len, z / len);
  };
  for (const row of ids) weld(row[0], row[n]);
  if (closedAlong) {
    const first = ids[0];
    const last = ids[ids.length - 1];
    for (let i = 0; i <= n; i += 1) weld(first[i], last[i]);
  }
  normals.needsUpdate = true;
  return geo;
}

export interface Outline {
  top: Vec2[];
  bottom: Vec2[];
}

export interface OutlineStyle {
  /** metres the butt drops below the front (curved handles) */
  bend?: number;
  /** relative swell in the middle */
  swell?: number;
  /** depth of the index finger dip behind the guard, fraction of height */
  choil?: number;
  /** relative flare at the butt */
  flare?: number;
  /** finger grooves on the edge side */
  grooves?: number;
}

/** side outline of a handle from x0 (front) back to x0 - len */
export function handleOutline(x0: number, len: number, cy: number, height: number, style: OutlineStyle, n = 28): Outline {
  const top: Vec2[] = [];
  const bottom: Vec2[] = [];
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1);
    const x = x0 - t * len;
    const c = cy - (style.bend ?? 0) * t * t;
    const swell = 1 + (style.swell ?? 0.08) * Math.sin(Math.PI * t);
    const flare = 1 + (style.flare ?? 0.1) * smoothstep(0.7, 1, t);
    const round = t > 0.93 ? Math.sqrt(Math.max(0.2, 1 - ((t - 0.93) / 0.07) ** 2)) : 1;
    let bottomScale = swell * flare * round;
    if (style.choil) bottomScale *= 1 - style.choil * Math.exp(-(((t - 0.08) / 0.06) ** 2));
    if (style.grooves) {
      const g = smoothstep(0.1, 0.18, t) * (1 - smoothstep(0.62, 0.7, t));
      bottomScale *= 1 - 0.1 * g * Math.pow(Math.sin(Math.PI * ((t - 0.1) / 0.6) * style.grooves), 2);
    }
    const topScale = (1 + 0.04 * Math.sin(Math.PI * t)) * flare * round;
    top.push([x, c + (height / 2) * topScale]);
    bottom.push([x, c - (height / 2) * bottomScale]);
  }
  return { top, bottom };
}

/**
 * domed slab on one side of the knife (scales, liners, tang, balisong halves).
 * inner face flat at |z| = z0, outer face rises by `thickness` with rounded
 * shoulders. side = +1 builds on +z, -1 on -z.
 */
export function slab(outline: Outline, z0: number, thickness: number, side: 1 | -1, opts: { dome?: number; rows?: number;
  texScale?: number } = {}): BufferGeometry {
  const mb = new MeshBuilder();
  const rows = opts.rows ?? 6;
  const dome = opts.dome ?? 0.55;
  const tex = opts.texScale ?? 0.03;
  const n = outline.top.length;
  const outer: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    const row: number[] = [];
    const [x, yt] = outline.top[i];
    const yb = outline.bottom[i][1];
    for (let r = 0; r <= rows; r += 1) {
      const v = r / rows;
      const y = lerp(yb, yt, v);
      // flat middle with rounded shoulders towards the top and bottom edges
      const k = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(2 * v - 1), 2.6)), 0.5);
      const z = z0 + thickness * ((1 - dome) + dome * k);
      row.push(mb.vertex(x, y, side * z, x / tex, y / tex));
    }
    outer.push(row);
  }
  for (let i = 0; i < n - 1; i += 1) {
    for (let r = 0; r < rows; r += 1) mb.quad(outer[i][r], outer[i + 1][r], outer[i + 1][r + 1], outer[i][r + 1]);
  }
  // inner face and the perimeter walls (own vertices, crisp corners)
  const inner = outline.top.map((p, i) => [mb.vertex(p[0], outline.bottom[i][1], side * z0), mb.vertex(p[0], p[1], side * z0)]);
  for (let i = 0; i < n - 1; i += 1) mb.quad(inner[i][0], inner[i][1], inner[i + 1][1], inner[i + 1][0]);
  const wallBottom = outer.map((row, i) => [mb.clone(row[0]), mb.clone(inner[i][0])]);
  const wallTop = outer.map((row, i) => [mb.clone(row[rows]), mb.clone(inner[i][1])]);
  for (let i = 0; i < n - 1; i += 1) {
    mb.quad(wallBottom[i][0], wallBottom[i][1], wallBottom[i + 1][1], wallBottom[i + 1][0]);
    mb.quad(wallTop[i][0], wallTop[i + 1][0], wallTop[i + 1][1], wallTop[i][1]);
  }
  for (const i of [0, n - 1]) {
    const loop = [...outer[i].map((id) => mb.clone(id)), mb.clone(inner[i][1]), mb.clone(inner[i][0])];
    const [x, yt] = outline.top[i];
    const yb = outline.bottom[i][1];
    const c = mb.vertex(x, (yt + yb) / 2, side * (z0 + thickness * 0.5));
    mb.fan(c, i === 0 ? loop : [...loop].reverse());
  }
  return mb.build(true);
}

/** z of a slab's outer face at the middle of its height */
export function slabCrown(z0: number, thickness: number): number {
  return z0 + thickness;
}

/** straight pin along z centred on (x, y), from -len/2 to len/2 */
export function pin(x: number, y: number, radius: number, z0: number, z1: number, segs = 12): BufferGeometry {
  const rings: Vector3[][] = [];
  for (const z of [z0, z1]) {
    const r: Vector3[] = [];
    for (let i = 0; i < segs; i += 1) {
      const a = (i / segs) * Math.PI * 2;
      r.push(new Vector3(x + Math.cos(a) * radius, y + Math.sin(a) * radius, z));
    }
    rings.push(r);
  }
  return loft(rings, 0.01);
}

/** torus-like ring with a superellipse tube section (finger rings, muzzle rings) */
export function torus(center: Vector3, axis: 'x' | 'z', radius: number, tubeR: number, tubeW: number, segs = 32,
  tubeSegs = 10): BufferGeometry {
  const rings: Vector3[][] = [];
  for (let i = 0; i < segs; i += 1) {
    const a = (i / segs) * Math.PI * 2;
    const dir = new Vector3(Math.cos(a), Math.sin(a), 0);
    const r: Vector3[] = [];
    for (let j = 0; j < tubeSegs; j += 1) {
      const b = (j / tubeSegs) * Math.PI * 2;
      const cb = Math.cos(b);
      const sb = Math.sin(b);
      const rr = radius + Math.sign(cb) * Math.pow(Math.abs(cb), 0.8) * tubeR;
      const zz = Math.sign(sb) * Math.pow(Math.abs(sb), 0.8) * tubeW;
      r.push(new Vector3(dir.x * rr, dir.y * rr, zz));
    }
    rings.push(r);
  }
  rings.push(rings[0]);
  const geo = loft(rings, 0.01, [false, false], undefined, true);
  if (axis === 'x') geo.rotateY(Math.PI / 2);
  geo.translate(center.x, center.y, center.z);
  return geo;
}

/** tube along a polyline with a round section */
export function tube(path: Vector3[], radius: number, sides = 6, texScale = 0.006): BufferGeometry {
  const rings: Vector3[][] = [];
  let normal = new Vector3(0, 1, 0);
  for (let i = 0; i < path.length; i += 1) {
    const prev = path[Math.max(0, i - 1)];
    const next = path[Math.min(path.length - 1, i + 1)];
    const t = next.clone().sub(prev).normalize();
    // parallel transport keeps the tube from twisting
    normal = normal.clone().sub(t.clone().multiplyScalar(normal.dot(t))).normalize();
    if (normal.lengthSq() < 1e-8) normal = new Vector3(0, 0, 1);
    const bin = t.clone().cross(normal).normalize();
    const r: Vector3[] = [];
    for (let j = 0; j < sides; j += 1) {
      const a = (j / sides) * Math.PI * 2;
      r.push(path[i].clone().addScaledVector(normal, Math.cos(a) * radius).addScaledVector(bin, Math.sin(a) * radius));
    }
    rings.push(r);
  }
  return loft(rings, texScale);
}

/** helical wrap around a rounded rectangle section: the paracord handle */
export function cordWrap(x0: number, x1: number, cy: number, halfHeight: number, halfWidth: number, cord: number,
  pointsPerTurn = 10): BufferGeometry {
  const pitch = cord * 2.05;
  const turns = Math.max(2, Math.floor(Math.abs(x0 - x1) / pitch));
  const path: Vector3[] = [];
  const hh = halfHeight + cord * 0.8;
  const hw = halfWidth + cord * 0.8;
  for (let i = 0; i <= turns * pointsPerTurn; i += 1) {
    const turn = i / pointsPerTurn;
    const a = turn * Math.PI * 2;
    const s = Math.sin(a);
    const c = Math.cos(a);
    const y = cy + Math.sign(s) * Math.pow(Math.abs(s), 0.6) * hh;
    const z = Math.sign(c) * Math.pow(Math.abs(c), 0.6) * hw;
    path.push(new Vector3(x0 - turn * pitch, y, z));
  }
  return tube(path, cord, 5, cord * 3);
}

/** crossguard as a loft along y with tapered, slightly forward swept quillons */
export function crossGuard(yc: number, span: number, depth: number, width: number, x: number): BufferGeometry {
  const rings: Vector3[][] = [];
  const n = 11;
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1);
    const y = yc + (t - 0.5) * span;
    const edge = Math.abs(2 * t - 1);
    const taper = 1 - 0.35 * Math.pow(edge, 2);
    const sweep = 0.0025 * Math.pow(edge, 2);
    const endRound = edge > 0.9 ? Math.sqrt(Math.max(0.15, 1 - ((edge - 0.9) / 0.1) ** 2)) : 1;
    const hd = (depth / 2) * taper * endRound;
    const hw = (width / 2) * taper * endRound;
    const r: Vector3[] = [];
    for (let j = 0; j < 12; j += 1) {
      const a = (j / 12) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      r.push(new Vector3(x + sweep + Math.sign(c) * Math.pow(Math.abs(c), 0.55) * hd, y,
        Math.sign(s) * Math.pow(Math.abs(s), 0.55) * hw));
    }
    rings.push(r);
  }
  return loft(rings, 0.02);
}

/** open skeleton frame handle: tang outline with two cut-outs, lightly bevelled */
export function skeletonFrame(x0: number, len: number, cy: number, height: number, thickness: number): BufferGeometry {
  const hh = height / 2;
  const outline = new Shape();
  outline.moveTo(x0 + 0.002, cy - hh * 0.8);
  outline.lineTo(x0 - len * 0.2, cy - hh * 0.95);
  outline.quadraticCurveTo(x0 - len * 0.55, cy - hh * 1.12, x0 - len * 0.86, cy - hh * 0.95);
  outline.quadraticCurveTo(x0 - len * 1.04, cy - hh * 0.9, x0 - len, cy + hh * 0.2);
  outline.quadraticCurveTo(x0 - len * 0.98, cy + hh * 1.05, x0 - len * 0.8, cy + hh * 1.0);
  outline.quadraticCurveTo(x0 - len * 0.45, cy + hh * 0.9, x0 - len * 0.15, cy + hh * 1.0);
  outline.lineTo(x0 + 0.002, cy + hh * 0.85);
  outline.closePath();
  const big = new Path();
  big.moveTo(x0 - len * 0.2, cy - hh * 0.42);
  big.quadraticCurveTo(x0 - len * 0.45, cy - hh * 0.62, x0 - len * 0.66, cy - hh * 0.4);
  big.quadraticCurveTo(x0 - len * 0.74, cy, x0 - len * 0.66, cy + hh * 0.42);
  big.quadraticCurveTo(x0 - len * 0.45, cy + hh * 0.55, x0 - len * 0.2, cy + hh * 0.42);
  big.quadraticCurveTo(x0 - len * 0.14, cy, x0 - len * 0.2, cy - hh * 0.42);
  outline.holes.push(big);
  const small = new Path();
  small.absellipse(x0 - len * 0.86, cy + hh * 0.05, hh * 0.3, hh * 0.3, 0, Math.PI * 2, false, 0);
  outline.holes.push(small);
  const geo = new ExtrudeGeometry(outline, {
    depth: thickness * 0.6,
    bevelEnabled: true,
    bevelThickness: thickness * 0.2,
    bevelSize: thickness * 0.2,
    bevelSegments: 2,
    curveSegments: 10,
  });
  geo.translate(0, 0, -thickness * 0.3);
  return geo;
}
