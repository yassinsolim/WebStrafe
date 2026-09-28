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
const FOLDERS: KnifeId[] = ['flip', 'falchion', 'navaja', 'stiletto', 'talon', 'ursus', 'nomad'];
const RING_SOCKET: KnifeId[] = ['karambit', 'talon', 'skeleton'];
const HAWKBILL: KnifeId[] = ['karambit', 'talon'];
const MATERIALS = ['knife_blade', 'knife_edge', 'knife_handle', 'knife_metal', 'knife_accent'];
const REQUIRED = ['knife_blade', 'knife_edge', 'knife_handle'];
// the paracord knife has no fittings: its exposed tang end is blade steel
const NO_METAL: KnifeId[] = ['paracord'];
const MAX_TRIANGLES = 8000;
const MAX_BYTES = 200 * 1024;

type V3 = [number, number, number];

const docs = new Map<string, Document>();
const glb = (id: string) => path.join(repo, 'public', 'knives', `${id}.glb`);

beforeAll(async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  for (const k of KNIVES) docs.set(k.id, await io.read(glb(k.id)));
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

  it('uses only the contract materials, with baked ao and uvs on every primitive', () => {
    const used = new Set<string>();
    for (const n of meshNodes(doc())) {
      for (const prim of n.getMesh()!.listPrimitives()) {
        const name = prim.getMaterial()?.getName() ?? '';
        expect(MATERIALS, `${n.getName()} ${name}`).toContain(name);
        expect(prim.getAttribute('COLOR_0'), `${n.getName()} ${name} ao`).not.toBeNull();
        expect(prim.getAttribute('TEXCOORD_0'), `${n.getName()} ${name} uv`).not.toBeNull();
        used.add(name);
      }
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
    expect(bladeHeight).toBeGreaterThan((yHi - yLo) * (HAWKBILL.includes(id) || id === 'kukri' ? 0.35 : 0.6));
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
