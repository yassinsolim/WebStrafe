import { describe, expect, it } from 'vitest';
import { resolveRunGoal } from '../RunGoal';
import type { MapMeta } from '../types';

const baseMeta: MapMeta = {
  id: 'test',
  name: 'Test',
  author: 'WebStrafe',
  source: 'local',
  license: 'test',
};

describe('resolveRunGoal', () => {
  it('keeps maps without an authored finish open-ended', () => {
    expect(resolveRunGoal(baseMeta)).toBeNull();
  });

  it('resolves and clamps an authored finish pad', () => {
    const goal = resolveRunGoal({
      ...baseMeta,
      goalPad: { center: [4, -2, 8], radius: 0.1, tolerance: 0.1 },
    });
    expect(goal?.center.toArray()).toEqual([4, -2, 8]);
    expect(goal?.radius).toBe(0.25);
    expect(goal?.tolerance).toBe(0.2);
  });
});
