import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Path,
  Shape,
  SphereGeometry,
  TorusGeometry,
  type Material,
} from 'three';
import type { BladeProfile, KnifeDef, KnifeShape } from '../combat/knives';

/**
 * Builds an original low-poly knife from a {@link KnifeDef}. Frame: +X runs from
 * the guard to the blade tip, +Y is the spine side, the edge faces -Y, Z is
 * thickness. The grip centre sits on -X, so the origin is the point where the
 * hand meets the guard. Units are metres.
 */
export function buildProceduralKnife(def: KnifeDef): Group {
  const s = def.shape;
  const group = new Group();
  group.name = `ProceduralKnife:${def.id}`;
  const steel = new MeshStandardMaterial({ color: s.bladeColor, metalness: 0.6, roughness: 0.32 });
  const handleMat = new MeshStandardMaterial({ color: s.handleColor, metalness: 0.1, roughness: 0.72 });
  const accent = new MeshStandardMaterial({ color: s.accentColor, metalness: 0.7, roughness: 0.4 });

  const blade = new Mesh(bladeGeometry(s), steel);
  blade.name = 'blade';
  group.add(blade);

  if (s.fuller) {
    const fuller = new Mesh(new BoxGeometry(s.bladeLength * 0.55, s.bladeHeight * 0.12, s.bladeThickness * 1.15), accent);
    fuller.position.set(s.bladeLength * 0.36, s.bladeHeight * 0.62, 0);
    group.add(fuller);
  }
  if (s.serratedSpine) {
    group.add(new Mesh(serrationGeometry(s), steel));
  }
  addGuard(group, s, accent);
  addHandle(group, s, handleMat, accent);

  group.userData.knifeId = def.id;
  group.userData.overallLength = s.bladeLength + s.handleLength + guardDepth(s);
  return group;
}

/** Disposes geometries and materials created by {@link buildProceduralKnife}. */
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

function guardDepth(s: KnifeShape): number {
  return s.guard === 'none' ? 0 : 0.012;
}

function bladeGeometry(s: KnifeShape): BufferGeometry {
  const shape = bladeShape(s.profile, s.bladeLength, s.bladeHeight);
  const geometry = new ExtrudeGeometry(shape, {
    depth: s.bladeThickness,
    bevelEnabled: true,
    bevelThickness: s.bladeThickness * 0.45,
    bevelSize: Math.min(0.0025, s.bladeHeight * 0.09),
    bevelSegments: 1,
    curveSegments: 14,
  });
  geometry.translate(0, 0, -s.bladeThickness / 2);
  geometry.computeVertexNormals();
  return geometry;
}

/** 2D outline in (x along blade, y from edge=0 to spine=h). */
export function bladeShape(profile: BladeProfile, L: number, h: number): Shape {
  const p = new Shape();
  switch (profile) {
    case 'spear':
      p.moveTo(0, 0);
      p.lineTo(L * 0.68, h * 0.04);
      p.quadraticCurveTo(L * 0.92, h * 0.2, L, h * 0.5);
      p.quadraticCurveTo(L * 0.92, h * 0.8, L * 0.68, h * 0.96);
      p.lineTo(0, h);
      break;
    case 'drop':
      p.moveTo(0, 0);
      p.lineTo(L * 0.72, 0);
      p.quadraticCurveTo(L * 0.96, h * 0.04, L, h * 0.42);
      p.quadraticCurveTo(L * 0.9, h * 0.92, L * 0.62, h);
      p.lineTo(0, h);
      break;
    case 'clip':
      p.moveTo(0, 0);
      p.lineTo(L * 0.7, 0);
      p.quadraticCurveTo(L * 0.97, h * 0.06, L, h * 0.56);
      p.quadraticCurveTo(L * 0.8, h * 0.66, L * 0.6, h * 0.86);
      p.lineTo(L * 0.52, h);
      p.lineTo(0, h);
      break;
    case 'tanto':
      p.moveTo(0, 0);
      p.lineTo(L * 0.8, 0);
      p.lineTo(L, h * 0.64);
      p.lineTo(L * 0.9, h);
      p.lineTo(0, h);
      break;
    case 'needle':
      p.moveTo(0, 0);
      p.quadraticCurveTo(L * 0.6, h * 0.1, L, h * 0.52);
      p.quadraticCurveTo(L * 0.6, h * 0.94, 0, h);
      break;
    case 'hawkbill':
      // claw: tip hooks down below the edge line, edge on the inner curve
      p.moveTo(0, 0);
      p.quadraticCurveTo(L * 0.6, h * 0.1, L, -h * 1.1);
      p.quadraticCurveTo(L * 0.72, h * 1.05, 0, h);
      break;
    case 'recurve':
      p.moveTo(0, 0);
      p.quadraticCurveTo(L * 0.42, h * 0.3, L * 0.72, -h * 0.18);
      p.quadraticCurveTo(L * 0.98, -h * 0.34, L, h * 0.3);
      p.quadraticCurveTo(L * 0.82, h * 1.18, L * 0.3, h * 1.08);
      p.lineTo(0, h);
      break;
    case 'cleaver':
      p.moveTo(0, 0);
      p.quadraticCurveTo(L * 0.66, -h * 0.3, L, h * 0.74);
      p.quadraticCurveTo(L * 0.86, h * 1.02, L * 0.5, h);
      p.lineTo(0, h);
      break;
    case 'gut':
      p.moveTo(0, 0);
      p.lineTo(L * 0.74, 0);
      p.quadraticCurveTo(L * 0.97, h * 0.05, L, h * 0.4);
      p.quadraticCurveTo(L * 0.92, h * 0.88, L * 0.7, h);
      // the gut hook notch in the spine
      p.lineTo(L * 0.62, h);
      p.quadraticCurveTo(L * 0.56, h * 0.6, L * 0.48, h * 0.78);
      p.lineTo(L * 0.44, h);
      p.lineTo(0, h);
      break;
    default:
      p.moveTo(0, 0);
      p.lineTo(L, h * 0.5);
      p.lineTo(0, h);
  }
  p.closePath();
  return p;
}

function serrationGeometry(s: KnifeShape): BufferGeometry {
  const teeth = 7;
  const start = s.bladeLength * 0.1;
  const span = s.bladeLength * 0.34;
  const tooth = span / teeth;
  const shape = new Shape();
  shape.moveTo(start, s.bladeHeight * 0.96);
  for (let i = 0; i < teeth; i += 1) {
    const x = start + i * tooth;
    shape.lineTo(x + tooth * 0.5, s.bladeHeight * 1.14);
    shape.lineTo(x + tooth, s.bladeHeight * 0.96);
  }
  shape.lineTo(start, s.bladeHeight * 0.96);
  const geometry = new ExtrudeGeometry(shape, { depth: s.bladeThickness * 0.8, bevelEnabled: false });
  geometry.translate(0, 0, -s.bladeThickness * 0.4);
  return geometry;
}

function addGuard(group: Group, s: KnifeShape, mat: Material): void {
  const h = s.bladeHeight;
  if (s.guard === 'cross' || s.guard === 'ring') {
    const cross = new Mesh(new BoxGeometry(0.01, h * 2.1, s.bladeThickness * 3.4), mat);
    cross.position.set(-0.005, h * 0.5, 0);
    group.add(cross);
  }
  if (s.guard === 'bolster') {
    const bolster = new Mesh(new BoxGeometry(0.014, h * 1.08, s.bladeThickness * 2.8), mat);
    bolster.position.set(-0.007, h * 0.5, 0);
    group.add(bolster);
  }
  if (s.guard === 'ring') {
    const ring = new Mesh(new TorusGeometry(0.009, 0.0022, 8, 18), mat);
    ring.rotation.y = Math.PI / 2;
    ring.position.set(-0.005, h * 1.55 + 0.009, 0);
    group.add(ring);
  }
}

function addHandle(group: Group, s: KnifeShape, mat: Material, accent: Material): void {
  const len = s.handleLength;
  const h = s.bladeHeight;
  const cy = h * 0.5;
  const x0 = -guardDepth(s);
  const r = Math.max(0.011, h * 0.42);
  const alongX = (geometry: BufferGeometry) => {
    geometry.rotateZ(Math.PI / 2);
    return geometry;
  };

  switch (s.handle) {
    case 'grip':
    case 'wood': {
      const body = new Mesh(alongX(new CylinderGeometry(r * 0.92, r, len, 12)), mat);
      body.scale.z = 0.72;
      body.position.set(x0 - len / 2, cy, 0);
      group.add(body);
      if (s.handle === 'grip') {
        for (let i = 1; i <= 3; i += 1) {
          const ridge = new Mesh(new TorusGeometry(r * 0.98, r * 0.12, 6, 14), mat);
          ridge.rotation.y = Math.PI / 2;
          ridge.scale.set(1, 1, 0.72);
          ridge.position.set(x0 - (len * i) / 4, cy, 0);
          group.add(ridge);
        }
      }
      const pommel = new Mesh(new SphereGeometry(r * 1.05, 10, 8), accent);
      pommel.scale.set(0.6, 1, 0.75);
      pommel.position.set(x0 - len, cy, 0);
      group.add(pommel);
      break;
    }
    case 'scales': {
      const body = new Mesh(new BoxGeometry(len, h * 0.9, s.bladeThickness * 3.2), mat);
      body.position.set(x0 - len / 2, cy, 0);
      group.add(body);
      for (const f of [0.2, 0.8]) {
        const pin = new Mesh(new CylinderGeometry(0.0022, 0.0022, s.bladeThickness * 3.6, 8), accent);
        pin.rotation.x = Math.PI / 2;
        pin.position.set(x0 - len * f, cy, 0);
        group.add(pin);
      }
      break;
    }
    case 'cord': {
      const core = new Mesh(new BoxGeometry(len, h * 0.7, s.bladeThickness * 2), accent);
      core.position.set(x0 - len / 2, cy, 0);
      group.add(core);
      const wraps = 11;
      for (let i = 0; i < wraps; i += 1) {
        const wrap = new Mesh(new TorusGeometry(r * 0.8, r * 0.22, 6, 12), mat);
        wrap.rotation.y = Math.PI / 2;
        wrap.rotation.x = i % 2 === 0 ? 0.25 : -0.25;
        wrap.scale.set(1, 1, 0.7);
        wrap.position.set(x0 - (len * (i + 0.5)) / wraps, cy, 0);
        group.add(wrap);
      }
      const loop = new Mesh(new TorusGeometry(r * 0.7, r * 0.18, 6, 14), mat);
      loop.position.set(x0 - len - r * 0.6, cy, 0);
      group.add(loop);
      break;
    }
    case 'split': {
      // balisong: two handle halves either side of the tang, pivot pins at the blade end
      for (const side of [-1, 1]) {
        const half = new Mesh(new BoxGeometry(len, h * 0.8, s.bladeThickness * 1.6), mat);
        half.position.set(x0 - len / 2, cy, side * s.bladeThickness * 1.9);
        group.add(half);
      }
      const pivot = new Mesh(new CylinderGeometry(0.003, 0.003, s.bladeThickness * 6, 10), accent);
      pivot.rotation.x = Math.PI / 2;
      pivot.position.set(x0 - 0.006, cy, 0);
      group.add(pivot);
      const latch = new Mesh(new BoxGeometry(0.018, 0.003, s.bladeThickness * 5.4), accent);
      latch.position.set(x0 - len + 0.009, cy - h * 0.38, 0);
      group.add(latch);
      break;
    }
    case 'ring': {
      const body = new Mesh(new BoxGeometry(len, h * 0.95, s.bladeThickness * 3), mat);
      body.position.set(x0 - len / 2, cy - h * 0.1, 0);
      body.rotation.z = -0.18;
      group.add(body);
      const ring = new Mesh(new TorusGeometry(0.017, 0.0045, 10, 22), accent);
      ring.position.set(x0 - len - 0.012, cy - h * 0.35, 0);
      group.add(ring);
      break;
    }
    case 'skeleton': {
      const outline = new Shape();
      const hh = h * 0.95;
      outline.moveTo(0, -hh / 2);
      outline.lineTo(-len, -hh / 2);
      outline.quadraticCurveTo(-len - hh * 0.5, 0, -len, hh / 2);
      outline.lineTo(0, hh / 2);
      outline.closePath();
      const hole = new Path();
      hole.moveTo(-len * 0.18, -hh * 0.2);
      hole.lineTo(-len * 0.86, -hh * 0.2);
      hole.lineTo(-len * 0.86, hh * 0.2);
      hole.lineTo(-len * 0.18, hh * 0.2);
      hole.closePath();
      outline.holes.push(hole);
      const geometry = new ExtrudeGeometry(outline, { depth: s.bladeThickness * 1.6, bevelEnabled: false });
      geometry.translate(x0, cy, -s.bladeThickness * 0.8);
      group.add(new Mesh(geometry, mat));
      break;
    }
    case 'tee': {
      const bar = new Mesh(new CylinderGeometry(r, r, len, 12), mat);
      bar.scale.z = 0.8;
      bar.position.set(x0 - r, cy, 0);
      group.add(bar);
      const stem = new Mesh(new BoxGeometry(r * 2, h * 0.7, s.bladeThickness * 2.4), accent);
      stem.position.set(x0 - r * 0.2, cy, 0);
      group.add(stem);
      break;
    }
    default:
      break;
  }
}
