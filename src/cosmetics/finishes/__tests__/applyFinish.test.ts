import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  type Material,
  Mesh,
  MeshStandardMaterial,
  ShaderLib,
  UniformsUtils,
  Vector3,
} from 'three';
import { getKnife } from '../../../combat/knives';
import { buildProceduralKnife, disposeProceduralKnife } from '../../ProceduralKnife';
import { applyKnifeFinish, clearKnifeFinish, knifeFinishOf, knifeFinishPart } from '../applyFinish';
import { KNIFE_FINISHES, selectableKnifeFinishIds } from '../catalog';
import { disposeIdleFinishMaterials, finishMaterialStats, isKnifeFinishMaterial } from '../finishMaterials';

function materialsOf(root: Group): Map<Mesh, Material[]> {
  const out = new Map<Mesh, Material[]>();
  root.traverse((o) => {
    if (o instanceof Mesh) out.set(o, Array.isArray(o.material) ? [...o.material] : [o.material]);
  });
  return out;
}

function slotsNamed(root: Group, name: string): Material[] {
  const out: Material[] = [];
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m.name === name) out.push(m);
  });
  return out;
}

afterEach(() => {
  disposeIdleFinishMaterials();
});

describe('knife finish parts', () => {
  it('reads contract material names and mesh names', () => {
    const named = (name: string) => new MeshStandardMaterial({ name });
    expect(knifeFinishPart(named('knife_blade'))).toBe('blade');
    expect(knifeFinishPart(named('knife_edge.001'))).toBe('edge');
    expect(knifeFinishPart(named('knife_handle'))).toBe('handle');
    expect(knifeFinishPart(named('knife_metal'))).toBe('metal');
    expect(knifeFinishPart(named('knife_accent'))).toBeNull();
    expect(knifeFinishPart(named('knife_bladework'))).toBeNull();
    expect(knifeFinishPart(named(''), 'knife_blade')).toBe('blade');
  });

  it('procedural knives name their materials after the contract', () => {
    const karambit = buildProceduralKnife(getKnife('karambit'));
    expect(slotsNamed(karambit, 'knife_blade').length).toBeGreaterThan(0);
    expect(slotsNamed(karambit, 'knife_edge').length).toBeGreaterThan(0);
    expect(slotsNamed(karambit, 'knife_handle').length).toBeGreaterThan(0);
    // the finger ring is metal and follows the blade
    const ring = karambit.getObjectByName('finger_ring_mesh') as Mesh;
    expect((ring.material as Material).name).toBe('knife_metal');
    expect(karambit.userData.bladeLength).toBe(getKnife('karambit').shape.bladeLength);
    expect(karambit.userData.bladeHeight).toBe(getKnife('karambit').shape.bladeHeight);
    const skeleton = buildProceduralKnife(getKnife('skeleton'));
    expect(slotsNamed(skeleton, 'knife_handle')).toHaveLength(0);
    expect(slotsNamed(skeleton, 'knife_metal').length).toBeGreaterThan(0);
    disposeProceduralKnife(karambit);
    disposeProceduralKnife(skeleton);
  });
});

describe('applyKnifeFinish', () => {
  it('swaps blade, edge and metal for a doppler and restores the exact originals', () => {
    const knife = buildProceduralKnife(getKnife('karambit'));
    const before = materialsOf(knife);
    const handle = slotsNamed(knife, 'knife_handle')[0];
    applyKnifeFinish(knife, { finishId: 'doppler_phase2', wear: 0.02, seed: 661 });

    const blade = knife.getObjectByName('blade') as Mesh;
    const [bladeMat, edgeMat] = blade.material as Material[];
    expect(isKnifeFinishMaterial(bladeMat)).toBe(true);
    expect(isKnifeFinishMaterial(edgeMat)).toBe(true);
    expect(bladeMat).not.toBe(edgeMat);
    expect(isKnifeFinishMaterial((knife.getObjectByName('finger_ring_mesh') as Mesh).material as Material)).toBe(true);
    // doppler leaves the handle alone, pins and liners are never touched
    expect(slotsNamed(knife, 'knife_handle')).toEqual([handle]);
    expect(slotsNamed(knife, 'knife_pin').length).toBeGreaterThan(0);
    expect(knifeFinishOf(knife)).toEqual({ finishId: 'doppler_phase2', wear: 0.02, seed: 661 });

    clearKnifeFinish(knife);
    const after = materialsOf(knife);
    for (const [mesh, mats] of before) expect(after.get(mesh)).toEqual(mats);
    for (const [mesh, mats] of before) for (let i = 0; i < mats.length; i += 1) expect(after.get(mesh)![i]).toBe(mats[i]);
    expect(knifeFinishOf(knife)).toBeNull();
    disposeProceduralKnife(knife);
  });

  it('restyles handles the way the catalog says', () => {
    const knife = buildProceduralKnife(getKnife('m9_bayonet'));
    const handle = slotsNamed(knife, 'knife_handle')[0] as MeshStandardMaterial;
    applyKnifeFinish(knife, { finishId: 'crimson_web', wear: 0.1, seed: 3 });
    const tinted = findHandle(knife);
    expect(tinted).not.toBe(handle);
    expect(tinted.color.getHex()).toBe(0x141414);
    // same texture detail as the original handle
    expect(tinted.normalMap).toBe(handle.normalMap);

    applyKnifeFinish(knife, { finishId: 'boreal_forest', wear: 0.2, seed: 3 });
    const camo = findHandle(knife);
    expect(camo.userData.knifeFinishUniforms).toBeDefined();
    expect(camo.customProgramCacheKey()).toContain('boreal_forest:handle');

    applyKnifeFinish(knife, { finishId: 'tiger_tooth', wear: 0.01, seed: 3 });
    expect(findHandle(knife)).toBe(handle);
    // the guard is metal and takes the finish
    const metal = slotsNamed(knife, 'knife_finish_blade');
    expect(metal.length).toBeGreaterThan(1);
    disposeProceduralKnife(knife);
  });

  it('vanilla is the knife as built', () => {
    const knife = buildProceduralKnife(getKnife('butterfly'));
    const before = materialsOf(knife);
    applyKnifeFinish(knife, { finishId: 'fade', wear: 0, seed: 1 });
    applyKnifeFinish(knife, { finishId: 'vanilla', wear: 0.5, seed: 1 });
    const after = materialsOf(knife);
    for (const [mesh, mats] of before) expect(after.get(mesh)).toEqual(mats);
    expect(knifeFinishOf(knife)).toEqual({ finishId: 'vanilla', wear: 0, seed: 0 });
    disposeProceduralKnife(knife);
  });

  it('shares materials between knives with the same finish, wear step and seed', () => {
    const a = buildProceduralKnife(getKnife('karambit'));
    const b = buildProceduralKnife(getKnife('flip'));
    const sel = { finishId: 'case_hardened', wear: 0.3, seed: 387 };
    applyKnifeFinish(a, sel);
    applyKnifeFinish(b, sel);
    const bladeA = ((a.getObjectByName('blade') as Mesh).material as Material[])[0];
    const bladeB = ((b.getObjectByName('blade') as Mesh).material as Material[])[0];
    expect(bladeA).toBe(bladeB);
    applyKnifeFinish(b, { ...sel, seed: 388 });
    expect(((b.getObjectByName('blade') as Mesh).material as Material[])[0]).not.toBe(bladeA);
    // finishes where the seed does nothing share across seeds
    applyKnifeFinish(a, { finishId: 'night', wear: 0.3, seed: 1 });
    applyKnifeFinish(b, { finishId: 'night', wear: 0.3, seed: 999 });
    expect(((a.getObjectByName('blade') as Mesh).material as Material[])[0])
      .toBe(((b.getObjectByName('blade') as Mesh).material as Material[])[0]);
    disposeProceduralKnife(a);
    disposeProceduralKnife(b);
  });

  it('reference counts shared materials and never disposes one in use', () => {
    disposeIdleFinishMaterials();
    const start = finishMaterialStats();
    const a = buildProceduralKnife(getKnife('bayonet'));
    const b = buildProceduralKnife(getKnife('bayonet'));
    const sel = { finishId: 'slaughter', wear: 0.05, seed: 10 };
    applyKnifeFinish(a, sel);
    applyKnifeFinish(b, sel);
    const shared = ((a.getObjectByName('blade') as Mesh).material as Material[])[0];
    const spy = vi.spyOn(shared, 'dispose');
    // disposing one knife clears its finish, the other keeps using the material
    disposeProceduralKnife(a);
    disposeIdleFinishMaterials();
    expect(spy).not.toHaveBeenCalled();
    expect(((b.getObjectByName('blade') as Mesh).material as Material[])[0]).toBe(shared);
    disposeProceduralKnife(b);
    expect(finishMaterialStats().live).toBe(start.live);
    disposeIdleFinishMaterials();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(finishMaterialStats()).toEqual({ live: start.live, idle: 0 });
  });

  it('disposes the original materials of a finished knife exactly once', () => {
    const knife = buildProceduralKnife(getKnife('m9_bayonet'));
    const originals = new Set<Material>();
    for (const mats of materialsOf(knife).values()) for (const m of mats) originals.add(m);
    const spies = [...originals].map((m) => vi.spyOn(m, 'dispose'));
    applyKnifeFinish(knife, { finishId: 'safari_mesh', wear: 0.4, seed: 5 });
    disposeProceduralKnife(knife);
    for (const s of spies) expect(s).toHaveBeenCalledTimes(1);
  });

  it('bakes knife space in the rest pose, folders included', () => {
    const def = getKnife('flip');
    const knife = buildProceduralKnife(def);
    knife.getObjectByName('blade_pivot')!.rotation.z = -Math.PI * 0.7;
    knife.position.set(1, 2, 3);
    knife.rotation.set(0.3, 0.4, 0.5);
    applyKnifeFinish(knife, { finishId: 'fade', wear: 0, seed: 1 });
    const blade = knife.getObjectByName('blade') as Mesh;
    const geo = blade.geometry as BufferGeometry;
    const pos = geo.getAttribute('finishPos');
    const uv = geo.getAttribute('finishUv');
    const nrm = geo.getAttribute('finishNormal');
    expect(pos.count).toBe(geo.getAttribute('position').count);
    let maxU = -Infinity;
    let minU = Infinity;
    let minEdge = Infinity;
    for (let i = 0; i < pos.count; i += 1) {
      maxU = Math.max(maxU, uv.getX(i));
      minU = Math.min(minU, uv.getX(i));
      minEdge = Math.min(minEdge, uv.getZ(i));
      expect(uv.getW(i)).toBeCloseTo(def.shape.bladeLength, 6);
      expect(nrm.getW(i)).toBeCloseTo(def.shape.bladeHeight, 6);
      expect(Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i))).toBeCloseTo(1, 4);
    }
    // an open blade runs from the guard to the tip whatever the pivot is doing
    expect(maxU).toBeCloseTo(1, 2);
    expect(minU).toBeGreaterThan(-0.2);
    expect(minEdge).toBeLessThan(1e-4);
    // the spine is far from the edge, a handle is not on the blade at all
    const tip = new Vector3();
    let spineEdge = 0;
    for (let i = 0; i < pos.count; i += 1) {
      tip.fromBufferAttribute(pos, i);
      if (uv.getY(i) > 0.95 && uv.getX(i) < 0.5) spineEdge = Math.max(spineEdge, uv.getZ(i));
    }
    expect(spineEdge).toBeGreaterThan(def.shape.bladeHeight * 0.8);
    disposeProceduralKnife(knife);
  });

  it('works on a contract glb style knife: pivots, quantized positions and named materials', () => {
    // what GLTFLoader gives for a meshopt quantized folder: int16 normalized
    // positions, the node transform dequantizes them, the mesh sits under blade_pivot
    const root = new Group();
    root.userData.bladeLength = 0.1;
    root.userData.bladeHeight = 0.03;
    const pivot = new Group();
    pivot.name = 'blade_pivot';
    pivot.position.set(-0.004, 0.012, 0);
    pivot.rotation.z = -Math.PI * 0.6;
    root.add(pivot);
    // blade outline in knife space: edge strip (y 0..0.002) and the flat above it
    const corners = [
      [0, 0, 0.001], [0.1, 0.012, 0.001], [0.1, 0.014, 0.001], [0, 0.002, 0.001],
      [0, 0.002, 0.001], [0.1, 0.014, 0.001], [0.09, 0.03, 0.001], [0, 0.03, 0.001],
    ];
    const scale = 0.1;
    const offset = new Vector3(0.046, 0.003, 0);
    const quantized = new Int16Array(corners.length * 3);
    corners.forEach(([x, y, z], i) => {
      // knife space to pivot space to the node's quantized frame
      const local = new Vector3(x, y, z).sub(pivot.position).sub(offset).divideScalar(scale);
      quantized.set([local.x, local.y, local.z].map((v) => Math.round(v * 32767)), i * 3);
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(quantized, 3, true));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(corners.flatMap(() => [0, 0, 1])), 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    geometry.addGroup(0, 6, 1);
    geometry.addGroup(6, 6, 0);
    const blade = new MeshStandardMaterial({ name: 'knife_blade' });
    const edge = new MeshStandardMaterial({ name: 'knife_edge' });
    const mesh = new Mesh(geometry, [blade, edge]);
    mesh.name = 'blade_mesh';
    mesh.position.copy(offset);
    mesh.scale.setScalar(scale);
    pivot.add(mesh);
    const safe = new Group();
    safe.name = 'handle_safe';
    safe.rotation.z = Math.PI * 0.5;
    root.add(safe);
    const handleMat = new MeshStandardMaterial({ name: 'knife_handle', color: 0x777777 });
    const handle = new Mesh(new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(9), 3)), handleMat);
    safe.add(handle);

    applyKnifeFinish(root, { finishId: 'crimson_web', wear: 0.2, seed: 9 });
    const [b, e] = mesh.material as Material[];
    expect(isKnifeFinishMaterial(b) && isKnifeFinishMaterial(e)).toBe(true);
    expect(b.name).toBe('knife_finish_blade');
    expect(e.name).toBe('knife_finish_edge');
    expect((handle.material as MeshStandardMaterial).color.getHex()).toBe(0x141414);

    // baked coordinates are the dequantized knife space positions with the pivot at rest
    const pos = geometry.getAttribute('finishPos');
    const uv = geometry.getAttribute('finishUv');
    for (let i = 0; i < corners.length; i += 1) {
      expect(pos.getX(i)).toBeCloseTo(corners[i][0], 4);
      expect(pos.getY(i)).toBeCloseTo(corners[i][1], 4);
      expect(uv.getX(i)).toBeCloseTo(corners[i][0] / 0.1, 3);
      expect(uv.getW(i)).toBeCloseTo(0.1, 6);
    }
    // the edge strip is on the edge, the spine corner is far from it
    expect(uv.getZ(0)).toBeLessThan(1e-4);
    expect(uv.getZ(7)).toBeGreaterThan(0.02);

    clearKnifeFinish(root);
    expect(mesh.material).toEqual([blade, edge]);
    expect(handle.material).toBe(handleMat);
  });

  it('finishes every knife with every finish without throwing', () => {
    for (const knifeId of ['karambit', 'm9_bayonet', 'butterfly', 'shadow_daggers', 'skeleton', 'paracord', 'kukri'] as const) {
      const knife = buildProceduralKnife(getKnife(knifeId));
      for (const finishId of selectableKnifeFinishIds()) {
        applyKnifeFinish(knife, { finishId, wear: 0.5, seed: 42 });
        if (finishId !== 'vanilla') expect(slotsNamed(knife, 'knife_finish_blade').length, `${knifeId}/${finishId}`).toBeGreaterThan(0);
      }
      disposeProceduralKnife(knife);
    }
  });
});

describe('finish shaders', () => {
  function compile(material: MeshStandardMaterial) {
    const shader = {
      uniforms: UniformsUtils.clone(ShaderLib.standard.uniforms),
      vertexShader: ShaderLib.standard.vertexShader,
      fragmentShader: ShaderLib.standard.fragmentShader,
    };
    material.onBeforeCompile(shader as never, undefined as never);
    return shader;
  }

  it('inject into the three standard shader for every finish and part', () => {
    const knife = buildProceduralKnife(getKnife('m9_bayonet'));
    for (const finish of KNIFE_FINISHES) {
      if (finish.id === 'vanilla') continue;
      applyKnifeFinish(knife, { finishId: finish.id, wear: 0.3, seed: 7 });
      const finished = new Set<MeshStandardMaterial>();
      knife.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (isKnifeFinishMaterial(m) && (m as MeshStandardMaterial).userData.knifeFinishUniforms) finished.add(m as MeshStandardMaterial);
        }
      });
      expect(finished.size, finish.id).toBeGreaterThan(0);
      for (const material of finished) {
        const shader = compile(material);
        expect(shader.vertexShader).toContain('vFinishUv = finishUv;');
        expect(shader.fragmentShader).toContain('vec3 finSurface(FinishIn fi');
        expect(shader.fragmentShader).toContain('roughnessFactor = finRough;');
        expect(shader.fragmentShader).toContain(`#define FINISH_WEAR_${finish.wearStyle.toUpperCase()}`);
        for (const name of ['finSeed', 'finParams', 'finWear', 'finBase', 'finData']) expect(shader.uniforms, name).toHaveProperty(name);
      }
    }
    disposeProceduralKnife(knife);
  });

  it('share one program per finish family, whatever the variant, wear or seed', () => {
    const a = buildProceduralKnife(getKnife('karambit'));
    const b = buildProceduralKnife(getKnife('karambit'));
    applyKnifeFinish(a, { finishId: 'doppler_phase1', wear: 0.01, seed: 1 });
    applyKnifeFinish(b, { finishId: 'doppler_sapphire', wear: 0.07, seed: 900 });
    const ma = ((a.getObjectByName('blade') as Mesh).material as MeshStandardMaterial[])[0];
    const mb = ((b.getObjectByName('blade') as Mesh).material as MeshStandardMaterial[])[0];
    expect(ma).not.toBe(mb);
    expect(ma.customProgramCacheKey()).toBe(mb.customProgramCacheKey());
    applyKnifeFinish(b, { finishId: 'fade', wear: 0.01, seed: 1 });
    const mc = ((b.getObjectByName('blade') as Mesh).material as MeshStandardMaterial[])[0];
    expect(mc.customProgramCacheKey()).not.toBe(ma.customProgramCacheKey());
    disposeProceduralKnife(a);
    disposeProceduralKnife(b);
  });
});

function findHandle(knife: Group): MeshStandardMaterial {
  let found: MeshStandardMaterial | null = null;
  knife.traverse((o) => {
    if (!(o instanceof Mesh) || found) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m.name === 'knife_handle' || m.name === 'knife_finish_handle') found = m as MeshStandardMaterial;
    }
  });
  if (!found) throw new Error('no handle');
  return found;
}
