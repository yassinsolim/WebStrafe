import { BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, Uint32BufferAttribute } from 'three';

/**
 * Small indexed mesh writer for the procedural knives. Triangles are kept per
 * material slot and written out as geometry groups. Parts that need a crisp
 * crease (grind lines, bevels) just add their own vertices, since normals are
 * only averaged over shared vertices.
 */
export class MeshBuilder {
  private readonly positions: number[] = [];
  private readonly uvs: number[] = [];
  private readonly colors: number[] = [];
  private readonly tris: number[][] = [[]];
  private slot = 0;
  private useColors = false;

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  /** material slot for the triangles added after this call */
  material(slot: number): this {
    this.slot = slot;
    while (this.tris.length <= slot) this.tris.push([]);
    return this;
  }

  vertex(x: number, y: number, z: number, u = 0, v = 0, shade = 1): number {
    this.positions.push(x, y, z);
    this.uvs.push(u, v);
    this.colors.push(shade, shade, shade);
    if (shade !== 1) this.useColors = true;
    return this.positions.length / 3 - 1;
  }

  /** copy of an existing vertex, for faces that must not share normals */
  clone(index: number): number {
    const p = this.positions;
    const t = this.uvs;
    const c = this.colors;
    this.positions.push(p[index * 3], p[index * 3 + 1], p[index * 3 + 2]);
    this.uvs.push(t[index * 2], t[index * 2 + 1]);
    this.colors.push(c[index * 3], c[index * 3 + 1], c[index * 3 + 2]);
    return this.positions.length / 3 - 1;
  }

  /** flat shaded polygon (convex, counter-clockwise from the front) with its own vertices */
  facet(points: readonly (readonly [number, number, number])[]): this {
    const ids = points.map((p) => this.vertex(p[0], p[1], p[2], p[0] * 20, p[1] * 20));
    for (let i = 1; i < ids.length - 1; i += 1) this.tri(ids[0], ids[i], ids[i + 1]);
    return this;
  }

  tri(a: number, b: number, c: number): this {
    this.tris[this.slot].push(a, b, c);
    return this;
  }

  /** a, b, c, d counter-clockwise seen from the front */
  quad(a: number, b: number, c: number, d: number): this {
    return this.tri(a, b, c).tri(a, c, d);
  }

  /** quads between two rows of equal length */
  strip(rowA: readonly number[], rowB: readonly number[], closed = false): this {
    const n = rowA.length;
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i += 1) {
      const j = (i + 1) % n;
      this.quad(rowA[i], rowA[j], rowB[j], rowB[i]);
    }
    return this;
  }

  /** triangle fan from a centre vertex over a closed loop */
  fan(center: number, loop: readonly number[]): this {
    for (let i = 0; i < loop.length; i += 1) this.tri(center, loop[i], loop[(i + 1) % loop.length]);
    return this;
  }

  /** signed volume of everything written so far (positive = outward winding) */
  signedVolume(): number {
    const p = this.positions;
    let vol = 0;
    for (const list of this.tris) {
      for (let i = 0; i < list.length; i += 3) {
        const a = list[i] * 3;
        const b = list[i + 1] * 3;
        const c = list[i + 2] * 3;
        vol += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1])
          - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c])
          + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
      }
    }
    return vol / 6;
  }

  /** flips every triangle, used when a closed part was wound inside out */
  flip(): this {
    for (const list of this.tris) {
      for (let i = 0; i < list.length; i += 3) {
        const t = list[i + 1];
        list[i + 1] = list[i + 2];
        list[i + 2] = t;
      }
    }
    return this;
  }

  /**
   * @param closed the part is a closed solid, so it gets wound outward
   *   automatically (mirrored parts come out inside out otherwise)
   */
  build(closed = true): BufferGeometry {
    if (closed && this.signedVolume() < 0) this.flip();
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(this.uvs, 2));
    if (this.useColors) geometry.setAttribute('color', new Float32BufferAttribute(this.colors, 3));
    const index: number[] = [];
    let start = 0;
    this.tris.forEach((list, slot) => {
      if (list.length === 0) return;
      index.push(...list);
      geometry.addGroup(start, list.length, slot);
      start += list.length;
    });
    const count = this.positions.length / 3;
    geometry.setIndex(count > 65535 ? new Uint32BufferAttribute(index, 1) : new Uint16BufferAttribute(index, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

export type Vec2 = [number, number];

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** samples a polyline at `n` points spaced evenly by arc length */
export function resample(points: readonly Vec2[], n: number, remap: (t: number) => number = (t) => t): Vec2[] {
  const acc = [0];
  for (let i = 1; i < points.length; i += 1) {
    acc.push(acc[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  const total = acc[acc.length - 1];
  const out: Vec2[] = [];
  let seg = 1;
  for (let i = 0; i < n; i += 1) {
    const target = remap(i / (n - 1)) * total;
    while (seg < points.length - 1 && acc[seg] < target) seg += 1;
    const a = points[seg - 1];
    const b = points[seg];
    const span = acc[seg] - acc[seg - 1] || 1;
    const t = Math.min(1, Math.max(0, (target - acc[seg - 1]) / span));
    out.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t)]);
  }
  return out;
}

/** points along a quadratic bezier, excluding the start point */
export function quadTo(from: Vec2, ctrl: Vec2, to: Vec2, steps: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    out.push([a * from[0] + b * ctrl[0] + c * to[0], a * from[1] + b * ctrl[1] + c * to[1]]);
  }
  return out;
}

/** points along a straight line, excluding the start point */
export function lineTo(from: Vec2, to: Vec2, steps: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    out.push([lerp(from[0], to[0], t), lerp(from[1], to[1], t)]);
  }
  return out;
}
