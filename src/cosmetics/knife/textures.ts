import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  type Texture,
  UnsignedByteType,
} from 'three';

/**
 * Tiny generated textures shared by every procedural knife (no downloads).
 * They are module singletons on purpose: materials are per knife and get
 * disposed with it, the textures stay alive so disposing one knife never
 * breaks another. All of them together are well under 200 KB of texels.
 */

function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** smooth value noise that wraps every `period` cells */
function noise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const w = (a: number) => ((a % period) + period) % period;
  const a = hash(w(xi), w(yi), seed);
  const b = hash(w(xi + 1), w(yi), seed);
  const c = hash(w(xi), w(yi + 1), seed);
  const d = hash(w(xi + 1), w(yi + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function makeTexture(width: number, height: number, fill: (x: number, y: number) => [number, number, number],
  color: boolean): DataTexture {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = fill(x, y);
      const i = (y * width + x) * 4;
      data[i] = Math.round(Math.min(1, Math.max(0, r)) * 255);
      data[i + 1] = Math.round(Math.min(1, Math.max(0, g)) * 255);
      data[i + 2] = Math.round(Math.min(1, Math.max(0, b)) * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new DataTexture(data, width, height, RGBAFormat, UnsignedByteType);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = color ? SRGBColorSpace : NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** normal map from a height field on a wrapping grid */
function normalMap(size: number, height: ((x: number, y: number) => number) | Float32Array, strength: number): DataTexture {
  let h: Float32Array;
  if (height instanceof Float32Array) {
    h = height;
  } else {
    h = new Float32Array(size * size);
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) h[y * size + x] = height(x, y);
  }
  const at = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)];
  return makeTexture(size, size, (x, y) => {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
    const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const len = Math.hypot(dx, dy, 1);
    return [(-dx / len) * 0.5 + 0.5, (-dy / len) * 0.5 + 0.5, (1 / len) * 0.5 + 0.5];
  }, false);
}

const cache = new Map<string, Texture>();

function cached(key: string, make: () => Texture): Texture {
  let tex = cache.get(key);
  if (!tex) {
    tex = make();
    tex.name = `knife_${key}`;
    tex.userData.sharedKnifeTexture = true;
    cache.set(key, tex);
  }
  return tex;
}

/** brushed steel: fine streaks along u (the blade length). R/G/B = roughness factor */
export function brushedRoughness(): Texture {
  return cached('brushed', () => makeTexture(64, 256, (x, y) => {
    const streak = noise(x * 0.05, y * 1.0, 64, 3) * 0.55 + noise(x * 0.02, y * 0.25, 64, 9) * 0.45;
    const v = 0.62 + streak * 0.3 + (hash(x, y, 5) - 0.5) * 0.05;
    return [v, v, v];
  }, false));
}

/** very subtle brightness streaks to go with the brushed roughness (srgb) */
export function brushedColor(): Texture {
  return cached('brushed_color', () => makeTexture(64, 256, (x, y) => {
    const v = 0.93 + noise(x * 0.05, y * 1.0, 64, 3) * 0.07;
    return [v, v, v];
  }, true));
}

/** pebbled rubber / textured g10 */
export function pebbleNormal(): Texture {
  return cached('pebble', () => {
    const size = 128;
    const field = new Float32Array(size * size);
    // splat round bumps into a wrapping height field
    for (let i = 0; i < 700; i += 1) {
      const bx = hash(i, 1, 21) * size;
      const by = hash(i, 2, 21) * size;
      const r = 1.4 + hash(i, 3, 21) * 1.8;
      const k = 0.7 + hash(i, 4, 21) * 0.3;
      for (let y = Math.floor(by - r); y <= Math.ceil(by + r); y += 1) {
        for (let x = Math.floor(bx - r); x <= Math.ceil(bx + r); x += 1) {
          const d2 = ((x - bx) * (x - bx) + (y - by) * (y - by)) / (r * r);
          if (d2 >= 1) continue;
          const idx = (((y % size) + size) % size) * size + (((x % size) + size) % size);
          field[idx] = Math.max(field[idx], Math.sqrt(1 - d2) * k);
        }
      }
    }
    return normalMap(size, field, 1.6);
  });
}

/** long wood grain along u, values around 0.7..1 multiplied onto the wood colour (srgb) */
export function woodGrain(): Texture {
  return cached('wood', () => makeTexture(256, 64, (x, y) => {
    const warp = noise(x * 0.02, y * 0.08, 64, 12) * 4.0;
    const ring = Math.sin((y * 0.55 + warp) * Math.PI);
    const fine = noise(x * 0.4, y * 1.3, 64, 44);
    const pores = hash(x, y, 7) > 0.985 ? -0.12 : 0;
    const v = 0.8 + ring * 0.1 + (fine - 0.5) * 0.08 + pores;
    return [v * 1.0, v * 0.93, v * 0.86];
  }, true));
}

/** paracord weave: diagonal braid along u (the cord path), across v (around the cord) */
export function braidColor(): Texture {
  return cached('braid', () => makeTexture(64, 32, (x, y) => {
    const a = Math.sin(((x + y) / 64) * Math.PI * 8);
    const b = Math.sin(((x - y) / 64) * Math.PI * 8);
    const weave = Math.max(a, b);
    const v = 0.72 + weave * 0.2 + (hash(x, y, 31) - 0.5) * 0.06;
    return [v, v, v];
  }, true));
}

export function braidNormal(): Texture {
  return cached('braid_normal', () => normalMap(64, (x, y) => {
    const a = Math.sin(((x + y) / 64) * Math.PI * 8);
    const b = Math.sin(((x - y) / 64) * Math.PI * 8);
    return Math.max(a, b) * 0.5 + 0.5;
  }, 1.2));
}
