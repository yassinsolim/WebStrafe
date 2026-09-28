import { existsSync, readFileSync } from 'node:fs';
import { Box3, Texture, Vector3, type Mesh } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { MovementController } from '../../movement/MovementController';
import { defaultCvars } from '../../movement/cvars';
import { weaponMaxSpeed } from '../../combat/weapons';
import type { CollisionWorld } from '../CollisionWorld';
import { MapTriggers, sanitizeTriggers } from '../MapTriggers';
import { applyLightmaps, resolveEnvironment, resolveMapAssetPath } from '../MapEnvironment';
import { resolveBotAnchor } from '../SpawnPoints';
import type { MapManifest, MapMeta } from '../types';
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
import { fullRun, rideStage, type SurfLayout, type SurfRamp } from './surfRiders';

const MAPS = ['bhop_emberdrift', 'surf_prismline', 'aim_ochrecut', 'surf_lumen', 'surf_cascade', 'surf_vanta'] as const;
// the standing hull the game spawns and moves (cs2's 72 u)
const CAPSULE = new MovementController().capsule;
const DT = 1 / 128;
const MB = 1024 * 1024;

/** the real movement code at the speed you run with the knife, what you hold outside combat */
function knifeRunner(): MovementController {
  const player = new MovementController();
  player.setMaxSpeedCap(weaponMaxSpeed('knife'));
  return player;
}

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
    const files = ['scene.glb', 'collision.glb', 'lightmap.ktx2', 'thumbnail.webp'];
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
  it('bhop and surf maps carry their community air acceleration, the arena none', () => {
    // autobhop bhop servers run 1000 and surf servers 150, see docs/movement-cs2.md
    expect((readMeta('bhop_emberdrift').cvars as Record<string, number>).sv_airaccelerate).toBe(1000);
    for (const id of ['surf_prismline', 'surf_lumen', 'surf_cascade', 'surf_vanta']) {
      expect((readMeta(id).cvars as Record<string, number>).sv_airaccelerate, id).toBe(150);
    }
    expect(readMeta('aim_ochrecut').cvars).toBeUndefined();
  });
});

describe('map manifest', () => {
  const manifest = JSON.parse(readFileSync(`${ROOT}/public/maps/manifest.json`, 'utf8')) as MapManifest;
  const MODES = ['surf', 'combat'];
  const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];

  it('sets modes on every map and matches each meta', () => {
    expect(manifest.maps.length).toBeGreaterThan(0);
    for (const entry of manifest.maps) {
      expect(entry.modes?.length ?? 0, `${entry.id} has modes`).toBeGreaterThan(0);
      expect(new Set(entry.modes).size, `${entry.id} lists a mode once`).toBe(entry.modes!.length);
      for (const mode of entry.modes!) {
        expect(MODES, `${entry.id} mode ${mode}`).toContain(mode);
      }
      if (entry.difficulty !== undefined) {
        expect(DIFFICULTIES).toContain(entry.difficulty);
      }
      const meta = JSON.parse(readFileSync(`${ROOT}/public${entry.metaPath}`, 'utf8')) as MapMeta;
      expect(meta.id).toBe(entry.id);
      if (meta.modes) expect(meta.modes, `${entry.id} meta modes`).toEqual(entry.modes);
      expect(meta.difficulty, `${entry.id} meta difficulty`).toBe(entry.difficulty);
    }
  });

  it('lists the built maps with files that exist', () => {
    for (const id of MAPS) {
      const entry = manifest.maps.find((m) => m.id === id);
      expect(entry, `${id} in the manifest`).toBeDefined();
      for (const p of [entry!.scenePath, entry!.collisionPath!, entry!.metaPath, entry!.thumbnailPath!]) {
        expect(existsSync(`${ROOT}/public${p}`), `${p} exists`).toBe(true);
      }
    }
    const modes = (id: string) => manifest.maps.find((m) => m.id === id)!.modes;
    expect(modes('surf_lumen')).toEqual(['surf']);
    expect(modes('surf_cascade')).toEqual(['surf']);
    expect(modes('surf_vanta')).toEqual(['surf', 'combat']);
    expect(modes('aim_ochrecut')).toEqual(['combat']);
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
    const player = knifeRunner();
    player.applyMapCvars(meta.cvars);
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

interface SurfSpec {
  stages: [number, number];
  /** distinct ramps (a fork counts as two) */
  ramps?: [number, number];
  angle: [number, number];
  length: [number, number];
  height: [number, number];
}

const SURF: Record<string, SurfSpec> = {
  surf_prismline: { stages: [3, 4], angle: [55, 62], length: [30, 120], height: [10, 20] },
  surf_lumen: { stages: [1, 1], ramps: [5, 7], angle: [50, 56], length: [30, 120], height: [10, 24] },
  surf_cascade: { stages: [5, 6], angle: [55, 60], length: [30, 120], height: [10, 20] },
  surf_vanta: { stages: [3, 4], angle: [58, 64], length: [30, 120], height: [10, 22] },
};
const SURF_MAPS = Object.keys(SURF);
const NEW_SURF_MAPS = ['surf_lumen', 'surf_cascade', 'surf_vanta'];

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

describe.each(SURF_MAPS)('%s ramps', (id) => {
  const spec = SURF[id];
  const meta = readMeta(id);
  const layout = readLayout<SurfLayout>(id);

  it('has its stages with start, checkpoints, a teleport under each stage and a finish', () => {
    expect(layout.stages.length).toBeGreaterThanOrEqual(spec.stages[0]);
    expect(layout.stages.length).toBeLessThanOrEqual(spec.stages[1]);
    const triggers = meta.triggers ?? [];
    const start = triggers.filter((t) => t.type === 'start');
    expect(start).toHaveLength(1);
    expect(triggers.filter((t) => t.type === 'finish')).toHaveLength(1);
    const checkpoints = triggers.filter((t) => t.type === 'checkpoint');
    expect(checkpoints.map((t) => t.stage)).toEqual(layout.stages.slice(1).map((s) => s.index));
    for (const t of checkpoints) {
      expect(inBox(vec(t.target!.position), t.min, t.max), `${t.id} contains its target`).toBe(true);
    }
    // the start of each stage: the spawn for the first, its checkpoint target after that
    const starts = [start[0].target!, ...checkpoints.map((t) => t.target!)];
    for (const stage of layout.stages) {
      const fall = triggers.find((t) => t.type === 'teleport' && t.stage === stage.index);
      expect(fall, `teleport under stage ${stage.index}`).toBeDefined();
      expect(fall!.target, `stage ${stage.index} teleport goes to its start`).toEqual(starts[stage.index - 1]);
    }
    const lowest = Math.min(...layout.ramps.map((r) => Math.min(...r.quad.map((q) => q[1]))), ...layout.stages.map((s) => s.landing.top));
    const voids = triggers.filter((t) => t.type === 'teleport' && t.stage === undefined);
    expect(voids.length, 'a void catch under everything').toBeGreaterThan(0);
    for (const t of voids) expect(t.max[1]).toBeLessThan(lowest - 4);
  });

  it('builds ramps in the classic surf range', () => {
    for (const r of layout.ramps) {
      expect(r.angleDeg).toBeGreaterThanOrEqual(spec.angle[0]);
      expect(r.angleDeg).toBeLessThanOrEqual(spec.angle[1]);
      expect(r.length).toBeGreaterThanOrEqual(spec.length[0]);
      expect(r.length).toBeLessThanOrEqual(spec.length[1]);
      expect(r.height).toBeGreaterThanOrEqual(spec.height[0]);
      expect(r.height).toBeLessThanOrEqual(spec.height[1]);
    }
    if (spec.ramps) {
      const prisms = layout.ramps.filter((r) => r.side === 'right').length;
      expect(prisms).toBeGreaterThanOrEqual(spec.ramps[0]);
      expect(prisms).toBeLessThanOrEqual(spec.ramps[1]);
    }
  });

  it('keeps every ramp face one planar quad in the collision mesh', { timeout: 30000 }, async () => {
    const tris = trianglesOf((await loadCollisionWorld(id)).root);
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
    const scene = await loadGlbScene(mapFile(id, 'scene.glb'));
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
    const w = world(id);
    const ramp = layout.ramps[0];
    const { rs, re, fs, normal } = facePlane(ramp);
    const f = vec(ramp.forward).normalize();
    const start = rs.clone().lerp(re, 0.1).add(fs.clone().sub(rs).multiplyScalar(0.15)).addScaledVector(normal, 0.3);
    const player = knifeRunner();
    player.applyMapCvars(meta.cvars);
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
    const w = world(id);
    for (const stage of layout.stages) {
      for (const side of ['left', 'right'] as const) {
        for (const [depthFrac, speed] of [[0.25, 12], [0.5, 18], [0.75, 26]]) {
          expect(rideStage(w, layout, stage.index, side, depthFrac, speed), `stage ${stage.index} ${side} ${speed} m/s`).toBe(true);
        }
      }
    }
  }, 240000);
});

describe.each(NEW_SURF_MAPS)('%s full run', (id) => {
  const meta = readMeta(id);
  const layout = readLayout<SurfLayout>(id);

  it('tags its modes, difficulty and par time', () => {
    expect(meta.modes).toContain('surf');
    expect(['beginner', 'intermediate', 'advanced']).toContain(meta.difficulty);
    expect(meta.parTimeMs).toBeGreaterThan(10000);
    expect(Number.isInteger(meta.parTimeMs)).toBe(true);
  });

  it('rides from the spawn through every checkpoint to the finish with the real movement code', () => {
    const w = world(id);
    const times: number[] = [];
    for (const side of ['left', 'right'] as const) {
      for (const entryOffset of [2, 3]) {
        const run = fullRun(w, meta, layout, { side, entryOffset });
        const label = `${side} rider, gate offset ${entryOffset} m`;
        expect(run.teleports, `${label}: ${run.reason}`).toEqual([]);
        expect(run.finished, `${label}: ${run.reason}`).toBe(true);
        expect(run.checkpoints, label).toEqual(layout.stages.slice(1).map((s) => s.index));
        times.push(run.timeMs);
      }
    }
    // parTimeMs is the fastest of these runs, rounded
    const fastest = Math.min(...times);
    expect(Math.abs(fastest - meta.parTimeMs!), `fastest run ${fastest.toFixed(0)} ms`).toBeLessThan(meta.parTimeMs! * 0.1);
  }, 240000);
});

// ---------------------------------------------------------------------------
// vanta combat deck

interface ArenaLayout {
  origin: [number, number, number];
  forward: [number, number, number];
  right: [number, number, number];
  halfLat: number;
  halfFwd: number;
  wallThickness: number;
  spawns: { a: number[]; b: number[] };
}

describe('surf_vanta combat deck', () => {
  const meta = readMeta('surf_vanta') as MapMeta;
  const arena = readLayout<SurfLayout & { arena: ArenaLayout }>('surf_vanta').arena;
  const origin = vec(arena.origin);
  const fwd = vec(arena.forward).normalize();
  const right = vec(arena.right).normalize();
  const local = (p: Vector3) => {
    const rel = p.clone().sub(origin);
    return { x: rel.dot(right), y: rel.dot(fwd) };
  };

  it('is tagged for surf and combat', () => {
    expect(meta.modes).toEqual(['surf', 'combat']);
    expect(meta.difficulty).toBe('advanced');
  });

  it('has a flat, mostly open floor of at least 50 x 40 m', () => {
    const w = world('surf_vanta');
    expect(arena.halfLat * 2).toBeGreaterThanOrEqual(50);
    expect(arena.halfFwd * 2).toBeGreaterThanOrEqual(40);
    const inset = arena.wallThickness + 0.5;
    let samples = 0;
    let open = 0;
    for (let x = -arena.halfLat + inset; x <= arena.halfLat - inset; x += 2) {
      for (let y = -arena.halfFwd + inset; y <= arena.halfFwd - inset; y += 2) {
        // from above the corner light masts, the tallest things on the deck
        const top = origin.clone().addScaledVector(right, x).addScaledVector(fwd, y).add(new Vector3(0, 12, 0));
        const hit = w.raycastGeometry(top, new Vector3(0, -1, 0), 16);
        samples += 1;
        expect(hit, `deck under ${x}, ${y}`).not.toBeNull();
        // floor and cover tops are all flat, no slopes on the deck
        expect(hit!.normal.y, `flat at ${x}, ${y}`).toBeGreaterThan(0.999);
        if (Math.abs(hit!.point.y - origin.y) < 0.02) open += 1;
      }
    }
    expect(open / samples).toBeGreaterThan(0.85);
    expect(open * 4, 'open floor in m2').toBeGreaterThan(1800);
  });

  it('has four or more grounded spawns per side, facing the other side', () => {
    const w = world('surf_vanta');
    for (const [side, other] of [['a', 'b'], ['b', 'a']] as const) {
      const own = arena.spawns[side].map((i) => meta.spawns![i]);
      expect(own.length).toBeGreaterThanOrEqual(4);
      const otherCenter = arena.spawns[other].map((i) => vec(meta.spawns![i].position))
        .reduce((acc, p) => acc.add(p), new Vector3()).multiplyScalar(1 / arena.spawns[other].length);
      for (const s of own) {
        expect(s.side).toBe(side);
        const p = vec(s.position);
        const { x, y } = local(p);
        expect(Math.abs(x)).toBeLessThan(arena.halfLat - arena.wallThickness);
        expect(Math.abs(y)).toBeLessThan(arena.halfFwd - arena.wallThickness);
        expectGrounded(w, p, `${side} spawn`);
        const yaw = ((s.yawDeg ?? 0) * Math.PI) / 180;
        const facing = new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
        const toOther = otherCenter.clone().sub(p).setY(0).normalize();
        expect(facing.dot(toOther), `${side} spawn faces side ${other}`).toBeGreaterThan(0.5);
      }
    }
    // runs start on the pad (side a), bots stage across the deck on side b
    const run = meta.spawns![0];
    const start = meta.triggers!.find((t) => t.type === 'start')!;
    expect(inBox(vec(run.position), start.min, start.max)).toBe(true);
    expect(run.side).toBe('a');
    const anchor = resolveBotAnchor(meta)!;
    const b0 = meta.spawns![arena.spawns.b[0]];
    expect(anchor.position.distanceTo(vec(b0.position))).toBeLessThan(1e-6);
  });

  it('lets a player walk from the run spawn through the doorway onto the deck', () => {
    const w = world('surf_vanta');
    const spawn = meta.spawns![0];
    const goal = origin.clone().addScaledVector(fwd, arena.halfFwd * 0.5);
    const player = new MovementController();
    player.applyMapCvars(meta.cvars);
    player.reset(vec(spawn.position), spawn.yawDeg ?? 0);
    let reached = false;
    for (let t = 0; t < 128 * 6 && !reached; t += 1) {
      const to = goal.clone().sub(player.getFeetPosition()).setY(0);
      player.setView(Math.atan2(-to.x, -to.z), 0);
      player.tick(DT, { forwardMove: 1, sideMove: 0, jumpPressed: false, jumpHeld: false }, w);
      reached = to.length() < 1.5 && player.getDebugState().grounded;
    }
    expect(reached).toBe(true);
    expect(Math.abs(player.getFeetPosition().y - origin.y)).toBeLessThan(0.1);
  });
});

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
