import { existsSync } from 'node:fs';
import { Box3, Texture, Vector3, type Mesh } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { MovementController } from '../../movement/MovementController';
import { defaultCvars } from '../../movement/cvars';
import type { CollisionWorld } from '../CollisionWorld';
import { MapTriggers, sanitizeTriggers } from '../MapTriggers';
import { applyLightmaps, resolveEnvironment, resolveMapAssetPath } from '../MapEnvironment';
import type { MapMeta } from '../types';
import {
  ROOT,
  fileSize,
  glbJson,
  inBox,
  loadCollisionWorld,
  loadGlbScene,
  mapFile,
  readLayout,
  readMeta,
  trianglesOf,
  vec,
  type Triangle,
} from './mapTestUtils';

const MAPS = ['bhop_emberdrift', 'surf_prismline', 'aim_ochrecut'] as const;
// the standing hull the game spawns and moves (cs2's 72 u)
const CAPSULE = new MovementController().capsule;
const DT = 1 / 128;
const MB = 1024 * 1024;

const worlds = new Map<string, CollisionWorld>();

beforeAll(async () => {
  for (const id of MAPS) {
    worlds.set(id, (await loadCollisionWorld(id)).world);
  }
}, 60000);

function world(id: string): CollisionWorld {
  const w = worlds.get(id);
  if (!w) throw new Error(`collision for ${id} not loaded`);
  return w;
}

function expectGrounded(w: CollisionWorld, p: Vector3, label: string): void {
  const ground = w.queryGround(p, CAPSULE, 0.3);
  expect(ground, `${label} has ground under it`).not.toBeNull();
  expect(ground!.distance, `${label} sits on the ground`).toBeLessThan(0.2);
  expect(ground!.normal.y, `${label} stands on a flat floor`).toBeGreaterThan(0.95);
  const resolved = w.resolveCapsulePosition(p, CAPSULE);
  expect(resolved.position.distanceTo(p), `${label} is not inside geometry`).toBeLessThan(0.1);
}

describe.each(MAPS)('%s meta', (id) => {
  const meta = readMeta(id);

  it('describes an original map with a matching id', () => {
    expect(meta.id).toBe(id);
    expect(meta.name.length).toBeGreaterThan(2);
    expect(meta.license).toMatch(/original/i);
    expect(meta.source).toContain(`build_${id}.py`);
  });

  it('has spawns that sit on the collision ground', () => {
    expect(meta.spawns?.length ?? 0).toBeGreaterThan(0);
    for (const [i, spawn] of (meta.spawns ?? []).entries()) {
      expectGrounded(world(id), vec(spawn.position), `spawn ${i}`);
    }
  });

  it('has well formed triggers whose targets sit on the ground', () => {
    const raw = meta.triggers ?? [];
    expect(sanitizeTriggers(raw)).toHaveLength(raw.length);
    for (const t of raw) {
      for (let k = 0; k < 3; k += 1) {
        expect(t.max[k], `${t.id} max > min`).toBeGreaterThan(t.min[k]);
      }
      if (t.target) {
        expectGrounded(world(id), vec(t.target.position), `${t.id} target`);
      }
    }
  });

  it('ships its environment files and sane light values', () => {
    const env = resolveEnvironment(meta.environment);
    expect(meta.environment).toBeDefined();
    expect(env.sky).not.toBeNull();
    expect(env.lightmaps.length).toBeGreaterThan(0);
    for (const entry of env.lightmaps) {
      const url = resolveMapAssetPath(entry.path, `/maps/${id}/meta.json`);
      expect(existsSync(`${ROOT}/public${url}`), `${url} exists`).toBe(true);
    }
    expect(env.lightMapIntensity).toBeGreaterThan(1);
    expect(env.sunIntensity).toBeGreaterThan(0);
    expect(env.fogFar).toBeGreaterThan(env.fogNear);
  });

  it('keeps the download and draw budgets', async () => {
    const files = ['scene.glb', 'collision.glb', 'lightmap.webp', 'thumbnail.webp'];
    const total = files.reduce((sum, f) => sum + fileSize(mapFile(id, f)), 0);
    expect(total).toBeLessThan(8 * MB);
    expect(fileSize(mapFile(id, 'thumbnail.webp'))).toBeGreaterThan(0);
    expect(fileSize(mapFile(id, 'thumbnail.webp'))).toBeLessThanOrEqual(60 * 1024);
    const scene = await loadGlbScene(mapFile(id, 'scene.glb'));
    let drawCalls = 0;
    scene.traverse((child) => {
      if ((child as { isMesh?: boolean }).isMesh) drawCalls += 1;
    });
    expect(drawCalls).toBeLessThanOrEqual(150);
    expect(trianglesOf(scene).length).toBeLessThanOrEqual(250000);
  }, 30000);

  it('ships lightmap uvs that the runtime picks up', async () => {
    const scene = await loadGlbScene(mapFile(id, 'scene.glb'));
    let lit = 0;
    let unlit = 0;
    scene.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) return;
      const uv1 = mesh.geometry.getAttribute('uv1');
      if (!uv1) {
        unlit += 1;
        return;
      }
      lit += 1;
      for (let i = 0; i < uv1.count; i += 97) {
        expect(uv1.getX(i)).toBeGreaterThanOrEqual(0);
        expect(uv1.getX(i)).toBeLessThanOrEqual(1);
        expect(uv1.getY(i)).toBeGreaterThanOrEqual(0);
        expect(uv1.getY(i)).toBeLessThanOrEqual(1);
      }
      expect(mesh.geometry.getAttribute('uv'), `${mesh.name} has albedo uvs`).toBeDefined();
    });
    expect(lit).toBeGreaterThan(5);
    expect(unlit).toBeGreaterThan(0);
    const env = resolveEnvironment(meta.environment);
    expect(applyLightmaps(scene, env, [new Texture()])).toBe(lit);
  }, 30000);

  it('ships a plain collision glb (positions only, no textures or meshopt)', () => {
    const json = glbJson(mapFile(id, 'collision.glb'));
    expect(json.images).toBeUndefined();
    expect(json.textures).toBeUndefined();
    expect(json.materials).toBeUndefined();
    expect((json.extensionsUsed as string[] | undefined) ?? []).toEqual([]);
    const meshes = json.meshes as Array<{ primitives: Array<{ attributes: Record<string, number> }> }>;
    expect(meshes).toHaveLength(1);
    expect(Object.keys(meshes[0].primitives[0].attributes)).toEqual(['POSITION']);
  });

  it('drops a spawned player onto the ground with the real movement code', () => {
    const player = new MovementController();
    const spawn = vec(meta.spawns![0].position);
    player.reset(spawn.clone().add(new Vector3(0, 1.5, 0)), meta.spawns![0].yawDeg ?? 0);
    for (let i = 0; i < 128; i += 1) {
      player.tick(DT, { forwardMove: 0, sideMove: 0, jumpPressed: false, jumpHeld: false }, world(id));
    }
    expect(player.getDebugState().grounded).toBe(true);
    expect(Math.abs(player.getFeetPosition().y - spawn.y)).toBeLessThan(0.15);
  });
});

describe('map cvars', () => {
  it('bhop and surf maps carry their air acceleration, the arena none', () => {
    expect((readMeta('bhop_emberdrift').cvars as Record<string, number>).sv_airaccelerate).toBe(150);
    expect((readMeta('surf_prismline').cvars as Record<string, number>).sv_airaccelerate).toBe(100);
    expect(readMeta('aim_ochrecut').cvars).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// bhop

interface BhopLayout {
  platforms: Array<{ index: number; kind: string; section: number; center: [number, number]; top: number; length: number; width: number; heading: number }>;
}

describe('bhop_emberdrift course', () => {
  const meta = readMeta('bhop_emberdrift');
  const layout = readLayout<BhopLayout>('bhop_emberdrift');
  // blender (x, y, z) -> three (x, z, -y)
  const top = (p: BhopLayout['platforms'][number]) => new Vector3(p.center[0], p.top, -p.center[1]);

  it('is a 25 to 35 jump course with checkpoints every few jumps', () => {
    const jumps = layout.platforms.length - 1;
    expect(jumps).toBeGreaterThanOrEqual(25);
    expect(jumps).toBeLessThanOrEqual(35);
    const checkpoints = layout.platforms.filter((p) => p.kind === 'checkpoint').map((p) => p.index);
    expect(checkpoints.length).toBeGreaterThanOrEqual(4);
    const marks = [0, ...checkpoints, layout.platforms.length - 1];
    for (let i = 1; i < marks.length; i += 1) {
      expect(marks[i] - marks[i - 1]).toBeLessThanOrEqual(9);
    }
    const triggers = new MapTriggers(meta.triggers, { position: [0, 0, 0], yawDeg: 0 });
    expect(triggers.count('start')).toBe(1);
    expect(triggers.count('finish')).toBe(1);
    expect(triggers.count('checkpoint')).toBe(checkpoints.length);
  });

  it('has a platform top under every jump and every one is reachable', () => {
    const g = defaultCvars.sv_gravity;
    const vz = defaultCvars.sv_jump_impulse;
    for (let i = 1; i < layout.platforms.length; i += 1) {
      const a = layout.platforms[i - 1];
      const b = layout.platforms[i];
      expectGrounded(world('bhop_emberdrift'), top(b).add(new Vector3(0, 0.04, 0)), `platform ${b.index}`);
      const drop = a.top - b.top;
      expect(drop, `platform ${b.index} is not a climb`).toBeGreaterThan(-0.6);
      const air = (vz + Math.sqrt(vz * vz + 2 * g * drop)) / g;
      // closest edge to edge distance, conservatively using the platform half sizes
      const centre = Math.hypot(b.center[0] - a.center[0], b.center[1] - a.center[1]);
      const gap = centre - Math.max(a.length, a.width) / 2 - Math.max(b.length, b.width) / 2;
      const needed = Math.max(0, gap) / air;
      const limit = b.section <= 1 ? 11 : 14;
      expect(needed, `jump into platform ${b.index} needs ${needed.toFixed(1)} m/s`).toBeLessThanOrEqual(limit);
      const turn = Math.abs(((b.heading - a.heading + 540) % 360) - 180);
      expect(turn, `platform ${b.index} turn per jump`).toBeLessThanOrEqual(45);
    }
  });

  it('never teleports a player standing on or jumping between platforms', () => {
    const teleports = (meta.triggers ?? []).filter((t) => t.type === 'teleport');
    for (let i = 1; i < layout.platforms.length; i += 1) {
      const a = top(layout.platforms[i - 1]);
      const b = top(layout.platforms[i]);
      for (let k = 0; k <= 10; k += 1) {
        const p = a.clone().lerp(b, k / 10);
        p.y += 0.05 + Math.sin((Math.PI * k) / 10) * 0.7;
        for (const t of teleports) {
          expect(inBox(p, t.min, t.max), `${t.id} catches the jump into ${i}`).toBe(false);
        }
      }
    }
    const checkpoints = (meta.triggers ?? []).filter((t) => t.type === 'checkpoint');
    for (const t of checkpoints) {
      expect(inBox(vec(t.target!.position), t.min, t.max), `${t.id} contains its target`).toBe(true);
    }
    const finish = (meta.triggers ?? []).find((t) => t.type === 'finish')!;
    expect(inBox(top(layout.platforms[layout.platforms.length - 1]).add(new Vector3(0, 0.05, 0)), finish.min, finish.max)).toBe(true);
    const lava = teleports.find((t) => t.id === 'lava')!;
    const low = Math.min(...layout.platforms.map((p) => p.top));
    expect(lava.max[1]).toBeLessThan(low - 3);
  });

  it('runs the start of the course with the real movement code', () => {
    const w = world('bhop_emberdrift');
    const player = new MovementController();
    player.setCvar('sv_airaccelerate', 150);
    const spawn = meta.spawns![0];
    player.reset(vec(spawn.position), spawn.yawDeg ?? 0);
    const targets = layout.platforms.slice(1, 6).map((p) => top(p));
    let next = 0;
    let landed = 0;
    let side = 1;
    let hopping = false;
    const { sv_gravity: g, sv_jump_impulse: vz } = player.getCvars();
    for (let t = 0; t < 128 * 8 && next < targets.length; t += 1) {
      const feet = player.getFeetPosition();
      const goal = targets[next];
      const to = goal.clone().sub(feet).setY(0);
      // run up facing the platform and start hopping once a flat jump at this speed reaches its
      // centre, then hold W and steer the wish direction like a mouse strafe. with the 30 u/s air
      // cap that's the only way to turn, gain or lose speed in the air, so the bot turns toward
      // the platform and gains or bleeds speed so it lands on the centre
      let yaw = Math.atan2(-to.x, -to.z);
      const vel = player.captureState().velocity;
      const speed = Math.hypot(vel[0], vel[2]);
      hopping ||= to.length() <= speed * ((2 * vz) / g);
      if (hopping && speed > 1 && !player.getDebugState().grounded && feet.y > goal.y - 1) {
        const velYaw = Math.atan2(-vel[0], -vel[2]);
        const err = Math.atan2(Math.sin(yaw - velYaw), Math.cos(yaw - velYaw));
        // speed that lands on the platform centre in the air time left
        const drop = Math.max(0, vel[1] * vel[1] + 2 * g * (feet.y - goal.y));
        const airLeft = (vel[1] + Math.sqrt(drop)) / g;
        const want = to.length() / Math.max(airLeft, 0.05);
        // just past perpendicular bleeds a little speed per tick, straight back would stop dead
        side = Math.abs(err) > 0.02 ? Math.sign(err) : -side;
        if (speed < want - 0.2) yaw = velYaw + side * Math.acos(Math.min(1, 0.5 / speed));
        else if (speed > want + 0.2) yaw = velYaw + side * Math.acos(Math.max(-1, -1 / speed));
        else yaw = Math.abs(err) > 0.02 ? velYaw + side * Math.PI / 2 : velYaw;
      }
      player.setView(yaw, 0);
      player.tick(DT, { forwardMove: 1, sideMove: 0, jumpPressed: false, jumpHeld: hopping }, w);
      const d = player.getDebugState();
      if (d.grounded && Math.abs(player.getFeetPosition().y - goal.y) < 0.2 && player.getFeetPosition().clone().setY(0).distanceTo(goal.clone().setY(0)) < 2.2) {
        landed += 1;
        next += 1;
      }
      expect(player.getFeetPosition().y).toBeGreaterThan(-3);
    }
    expect(landed).toBe(targets.length);
  }, 30000);
});

// ---------------------------------------------------------------------------
// surf

interface SurfRamp {
  stage: number;
  index: number;
  side: 'left' | 'right';
  angleDeg: number;
  length: number;
  height: number;
  s0: number;
  s1: number;
  lateral: number;
  ridgeStart: number;
  ridgeEnd: number;
  forward: [number, number, number];
  quad: Array<[number, number, number]>;
}

interface SurfLayout {
  stages: Array<{ index: number; origin: [number, number, number]; forward: [number, number, number]; right: [number, number, number]; landing: { s0: number; s1: number; top: number } }>;
  ramps: SurfRamp[];
}

function facePlane(ramp: SurfRamp) {
  const [rs, re, , fs] = ramp.quad.map(vec);
  const normal = re.clone().sub(rs).cross(fs.clone().sub(rs)).normalize();
  if (normal.y < 0) normal.negate();
  return { rs, re, fs, normal, d: normal.dot(rs) };
}

/** (u, v) of p in the face parallelogram rs + u * along + v * across */
function faceCoords(p: Vector3, rs: Vector3, along: Vector3, across: Vector3): [number, number] {
  const rel = p.clone().sub(rs);
  const aa = along.dot(along);
  const ab = along.dot(across);
  const bb = across.dot(across);
  const pa = rel.dot(along);
  const pb = rel.dot(across);
  const det = aa * bb - ab * ab;
  return [(pa * bb - pb * ab) / det, (pb * aa - pa * ab) / det];
}

function trianglesOnFace(tris: Triangle[], ramp: SurfRamp, tolerance: number): Triangle[] {
  const { rs, re, fs, normal, d } = facePlane(ramp);
  const along = re.clone().sub(rs);
  const across = fs.clone().sub(rs);
  const inside = (p: Vector3) => {
    const [u, v] = faceCoords(p, rs, along, across);
    return u > -0.01 && u < 1.01 && v > -0.02 && v < 1.02;
  };
  return tris.filter((t) => [t.a, t.b, t.c].every((p) => Math.abs(normal.dot(p) - d) < tolerance && inside(p))
    && Math.abs(Math.abs(t.normal.dot(normal)) - 1) < 1e-3);
}

describe('surf_prismline ramps', () => {
  const meta = readMeta('surf_prismline');
  const layout = readLayout<SurfLayout>('surf_prismline');

  it('has 3 or 4 stages with start, checkpoints, a teleport under each stage and a finish', () => {
    expect(layout.stages.length).toBeGreaterThanOrEqual(3);
    expect(layout.stages.length).toBeLessThanOrEqual(4);
    const triggers = meta.triggers ?? [];
    expect(triggers.filter((t) => t.type === 'start')).toHaveLength(1);
    expect(triggers.filter((t) => t.type === 'finish')).toHaveLength(1);
    expect(triggers.filter((t) => t.type === 'checkpoint')).toHaveLength(layout.stages.length - 1);
    for (const stage of layout.stages) {
      const fall = triggers.find((t) => t.type === 'teleport' && t.stage === stage.index);
      expect(fall, `teleport under stage ${stage.index}`).toBeDefined();
      expect(fall!.target, `stage ${stage.index} teleport goes to its start`).toBeDefined();
    }
  });

  it('builds ramps in the classic surf range', () => {
    for (const r of layout.ramps) {
      expect(r.angleDeg).toBeGreaterThanOrEqual(55);
      expect(r.angleDeg).toBeLessThanOrEqual(62);
      expect(r.length).toBeGreaterThanOrEqual(30);
      expect(r.length).toBeLessThanOrEqual(120);
      expect(r.height).toBeGreaterThanOrEqual(10);
      expect(r.height).toBeLessThanOrEqual(20);
    }
  });

  it('keeps every ramp face one planar quad in the collision mesh', { timeout: 30000 }, async () => {
    const tris = trianglesOf((await loadCollisionWorld('surf_prismline')).root);
    for (const r of layout.ramps) {
      const face = trianglesOnFace(tris, r, 0.01);
      expect(face, `stage ${r.stage} ramp ${r.index} ${r.side} is two triangles`).toHaveLength(2);
      const angle = (Math.acos(Math.abs(face[0].normal.y)) * 180) / Math.PI;
      expect(Math.abs(angle - r.angleDeg)).toBeLessThan(0.6);
      // no stray vertex anywhere inside the face
      const { rs, re, fs, normal, d } = facePlane(r);
      const along = re.clone().sub(rs);
      const across = fs.clone().sub(rs);
      for (const t of tris) {
        for (const p of [t.a, t.b, t.c]) {
          if (Math.abs(normal.dot(p) - d) > 0.01) continue;
          const [u, v] = faceCoords(p, rs, along, across);
          expect(u > 0.001 && u < 0.999 && v > 0.001 && v < 0.999, 'vertex inside a ramp face').toBe(false);
        }
      }
    }
  });

  it('keeps every ramp face one planar quad in the render mesh', { timeout: 30000 }, async () => {
    const scene = await loadGlbScene(mapFile('surf_prismline', 'scene.glb'));
    const tris = trianglesOf(scene, (name) => name.includes('__ramp_'));
    for (const r of layout.ramps) {
      // quantized render positions sit within a few millimetres of the plane
      const face = trianglesOnFace(tris, r, 0.03);
      expect(face, `render stage ${r.stage} ramp ${r.index} ${r.side}`).toHaveLength(2);
      expect(face[0].normal.dot(face[1].normal)).toBeGreaterThan(0.99999);
    }
  });

  it('never teleports a rider on a ramp face or a stage platform', () => {
    const teleports = (meta.triggers ?? []).filter((t) => t.type === 'teleport');
    for (const r of layout.ramps) {
      const { rs, re, fs, normal } = facePlane(r);
      for (let i = 0; i <= 8; i += 1) {
        for (let j = 0; j <= 4; j += 1) {
          const p = rs.clone().lerp(re, i / 8).add(fs.clone().sub(rs).multiplyScalar(j / 4)).addScaledVector(normal, 1.0);
          for (const t of teleports) {
            expect(inBox(p, t.min, t.max), `${t.id} over stage ${r.stage} ramp ${r.index}`).toBe(false);
          }
        }
      }
    }
    for (const stage of layout.stages) {
      const o = vec(stage.origin);
      const f = vec(stage.forward);
      const land = o.clone().addScaledVector(f, (stage.landing.s0 + stage.landing.s1) / 2);
      land.y = stage.landing.top + 0.5;
      for (const t of teleports) {
        expect(inBox(o.clone().setY(o.y + 0.5), t.min, t.max)).toBe(false);
        expect(inBox(land, t.min, t.max)).toBe(false);
      }
    }
  });

  it('keeps a rider holding into a ramp in surf mode and speeds them up', () => {
    const w = world('surf_prismline');
    const ramp = layout.ramps[0];
    const { rs, re, fs, normal } = facePlane(ramp);
    const f = vec(ramp.forward).normalize();
    const start = rs.clone().lerp(re, 0.1).add(fs.clone().sub(rs).multiplyScalar(0.15)).addScaledVector(normal, 0.3);
    const player = new MovementController();
    player.setCvar('sv_airaccelerate', 100);
    player.reset(start, (Math.atan2(-f.x, -f.z) * 180) / Math.PI);
    player.setVelocity(f.clone().multiplyScalar(12));
    const into = ramp.side === 'right' ? -1 : 1;
    const up = rs.clone().sub(fs).normalize();
    let surfTicks = 0;
    let ticks = 0;
    for (let t = 0; t < 128 * 2.2; t += 1) {
      // hold into the ramp once sliding down faster than 6 m/s, so the rider
      // keeps drifting down the face and turns height into speed
      const push = Math.min(1, Math.max(0, 0.6 * (-6 - player.getVelocity().dot(up))));
      player.tick(DT, { forwardMove: 0, sideMove: into * push, jumpPressed: false, jumpHeld: false }, w);
      ticks += 1;
      if (player.getDebugState().surfing) surfTicks += 1;
    }
    expect(surfTicks / ticks).toBeGreaterThan(0.9);
    expect(player.getVelocity().length()).toBeGreaterThan(13);
    expect(player.getFeetPosition().y).toBeLessThan(start.y - 3);
  }, 30000);

  it('carries a rider through every stage onto its landing platform', () => {
    const w = world('surf_prismline');
    for (const stage of layout.stages) {
      for (const side of ['left', 'right'] as const) {
        for (const [depthFrac, speed] of [[0.25, 12], [0.5, 18], [0.75, 26]]) {
          expect(rideStage(w, layout, stage.index, side, depthFrac, speed), `stage ${stage.index} ${side} ${speed} m/s`).toBe(true);
        }
      }
    }
  }, 120000);
});

/**
 * a surfer bot: starts on the first ramp of a stage, holds its line by pushing
 * into the face only as much as it needs (slowly drifting down for speed) and
 * lets go between ramps. true when it lands on the stage's landing platform.
 */
function rideStage(w: CollisionWorld, layout: SurfLayout, stageIndex: number, side: 'left' | 'right', depthFrac: number, speed: number): boolean {
  const stage = layout.stages[stageIndex - 1];
  const origin = vec(stage.origin);
  const fwd = vec(stage.forward).normalize();
  const right = vec(stage.right).normalize();
  const ramps = layout.ramps.filter((r) => r.stage === stageIndex && r.side === side);
  const first = ramps[0];
  const depth0 = first.height * depthFrac;
  const sign = side === 'right' ? 1 : -1;
  const start = origin.clone().addScaledVector(fwd, first.s0 + 8)
    .addScaledVector(right, first.lateral + sign * depth0 / Math.tan((first.angleDeg * Math.PI) / 180));
  start.y = first.ridgeStart + (first.ridgeEnd - first.ridgeStart) * (8 / first.length) - depth0 + 0.3;
  const player = new MovementController();
  player.setCvar('sv_airaccelerate', 100);
  player.reset(start, (Math.atan2(-fwd.x, -fwd.z) * 180) / Math.PI);
  player.setVelocity(fwd.clone().multiplyScalar(speed));
  let current = -1;
  let target = depth0;
  for (let t = 0; t < 128 * 40; t += 1) {
    const feet = player.getFeetPosition();
    const rel = feet.clone().sub(origin);
    const s = rel.dot(fwd);
    const lat = rel.dot(right);
    const idx = ramps.findIndex((r) => s >= r.s0 - 0.5 && s <= r.s1);
    let push = 0;
    if (idx >= 0) {
      const r = ramps[idx];
      const ridge = r.ridgeStart + (r.ridgeEnd - r.ridgeStart) * ((s - r.s0) / r.length);
      const depth = ridge - feet.y;
      const onRight = lat - r.lateral > 0;
      if (idx !== current && player.getDebugState().surfing) {
        current = idx;
        target = Math.min(r.height * 0.6, Math.max(depth, r.height * 0.25));
      }
      const a = (r.angleDeg * Math.PI) / 180;
      const up = right.clone().multiplyScalar((onRight ? -1 : 1) * Math.cos(a)).add(new Vector3(0, Math.sin(a), 0));
      const wantUp = -0.8 + 0.5 * (depth - target);
      push = Math.min(1, Math.max(0, 0.6 * (wantUp - player.getVelocity().dot(up)))) * (onRight ? -1 : 1);
    }
    player.tick(DT, { forwardMove: 0, sideMove: push, jumpPressed: false, jumpHeld: false }, w);
    const d = player.getDebugState();
    if (s >= stage.landing.s0 && d.grounded && Math.abs(player.getFeetPosition().y - stage.landing.top) < 1) {
      return true;
    }
    if (feet.y < stage.landing.top - 40) {
      return false;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// aim arena

interface AimLayout {
  halfX: number;
  halfY: number;
  nestTop: number;
  nests: Array<[number, number, number]>;
  stairs: Array<{ bottom: [number, number, number]; top: [number, number, number] }>;
}

describe('aim_ochrecut arena', () => {
  const meta = readMeta('aim_ochrecut') as MapMeta;
  const layout = readLayout<AimLayout>('aim_ochrecut');

  it('is 110 to 130 m long and 45 to 60 m wide', () => {
    expect(layout.halfY * 2).toBeGreaterThanOrEqual(110);
    expect(layout.halfY * 2).toBeLessThanOrEqual(130);
    expect(layout.halfX * 2).toBeGreaterThanOrEqual(45);
    expect(layout.halfX * 2).toBeLessThanOrEqual(60);
  });

  it('has at least four spawns per side facing the enemy half', () => {
    const spawns = meta.spawns ?? [];
    for (const side of ['a', 'b']) {
      const own = spawns.filter((s) => s.side === side);
      expect(own.length).toBeGreaterThanOrEqual(4);
      for (const s of own) {
        const yaw = ((s.yawDeg ?? 0) * Math.PI) / 180;
        const forward = new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
        // side a is at three +z (blender -y) and looks towards -z, side b the opposite
        const towards = new Vector3(0, 0, -Math.sign(s.position[2]));
        expect(forward.dot(towards)).toBeGreaterThan(0.9);
      }
    }
    expect(spawns[0].side).toBe('a');
  });

  it('has a clear AWP line nest to nest and walkable stairs up to both nests', () => {
    const w = world('aim_ochrecut');
    const [a, b] = layout.nests.map((n) => vec(n).add(new Vector3(0, 1.6, 0)));
    expect(a.distanceTo(b)).toBeGreaterThanOrEqual(60);
    expect(w.segmentIntersectsGeometry(a, b)).toBe(false);
    for (const stair of layout.stairs) {
      const bottom = vec(stair.bottom);
      const topPoint = vec(stair.top);
      const run = Math.hypot(topPoint.x - bottom.x, topPoint.z - bottom.z);
      const slope = (Math.atan2(topPoint.y - bottom.y, run) * 180) / Math.PI;
      expect(slope).toBeLessThanOrEqual(35);
      const mid = bottom.clone().lerp(topPoint, 0.5).add(new Vector3(0, 2, 0));
      const hit = w.raycastGeometry(mid, new Vector3(0, -1, 0), 6);
      expect(hit).not.toBeNull();
      const angle = (Math.acos(hit!.normal.y) * 180) / Math.PI;
      expect(angle).toBeLessThanOrEqual(35);
    }
  });

  it('lets a player walk up a stair ramp onto the nest', () => {
    const w = world('aim_ochrecut');
    const stair = layout.stairs[0];
    const bottom = vec(stair.bottom);
    const topPoint = vec(stair.top);
    const dir = topPoint.clone().sub(bottom).setY(0).normalize();
    const player = new MovementController();
    player.reset(bottom.clone().addScaledVector(dir, -1.5).add(new Vector3(0, 0.05, 0)), (Math.atan2(-dir.x, -dir.z) * 180) / Math.PI);
    let onNest = false;
    for (let t = 0; t < 128 * 3 && !onNest; t += 1) {
      player.tick(DT, { forwardMove: 1, sideMove: 0, jumpPressed: false, jumpHeld: false }, w);
      onNest = player.getDebugState().grounded && Math.abs(player.getFeetPosition().y - layout.nestTop) < 0.05;
    }
    expect(onNest).toBe(true);
  });

  it('shields the mid spawns from the enemy nest', () => {
    const w = world('aim_ochrecut');
    const enemyEye = vec(layout.nests[1]).add(new Vector3(0, 1.6, 0));
    const mid = (meta.spawns ?? []).filter((s) => s.side === 'a' && Math.abs(s.position[0]) < 5);
    expect(mid.length).toBeGreaterThan(0);
    for (const s of mid) {
      const chest = vec(s.position).add(new Vector3(0, 1.2, 0));
      expect(w.segmentIntersectsGeometry(enemyEye, chest)).toBe(true);
    }
    const bounds = new Box3(new Vector3(-layout.halfX, -1, -layout.halfY), new Vector3(layout.halfX, 30, layout.halfY));
    for (const s of meta.spawns ?? []) {
      expect(bounds.containsPoint(vec(s.position))).toBe(true);
    }
  });
});
