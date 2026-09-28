import { Color, MeshStandardMaterial, Vector2 } from 'three';
import type { HandleStyle, KnifeShape } from '../../combat/knives';
import { braidColor, braidNormal, brushedColor, brushedRoughness, pebbleNormal, woodGrain } from './textures';

export interface KnifeMaterials {
  blade: MeshStandardMaterial;
  /** polished sharpening bevel, reads as a bright line along the edge */
  edge: MeshStandardMaterial;
  handle: MeshStandardMaterial;
  accent: MeshStandardMaterial;
  pin: MeshStandardMaterial;
  liner: MeshStandardMaterial;
}

const DARK_FINISH_LUMA = 0.35;

function luma(hex: number): number {
  const c = new Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

function saturation(hex: number): number {
  const c = new Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return hsl.s;
}

/** true for blades the catalog gives a dark (coated or stonewashed) finish */
export function isDarkFinish(shape: KnifeShape): boolean {
  return luma(shape.bladeColor) < DARK_FINISH_LUMA;
}

/**
 * one set of materials per knife (disposed with it). textures are shared
 * singletons, see textures.ts.
 */
export function createKnifeMaterials(shape: KnifeShape): KnifeMaterials {
  const dark = isDarkFinish(shape);
  const blade = new MeshStandardMaterial({
    name: 'knife_blade',
    color: dark ? new Color(shape.bladeColor).multiplyScalar(0.55) : shape.bladeColor,
    metalness: dark ? 0.7 : 1.0,
    roughness: dark ? 0.72 : 0.5,
    roughnessMap: brushedRoughness(),
    map: brushedColor(),
  });
  const edge = new MeshStandardMaterial({
    name: 'knife_edge',
    color: 0xe4e8ee,
    metalness: 1.0,
    roughness: 0.16,
  });
  const accentMetal = saturation(shape.accentColor) < 0.5;
  // metal accents are the guards, bolsters, pommels and rings the finishes paint (knife-contract.md)
  const accent = new MeshStandardMaterial({
    name: accentMetal ? 'knife_metal' : 'knife_accent',
    color: shape.accentColor,
    metalness: accentMetal ? (luma(shape.accentColor) < 0.05 ? 0.5 : 0.9) : 0.0,
    roughness: accentMetal ? 0.36 : 0.55,
  });
  const pin = new MeshStandardMaterial({ name: 'knife_pin', color: 0xb9bec6, metalness: 1.0, roughness: 0.28 });
  const liner = accentMetal
    ? new MeshStandardMaterial({ name: 'knife_liner', color: 0x8d939b, metalness: 1.0, roughness: 0.4 })
    : new MeshStandardMaterial({ name: 'knife_liner', color: shape.accentColor, metalness: 0.0, roughness: 0.5 });
  const handle = handleMaterial(shape.handle, shape.handleColor);
  // contract names for the finish system: a skeleton frame is bare metal like its blade
  handle.name = shape.handle === 'skeleton' ? 'knife_metal' : 'knife_handle';
  handle.userData.handleStyle = shape.handle;
  return { blade, edge, handle, accent, pin, liner };
}

function handleMaterial(style: HandleStyle, color: number): MeshStandardMaterial {
  switch (style) {
    case 'grip':
    case 'tee':
    case 'ring':
      // moulded rubber / textured polymer
      return new MeshStandardMaterial({
        name: 'knife_handle_rubber', color, metalness: 0.0, roughness: 0.82,
        normalMap: pebbleNormal(), normalScale: new Vector2(0.55, 0.55),
      });
    case 'wood':
      return new MeshStandardMaterial({
        name: 'knife_handle_wood', color: new Color(color).multiplyScalar(1.2), metalness: 0.0, roughness: 0.58,
        map: woodGrain(),
      });
    case 'cord':
      return new MeshStandardMaterial({
        name: 'knife_handle_cord', color, metalness: 0.0, roughness: 0.92,
        map: braidColor(), normalMap: braidNormal(), normalScale: new Vector2(0.8, 0.8),
      });
    case 'split':
    case 'skeleton':
      // bare metal handles
      return new MeshStandardMaterial({
        name: 'knife_handle_metal', color, metalness: 0.9, roughness: 0.42, roughnessMap: brushedRoughness(),
      });
    case 'scales':
    default:
      // g10 style scales with a fine texture
      return new MeshStandardMaterial({
        name: 'knife_handle_scales', color, metalness: 0.0, roughness: 0.62,
        normalMap: pebbleNormal(), normalScale: new Vector2(0.25, 0.25),
      });
  }
}
