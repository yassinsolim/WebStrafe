import { describe, expect, it, vi } from 'vitest';
import { Box3, BufferGeometry, Group, type Material, Mesh, MeshStandardMaterial, Object3D, Texture, Vector3 } from 'three';
import { getKnife, KNIVES, type KnifeDef } from '../../combat/knives';
import { buildProceduralKnife, disposeProceduralKnife, isSharedKnifeTexture, KNIFE_NODES } from '../ProceduralKnife';

const FOLDERS = ['flip', 'talon', 'stiletto'];
const RING_KNIVES = ['karambit', 'talon'];

function meshes(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh) out.push(o);
  });
  return out;
}

function triangles(root: Object3D): number {
  return meshes(root).reduce((acc, m) => {
    const g = m.geometry as BufferGeometry;
    return acc + (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  }, 0);
}

function worldPos(root: Object3D, name: string): Vector3 {
  root.updateMatrixWorld(true);
  const node = root.getObjectByName(name);
  expect(node, name).toBeDefined();
  return node!.getWorldPosition(new Vector3());
}

function signedVolume(m: Mesh): number {
  const g = m.geometry as BufferGeometry;
  const pos = g.getAttribute('position');
  const count = g.index ? g.index.count : pos.count;
  const at = (i: number) => new Vector3().fromBufferAttribute(pos, g.index ? g.index.getX(i) : i);
  let vol = 0;
  for (let i = 0; i < count; i += 3) vol += at(i).dot(at(i + 1).cross(at(i + 2))) / 6;
  return vol;
}

describe('procedural knife sockets', () => {
  it.each(KNIVES.map((k) => [k.id, k] as const))('%s has grip and tip sockets in the knife frame', (_id, def) => {
    const knife = buildProceduralKnife(def);
    const tip = worldPos(knife, KNIFE_NODES.tip);
    const grip = worldPos(knife, KNIFE_NODES.grip);
    const box = new Box3().setFromObject(knife);
    // tip is the far +x end of the blade, the grip sits on the handle behind the guard
    expect(tip.x).toBeCloseTo(def.shape.bladeLength, 3);
    expect(tip.x).toBeGreaterThan(box.max.x - 0.002);
    expect(grip.x).toBeLessThan(0);
    expect(grip.x).toBeGreaterThan(box.min.x);
    expect(Math.abs(grip.z)).toBeLessThan(1e-6);
    disposeProceduralKnife(knife);
  });
});

describe('articulated knives', () => {
  it('folders carry the blade and tip on blade_pivot and fold it into the handle', () => {
    for (const id of FOLDERS) {
      const def = getKnife(id);
      expect(def.shape.mechanism, id).toBe('folder');
      const knife = buildProceduralKnife(def);
      const pivot = knife.getObjectByName(KNIFE_NODES.bladePivot);
      expect(pivot, id).toBeInstanceOf(Group);
      expect(pivot!.getObjectByName('blade'), id).toBeInstanceOf(Mesh);
      expect(pivot!.getObjectByName(KNIFE_NODES.tip), id).toBeDefined();
      const pin = worldPos(knife, KNIFE_NODES.pivot);
      expect(pin.distanceTo(pivot!.getWorldPosition(new Vector3())), id).toBeLessThan(1e-9);

      const handleBox = new Box3();
      knife.updateMatrixWorld(true);
      for (const m of meshes(knife)) {
        if (!isUnder(m, pivot!) && /scale_|liner_/.test(m.name)) handleBox.expandByObject(m);
      }
      pivot!.rotation.z = -Math.PI;
      const folded = new Box3().setFromObject(pivot!);
      const tip = worldPos(knife, KNIFE_NODES.tip);
      expect(tip.x, id).toBeLessThan(pin.x - def.shape.bladeLength * 0.9);
      // closed edge stays under the backspacer. the talon's hooked tip points
      // up once mirrored about the pin, so it only has to end up behind it
      if (def.shape.profile !== 'hawkbill') expect(folded.max.y, id).toBeLessThan(handleBox.max.y + 0.0005);
      expect(worldPos(knife, KNIFE_NODES.pivot).distanceTo(pin), id).toBeLessThan(1e-9);
      disposeProceduralKnife(knife);
    }
  });

  it('balisong handles are separate groups pivoting on their own tang pins', () => {
    const knife = buildProceduralKnife(getKnife('butterfly'));
    expect(knife.getObjectByName(KNIFE_NODES.bladePivot)).toBeUndefined();
    const pins: Vector3[] = [];
    for (const [group, socket, closeTo] of [
      [KNIFE_NODES.handleSafe, KNIFE_NODES.pivotSafe, Math.PI],
      [KNIFE_NODES.handleBite, KNIFE_NODES.pivotBite, -Math.PI],
    ] as const) {
      const half = knife.getObjectByName(group);
      expect(half, group).toBeInstanceOf(Group);
      const pin = worldPos(knife, socket);
      pins.push(pin);
      expect(half!.position.distanceTo(pin), group).toBeLessThan(1e-9);
      expect(meshes(half!).length, group).toBeGreaterThan(0);
      const open = new Box3().setFromObject(half!).getCenter(new Vector3());
      expect(open.x, group).toBeLessThan(pin.x);
      half!.rotation.z = closeTo;
      const closed = new Box3().setFromObject(half!).getCenter(new Vector3());
      // swung forward over the blade, around the same pin
      expect(closed.x, group).toBeGreaterThan(pin.x);
      expect(worldPos(knife, socket).distanceTo(pin), group).toBeLessThan(1e-9);
    }
    // two different pins, spine side and edge side
    expect(pins[0].y).toBeGreaterThan(pins[1].y);
    disposeProceduralKnife(knife);
  });

  it('ring knives have a finger_ring group with socket_ring at the ring centre', () => {
    for (const id of RING_KNIVES) {
      const knife = buildProceduralKnife(getKnife(id));
      const ring = knife.getObjectByName(KNIFE_NODES.fingerRing);
      expect(ring, id).toBeInstanceOf(Group);
      const socket = ring!.getObjectByName(KNIFE_NODES.ring);
      expect(socket?.parent, id).toBe(ring);
      expect(socket!.position.length(), id).toBeLessThan(1e-9);
      const box = new Box3().setFromObject(ring!);
      const size = box.getSize(new Vector3());
      // a finger fits through it
      expect(Math.min(size.x, size.y), id).toBeGreaterThan(0.028);
      expect(box.containsPoint(worldPos(knife, KNIFE_NODES.ring)), id).toBe(true);
      disposeProceduralKnife(knife);
    }
  });

  it('push daggers stay a pair', () => {
    const def = getKnife('shadow_daggers');
    const knife = buildProceduralKnife(def);
    expect(def.shape.pair).toBe(true);
    expect(knife.userData.pair).toBe(true);
    disposeProceduralKnife(knife);
  });

  it('only folders, the balisong and ring knives get articulated groups', () => {
    for (const def of KNIVES) {
      const knife = buildProceduralKnife(def);
      const has = (name: string) => knife.getObjectByName(name) !== undefined;
      expect(has(KNIFE_NODES.bladePivot), def.id).toBe(FOLDERS.includes(def.id));
      expect(has(KNIFE_NODES.handleSafe) && has(KNIFE_NODES.handleBite), def.id).toBe(def.id === 'butterfly');
      expect(has(KNIFE_NODES.fingerRing), def.id).toBe(RING_KNIVES.includes(def.id));
      expect(has(KNIFE_NODES.pivot), def.id).toBe(FOLDERS.includes(def.id));
      disposeProceduralKnife(knife);
    }
  });
});

function isUnder(node: Object3D, ancestor: Object3D): boolean {
  for (let p: Object3D | null = node; p; p = p.parent) if (p === ancestor) return true;
  return false;
}

describe('procedural knife geometry', () => {
  it.each(KNIVES.map((k) => [k.id, k] as const))('%s is finite, closed, outward facing and under 8k triangles', (_id, def: KnifeDef) => {
    const knife = buildProceduralKnife(def);
    expect(triangles(knife)).toBeLessThanOrEqual(8000);
    for (const m of meshes(knife)) {
      const g = m.geometry as BufferGeometry;
      const pos = g.getAttribute('position');
      const nrm = g.getAttribute('normal');
      for (let i = 0; i < pos.count; i += 1) {
        expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i)), m.name).toBe(true);
        expect(Number.isFinite(nrm.getX(i) + nrm.getY(i) + nrm.getZ(i)), m.name).toBe(true);
      }
      expect(signedVolume(m), `${def.id}/${m.name}`).toBeGreaterThan(0);
    }
    const box = new Box3().setFromObject(knife);
    const size = box.getSize(new Vector3());
    expect(size.toArray().every(Number.isFinite)).toBe(true);
    expect(size.z).toBeLessThan(0.04);
    disposeProceduralKnife(knife);
  });

  it('blades taper from the spine thickness to a sharp edge with a polished bevel', () => {
    for (const def of KNIVES) {
      const knife = buildProceduralKnife(def);
      const blade = knife.getObjectByName('blade') as Mesh;
      const g = blade.geometry as BufferGeometry;
      const pos = g.getAttribute('position');
      let maxZ = 0;
      let sharp = 0;
      for (let i = 0; i < pos.count; i += 1) {
        maxZ = Math.max(maxZ, Math.abs(pos.getZ(i)));
        if (Math.abs(pos.getZ(i)) < 0.0001 && pos.getX(i) > def.shape.bladeLength * 0.3) sharp += 1;
      }
      expect(maxZ * 2, def.id).toBeGreaterThan(def.shape.bladeThickness * 0.9);
      expect(maxZ * 2, def.id).toBeLessThanOrEqual(def.shape.bladeThickness * 1.001);
      expect(sharp, def.id).toBeGreaterThan(20);
      expect(Array.isArray(blade.material) && blade.material.length === 2, def.id).toBe(true);
      expect(g.groups.map((gr) => gr.materialIndex).sort(), def.id).toEqual([0, 1]);
      disposeProceduralKnife(knife);
    }
  });

  it('adds real sawback teeth to serrated spines', () => {
    for (const def of KNIVES) {
      const knife = buildProceduralKnife(def);
      const teeth = knife.getObjectByName('blade_teeth');
      expect(teeth !== undefined, def.id).toBe(def.shape.serratedSpine === true);
      if (teeth) {
        const blade = new Box3().setFromObject(knife.getObjectByName('blade')!);
        const box = new Box3().setFromObject(teeth);
        expect(box.max.y, def.id).toBeGreaterThan(blade.max.y - 0.002);
      }
      disposeProceduralKnife(knife);
    }
  });

  it('cuts the fuller as a groove thinner than the flats', () => {
    const def = getKnife('bayonet');
    const knife = buildProceduralKnife(def);
    const pos = ((knife.getObjectByName('blade') as Mesh).geometry as BufferGeometry).getAttribute('position');
    const h = def.shape.bladeHeight;
    let thinnest = Infinity;
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      if (x > 0.04 && x < 0.08 && y > h * 0.5 && y < h * 0.57) thinnest = Math.min(thinnest, Math.abs(pos.getZ(i)));
    }
    expect(thinnest * 2).toBeLessThan(def.shape.bladeThickness * 0.8);
    disposeProceduralKnife(knife);
  });
});

describe('disposal', () => {
  it('disposes every geometry and material once and keeps shared textures alive', () => {
    const a = buildProceduralKnife(getKnife('m9_bayonet'));
    const b = buildProceduralKnife(getKnife('huntsman'));
    const geometries = new Set<BufferGeometry>();
    const materials = new Set<Material>();
    const textures = new Set<Texture>();
    for (const m of meshes(a)) {
      geometries.add(m.geometry as BufferGeometry);
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        materials.add(mat);
        const std = mat as MeshStandardMaterial;
        for (const t of [std.map, std.normalMap, std.roughnessMap]) if (t) textures.add(t);
      }
    }
    expect(textures.size).toBeGreaterThan(0);
    const geoSpies = [...geometries].map((g) => vi.spyOn(g, 'dispose'));
    const matSpies = [...materials].map((m) => vi.spyOn(m, 'dispose'));
    const texSpies = [...textures].map((t) => vi.spyOn(t, 'dispose'));
    disposeProceduralKnife(a);
    for (const s of [...geoSpies, ...matSpies]) expect(s).toHaveBeenCalledTimes(1);
    for (const s of texSpies) expect(s).not.toHaveBeenCalled();
    for (const t of textures) expect(isSharedKnifeTexture(t)).toBe(true);
    // the other knife still shares the same live textures
    const bTextures = meshes(b).flatMap((m) => (Array.isArray(m.material) ? m.material : [m.material]))
      .flatMap((mat) => [(mat as MeshStandardMaterial).map, (mat as MeshStandardMaterial).normalMap]).filter(Boolean);
    expect(bTextures.some((t) => textures.has(t!))).toBe(true);
    // materials are not shared between knives
    const bMaterials = new Set(meshes(b).flatMap((m) => (Array.isArray(m.material) ? m.material : [m.material])));
    for (const m of materials) expect(bMaterials.has(m)).toBe(false);
    disposeProceduralKnife(b);
  });
});
