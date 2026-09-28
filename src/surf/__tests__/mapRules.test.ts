import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RULES_MIGRATION, collectRules, renderMigration, ruleForMeta } from '../../../tools/surf/mapRules';

describe('surf map rules', () => {
  it('the seed migration matches the maps (run npx tsx tools/surf/mapRules.ts)', () => {
    expect(readFileSync(RULES_MIGRATION, 'utf8')).toBe(renderMigration(collectRules()));
  });

  it('every timed map gets a positive minimum per stage', () => {
    for (const rule of collectRules()) {
      expect(rule.minStageMs).toHaveLength(rule.stages.length + 1);
      expect(rule.minStageMs.every((ms) => ms >= 0)).toBe(true);
      expect(rule.minTimeMs).toBeGreaterThanOrEqual(1000);
    }
  });

  it('uses the par time as a floor and skips maps without zones', () => {
    const box = (x: number) => ({ min: [x, 0, 0] as [number, number, number], max: [x + 1, 1, 1] as [number, number, number] });
    const rule = ruleForMeta({
      id: 'surf_x',
      parTimeMs: 60_000,
      triggers: [
        { id: 's', type: 'start', ...box(0) },
        { id: 'f', type: 'finish', ...box(91) },
      ],
    })!;
    expect(rule.minStageMs).toEqual([1000]);
    expect(rule.minTimeMs).toBe(27_000);
    expect(ruleForMeta({ id: 'aim_x', triggers: [] })).toBeNull();
  });
});
