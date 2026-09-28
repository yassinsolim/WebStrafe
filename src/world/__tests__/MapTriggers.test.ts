import { describe, expect, it } from 'vitest';
import { MapTriggers, sanitizeTriggers, type TriggerRespawn } from '../MapTriggers';
import type { MapTrigger } from '../types';

const SPAWN: TriggerRespawn = { position: [0, 0, 0], yawDeg: 0 };

const TRIGGERS: MapTrigger[] = [
  { id: 'start', type: 'start', min: [-5, -1, -5], max: [5, 3, 5] },
  {
    id: 'cp1',
    type: 'checkpoint',
    stage: 1,
    min: [-2, -1, -32],
    max: [2, 3, -28],
    target: { position: [0, 0, -30], yawDeg: 90 },
  },
  { id: 'lava', type: 'teleport', min: [-100, -60, -100], max: [100, -10, 100] },
  {
    id: 'shortcut_catch',
    type: 'teleport',
    min: [40, -5, -5],
    max: [50, 5, 5],
    target: { position: [0, 0, -30], yawDeg: 180 },
  },
  { id: 'finish', type: 'finish', min: [-3, -1, -63], max: [3, 3, -57] },
];

function at(x: number, y: number, z: number) {
  return { x, y, z };
}

describe('MapTriggers', () => {
  it('holds the start zone while inside and fires start once on entry', () => {
    const triggers = new MapTriggers(TRIGGERS, SPAWN);
    const first = triggers.update(at(0, 0, 0));
    expect(first.inStartZone).toBe(true);
    expect(first.events.map((e) => e.type)).toEqual(['start']);
    const second = triggers.update(at(1, 0, 1));
    expect(second.inStartZone).toBe(true);
    expect(second.events).toHaveLength(0);
    const outside = triggers.update(at(0, 0, -10));
    expect(outside.inStartZone).toBe(false);
  });

  it('stores the checkpoint target as the respawn and reports stage changes once', () => {
    const triggers = new MapTriggers(TRIGGERS, SPAWN);
    triggers.update(at(0, 0, 0));
    const hit = triggers.update(at(0, 0.5, -30));
    expect(hit.events).toHaveLength(1);
    const event = hit.events[0];
    expect(event.type).toBe('checkpoint');
    if (event.type === 'checkpoint') {
      expect(event.stage).toBe(1);
      expect(event.changed).toBe(true);
      expect(event.respawn).toEqual({ position: [0, 0, -30], yawDeg: 90 });
    }
    expect(triggers.getStage()).toBe(1);
    expect(triggers.getRespawn()).toEqual({ position: [0, 0, -30], yawDeg: 90 });
    // leaving and coming back re-enters the volume but the checkpoint did not change
    triggers.update(at(0, 0, -40));
    const again = triggers.update(at(0, 0, -30));
    expect(again.events[0].type).toBe('checkpoint');
    if (again.events[0].type === 'checkpoint') {
      expect(again.events[0].changed).toBe(false);
    }
  });

  it('teleports to the last checkpoint when the volume has no target', () => {
    const triggers = new MapTriggers(TRIGGERS, SPAWN);
    triggers.update(at(0, 0, -30));
    const fall = triggers.update(at(10, -20, -45));
    expect(fall.events).toHaveLength(1);
    expect(fall.events[0]).toMatchObject({ type: 'teleport', respawn: { position: [0, 0, -30], yawDeg: 90 } });
  });

  it('teleports to the spawn before any checkpoint and to explicit targets', () => {
    const triggers = new MapTriggers(TRIGGERS, SPAWN);
    const fall = triggers.update(at(0, -30, 0));
    expect(fall.events[0]).toMatchObject({ type: 'teleport', respawn: SPAWN });
    const catchVolume = triggers.update(at(45, 0, 0));
    expect(catchVolume.events[0]).toMatchObject({ type: 'teleport', respawn: { position: [0, 0, -30], yawDeg: 180 } });
  });

  it('fires teleport once per entry, not every tick inside the volume', () => {
    const triggers = new MapTriggers(TRIGGERS, SPAWN);
    expect(triggers.update(at(0, -30, 0)).events).toHaveLength(1);
    expect(triggers.update(at(0, -31, 0)).events).toHaveLength(0);
  });

  it('reports the finish and orders teleports after other events', () => {
    const overlapping: MapTrigger[] = [
      { id: 'tp', type: 'teleport', min: [-1, -1, -1], max: [1, 1, 1] },
      { id: 'finish', type: 'finish', min: [-1, -1, -1], max: [1, 1, 1] },
    ];
    const triggers = new MapTriggers(overlapping, SPAWN);
    expect(triggers.hasFinish()).toBe(true);
    expect(triggers.update(at(0, 0, 0)).events.map((e) => e.type)).toEqual(['finish', 'teleport']);
  });

  it('start re-arms the checkpoint back to the start target', () => {
    const withTarget: MapTrigger[] = [
      { ...TRIGGERS[0], target: { position: [0, 0, 2], yawDeg: 45 } },
      TRIGGERS[1],
    ];
    const triggers = new MapTriggers(withTarget, SPAWN);
    triggers.update(at(0, 0, -30));
    expect(triggers.getStage()).toBe(1);
    triggers.update(at(0, 0, 0));
    expect(triggers.getStage()).toBe(0);
    expect(triggers.getRespawn()).toEqual({ position: [0, 0, 2], yawDeg: 45 });
  });

  it('reset clears the checkpoint and lets volumes fire again', () => {
    const triggers = new MapTriggers(TRIGGERS, SPAWN);
    triggers.update(at(0, 0, -30));
    triggers.reset();
    expect(triggers.getRespawn()).toEqual(SPAWN);
    expect(triggers.update(at(0, 0, -30)).events[0].type).toBe('checkpoint');
  });

  it('uses the entry point when a checkpoint has no target', () => {
    const triggers = new MapTriggers([{ id: 'cp', type: 'checkpoint', min: [0, 0, 0], max: [4, 4, 4] }], SPAWN);
    triggers.update(at(1, 0.5, 2));
    expect(triggers.getRespawn().position).toEqual([1, 0.5, 2]);
    expect(triggers.getStage()).toBe(1);
  });

  it('accepts min and max in either order', () => {
    const triggers = new MapTriggers([{ id: 'f', type: 'finish', min: [4, 4, 4], max: [0, 0, 0] }], SPAWN);
    expect(triggers.update(at(2, 2, 2)).events[0].type).toBe('finish');
  });

  it('drops malformed triggers instead of throwing', () => {
    const cleaned = sanitizeTriggers([
      null,
      { id: 'x', type: 'warp', min: [0, 0, 0], max: [1, 1, 1] },
      { id: 'y', type: 'finish', min: [0, 0], max: [1, 1, 1] },
      { id: 'z', type: 'finish', min: [0, Number.NaN, 0], max: [1, 1, 1] },
      { id: 'ok', type: 'teleport', min: [0, 0, 0], max: [1, 1, 1], target: { position: [1, 2] } },
    ]);
    expect(cleaned.map((t) => t.id)).toEqual(['ok']);
    expect(cleaned[0].target).toBeUndefined();
    expect(new MapTriggers(undefined, SPAWN).hasTriggers()).toBe(false);
  });
});
