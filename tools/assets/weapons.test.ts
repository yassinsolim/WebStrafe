import { beforeAll, describe, expect, it } from 'vitest';
import { getBounds, NodeIO, type Document, type mat4, type Node } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// checks the committed v2 weapon viewmodels against the contract in
// tools/blender/README.md (names, parenting, scale, axes, budgets)

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

interface WeaponSpec {
  file: string;
  root: string;
  sockets: string[];
  parts: string[];
  /** child -> required parent */
  parents: Record<string, string>;
  /** target overall size in metres: length along z, height along y */
  length: number;
  height: number;
  maxTriangles: number;
  /** z of socket_grip_r's up axis must be below this (grips lean forward going up) */
  maxGripUpZ: number;
}

const SPECS: Record<'deagle' | 'awp', WeaponSpec> = {
  deagle: {
    file: 'public/viewmodels/v2/deagle.glb',
    root: 'deagle',
    sockets: ['socket_grip_r', 'socket_grip_l', 'socket_trigger', 'socket_muzzle', 'socket_eject',
      'socket_mag_bottom', 'socket_slide_rear'],
    parts: ['slide', 'hammer', 'trigger', 'mag'],
    parents: { socket_mag_bottom: 'mag', socket_slide_rear: 'slide' },
    // mark xix with the 6 in barrel: 273 mm long, 159 mm tall
    length: 0.273,
    height: 0.159,
    maxTriangles: 20000,
    // the socket follows the nearly upright front strap (4 degrees)
    maxGripUpZ: -0.05,
  },
  awp: {
    file: 'public/viewmodels/v2/awp.glb',
    root: 'awp',
    sockets: ['socket_grip_r', 'socket_grip_l', 'socket_trigger', 'socket_muzzle', 'socket_eject',
      'socket_mag_bottom', 'socket_bolt_knob', 'socket_scope_eye'],
    parts: ['bolt', 'mag', 'trigger'],
    parents: { socket_mag_bottom: 'mag', socket_bolt_knob: 'bolt' },
    length: 1.18,
    height: 0.25,
    maxTriangles: 28000,
    maxGripUpZ: -0.15,
  },
};

const docs = new Map<string, Document>();

beforeAll(async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  for (const [id, spec] of Object.entries(SPECS)) {
    docs.set(id, await io.read(path.join(repo, spec.file)));
  }
});

function node(doc: Document, name: string): Node {
  const found = doc.getRoot().listNodes().filter((n) => n.getName() === name);
  expect(found, `node ${name}`).toHaveLength(1);
  return found[0];
}

function apply(m: mat4, v: readonly [number, number, number], w: 0 | 1): [number, number, number] {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * w,
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * w,
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * w,
  ];
}

const worldPos = (n: Node) => apply(n.getWorldMatrix(), [0, 0, 0], 1);
const worldDir = (n: Node, v: [number, number, number]) => {
  const d = apply(n.getWorldMatrix(), v, 0);
  const len = Math.hypot(...d);
  return d.map((c) => c / len) as [number, number, number];
};

function triangles(doc: Document): number {
  let total = 0;
  for (const n of doc.getRoot().listNodes()) {
    for (const prim of n.getMesh()?.listPrimitives() ?? []) {
      const count = prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION')!.getCount();
      total += count / 3;
    }
  }
  return total;
}

describe.each(Object.entries(SPECS))('%s viewmodel', (id, spec) => {
  const doc = () => docs.get(id)!;

  it('has every contract node exactly once', () => {
    for (const name of [spec.root, ...spec.sockets, ...spec.parts]) node(doc(), name);
  });

  it('parents the moving sockets to their parts', () => {
    for (const [child, parent] of Object.entries(spec.parents)) {
      expect(node(doc(), child).getParentNode()?.getName(), child).toBe(parent);
    }
    for (const part of spec.parts) {
      expect(node(doc(), part).getParentNode()?.getName(), part).toBe(spec.root);
    }
  });

  it('keeps moving parts as clean pivots (no quantization scale folded in)', () => {
    for (const part of spec.parts) {
      const n = node(doc(), part);
      expect(n.getMesh(), part).toBeNull();
      expect(n.getRotation(), part).toEqual([0, 0, 0, 1]);
      n.getScale().forEach((s) => expect(s, part).toBeCloseTo(1, 6));
      expect(n.listChildren().some((c) => c.getMesh() !== null), `${part} has geometry`).toBe(true);
    }
  });

  it('is real scale within about 10% of the target size', () => {
    const { min, max } = getBounds(doc().getRoot().listScenes()[0]);
    const length = max[2] - min[2];
    const height = max[1] - min[1];
    expect(length / spec.length).toBeGreaterThan(0.9);
    expect(length / spec.length).toBeLessThan(1.1);
    expect(height / spec.height).toBeGreaterThan(0.88);
    expect(height / spec.height).toBeLessThan(1.1);
  });

  it('points the barrel down -z from the grip to the muzzle', () => {
    const grip = worldPos(node(doc(), 'socket_grip_r'));
    const muzzle = worldPos(node(doc(), 'socket_muzzle'));
    const d = [muzzle[0] - grip[0], muzzle[1] - grip[1], muzzle[2] - grip[2]];
    const len = Math.hypot(...d);
    expect(d[2] / len).toBeLessThan(-0.9);
    expect(Math.abs(d[0] / len)).toBeLessThan(0.02);
    const forward = worldDir(node(doc(), 'socket_muzzle'), [0, 0, -1]);
    expect(forward[2]).toBeCloseTo(-1, 5);
  });

  it('tilts socket_grip_r up the grip rake', () => {
    const up = worldDir(node(doc(), 'socket_grip_r'), [0, 1, 0]);
    expect(up[1]).toBeGreaterThan(0.9);
    // grips rake back at the bottom, so up the grip leans forward (-z)
    expect(up[2]).toBeLessThan(spec.maxGripUpZ);
    // the weapon origin is the grip socket, so hands can attach without offsets
    worldPos(node(doc(), 'socket_grip_r')).forEach((c) => expect(c).toBeCloseTo(0, 6));
  });

  it('stays inside the triangle budget', () => {
    expect(triangles(doc())).toBeLessThanOrEqual(spec.maxTriangles);
    expect(triangles(doc())).toBeGreaterThan(spec.maxTriangles * 0.4);
  });

  it('ships baked ao and named pbr materials', () => {
    for (const mesh of doc().getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        expect(prim.getAttribute('COLOR_0'), mesh.getName()).not.toBeNull();
        expect(prim.getMaterial()?.getName() ?? '', mesh.getName()).toMatch(/^mat_/);
      }
    }
  });
});

describe('socket placement', () => {
  it('puts the deagle support palm on the left panel under the trigger guard', () => {
    const doc = docs.get('deagle')!;
    const l = worldPos(node(doc, 'socket_grip_l'));
    const trigger = worldPos(node(doc, 'socket_trigger'));
    expect(l[0]).toBeLessThan(-0.012);
    expect(l[1]).toBeLessThan(trigger[1] - 0.015);
    expect(Math.abs(l[2])).toBeLessThan(0.03);
  });

  it('cradles the awp forend 30-38 cm ahead of the trigger', () => {
    const doc = docs.get('awp')!;
    const l = worldPos(node(doc, 'socket_grip_l'));
    const trigger = worldPos(node(doc, 'socket_trigger'));
    const ahead = trigger[2] - l[2];
    expect(ahead).toBeGreaterThan(0.3);
    expect(ahead).toBeLessThan(0.38);
    expect(l[1]).toBeLessThan(worldPos(node(doc, 'socket_muzzle'))[1]);
  });

  it('keeps the scope eye above the bore and behind the receiver', () => {
    const doc = docs.get('awp')!;
    const eye = worldPos(node(doc, 'socket_scope_eye'));
    const muzzle = worldPos(node(doc, 'socket_muzzle'));
    expect(eye[1] - muzzle[1]).toBeGreaterThan(0.045);
    expect(eye[2]).toBeGreaterThan(worldPos(node(doc, 'socket_trigger'))[2]);
  });
});
