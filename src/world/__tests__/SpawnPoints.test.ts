import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { listMetaSpawns, pickSpawnAwayFrom, resolveBotAnchor } from '../SpawnPoints';
import type { MapMeta } from '../types';

function meta(spawns: MapMeta['spawns']): MapMeta {
  return { id: 'm', name: 'm', author: 'a', source: 's', license: 'l', spawns };
}

describe('SpawnPoints', () => {
  it('lists valid spawns in meta order', () => {
    const list = listMetaSpawns(meta([
      { position: [1, 2, 3], yawDeg: 90 },
      { position: [4, 5, Number.NaN] },
      { position: [7, 8, 9] },
    ]));
    expect(list.map((s) => s.position.toArray())).toEqual([[1, 2, 3], [7, 8, 9]]);
    expect(list[1].yawDeg).toBe(0);
  });

  it('anchors bots on the first spawn of the other side', () => {
    const anchor = resolveBotAnchor(meta([
      { position: [0, 0, 50], side: 'a' },
      { position: [5, 0, 50], side: 'a' },
      { position: [0, 0, -50], yawDeg: 180, side: 'b' },
    ]));
    expect(anchor?.position.toArray()).toEqual([0, 0, -50]);
    expect(anchor?.yawDeg).toBe(180);
  });

  it('falls back to spawns[0] when spawns have no sides', () => {
    expect(resolveBotAnchor(meta([{ position: [3, 0, 3] }]))?.position.toArray()).toEqual([3, 0, 3]);
    expect(resolveBotAnchor(meta([]))).toBeNull();
  });

  it('picks the spawn furthest from living enemies', () => {
    const spawns = [
      { position: new Vector3(0, 0, 0), yawDeg: 0 },
      { position: new Vector3(0, 0, 100), yawDeg: 180 },
    ];
    const threats = [
      { position: [0, 0, 5] as [number, number, number], alive: true },
      { position: [0, 0, 99] as [number, number, number], alive: false },
    ];
    expect(pickSpawnAwayFrom(spawns, threats, () => 0.99)).toBe(spawns[1]);
  });

  it('randomises among spawns that are nearly as safe', () => {
    const spawns = [
      { position: new Vector3(-50, 0, 0), yawDeg: 0 },
      { position: new Vector3(50, 0, 0), yawDeg: 0 },
      { position: new Vector3(0, 0, 1), yawDeg: 0 },
    ];
    const threats = [{ position: new Vector3(0, 0, 0) }];
    expect(pickSpawnAwayFrom(spawns, threats, () => 0)).toBe(spawns[0]);
    expect(pickSpawnAwayFrom(spawns, threats, () => 0.99)).toBe(spawns[1]);
    expect(pickSpawnAwayFrom([], threats)).toBeNull();
  });
});
