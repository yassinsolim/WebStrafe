import { beforeAll, describe, expect, it } from 'vitest';
import { NodeIO, type Document, type mat4, type Node } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KNIVES, type KnifeId } from '../../src/combat/knives';

// checks public/knives/<id>.glb against docs/assets/knife-contract.md: nodes,
// clean pivots, materials, budgets, the knife frame and the userData hints

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FOLDERS: KnifeId[] = ['flip', 'stiletto', 'talon'];
const RING_SOCKET: KnifeId[] = ['karambit', 'talon', 'skeleton'];
const HAWKBILL: KnifeId[] = ['karambit', 'talon'];
const MATERIALS = ['knife_blade', 'knife_edge', 'knife_handle', 'knife_metal', 'knife_accent'];
const REQUIRED = ['knife_blade', 'knife_edge', 'knife_handle'];
// knives without fittings (none left since the paracord knife was retired)
const NO_METAL: KnifeId[] = [];
const MAX_TRIANGLES = 15000;
const MAX_BYTES = 1.5 * 1024 * 1024;
const MAX_TEXTURE_PX = 2048;
const LOD1_MAX_BYTES = 400 * 1024;

/**
 * sockets (knife frame, metres) and userData hints the grips were fitted to
 * (tools/assets/gripFit.ts). models may change, these may not move more than 1 mm.
 */
const FITTED: Record<KnifeId, { sockets: Record<string, V3>; hints: Record<string, number> }> = {
  bayonet: { sockets: { socket_grip: [-0.062, 0.018, 0], socket_tip: [0.18, 0.0165, 0] }, hints: { handleLength: 0.131, handleThickness: 0.0286, handleHeight: 0.033, bladeLength: 0.18, bladeHeight: 0.036 } },
  flip: { sockets: { socket_grip: [-0.062, 0.0145, 0], socket_pivot: [-0.009, 0.0159, 0], socket_tip: [0.1, 0.0135, 0] }, hints: { handleLength: 0.126, handleThickness: 0.0125, handleHeight: 0.036, bladeLength: 0.1, bladeHeight: 0.0306 } },
  gut: { sockets: { socket_grip: [-0.058, 0.016, 0], socket_tip: [0.1, 0.012, 0] }, hints: { handleLength: 0.12, handleThickness: 0.025, handleHeight: 0.031, bladeLength: 0.1, bladeHeight: 0.032 } },
  karambit: { sockets: { socket_grip: [-0.043, 0.0063, 0], socket_ring: [-0.0998, -0.0224, 0], socket_tip: [0.0713, -0.0307, 0] }, hints: { handleLength: 0.086, handleThickness: 0.013, handleHeight: 0.026, bladeLength: 0.0718, bladeHeight: 0.0255, ringInnerRadius: 0.0115 } },
  m9_bayonet: { sockets: { socket_grip: [-0.063, 0.019, 0], socket_tip: [0.19, 0.017, 0] }, hints: { handleLength: 0.133, handleThickness: 0.03, handleHeight: 0.035, bladeLength: 0.19, bladeHeight: 0.038 } },
  huntsman: { sockets: { socket_grip: [-0.062, 0.019, 0], socket_tip: [0.155, 0.018, 0] }, hints: { handleLength: 0.127, handleThickness: 0.027, handleHeight: 0.0335, bladeLength: 0.155, bladeHeight: 0.0383 } },
  butterfly: { sockets: { socket_grip: [-0.064, 0.0115, 0], socket_pivot_bite: [-0.0065, 0.0047, 0], socket_pivot_safe: [-0.0065, 0.0182, 0], socket_tip: [0.102, 0.0105, 0] }, hints: { handleLength: 0.128, handleThickness: 0.0129, handleHeight: 0.027, bladeLength: 0.102, bladeHeight: 0.0232 } },
  shadow_daggers: { sockets: { socket_grip: [-0.024, 0.013, 0], socket_tee: [-0.024, 0.013, 0], socket_tip: [0.066, 0.013, 0] }, hints: { handleLength: 0.092, handleThickness: 0.018, handleHeight: 0.014, bladeLength: 0.066, bladeHeight: 0.0253 } },
  bowie: { sockets: { socket_grip: [-0.06, 0.02, 0], socket_tip: [0.185, 0.019, 0] }, hints: { handleLength: 0.125, handleThickness: 0.027, handleHeight: 0.033, bladeLength: 0.185, bladeHeight: 0.0422 } },
  stiletto: { sockets: { socket_grip: [-0.07, 0.008, 0], socket_pivot: [-0.011, 0.0086, 0], socket_tip: [0.125, 0.008, 0] }, hints: { handleLength: 0.15, handleThickness: 0.0122, handleHeight: 0.0208, bladeLength: 0.125, bladeHeight: 0.016 } },
  talon: { sockets: { socket_grip: [-0.042, 0.0079, 0], socket_pivot: [-0.008, 0.0115, 0], socket_ring: [-0.0955, -0.0153, 0], socket_tip: [0.0643, -0.0244, 0] }, hints: { handleLength: 0.084, handleThickness: 0.0126, handleHeight: 0.026, bladeLength: 0.0648, bladeHeight: 0.0265, ringInnerRadius: 0.0115 } },
  skeleton: { sockets: { socket_grip: [-0.044, 0.014, 0], socket_ring: [-0.097, 0.014, 0], socket_tip: [0.1, 0.012, 0] }, hints: { handleLength: 0.088, handleThickness: 0.0057, handleHeight: 0.028, bladeLength: 0.1, bladeHeight: 0.028, ringInnerRadius: 0.011 } },
};

type V3 = [number, number, number];

const docs = new Map<string, Document>();
const lods = new Map<string, Document>();
const glb = (id: string, suffix = '') => path.join(repo, 'public', 'knives', `${id}${suffix}.glb`);

beforeAll(async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  for (const k of KNIVES) {
    docs.set(k.id, await io.read(glb(k.id)));
    lods.set(k.id, await io.read(glb(k.id, '_lod1')));
  }
});

function find(doc: Document, name: string): Node | undefined {
  return doc.getRoot().listNodes().find((n) => n.getName() === name);
}

function node(doc: Document, name: string): Node {
  const found = doc.getRoot().listNodes().filter((n) => n.getName() === name);
  expect(found, `node ${name}`).toHaveLength(1);
  return found[0];
}

function apply(m: mat4, v: readonly number[], w: 0 | 1): V3 {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * w,
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * w,
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * w,
  ];
}

const worldPos = (n: Node) => apply(n.getWorldMatrix(), [0, 0, 0], 1);
const worldDir = (n: Node, v: V3): V3 => {
  const d = apply(n.getWorldMatrix(), v, 0);
  const len = Math.hypot(...d);
  return d.map((c) => c / len) as V3;
};

/** world-space vertices of every primitive on a mesh node, optionally filtered by material */
function points(n: Node, materials?: string[], matrix: mat4 = n.getWorldMatrix()): V3[] {
  const out: V3[] = [];
  for (const prim of n.getMesh()?.listPrimitives() ?? []) {
    if (materials && !materials.includes(prim.getMaterial()?.getName() ?? '')) continue;
    const pos = prim.getAttribute('POSITION')!;
    const el: number[] = [];
    for (let i = 0; i < pos.getCount(); i += 1) out.push(apply(matrix, pos.getElement(i, el), 1));
  }
  return out;
}

function meshNodes(doc: Document): Node[] {
  return doc.getRoot().listNodes().filter((n) => n.getMesh() !== null);
}

function triangles(doc: Document): number {
  let total = 0;
  for (const n of meshNodes(doc)) {
    for (const prim of n.getMesh()!.listPrimitives()) {
      total += (prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION')!.getCount()) / 3;
    }
  }
  return total;
}

function extent(pts: V3[], axis: 0 | 1 | 2): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pts) {
    lo = Math.min(lo, p[axis]);
    hi = Math.max(hi, p[axis]);
  }
  return [lo, hi];
}

const mean = (pts: V3[], axis: 0 | 1 | 2) => pts.reduce((a, p) => a + p[axis], 0) / Math.max(1, pts.length);

/** y range of a mesh's side silhouette per x bin, rasterised from its triangles */
function handleBins(n: Node, width: number): Map<number, [number, number]> {
  const bins = new Map<number, [number, number]>();
  const m = n.getWorldMatrix();
  for (const prim of n.getMesh()?.listPrimitives() ?? []) {
    const pos = prim.getAttribute('POSITION')!;
    const idx = prim.getIndices();
    const el: number[] = [];
    const verts: V3[] = [];
    for (let i = 0; i < pos.getCount(); i += 1) verts.push(apply(m, pos.getElement(i, el), 1));
    const count = idx ? idx.getCount() : pos.getCount();
    for (let t = 0; t < count; t += 3) {
      const tri = [0, 1, 2].map((k) => verts[idx ? idx.getScalar(t + k) : t + k]);
      const [xLo, xHi] = extent(tri, 0);
      const [yLo, yHi] = extent(tri, 1);
      for (let b = Math.floor(xLo / width); b <= Math.floor(xHi / width); b += 1) {
        const r = bins.get(b) ?? [Infinity, -Infinity];
        bins.set(b, [Math.min(r[0], yLo), Math.max(r[1], yHi)]);
      }
    }
  }
  return bins;
}

/** the node that carries the blade (the folder pivot's mesh, else the static body) */
function bladeNode(doc: Document, id: KnifeId): Node {
  return FOLDERS.includes(id) ? node(doc, 'blade_pivot_mesh') : node(doc, 'body');
}

/** blade mesh points in world space with the folder's blade_pivot at rotation.z = angle */
function bladeAt(doc: Document, angle: number): V3[] {
  const pivot = node(doc, 'blade_pivot');
  const mesh = node(doc, 'blade_pivot_mesh');
  const [px, py, pz] = worldPos(pivot);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return points(mesh, ['knife_blade', 'knife_edge'], mesh.getMatrix()).map(([x, y, z]) => [px + c * x - s * y, py + s * x + c * y, pz + z]);
}

describe.each(KNIVES.map((k) => [k.id, k] as const))('%s', (id) => {
  const doc = () => docs.get(id)!;
  const extras = () => node(doc(), id).getExtras() as Record<string, unknown>;

  it('stays inside the size and triangle budgets', () => {
    expect(statSync(glb(id)).size).toBeLessThanOrEqual(MAX_BYTES);
    expect(triangles(doc())).toBeLessThanOrEqual(MAX_TRIANGLES);
    expect(triangles(doc())).toBeGreaterThan(1500);
  });

  it('has the knife root with the userData hints', () => {
    const root = node(doc(), id);
    expect(root.getParentNode()).toBeNull();
    const e = extras();
    const grip = HAWKBILL.includes(id) ? 'reverse_ring' : id === 'butterfly' ? 'balisong' : id === 'shadow_daggers' ? 'tee' : 'hammer';
    expect(e.grip).toBe(grip);
    for (const key of ['handleLength', 'handleThickness', 'handleHeight', 'bladeLength', 'bladeHeight']) {
      expect(typeof e[key], key).toBe('number');
      expect(e[key] as number, key).toBeGreaterThan(0.004);
      expect(e[key] as number, key).toBeLessThan(0.3);
    }
    if (HAWKBILL.includes(id) || id === 'skeleton') {
      expect(e.ringInnerRadius as number).toBeGreaterThan(0.0105);
      expect(e.ringInnerRadius as number).toBeLessThan(0.0125);
    } else {
      expect(e.ringInnerRadius).toBeUndefined();
    }
    expect(e.pair === true).toBe(id === 'shadow_daggers');
  });

  it('has every contract node exactly once, and nothing that does not belong', () => {
    const folder = FOLDERS.includes(id);
    const expected = ['socket_grip', 'socket_tip'];
    if (folder) expected.push('blade_pivot', 'blade_pivot_mesh', 'socket_pivot');
    if (id === 'butterfly') expected.push('handle_safe', 'handle_bite', 'handle_safe_mesh', 'handle_bite_mesh', 'socket_pivot_safe', 'socket_pivot_bite');
    if (RING_SOCKET.includes(id)) expected.push('socket_ring');
    if (id === 'shadow_daggers') expected.push('socket_tee');
    for (const name of expected) node(doc(), name);
    expect(find(doc(), 'blade_pivot') !== undefined).toBe(folder);
    expect(find(doc(), 'handle_safe') !== undefined).toBe(id === 'butterfly');
    expect(find(doc(), 'socket_ring') !== undefined).toBe(RING_SOCKET.includes(id));
    expect(find(doc(), 'socket_tee') !== undefined).toBe(id === 'shadow_daggers');
    expect(node(doc(), 'socket_tip').getParentNode()?.getName()).toBe(folder ? 'blade_pivot' : id);
    for (const name of ['socket_grip', 'socket_pivot', 'socket_ring', 'socket_tee', 'socket_pivot_safe', 'socket_pivot_bite']) {
      const n = find(doc(), name);
      if (n) expect(n.getParentNode()?.getName(), name).toBe(id);
    }
  });

  it('keeps moving parts as clean pivots with the geometry in <part>_mesh', () => {
    const pivots = [...(FOLDERS.includes(id) ? ['blade_pivot'] : []), ...(id === 'butterfly' ? ['handle_safe', 'handle_bite'] : [])];
    for (const name of pivots) {
      const n = node(doc(), name);
      expect(n.getMesh(), name).toBeNull();
      expect(n.getParentNode()?.getName(), name).toBe(id);
      expect(n.getRotation(), name).toEqual([0, 0, 0, 1]);
      n.getScale().forEach((s) => expect(s, name).toBeCloseTo(1, 6));
      const child = n.listChildren().find((c) => c.getName() === `${name}_mesh`);
      expect(child?.getMesh(), `${name}_mesh`).not.toBeNull();
    }
    const pairs: [string, string][] = [['blade_pivot', 'socket_pivot'], ['handle_safe', 'socket_pivot_safe'], ['handle_bite', 'socket_pivot_bite']];
    for (const [pivot, socket] of pairs) {
      const p = find(doc(), pivot);
      if (!p) continue;
      const a = worldPos(p);
      const b = worldPos(node(doc(), socket));
      expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), socket).toBeLessThan(1e-5);
    }
  });

  it('uses only the contract materials, each with baked colour, normal and orm maps on a 0..1 uv atlas', () => {
    const used = new Set<string>();
    for (const n of meshNodes(doc())) {
      for (const prim of n.getMesh()!.listPrimitives()) {
        const mat = prim.getMaterial();
        const name = mat?.getName() ?? '';
        expect(MATERIALS, `${n.getName()} ${name}`).toContain(name);
        expect(mat!.getBaseColorTexture(), `${name} colour`).not.toBeNull();
        expect(mat!.getNormalTexture(), `${name} normal`).not.toBeNull();
        expect(mat!.getMetallicRoughnessTexture(), `${name} roughness/metalness`).not.toBeNull();
        expect(mat!.getOcclusionTexture(), `${name} ao`).not.toBeNull();
        const uv = prim.getAttribute('TEXCOORD_0');
        expect(uv, `${n.getName()} ${name} uv`).not.toBeNull();
        const el: number[] = [];
        for (let i = 0; i < uv!.getCount(); i += 97) {
          uv!.getElement(i, el);
          expect(el[0], `${name} u`).toBeGreaterThanOrEqual(-1e-3);
          expect(el[0], `${name} u`).toBeLessThanOrEqual(1.001);
          expect(el[1], `${name} v`).toBeGreaterThanOrEqual(-1e-3);
          expect(el[1], `${name} v`).toBeLessThanOrEqual(1.001);
        }
        used.add(name);
      }
    }
    for (const t of doc().getRoot().listTextures()) {
      const [w, h] = t.getSize() ?? [0, 0];
      expect(Math.max(w, h), t.getName()).toBeLessThanOrEqual(MAX_TEXTURE_PX);
      expect(t.getMimeType(), t.getName()).toBe('image/webp');
    }
    for (const name of REQUIRED) expect([...used], name).toContain(name);
    expect(used.has('knife_metal'), 'knife_metal').toBe(!NO_METAL.includes(id));
    const blade = bladeNode(doc(), id);
    const bladeMats = blade.getMesh()!.listPrimitives().map((p) => p.getMaterial()?.getName());
    expect(bladeMats).toContain('knife_blade');
    expect(bladeMats).toContain('knife_edge');
  });

  it('faces the knife frame: tip on +x, spine on +y, thickness along z', () => {
    const e = extras();
    const bladeLength = e.bladeLength as number;
    const blade = points(bladeNode(doc(), id), ['knife_blade', 'knife_edge']).filter((p) => p[0] > 0.004);
    const edge = points(bladeNode(doc(), id), ['knife_edge']);
    const tip = worldPos(node(doc(), 'socket_tip'));
    const [, xMax] = extent(blade, 0);
    expect(xMax / bladeLength).toBeGreaterThan(0.97);
    expect(xMax / bladeLength).toBeLessThan(1.03);
    expect(tip[0]).toBeGreaterThan(bladeLength * (HAWKBILL.includes(id) ? 0.8 : 0.97));
    expect(Math.abs(tip[2])).toBeLessThan(1e-4);
    // the tip is the blade's point: nothing on the blade reaches further out along the blade's own axis
    const far = Math.max(...blade.map((p) => Math.hypot(p[0], p[1] - tip[1] * 0.5)));
    expect(Math.hypot(tip[0], tip[1] - tip[1] * 0.5)).toBeGreaterThan(far - 0.004);
    if (id === 'shadow_daggers') {
      // double edged: sharpened on both the spine side and the edge side
      expect(edge.some((p) => p[1] > tip[1] + 0.004)).toBe(true);
      expect(edge.some((p) => p[1] < tip[1] - 0.004)).toBe(true);
    } else {
      expect(mean(edge, 1)).toBeLessThan(mean(blade, 1));
    }
    const [zLo, zHi] = extent(blade, 2);
    const [yLo, yHi] = extent(blade, 1);
    expect(zHi - zLo).toBeLessThan(0.0095);
    expect(yHi - yLo).toBeGreaterThan((zHi - zLo) * 2.5);
    const bladeHeight = e.bladeHeight as number;
    expect(bladeHeight).toBeLessThanOrEqual((yHi - yLo) * 1.05);
    expect(bladeHeight).toBeGreaterThan((yHi - yLo) * (HAWKBILL.includes(id) ? 0.35 : 0.6));
  });

  it('keeps the sockets and hints the grips were fitted to, within 1 mm', () => {
    const fitted = FITTED[id];
    for (const [name, want] of Object.entries(fitted.sockets)) {
      const got = worldPos(node(doc(), name));
      expect(Math.hypot(got[0] - want[0], got[1] - want[1], got[2] - want[2]), name).toBeLessThan(0.001);
    }
    const e = extras();
    for (const [key, want] of Object.entries(fitted.hints)) expect(Math.abs((e[key] as number) - want), key).toBeLessThan(0.001);
  });

  it('ships a lod1 with the same nodes, sockets and hints at under half the triangles', () => {
    const lod = lods.get(id)!;
    expect(statSync(glb(id, '_lod1')).size).toBeLessThanOrEqual(LOD1_MAX_BYTES);
    expect(triangles(lod)).toBeLessThan(triangles(doc()) * 0.5);
    expect(triangles(lod)).toBeGreaterThan(triangles(doc()) * 0.25);
    const names = (d: Document) => d.getRoot().listNodes().filter((n) => !n.getName().endsWith('_mesh') && n.getName() !== 'body')
      .map((n) => n.getName()).sort();
    expect(names(lod)).toEqual(names(doc()));
    for (const n of doc().getRoot().listNodes().filter((x) => x.getName().startsWith('socket_'))) {
      const a = worldPos(n);
      const b = worldPos(node(lod, n.getName()));
      expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), n.getName()).toBeLessThan(1e-5);
    }
    expect(node(lod, id).getExtras()).toEqual(extras());
  });

  it('puts socket_grip in the middle of the handle, matching the handle hints', () => {
    const e = extras();
    const grip = worldPos(node(doc(), 'socket_grip'));
    // everything static plus the balisong handles in the open pose
    const body = meshNodes(doc()).filter((n) => n.getName() !== 'blade_pivot_mesh').flatMap((n) => points(n));
    expect(grip[0]).toBeLessThan(0);
    expect(Math.abs(grip[2])).toBeLessThan(1e-5);
    if (id === 'shadow_daggers') {
      // the t-bar runs across the blade: length along y, depth along x, thickness along z
      const bar = body.filter((p) => Math.abs(p[0] - grip[0]) < 0.012);
      const [yLo, yHi] = extent(bar, 1);
      expect((yHi - yLo) / (e.handleLength as number)).toBeGreaterThan(0.9);
      expect((yHi - yLo) / (e.handleLength as number)).toBeLessThan(1.1);
      const tee = node(doc(), 'socket_tee');
      expect(Math.abs(worldDir(tee, [0, 0, 1])[1])).toBeGreaterThan(0.999);
      const t = worldPos(tee);
      expect(Math.hypot(t[0] - grip[0], t[1] - grip[1])).toBeLessThan(0.002);
      return;
    }
    const handleLength = e.handleLength as number;
    expect(-grip[0] / handleLength).toBeGreaterThan(0.3);
    expect(-grip[0] / handleLength).toBeLessThan(0.7);
    const slice = body.filter((p) => Math.abs(p[0] - grip[0]) < 0.01);
    const [yLo, yHi] = extent(slice, 1);
    const [zLo, zHi] = extent(slice, 2);
    expect(grip[1]).toBeGreaterThan(yLo);
    expect(grip[1]).toBeLessThan(yHi);
    expect((yHi - yLo) / (e.handleHeight as number)).toBeGreaterThan(0.7);
    expect((yHi - yLo) / (e.handleHeight as number)).toBeLessThan(1.3);
    expect((zHi - zLo) / (e.handleThickness as number)).toBeGreaterThan(0.75);
    expect((zHi - zLo) / (e.handleThickness as number)).toBeLessThan(1.3);
    // the handle reaches back about handleLength behind the origin
    const back = extent(body, 0)[0];
    expect(-back / handleLength).toBeGreaterThan(0.85);
  });
});

describe('folders', () => {
  it.each(FOLDERS.map((id) => [id]))('%s folds the blade into the handle about a fixed pin', (id) => {
    const doc = docs.get(id)!;
    const pin = worldPos(node(doc, 'socket_pivot'));
    const bladeLength = (node(doc, id).getExtras() as Record<string, number>).bladeLength;
    const open = bladeAt(doc, 0);
    const closed = bladeAt(doc, -Math.PI);
    const [xLo] = extent(closed, 0);
    expect(xLo).toBeLessThan(pin[0] - bladeLength * 0.85);
    if (HAWKBILL.includes(id)) return;
    // closed, the blade (not its tang or flipper tab, which stick out at the pivot end
    // by design) sits inside the handle's side outline
    const bins = handleBins(node(doc, 'body'), 0.002);
    let worst = 0;
    for (const [i, p] of closed.entries()) {
      if (open[i][0] < 0.006) continue;
      const r = bins.get(Math.floor(p[0] / 0.002));
      expect(r, `handle at x=${p[0].toFixed(3)}`).toBeDefined();
      worst = Math.max(worst, p[1] - r![1], r![0] - p[1]);
    }
    expect(worst).toBeLessThan(0.0008);
  });
});

describe('butterfly', () => {
  it('swings each handle about its own tang pin and closes both round the blade', () => {
    const doc = docs.get('butterfly')!;
    const safePin = worldPos(node(doc, 'socket_pivot_safe'));
    const bitePin = worldPos(node(doc, 'socket_pivot_bite'));
    // spine-side pin for the safe handle, edge-side pin for the bite handle
    expect(safePin[1]).toBeGreaterThan(bitePin[1]);
    const swing = (name: string, angle: number) => {
      const pivot = node(doc, name);
      const mesh = node(doc, `${name}_mesh`);
      const [px, py, pz] = worldPos(pivot);
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      return points(mesh, undefined, mesh.getMatrix()).map(([x, y, z]) => [px + c * x - s * y, py + s * x + c * y, pz + z] as V3);
    };
    const safeOpen = swing('handle_safe', 0);
    const safeClosed = swing('handle_safe', Math.PI);
    const biteClosed = swing('handle_bite', -Math.PI);
    expect(mean(safeOpen, 0)).toBeLessThan(safePin[0]);
    expect(mean(safeClosed, 0)).toBeGreaterThan(safePin[0]);
    expect(mean(biteClosed, 0)).toBeGreaterThan(bitePin[0]);
    const blade = points(node(doc, 'body'), ['knife_blade', 'knife_edge']);
    const [bLo, bHi] = extent(blade, 1);
    const top = extent(safeClosed, 1)[1];
    const bottom = extent(biteClosed, 1)[0];
    expect(bHi).toBeLessThan(top);
    expect(bLo).toBeGreaterThan(bottom);
    expect(extent(blade, 0)[1]).toBeLessThan(Math.max(extent(safeClosed, 0)[1], extent(biteClosed, 0)[1]) + 0.001);
  });
});

describe('finger rings', () => {
  it.each(RING_SOCKET.map((id) => [id]))('%s has a clear finger hole round socket_ring, axis along z', (id) => {
    const doc = docs.get(id)!;
    const ring = node(doc, 'socket_ring');
    const c = worldPos(ring);
    const inner = (node(doc, id).getExtras() as Record<string, number>).ringInnerRadius;
    expect(Math.abs(worldDir(ring, [0, 0, 1])[2])).toBeGreaterThan(0.999);
    let nearest = Infinity;
    let ringVerts = 0;
    for (const n of meshNodes(doc)) {
      for (const p of points(n)) {
        const d = Math.hypot(p[0] - c[0], p[1] - c[1]);
        nearest = Math.min(nearest, d);
        if (d < inner + 0.008) ringVerts += 1;
      }
    }
    // a gloved index finger (22 to 24 mm) goes through
    expect(nearest).toBeGreaterThan(inner * 0.97);
    expect(nearest).toBeLessThan(inner * 1.05);
    expect(ringVerts).toBeGreaterThan(40);
  });
});
