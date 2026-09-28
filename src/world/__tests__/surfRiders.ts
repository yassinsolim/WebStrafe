import { Vector3 } from 'three';
import { MovementController } from '../../movement/MovementController';
import type { CollisionWorld } from '../CollisionWorld';
import { MapTriggers } from '../MapTriggers';
import type { MapMeta } from '../types';
import { vec } from './mapTestUtils';

// headless surf riders for the built surf maps. they only use the real
// MovementController with keyboard-style input (a strafe key into the ramp, W on
// the platforms), so a map that passes these is rideable in game.

export const DT = 1 / 128;

export interface SurfRamp {
  stage: number;
  index: number;
  side: 'left' | 'right';
  angleDeg: number;
  length: number;
  height: number;
  s0: number;
  s1: number;
  lateral: number;
  halfWidth?: number;
  ridgeStart: number;
  ridgeEnd: number;
  forward: [number, number, number];
  quad: Array<[number, number, number]>;
  /** the two halves of a fork (a transfer around a valley) */
  branch?: 'left' | 'right';
}

export interface SurfStage {
  index: number;
  origin: [number, number, number];
  forward: [number, number, number];
  right: [number, number, number];
  landing: { s0: number; s1: number; top: number; halfLat?: number };
  /** start platform half sizes in the stage frame (newer maps only) */
  platform?: { halfLat: number; halfFwd: number };
  gate?: { fwd: number; halfWidth: number };
}

export interface SurfLayout {
  stages: SurfStage[];
  ramps: SurfRamp[];
}

function yawFor(dir: Vector3): number {
  return Math.atan2(-dir.x, -dir.z);
}

/** the ramp under a rider at (s, lat) of a stage frame: the one whose ridge is closest sideways */
function pickRamp(ramps: SurfRamp[], s: number, lat: number): number {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < ramps.length; i += 1) {
    const r = ramps[i];
    if (s < r.s0 - 0.5 || s > r.s1) continue;
    const d = Math.abs(lat - r.lateral);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/**
 * holds a line on the face under the rider: pushes into the face only as much as
 * it needs to keep drifting down slowly towards `target` metres under the ridge,
 * lets go between ramps. returns the strafe input, 0 when no ramp is under it.
 */
class LineHolder {
  private current = -1;
  private target: number;

  constructor(private readonly ramps: SurfRamp[], initialTarget: number, private readonly depthRange: [number, number] = [0.25, 0.6]) {
    this.target = initialTarget;
  }

  push(player: MovementController, origin: Vector3, fwd: Vector3, right: Vector3): number {
    const feet = player.getFeetPosition();
    const rel = feet.clone().sub(origin);
    const s = rel.dot(fwd);
    const lat = rel.dot(right);
    const idx = pickRamp(this.ramps, s, lat);
    if (idx < 0) return 0;
    const r = this.ramps[idx];
    const ridge = r.ridgeStart + (r.ridgeEnd - r.ridgeStart) * ((s - r.s0) / r.length);
    const depth = ridge - feet.y;
    const onRight = lat - r.lateral > 0;
    if (idx !== this.current && player.getDebugState().surfing) {
      this.current = idx;
      this.target = Math.min(r.height * this.depthRange[1], Math.max(depth, r.height * this.depthRange[0]));
    }
    const a = (r.angleDeg * Math.PI) / 180;
    const up = right.clone().multiplyScalar((onRight ? -1 : 1) * Math.cos(a)).add(new Vector3(0, Math.sin(a), 0));
    const wantUp = -0.8 + 0.5 * (depth - this.target);
    return Math.min(1, Math.max(0, 0.6 * (wantUp - player.getVelocity().dot(up)))) * (onRight ? -1 : 1);
  }
}

function stageRamps(layout: SurfLayout, stageIndex: number, side: 'left' | 'right'): SurfRamp[] {
  return layout.ramps.filter((r) => r.stage === stageIndex && r.side === side);
}

/**
 * a surfer bot: starts on the first ramp of a stage, holds its line by pushing
 * into the face only as much as it needs (slowly drifting down for speed) and
 * lets go between ramps. true when it lands on the stage's landing platform.
 */
export function rideStage(w: CollisionWorld, layout: SurfLayout, stageIndex: number, side: 'left' | 'right', depthFrac: number, speed: number): boolean {
  const stage = layout.stages[stageIndex - 1];
  const origin = vec(stage.origin);
  const fwd = vec(stage.forward).normalize();
  const right = vec(stage.right).normalize();
  const ramps = stageRamps(layout, stageIndex, side);
  const first = ramps[0];
  const depth0 = first.height * depthFrac;
  const sign = side === 'right' ? 1 : -1;
  const start = origin.clone().addScaledVector(fwd, first.s0 + 8)
    .addScaledVector(right, first.lateral + sign * depth0 / Math.tan((first.angleDeg * Math.PI) / 180));
  start.y = first.ridgeStart + (first.ridgeEnd - first.ridgeStart) * (8 / first.length) - depth0 + 0.3;
  const player = new MovementController();
  player.setCvar('sv_airaccelerate', 100);
  player.reset(start, (yawFor(fwd) * 180) / Math.PI);
  player.setVelocity(fwd.clone().multiplyScalar(speed));
  const holder = new LineHolder(ramps, depth0);
  for (let t = 0; t < 128 * 40; t += 1) {
    const feet = player.getFeetPosition();
    const s = feet.clone().sub(origin).dot(fwd);
    const push = holder.push(player, origin, fwd, right);
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

export interface FullRunOptions {
  side: 'left' | 'right';
  /** sideways offset (m) the bot aims for when it walks out of each gate */
  entryOffset?: number;
  /** shallowest and deepest line the bot holds, as a fraction of ramp height */
  depthRange?: [number, number];
  maxSeconds?: number;
}

export interface FullRunResult {
  finished: boolean;
  /** run timer: from the last tick in the start zone to the finish, like the game */
  timeMs: number;
  stagesLanded: number;
  checkpoints: number[];
  teleports: string[];
  maxSpeed: number;
  reason: string;
}

/**
 * the whole run from spawns[0]: walks out of the start gate holding W, drops onto
 * the chosen face, rides each stage like rideStage, lands, walks to the next gate
 * and so on until the finish trigger fires. every trigger goes through the real
 * MapTriggers, a teleport ends the run as a failure.
 */
export function fullRun(w: CollisionWorld, meta: MapMeta, layout: SurfLayout, options: FullRunOptions): FullRunResult {
  const sign = options.side === 'right' ? 1 : -1;
  const entryOffset = options.entryOffset ?? 3;
  const spawn = meta.spawns![0];
  const player = new MovementController();
  player.applyMapCvars(meta.cvars);
  player.reset(vec(spawn.position), spawn.yawDeg ?? 0);
  const triggers = new MapTriggers(meta.triggers, { position: spawn.position, yawDeg: spawn.yawDeg ?? 0 });
  const result: FullRunResult = { finished: false, timeMs: 0, stagesLanded: 0, checkpoints: [], teleports: [], maxSpeed: 0, reason: 'timeout' };
  let startTick = 0;
  let k = 0;
  let phase: 'walk' | 'ride' | 'finish' = 'walk';
  let holder: LineHolder | null = null;
  const frame = (i: number) => {
    const st = layout.stages[i];
    return { st, origin: vec(st.origin), fwd: vec(st.forward).normalize(), right: vec(st.right).normalize() };
  };
  let f = frame(0);
  const maxTicks = Math.round((options.maxSeconds ?? 240) * 128);
  const lowest = Math.min(...layout.stages.map((s) => s.landing.top));
  for (let t = 0; t < maxTicks; t += 1) {
    const feet = player.getFeetPosition();
    const s = feet.clone().sub(f.origin).dot(f.fwd);
    const grounded = player.getDebugState().grounded;
    let input = { forwardMove: 0, sideMove: 0, jumpPressed: false, jumpHeld: false };
    if (phase === 'walk') {
      const hf = f.st.gate?.fwd ?? f.st.platform?.halfFwd ?? 15;
      const onPlatform = s < hf + 0.3 && feet.y > f.origin.y - 0.6;
      if (onPlatform) {
        // line up in front of the gate first, then walk out through it
        const aim = s < hf - 3 ? new Vector3(sign * entryOffset * 0.6, 0, hf - 2) : new Vector3(sign * entryOffset, 0, hf + 4);
        const goal = f.origin.clone().addScaledVector(f.right, aim.x).addScaledVector(f.fwd, aim.z);
        const to = goal.sub(feet).setY(0);
        player.setView(yawFor(to.normalize()), 0);
        input = { forwardMove: 1, sideMove: 0, jumpPressed: false, jumpHeld: false };
      } else {
        // off the edge: face down the stage and drift onto the chosen face
        player.setView(yawFor(f.fwd), 0);
        input = { forwardMove: 0, sideMove: sign, jumpPressed: false, jumpHeld: false };
        if (player.getDebugState().surfing) {
          phase = 'ride';
          holder = new LineHolder(stageRamps(layout, f.st.index, options.side), 0, options.depthRange);
        }
      }
    } else if (phase === 'ride') {
      input = { forwardMove: 0, sideMove: holder!.push(player, f.origin, f.fwd, f.right), jumpPressed: false, jumpHeld: false };
      if (s >= f.st.landing.s0 - 1 && grounded && Math.abs(feet.y - f.st.landing.top) < 1) {
        result.stagesLanded += 1;
        k += 1;
        if (k >= layout.stages.length) {
          phase = 'finish';
        } else {
          f = frame(k);
          phase = 'walk';
        }
      }
    } else {
      // on the finish platform: walk on towards its middle until the finish fires
      const st = layout.stages[layout.stages.length - 1];
      const fwd = vec(st.forward).normalize();
      const goal = vec(st.origin).addScaledVector(fwd, (st.landing.s0 + st.landing.s1) / 2);
      const to = goal.sub(feet).setY(0);
      if (to.length() > 1) player.setView(yawFor(to.normalize()), 0);
      input = { forwardMove: to.length() > 1 ? 1 : 0, sideMove: 0, jumpPressed: false, jumpHeld: false };
    }
    player.tick(DT, input, w);
    const v = player.getVelocity();
    result.maxSpeed = Math.max(result.maxSpeed, Math.hypot(v.x, v.z));
    const update = triggers.update(player.getFeetPosition());
    if (update.inStartZone) startTick = t + 1;
    for (const event of update.events) {
      if (event.type === 'checkpoint') {
        result.checkpoints.push(event.stage);
      } else if (event.type === 'teleport') {
        result.teleports.push(event.trigger.id);
        result.reason = `teleported by ${event.trigger.id} in stage ${k + 1} (${phase})`;
        return result;
      } else if (event.type === 'finish') {
        result.finished = true;
        result.timeMs = (t + 1 - startTick) * DT * 1000;
        result.reason = 'finished';
        return result;
      }
    }
    if (player.getFeetPosition().y < lowest - 90) {
      result.reason = `fell out in stage ${k + 1} (${phase})`;
      return result;
    }
  }
  return result;
}
