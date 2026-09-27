import {
  BufferGeometry,
  Group,
  type Material,
  Mesh,
  Object3D,
  Texture,
  Vector3,
} from 'three';
import type { KnifeDef, KnifeShape } from '../combat/knives';
import { buildBlade } from './knife/blade';
import { createKnifeMaterials, type KnifeMaterials } from './knife/materials';
import {
  cordWrap,
  crossGuard,
  handleOutline,
  loft,
  type Outline,
  pin,
  ring,
  skeletonFrame,
  slab,
  torus,
  tube,
} from './knife/parts';
import { bladeCurves } from './knife/profiles';

export { bladeShape } from './knife/profiles';

/** names of the sockets and articulated groups the viewmodel code can look up */
export const KNIFE_NODES = {
  grip: 'socket_grip',
  tip: 'socket_tip',
  pivot: 'socket_pivot',
  pivotSafe: 'socket_pivot_safe',
  pivotBite: 'socket_pivot_bite',
  ring: 'socket_ring',
  bladePivot: 'blade_pivot',
  handleSafe: 'handle_safe',
  handleBite: 'handle_bite',
  fingerRing: 'finger_ring',
} as const;

/**
 * builds an original procedural knife from a {@link KnifeDef}. frame: +X runs from
 * the guard to the blade tip, +Y is the spine side, the edge faces -Y, Z is
 * thickness. the grip centre sits on -X, so the origin is the point where the
 * hand meets the guard. units are metres.
 *
 * blades have a real cross section (edge bevel, flat or hollow grind, flats,
 * fuller, swedge, sawback teeth). moving parts are named groups whose origin
 * is the pivot pin, and every knife carries socket_* children, see
 * {@link KNIFE_NODES}:
 * - folders: `blade_pivot`, rotation.z = -PI folds the blade into the handle
 * - balisong: `handle_safe` (rotation.z 0..+PI closes over the spine) and
 *   `handle_bite` (0..-PI closes over the edge), each on its own tang pin
 * - ring knives: `finger_ring` with `socket_ring` at the ring centre
 */
export function buildProceduralKnife(def: KnifeDef): Group {
  const s = def.shape;
  const group = new Group();
  group.name = `ProceduralKnife:${def.id}`;
  const mats = createKnifeMaterials(s);
  const ctx: BuildContext = {
    id: def.id,
    s,
    mats,
    root: group,
    g: guardDepth(s),
    cy: s.bladeHeight / 2,
    // folder handles are taller than the blade so it can fold away inside them
    handleHeight: Math.max(0.022, s.bladeHeight * ((s.mechanism ?? 'fixed') === 'folder' ? 1.12 : 0.88)),
  };
  const mechanism = s.mechanism ?? 'fixed';

  // blade parts go under blade_pivot on folders so the whole blade can fold
  let bladeParent: Object3D = group;
  let bladeOffset = new Vector3();
  if (mechanism === 'folder') {
    const pivotPoint = folderPivot(ctx);
    const pivot = new Group();
    pivot.name = KNIFE_NODES.bladePivot;
    pivot.position.copy(pivotPoint);
    group.add(pivot);
    bladeParent = pivot;
    bladeOffset = pivotPoint.clone().negate();
    addSocket(group, KNIFE_NODES.pivot, pivotPoint);
  }
  const tip = addBlade(ctx, bladeParent, bladeOffset);
  addSocket(bladeParent, KNIFE_NODES.tip, tip.clone().add(bladeOffset));

  addGuard(ctx);
  const grip = addHandle(ctx, mechanism);
  addSocket(group, KNIFE_NODES.grip, grip);

  group.userData.knifeId = def.id;
  group.userData.mechanism = mechanism;
  group.userData.pair = s.pair === true;
  group.userData.overallLength = s.bladeLength + s.handleLength + guardDepth(s);
  return group;
}

/**
 * disposes geometries and materials created by {@link buildProceduralKnife}.
 * the small generated textures are shared between knives and stay alive.
 */
export function disposeProceduralKnife(root: Group): void {
  const materials = new Set<Material>();
  root.traverse((child) => {
    if (child instanceof Mesh) {
      (child.geometry as BufferGeometry).dispose();
      const list = Array.isArray(child.material) ? child.material : [child.material];
      for (const m of list) materials.add(m);
    }
  });
  for (const m of materials) m.dispose();
}

/** true for textures owned by the shared knife cache (never disposed per knife) */
export function isSharedKnifeTexture(tex: Texture | null | undefined): boolean {
  return tex?.userData.sharedKnifeTexture === true;
}

// ---------------------------------------------------------------- internals

interface BuildContext {
  id: string;
  s: KnifeShape;
  mats: KnifeMaterials;
  root: Group;
  /** guard depth along -x */
  g: number;
  /** handle axis height (blade mid height at the heel) */
  cy: number;
  handleHeight: number;
}

function guardDepth(s: KnifeShape): number {
  return s.guard === 'none' ? 0 : 0.012;
}

function addSocket(parent: Object3D, name: string, position: Vector3): Object3D {
  const socket = new Object3D();
  socket.name = name;
  socket.position.copy(position);
  parent.add(socket);
  return socket;
}

function mesh(name: string, geometry: BufferGeometry, material: Material | Material[], parent: Object3D,
  offset?: Vector3): Mesh {
  if (offset && offset.lengthSq() > 0) geometry.translate(offset.x, offset.y, offset.z);
  const m = new Mesh(geometry, material);
  m.name = name;
  parent.add(m);
  return m;
}

/**
 * pivot pin of a folder. folding by -PI mirrors the blade about the pin, so the
 * pin sits where the closed edge ends up just under the backspacer and the
 * spine rides at the bottom of the handle.
 */
function folderPivot(ctx: BuildContext): Vector3 {
  const h = ctx.s.bladeHeight;
  return new Vector3(-ctx.g * 0.5, (h + ctx.handleHeight) / 4 - 0.0022, 0);
}

function addBlade(ctx: BuildContext, parent: Object3D, offset: Vector3): Vector3 {
  const s = ctx.s;
  const curves = bladeCurves(s.profile, s.bladeLength, s.bladeHeight);
  const grind = s.grind ?? 'flat';
  const grindHeight = grind === 'sabre' ? 0.42 : grind === 'hollow' ? 0.58 : s.profile === 'tanto' ? 0.5 : 0.66;
  if (s.pair) curves.doubleEdgeFrom = 0.04;
  const blade = buildBlade({
    curves,
    thickness: s.bladeThickness,
    grind,
    grindHeight,
    ricasso: s.bladeLength > 0.15 ? 0.08 : 0.11,
    stations: s.serratedSpine ? 64 : 52,
    fuller: s.fuller ? { from: 0.06, to: 0.5, low: 0.47, high: 0.6, depth: s.bladeThickness * 0.2 } : undefined,
    serrations: s.serratedSpine
      ? { from: s.bladeLength * 0.1, to: s.bladeLength * 0.42, teeth: 8, height: Math.min(0.0032, s.bladeHeight * 0.09) }
      : undefined,
  });
  mesh('blade', blade.geometry, [ctx.mats.blade, ctx.mats.edge], parent, offset);
  if (blade.teeth) mesh('blade_teeth', blade.teeth, ctx.mats.blade, parent, offset);

  const mech = s.mechanism ?? 'fixed';
  if (mech === 'folder') {
    // tang disk around the pivot plus a thumb stud near the spine
    const p = folderPivot(ctx);
    const disk = pin(p.x, p.y, s.bladeHeight * 0.46, -s.bladeThickness / 2, s.bladeThickness / 2, 20);
    mesh('blade_tang', disk, ctx.mats.blade, parent, offset);
    const stud = pin(s.bladeLength * 0.1, s.bladeHeight * 0.76, 0.0021, -s.bladeThickness / 2 - 0.0022,
      s.bladeThickness / 2 + 0.0022, 12);
    mesh('thumb_stud', stud, ctx.mats.accent, parent, offset);
  }
  return blade.tip;
}

function addGuard(ctx: BuildContext): void {
  const { s, mats, root, cy } = ctx;
  if (s.guard === 'cross' || s.guard === 'ring') {
    const span = Math.max(s.bladeHeight * 2.1, ctx.handleHeight * 1.55);
    const geo = crossGuard(cy, span, 0.0095, Math.max(0.011, s.bladeThickness * 2.8), -ctx.g * 0.5);
    mesh('guard', geo, mats.accent, root);
    if (s.guard === 'ring') {
      const r = 0.0085;
      const geoRing = torus(new Vector3(-ctx.g * 0.5, cy + span / 2 + r * 0.72, 0), 'x', r, 0.0021, 0.0026, 28, 8);
      mesh('muzzle_ring', geoRing, mats.accent, root);
    }
  }
  if (s.guard === 'bolster' && (s.mechanism ?? 'fixed') === 'fixed') {
    // one piece bolster ring around the front of a fixed handle (kukri)
    const H = ctx.handleHeight * 1.08;
    const W = 0.024 * 1.05;
    const rings = [0.0015, -0.002, -ctx.g + 0.002, -ctx.g - 0.0005].map((x, i) => {
      const k = i === 0 || i === 3 ? 0.94 : 1;
      return ring(x, cy, (H / 2) * k, (H / 2) * k, (W / 2) * k, 20);
    });
    mesh('bolster', loft(rings, 0.02), mats.accent, root);
  }
}

/** returns the grip socket position */
function addHandle(ctx: BuildContext, mechanism: string): Vector3 {
  const s = ctx.s;
  if (mechanism === 'balisong') return balisongHandles(ctx);
  if (mechanism === 'folder') return folderHandle(ctx);
  switch (s.handle) {
    case 'cord':
      return cordHandle(ctx);
    case 'ring':
      return ringHandle(ctx);
    case 'skeleton':
      return skeletonHandle(ctx);
    case 'tee':
      return teeHandle(ctx);
    case 'wood':
    case 'grip':
    default:
      return loftHandle(ctx);
  }
}

// ---------------------------------------------------------------- fixed handles

interface LoftStyle {
  grooves?: number;
  choil?: number;
  swell?: number;
  flare?: number;
  bulges?: number[];
  width?: number;
  pommel?: boolean;
}

function loftStyle(s: KnifeShape, id: string): LoftStyle {
  if (s.handle === 'wood') {
    return s.profile === 'recurve'
      ? { bulges: [0.38, 0.52, 0.66], flare: 0.28, swell: 0.02, width: 0.025, pommel: true }
      : { swell: 0.1, flare: 0.16, width: 0.024, pommel: true };
  }
  switch (id) {
    case 'bayonet': return { grooves: 4, swell: 0.04, flare: 0.08, pommel: true };
    case 'm9_bayonet': return { swell: 0.06, flare: 0.1, choil: 0.08, pommel: true };
    case 'huntsman': return { grooves: 3, choil: 0.1, swell: 0.1, flare: 0.14 };
    case 'gut': return { grooves: 3, choil: 0.14, swell: 0.08, flare: 0.12 };
    default: return { swell: 0.1, flare: 0.12, choil: 0.06, pommel: true };
  }
}

function loftHandle(ctx: BuildContext): Vector3 {
  const { s, mats, root, cy } = ctx;
  const style = loftStyle(s, ctx.id);
  const H = ctx.handleHeight;
  const W = style.width ?? 0.023;
  const x0 = -ctx.g + 0.0015;
  const len = s.handleLength - (style.pommel ? 0.008 : 0);
  const n = 30;
  const rings = [];
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1);
    const x = x0 - t * len;
    const swell = 1 + (style.swell ?? 0.08) * Math.sin(Math.PI * t);
    const flare = 1 + (style.flare ?? 0.1) * Math.pow(t, 3);
    let bulge = 1;
    for (const b of style.bulges ?? []) bulge += 0.1 * Math.exp(-(((t - b) / 0.025) ** 2));
    let bottom = swell * flare * bulge;
    if (style.choil) bottom *= 1 - style.choil * Math.exp(-(((t - 0.07) / 0.05) ** 2));
    if (style.grooves) {
      const on = t > 0.1 && t < 0.72 ? 1 : 0;
      bottom *= 1 - 0.09 * on * Math.pow(Math.sin(Math.PI * ((t - 0.1) / 0.62) * style.grooves), 2);
    }
    const top = (1 + 0.03 * Math.sin(Math.PI * t)) * flare * bulge;
    const wide = (1 + 0.05 * Math.sin(Math.PI * t)) * flare * bulge;
    rings.push(ring(x, cy, (H / 2) * top, (H / 2) * bottom, (W / 2) * wide, 22));
  }
  const endX = x0 - len;
  if (!style.pommel) {
    // rounded butt
    const last = rings[rings.length - 1];
    for (let k = 1; k <= 3; k += 1) {
      const a = (k / 3) * (Math.PI / 2) * 0.92;
      const scale = Math.cos(a);
      rings.push(last.map((p) => new Vector3(endX - Math.sin(a) * 0.006, cy + (p.y - cy) * scale, p.z * scale)));
    }
  }
  mesh('handle', loft(rings, 0.03), mats.handle, root);

  if (style.pommel) {
    const last = rings[rings.length - 1];
    const pr = [0, 1, 2, 3, 4].map((k) => {
      const x = endX + 0.0006 - k * 0.002;
      const scale = k === 0 ? 1.0 : k < 3 ? 1.04 : Math.cos(((k - 2) / 3) * Math.PI * 0.45) * 1.02;
      return last.map((p) => new Vector3(x, cy + (p.y - cy) * scale, p.z * scale));
    });
    mesh('pommel', loft(pr, 0.02), mats.accent, root);
  }
  return new Vector3(x0 - s.handleLength / 2, cy, 0);
}

function cordHandle(ctx: BuildContext): Vector3 {
  const { s, mats, root, cy } = ctx;
  const tangH = ctx.handleHeight * 0.66;
  const x0 = -ctx.g + 0.002;
  const len = s.handleLength;
  const outline = straightOutline(x0, len + 0.012, cy, tangH);
  mesh('tang', slab(outline, 0, s.bladeThickness / 2, 1, { dome: 0, rows: 1 }), mats.blade, root);
  mesh('tang_back', slab(outline, 0, s.bladeThickness / 2, -1, { dome: 0, rows: 1 }), mats.blade, root);
  const cord = 0.0021;
  mesh('cord_wrap', cordWrap(x0 - 0.004, x0 - len + 0.002, cy, tangH / 2, s.bladeThickness / 2, cord), mats.handle, root);
  // lanyard loop through the tang end
  const endX = x0 - len - 0.006;
  mesh('lanyard', torus(new Vector3(endX - 0.006, cy - 0.001, 0), 'z', 0.0068, cord * 0.85, cord * 0.85, 24, 6),
    mats.handle, root);
  mesh('lanyard_pin', pin(endX + 0.0015, cy, 0.0022, -s.bladeThickness / 2 - 0.0006, s.bladeThickness / 2 + 0.0006, 10),
    mats.accent, root);
  return new Vector3(x0 - len / 2, cy, 0);
}

function straightOutline(x0: number, len: number, cy: number, height: number, n = 6): Outline {
  const top: [number, number][] = [];
  const bottom: [number, number][] = [];
  for (let i = 0; i < n; i += 1) {
    const x = x0 - (i / (n - 1)) * len;
    top.push([x, cy + height / 2]);
    bottom.push([x, cy - height / 2]);
  }
  return { top, bottom };
}

/** scales on a visible tang (karambit), optionally for a folder */
function scaleStack(ctx: BuildContext, outline: Outline, opts: { tang: boolean; folder: boolean }): void {
  const { s, mats, root } = ctx;
  const half = s.bladeThickness / 2;
  const linerT = 0.0008;
  const scaleT = 0.0042;
  if (opts.tang) {
    mesh('tang', slab(outline, 0, half, 1, { dome: 0, rows: 1 }), mats.blade, root);
    mesh('tang_back', slab(outline, 0, half, -1, { dome: 0, rows: 1 }), mats.blade, root);
  }
  const gap = opts.folder ? half + 0.0003 : half;
  for (const side of [1, -1] as const) {
    mesh(side > 0 ? 'liner_r' : 'liner_l', slab(outline, gap, linerT, side, { dome: 0, rows: 1 }), mats.liner, root);
    mesh(side > 0 ? 'scale_r' : 'scale_l', slab(outline, gap + linerT, scaleT, side, { dome: 0.6, rows: 6 }), mats.handle, root);
  }
  // pins through the scales, heads just proud of the crown
  const zOut = gap + linerT + scaleT + 0.0002;
  const n = outline.top.length;
  for (const f of [0.22, 0.55, 0.86]) {
    const i = Math.min(n - 1, Math.round(f * (n - 1)));
    const x = outline.top[i][0];
    const y = (outline.top[i][1] + outline.bottom[i][1]) / 2;
    mesh('pin', pin(x, y, 0.0019, -zOut, zOut, 12), mats.pin, root);
  }
}

function ringHandle(ctx: BuildContext): Vector3 {
  const { s, cy } = ctx;
  const x0 = -ctx.g + 0.001;
  const len = s.handleLength - 0.02;
  const outline = handleOutline(x0, len, cy, ctx.handleHeight * 0.95, { bend: len * 0.3, swell: 0.12, flare: 0.05, choil: 0.1 });
  scaleStack(ctx, outline, { tang: true, folder: false });
  const end = outline.top.length - 1;
  const endCenter = new Vector3(outline.top[end][0], (outline.top[end][1] + outline.bottom[end][1]) / 2, 0);
  addFingerRing(ctx, endCenter);
  const mid = Math.floor(end / 2);
  return new Vector3(outline.top[mid][0], (outline.top[mid][1] + outline.bottom[mid][1]) / 2, 0);
}

function addFingerRing(ctx: BuildContext, handleEnd: Vector3): void {
  const { s, mats, root } = ctx;
  const inner = 0.0125;
  const tubeR = 0.0036;
  const center = handleEnd.clone().add(new Vector3(-(inner + tubeR * 0.6), -0.003, 0));
  const group = new Group();
  group.name = KNIFE_NODES.fingerRing;
  group.position.copy(center);
  root.add(group);
  const geo = torus(new Vector3(0, 0, 0), 'z', inner + tubeR, tubeR, Math.max(s.bladeThickness * 0.9, 0.0034), 36, 10);
  mesh('finger_ring_mesh', geo, mats.accent, group);
  addSocket(group, KNIFE_NODES.ring, new Vector3());
}

function skeletonHandle(ctx: BuildContext): Vector3 {
  const { s, mats, root, cy } = ctx;
  const x0 = -ctx.g + 0.001;
  const len = s.handleLength;
  mesh('handle', skeletonFrame(x0, len, cy, ctx.handleHeight, s.bladeThickness * 1.3), mats.handle, root);
  // orange cord lanyard through the rear hole
  const hole = new Vector3(x0 - len * 0.86, cy + ctx.handleHeight * 0.025, 0);
  mesh('lanyard', torus(hole.clone().add(new Vector3(-0.004, -0.004, 0)), 'z', 0.0072, 0.0017, 0.0017, 24, 6),
    mats.liner, root);
  const tail = [0, 1, 2, 3, 4, 5].map((k) => new Vector3(hole.x - 0.009 - k * 0.004, hole.y - 0.01 - k * k * 0.0009, 0.001 * k));
  mesh('lanyard_tail', tube(tail, 0.0017, 6), mats.liner, root);
  return new Vector3(x0 - len / 2, cy, 0);
}

function teeHandle(ctx: BuildContext): Vector3 {
  const { s, mats, root, cy } = ctx;
  const barX = -0.016;
  const span = s.handleLength;
  const n = 26;
  const rings = [];
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1);
    const y = cy + (t - 0.5) * span;
    const edge = Math.abs(2 * t - 1);
    const round = edge > 0.86 ? Math.sqrt(Math.max(0.1, 1 - ((edge - 0.86) / 0.14) ** 2)) : 1;
    // finger grooves on the blade side of the bar, away from the stem
    const grooves = Math.abs(t - 0.5) > 0.08 ? 1 - 0.1 * Math.pow(Math.sin(Math.PI * t * 4), 2) : 1;
    const hx = 0.012 * round;
    const hz = 0.0105 * round * (1 - 0.06 * edge);
    const r = [];
    for (let j = 0; j < 18; j += 1) {
      const a = (j / 18) * Math.PI * 2;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const front = c > 0 ? grooves : 1;
      r.push(new Vector3(barX + Math.sign(c) * Math.pow(Math.abs(c), 0.7) * hx * front, y,
        Math.sign(sn) * Math.pow(Math.abs(sn), 0.7) * hz));
    }
    rings.push(r);
  }
  mesh('handle', loft(rings, 0.03), mats.handle, root);
  // stem that carries the blade out between the fingers
  const stem = [0.0015, -0.004, barX + 0.006].map((x, i) =>
    ring(x, cy, s.bladeHeight * (0.5 - i * 0.08), s.bladeHeight * (0.5 - i * 0.08), s.bladeThickness * (0.75 + i * 0.25), 12, 3));
  mesh('stem', loft(stem, 0.02), mats.blade, root);
  return new Vector3(barX, cy, 0);
}

// ---------------------------------------------------------------- folders and the balisong

function folderHandle(ctx: BuildContext): Vector3 {
  const { s, mats, root, cy } = ctx;
  const x0 = -ctx.g * 0.5 + 0.0045;
  const len = s.handleLength + ctx.g * 0.5 - 0.0045;
  const talon = s.fingerRing === true;
  const style = talon ? { bend: len * 0.12, swell: 0.1, flare: 0.04 } : { swell: 0.1, flare: 0.14, choil: 0.08 };
  const outline = handleOutline(x0, talon ? len - 0.02 : len, cy, ctx.handleHeight, style);
  scaleStack(ctx, outline, { tang: false, folder: true });

  // backspacer closes the spine side, the edge side stays open for the blade
  const n = outline.top.length;
  const back: Outline = {
    top: outline.top.slice(Math.floor(n * 0.3)).map((p) => [p[0], p[1] - 0.0004]),
    bottom: outline.top.slice(Math.floor(n * 0.3)).map((p) => [p[0], p[1] - 0.0045]),
  };
  const gap = s.bladeThickness / 2 + 0.0003;
  mesh('backspacer', slab(back, 0, gap, 1, { dome: 0, rows: 1 }), mats.liner, root);
  mesh('backspacer_back', slab(back, 0, gap, -1, { dome: 0, rows: 1 }), mats.liner, root);

  // metal bolsters over the pivot end
  if (s.guard === 'bolster' || s.guard === 'cross') {
    const bl = Math.floor(n * 0.2);
    const bolster: Outline = {
      top: outline.top.slice(0, bl).map((p) => [p[0], p[1] + 0.0003]),
      bottom: outline.bottom.slice(0, bl).map((p) => [p[0], p[1] - 0.0003]),
    };
    const z0 = gap + 0.0008;
    mesh('bolster_r', slab(bolster, z0, 0.0046, 1, { dome: 0.5, rows: 5 }), mats.accent, root);
    mesh('bolster_l', slab(bolster, z0, 0.0046, -1, { dome: 0.5, rows: 5 }), mats.accent, root);
  }
  if (s.guard === 'cross') {
    // stiletto style: small quillons ahead of the bolster
    mesh('guard', crossGuard(cy, s.bladeHeight * 2.3, 0.006, 0.009, 0.0015), mats.accent, root);
  }
  const p = folderPivot(ctx);
  const zPin = gap + 0.0008 + 0.0046 + 0.0003;
  mesh('pivot_pin', pin(p.x, p.y, 0.0034, -zPin, zPin, 16), mats.pin, root);
  if (talon) {
    const end = outline.top.length - 1;
    addFingerRing(ctx, new Vector3(outline.top[end][0], (outline.top[end][1] + outline.bottom[end][1]) / 2, 0));
  }
  return new Vector3(x0 - len / 2, cy, 0);
}

function balisongHandles(ctx: BuildContext): Vector3 {
  const { s, mats, root, cy } = ctx;
  const H = ctx.handleHeight * 1.02;
  const pinX = -0.006;
  const d = H * 0.22;
  const pins = { safe: new Vector3(pinX, cy + d, 0), bite: new Vector3(pinX, cy - d, 0) };
  // tang plate carrying both pivot holes, with a kicker on the edge side
  const tang: Outline = straightOutline(0.001, 0.012, cy, s.bladeHeight * 1.05);
  tang.bottom[tang.bottom.length - 1][1] -= 0.002;
  mesh('tang', slab(tang, 0, s.bladeThickness / 2, 1, { dome: 0, rows: 1 }), mats.blade, root);
  mesh('tang_back', slab(tang, 0, s.bladeThickness / 2, -1, { dome: 0, rows: 1 }), mats.blade, root);

  const len = s.handleLength;
  const gap = s.bladeThickness / 2 + 0.0004;
  const halfT = 0.0048;
  const outline = handleOutline(pinX + 0.0055, len + 0.0055, cy, H, { swell: 0.04, flare: 0.04 }, 26);
  const halves: [string, 1 | -1, Vector3, string][] = [
    [KNIFE_NODES.handleSafe, 1, pins.safe, KNIFE_NODES.pivotSafe],
    [KNIFE_NODES.handleBite, -1, pins.bite, KNIFE_NODES.pivotBite],
  ];
  for (const [name, side, p, socketName] of halves) {
    const half = new Group();
    half.name = name;
    half.position.copy(p);
    root.add(half);
    const off = p.clone().negate();
    mesh(`${name}_mesh`, slab(outline, gap, halfT, side, { dome: 0.45, rows: 6 }), mats.handle, half, off);
    const zPin = gap + halfT + 0.0004;
    mesh(`${name}_pin`, pin(p.x, p.y, 0.0026, side > 0 ? gap : -zPin, side > 0 ? zPin : -gap, 14), mats.pin, half, off);
    // two zen pins along the half
    for (const f of [0.45, 0.8]) {
      const x = pinX + 0.0055 - f * (len + 0.0055);
      mesh(`${name}_zen`, pin(x, cy, 0.0016, side > 0 ? gap : -zPin, side > 0 ? zPin : -gap, 10), mats.pin, half, off);
    }
    addSocket(root, socketName, p);
  }
  // latch at the butt of the bite handle
  const bite = root.getObjectByName(KNIFE_NODES.handleBite)!;
  const latchY = cy;
  const latchX = pinX - len - 0.002;
  const latch = straightOutline(latchX + 0.012, 0.016, latchY, 0.0036, 4);
  mesh('latch', slab(latch, gap + halfT * 0.2, 0.0012, -1, { dome: 0.3, rows: 2 }), mats.accent, bite, pins.bite.clone().negate());
  return new Vector3(pinX - len / 2, cy, 0);
}
