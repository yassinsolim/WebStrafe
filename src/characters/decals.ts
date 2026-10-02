import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  type Bone,
} from 'three';
import { drawEmblem } from './emblems';
import type { CharacterLook } from './look';
import type { DecalAnchor } from './library';

export const DECAL_NAME = 'CharacterDecals';
const EMBLEM_PX = 128;
const TAG_W = 384;

function canvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    return c;
  }
  return null;
}

/** picks a dark or light outline so the emblem reads on any paint */
function outlineFor(hex: string): string {
  const c = new Color(hex);
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return lum > 0.35 ? 'rgba(10,12,14,0.85)' : 'rgba(235,235,230,0.8)';
}

/**
 * the emblem and callsign drawn into one small texture: emblem in the left
 * square, callsign in the 3:1 strip to its right
 */
function paint(look: CharacterLook): CanvasTexture | null {
  const c = canvas(EMBLEM_PX + TAG_W, EMBLEM_PX);
  if (!c) return null;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D | null;
  if (!ctx) return null;
  ctx.clearRect(0, 0, c.width, c.height);
  if (look.emblem !== 'none') {
    ctx.save();
    ctx.shadowColor = outlineFor(look.accent);
    ctx.shadowBlur = 0;
    // a cheap outline: the emblem stamped a few px around in the outline colour
    for (const [dx, dy] of [[-3, 0], [3, 0], [0, -3], [0, 3], [-2, -2], [2, 2], [-2, 2], [2, -2]]) {
      drawEmblem(ctx, look.emblem, EMBLEM_PX / 2 + dx, EMBLEM_PX / 2 + dy, EMBLEM_PX * 0.86, outlineFor(look.accent));
    }
    drawEmblem(ctx, look.emblem, EMBLEM_PX / 2, EMBLEM_PX / 2, EMBLEM_PX * 0.86, look.accent);
    ctx.restore();
  }
  if (look.tag) {
    ctx.save();
    ctx.font = '700 88px "Rajdhani", "Barlow Condensed", "Arial Narrow", "Helvetica Neue", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const x = EMBLEM_PX + TAG_W / 2;
    const y = EMBLEM_PX / 2 + 4;
    const maxWidth = TAG_W - 24;
    ctx.lineWidth = 10;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = outlineFor(look.accent);
    ctx.strokeText(look.tag, x, y, maxWidth);
    ctx.fillStyle = look.accent;
    ctx.fillText(look.tag, x, y, maxWidth);
    ctx.restore();
  }
  const texture = new CanvasTexture(c as HTMLCanvasElement);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function quad(width: number, height: number, u0: number, u1: number): BufferGeometry {
  const g = new BufferGeometry();
  const w = width / 2;
  const h = height / 2;
  g.setAttribute('position', new BufferAttribute(new Float32Array([-w, -h, 0, w, -h, 0, w, h, 0, -w, h, 0]), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array([u0, 0, u1, 0, u1, 1, u0, 1]), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/**
 * builds the decal quads for a look and parents them to their bones. returns
 * a disposer. no-op when there is no canvas (node tests) or nothing to show.
 * `set` picks the anchors: the kit's chest piece, or a skin's id
 */
export function attachDecals(
  anchors: DecalAnchor[],
  look: CharacterLook,
  bones: Map<string, Bone>,
  bindWorld: Map<string, Matrix4>,
  set: string = look.chest,
): (() => void) | null {
  const wanted = anchors.filter((a) => a.set === set && (a.kind === 'emblem' ? look.emblem !== 'none' : look.tag !== ''));
  if (wanted.length === 0) return null;
  const texture = paint(look);
  if (!texture) return null;
  const material = new MeshStandardMaterial({
    map: texture,
    alphaTest: 0.5,
    roughness: 0.55,
    metalness: 0.05,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  material.name = 'CharacterDecal';
  const split = EMBLEM_PX / (EMBLEM_PX + TAG_W);
  const meshes: Mesh[] = [];
  for (const anchor of wanted) {
    const bone = bones.get(anchor.bone);
    const bind = bindWorld.get(anchor.bone);
    if (!bone || !bind) continue;
    const geometry = anchor.kind === 'emblem'
      ? quad(anchor.size, anchor.size, 0, split)
      : quad(anchor.size, anchor.size / 3, split, 1);
    const mesh = new Mesh(geometry, material);
    mesh.name = `${DECAL_NAME}:${anchor.kind}`;
    // anchor pose relative to the bone's bind pose
    const world = new Matrix4().compose(anchor.position, anchor.quaternion, mesh.scale.clone().set(1, 1, 1));
    const local = new Matrix4().copy(bind).invert().multiply(world);
    local.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.frustumCulled = false;
    bone.add(mesh);
    meshes.push(mesh);
  }
  return () => {
    for (const mesh of meshes) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    material.dispose();
    texture.dispose();
  };
}
