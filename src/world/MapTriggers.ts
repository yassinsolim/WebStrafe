import type { MapTrigger, MapTriggerType } from './types';

export type Vec3Tuple = [number, number, number];

export interface TriggerRespawn {
  position: Vec3Tuple;
  yawDeg: number;
}

export type MapTriggerEvent =
  | { type: 'start'; trigger: MapTrigger }
  | { type: 'checkpoint'; trigger: MapTrigger; stage: number; changed: boolean; respawn: TriggerRespawn }
  | { type: 'finish'; trigger: MapTrigger }
  | { type: 'teleport'; trigger: MapTrigger; respawn: TriggerRespawn };

export interface MapTriggerUpdate {
  /** enter events from this step, teleports last since they move the player */
  events: MapTriggerEvent[];
  /** true while the feet are inside any start volume (the run timer holds at zero) */
  inStartZone: boolean;
}

interface Volume {
  trigger: MapTrigger;
  min: Vec3Tuple;
  max: Vec3Tuple;
}

const TYPES: readonly MapTriggerType[] = ['start', 'checkpoint', 'teleport', 'finish'];
const EVENT_ORDER: Record<MapTriggerType, number> = { start: 0, checkpoint: 1, finish: 2, teleport: 3 };

function isVec3(value: unknown): value is Vec3Tuple {
  return Array.isArray(value)
    && value.length === 3
    && value.every((v) => typeof v === 'number' && Number.isFinite(v));
}

/** drops malformed entries so a bad meta.json can't break the game loop */
export function sanitizeTriggers(triggers: readonly unknown[] | undefined): MapTrigger[] {
  if (!Array.isArray(triggers)) {
    return [];
  }
  const out: MapTrigger[] = [];
  for (const raw of triggers) {
    const t = raw as Partial<MapTrigger> | null;
    if (!t || typeof t.id !== 'string' || !TYPES.includes(t.type as MapTriggerType)) {
      continue;
    }
    if (!isVec3(t.min) || !isVec3(t.max)) {
      continue;
    }
    const target = t.target && isVec3(t.target.position)
      ? {
          position: [...t.target.position] as Vec3Tuple,
          yawDeg: typeof t.target.yawDeg === 'number' && Number.isFinite(t.target.yawDeg) ? t.target.yawDeg : 0,
        }
      : undefined;
    out.push({
      id: t.id,
      type: t.type as MapTriggerType,
      min: [...t.min] as Vec3Tuple,
      max: [...t.max] as Vec3Tuple,
      target,
      stage: typeof t.stage === 'number' && Number.isFinite(t.stage) ? t.stage : undefined,
    });
  }
  return out;
}

/**
 * axis aligned trigger volumes from meta.json, checked against the player's feet
 * once per fixed tick. pure logic, the caller moves the player and runs the
 * timer from the events.
 *
 * - start: holds the run at zero while inside, resets the checkpoint to its target (or the spawn)
 * - checkpoint: stores its target (or the entry point) as the respawn
 * - teleport: sends the player to its target, or the last checkpoint
 * - finish: completes the run
 *
 * events fire on entry only, so standing in a volume never repeats them.
 */
export class MapTriggers {
  private readonly volumes: Volume[];
  private readonly inside = new Set<string>();
  private spawn: TriggerRespawn;
  private respawn: TriggerRespawn;
  private stage = 0;

  constructor(triggers: readonly unknown[] | undefined, spawn: TriggerRespawn) {
    this.volumes = sanitizeTriggers(triggers).map((trigger) => ({
      trigger,
      min: [
        Math.min(trigger.min[0], trigger.max[0]),
        Math.min(trigger.min[1], trigger.max[1]),
        Math.min(trigger.min[2], trigger.max[2]),
      ],
      max: [
        Math.max(trigger.min[0], trigger.max[0]),
        Math.max(trigger.min[1], trigger.max[1]),
        Math.max(trigger.min[2], trigger.max[2]),
      ],
    }));
    this.spawn = cloneRespawn(spawn);
    this.respawn = cloneRespawn(spawn);
  }

  public hasTriggers(): boolean {
    return this.volumes.length > 0;
  }

  public hasFinish(): boolean {
    return this.volumes.some((v) => v.trigger.type === 'finish');
  }

  public count(type: MapTriggerType): number {
    return this.volumes.filter((v) => v.trigger.type === type).length;
  }

  /** where a fall or a teleport without a target sends the player */
  public getRespawn(): TriggerRespawn {
    return cloneRespawn(this.respawn);
  }

  public getStage(): number {
    return this.stage;
  }

  /** back to the spawn: forget the checkpoint and which volumes we were in */
  public reset(spawn?: TriggerRespawn): void {
    if (spawn) {
      this.spawn = cloneRespawn(spawn);
    }
    this.respawn = cloneRespawn(this.spawn);
    this.stage = 0;
    this.inside.clear();
  }

  public update(feet: { x: number; y: number; z: number }): MapTriggerUpdate {
    const events: MapTriggerEvent[] = [];
    let inStartZone = false;
    for (const volume of this.volumes) {
      const id = volume.trigger.id;
      const contains = feet.x >= volume.min[0] && feet.x <= volume.max[0]
        && feet.y >= volume.min[1] && feet.y <= volume.max[1]
        && feet.z >= volume.min[2] && feet.z <= volume.max[2];
      if (!contains) {
        this.inside.delete(id);
        continue;
      }
      if (volume.trigger.type === 'start') {
        inStartZone = true;
      }
      if (this.inside.has(id)) {
        continue;
      }
      this.inside.add(id);
      const event = this.enter(volume.trigger, feet);
      if (event) {
        events.push(event);
      }
    }
    events.sort((a, b) => EVENT_ORDER[a.type] - EVENT_ORDER[b.type]);
    return { events, inStartZone };
  }

  private enter(trigger: MapTrigger, feet: { x: number; y: number; z: number }): MapTriggerEvent | null {
    switch (trigger.type) {
      case 'start':
        this.respawn = trigger.target ? cloneRespawn(trigger.target) : cloneRespawn(this.spawn);
        this.stage = 0;
        return { type: 'start', trigger };
      case 'checkpoint': {
        const stage = trigger.stage ?? this.stage + 1;
        const next = trigger.target
          ? cloneRespawn(trigger.target)
          : { position: [feet.x, feet.y, feet.z] as Vec3Tuple, yawDeg: this.respawn.yawDeg };
        const changed = stage !== this.stage || !sameRespawn(next, this.respawn);
        this.respawn = next;
        this.stage = stage;
        return { type: 'checkpoint', trigger, stage, changed, respawn: cloneRespawn(next) };
      }
      case 'finish':
        return { type: 'finish', trigger };
      case 'teleport':
        return {
          type: 'teleport',
          trigger,
          respawn: trigger.target ? cloneRespawn(trigger.target) : cloneRespawn(this.respawn),
        };
      default:
        return null;
    }
  }
}

function cloneRespawn(r: { position: Vec3Tuple | readonly number[]; yawDeg?: number }): TriggerRespawn {
  return {
    position: [r.position[0], r.position[1], r.position[2]],
    yawDeg: r.yawDeg ?? 0,
  };
}

function sameRespawn(a: TriggerRespawn, b: TriggerRespawn): boolean {
  return a.yawDeg === b.yawDeg
    && a.position[0] === b.position[0]
    && a.position[1] === b.position[1]
    && a.position[2] === b.position[2];
}
