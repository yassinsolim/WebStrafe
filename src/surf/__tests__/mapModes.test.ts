import { describe, expect, it } from 'vitest';
import { botsFor, checkpointStages, hasTimedZones, mapModes, pvpRuleFor } from '../mapModes';
import type { MapTrigger } from '../../world/types';

const box = { min: [0, 0, 0] as [number, number, number], max: [1, 1, 1] as [number, number, number] };

describe('map modes', () => {
  it('reads meta modes and falls back to the id prefix', () => {
    expect(mapModes({ id: 'surf_vanta', modes: ['surf', 'combat'] })).toEqual(['surf', 'combat']);
    expect(mapModes({ id: 'surf_prismline' })).toEqual(['surf']);
    expect(mapModes({ id: 'bhop_emberdrift' })).toEqual(['surf']);
    expect(mapModes({ id: 'aim_ochrecut' })).toEqual(['combat']);
    expect(mapModes({ id: 'surf_x', modes: ['bogus'] })).toEqual(['surf']);
  });

  it('timed maps start peaceful with a toggle, combat maps force pvp', () => {
    expect(pvpRuleFor(['surf'])).toEqual({ defaultOn: false, toggleable: true });
    expect(pvpRuleFor(['surf', 'combat'])).toEqual({ defaultOn: false, toggleable: true });
    expect(pvpRuleFor(['combat'])).toEqual({ defaultOn: true, toggleable: false });
  });

  it('host bots only on maps tagged for combat', () => {
    expect(botsFor(['surf'])).toBe(0);
    expect(botsFor(['surf', 'combat'])).toBe(1);
    expect(botsFor(['combat'])).toBe(1);
  });

  it('lists checkpoint stages once each, in order', () => {
    const triggers: MapTrigger[] = [
      { id: 'start', type: 'start', ...box },
      { id: 'c3', type: 'checkpoint', stage: 3, ...box },
      { id: 'c2', type: 'checkpoint', stage: 2, ...box },
      { id: 'c2b', type: 'checkpoint', stage: 2, ...box },
      { id: 'fall', type: 'teleport', stage: 2, ...box },
      { id: 'finish', type: 'finish', ...box },
    ];
    expect(checkpointStages(triggers)).toEqual([2, 3]);
    expect(hasTimedZones(triggers)).toBe(true);
    expect(hasTimedZones(triggers.filter((t) => t.type !== 'finish'))).toBe(false);
  });
});
