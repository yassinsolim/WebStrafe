import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat } from 'three';
import type { SurfaceKind } from '../../render/worldMaterials';

type Shader = (x: number, y: number) => [number, number, number, number];

/** small seeded rng so every texture is the same on every load */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function valueNoise(seed: number, cells: number): (x: number, y: number) => number {
  const r = rng(seed);
  const grid = Array.from({ length: cells * cells }, () => r());
  const at = (i: number, j: number) => grid[((j % cells + cells) % cells) * cells + ((i % cells + cells) % cells)];
  return (x, y) => {
    const fx = x * cells;
    const fy = y * cells;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const u = fx - i;
    const v = fy - j;
    const su = u * u * (3 - 2 * u);
    const sv = v * v * (3 - 2 * v);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * su;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * su;
    return a + (b - a) * sv;
  };
}

function bake(size: number, shader: Shader, mipmaps = true): DataTexture {
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = shader((x + 0.5) / size, (y + 0.5) / size);
      const o = (y * size + x) * 4;
      pixels[o] = Math.round(Math.min(1, Math.max(0, r)) * 255);
      pixels[o + 1] = Math.round(Math.min(1, Math.max(0, g)) * 255);
      pixels[o + 2] = Math.round(Math.min(1, Math.max(0, b)) * 255);
      pixels[o + 3] = Math.round(Math.min(1, Math.max(0, a)) * 255);
    }
  }
  const texture = new DataTexture(pixels, size, size, RGBAFormat);
  texture.magFilter = LinearFilter;
  texture.minFilter = mipmaps ? LinearMipmapLinearFilter : LinearFilter;
  texture.generateMipmaps = mipmaps;
  texture.needsUpdate = true;
  return texture;
}

/** muzzle flash: hot core and six uneven petals, white so the sprite color tints it */
export function createFlashTexture(): DataTexture {
  const petals = [1, 0.62, 0.9, 0.7, 0.95, 0.58];
  return bake(64, (x, y) => {
    const dx = x * 2 - 1;
    const dy = y * 2 - 1;
    const r = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const sector = ((angle + Math.PI) / (Math.PI * 2)) * petals.length;
    const i = Math.floor(sector) % petals.length;
    const f = sector - Math.floor(sector);
    const reach = petals[i] * (1 - Math.abs(f - 0.5) * 1.5);
    const petal = Math.max(0, 1 - r / Math.max(0.05, reach)) ** 1.4;
    const core = Math.max(0, 1 - r * 2.6) ** 1.2;
    const a = Math.min(1, core + petal * 0.75);
    return [1, 1, 1, a];
  });
}

/** soft round puff with a noisy edge, for dust, smoke and blood mist */
export function createPuffTexture(): DataTexture {
  const n = valueNoise(7, 6);
  const m = valueNoise(19, 14);
  return bake(64, (x, y) => {
    const dx = x * 2 - 1;
    const dy = y * 2 - 1;
    const r = Math.hypot(dx, dy);
    const edge = 0.72 + 0.28 * (n(x, y) * 0.7 + m(x, y) * 0.3);
    const a = Math.max(0, 1 - r / edge) ** 1.5;
    return [1, 1, 1, a];
  });
}

/**
 * bullet hole textures for multiply blending: rgb is what the surface is
 * multiplied by, so 0.5 (128) darkens, 1.0 (255 in the upper half) keeps it,
 * and the shader maps [0, 1] to [0, 2] so rims can brighten too.
 */
export function createDecalTexture(kind: SurfaceKind): DataTexture {
  const noise = valueNoise(kind.length * 31 + 5, 9);
  const fine = valueNoise(kind.length * 17 + 3, 23);
  const cracks = rng(kind.length * 101 + 9);
  const crackAngles = Array.from({ length: 5 }, () => cracks() * Math.PI * 2);
  const crackLengths = Array.from({ length: 5 }, () => 0.45 + cracks() * 0.45);
  return bake(64, (x, y) => {
    const dx = x * 2 - 1;
    const dy = y * 2 - 1;
    let r = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const grain = noise(x, y);
    const speck = fine(x, y);
    // multiplier, 1 = untouched surface
    let m = 1;
    switch (kind) {
      case 'metal': {
        const hole = r < 0.16 ? 0.05 : 1;
        const rim = Math.exp(-(((r - 0.24) / 0.06) ** 2)) * 0.55;
        const scorch = r < 0.55 ? 1 - (0.55 - r) * 0.6 : 1;
        m = Math.min(hole, 1) * scorch + rim;
        break;
      }
      case 'wood': {
        r = Math.hypot(dx * 0.7, dy * 1.5);
        const hole = r < 0.2 ? 0.12 : 1;
        const splinter = Math.abs(dy) < 0.12 + grain * 0.1 && Math.abs(dx) < 0.85 * grain + 0.2 ? 0.55 : 1;
        m = Math.min(hole, splinter, r < 0.4 ? 0.7 + r * 0.6 : 1);
        break;
      }
      case 'sand': {
        const dip = 0.55 + 0.45 * Math.min(1, (r / 0.75) ** 1.6);
        const rim = Math.exp(-(((r - 0.78) / 0.1) ** 2)) * 0.08;
        m = dip + rim + (speck - 0.5) * 0.12;
        break;
      }
      case 'glass': {
        const hole = r < 0.12 ? 0.1 : 1;
        let crack = 1;
        for (let i = 0; i < crackAngles.length; i += 1) {
          const d = Math.abs(Math.sin(angle - crackAngles[i])) * r;
          if (d < 0.02 && r < crackLengths[i]) crack = 0.6;
        }
        m = Math.min(hole, crack);
        break;
      }
      default: {
        // concrete, stone, generic: dark core, chipped crater, lighter dust ring, a few cracks
        const hole = r < 0.13 ? 0.08 : 1;
        const crater = r < 0.42 + grain * 0.12 ? 0.55 + 0.35 * (r / 0.5) + (speck - 0.5) * 0.25 : 1;
        const dust = Math.exp(-(((r - 0.62) / 0.14) ** 2)) * 0.12;
        let crack = 1;
        for (let i = 0; i < 3; i += 1) {
          const d = Math.abs(Math.sin(angle - crackAngles[i])) * r;
          if (d < 0.018 + grain * 0.01 && r < crackLengths[i]) crack = 0.62;
        }
        m = Math.min(hole, crater, crack) + dust;
        break;
      }
    }
    const fade = r > 0.92 ? 1 - (r - 0.92) / 0.08 : 1;
    const value = 1 + (m - 1) * Math.max(0, fade);
    const encoded = value / 2;
    return [encoded, encoded, encoded, 1];
  });
}
