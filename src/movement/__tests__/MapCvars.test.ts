import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { MovementController } from '../MovementController';
import { defaultCvars, sanitizeMapCvars } from '../cvars';
import type { SourceCvars } from '../types';
import { emptyWorld, horizontalSpeed } from './testWorlds';

// map json is untrusted, so the tests feed it in the shape JSON.parse would produce
const fromJson = (json: string) => JSON.parse(json) as Partial<SourceCvars>;

describe('per-map cvars', () => {
  it('defaults to airaccelerate 150 with the 30 u/s air cap and autobhop on', () => {
    expect(defaultCvars.sv_airaccelerate).toBe(150);
    expect(defaultCvars.sv_air_max_wishspeed).toBeCloseTo(30 * 0.0254, 12);
    expect(defaultCvars.sv_autobhop_enabled).toBe(true);
  });

  it('resets everything to defaults before applying the map overrides', () => {
    const mc = new MovementController();
    mc.setCvars({ sv_gravity: 5, sv_airaccelerate: 12, sv_autobhop_enabled: false });
    const result = mc.applyMapCvars(fromJson('{"sv_airaccelerate": 100}'));
    expect(result).toEqual({ applied: { sv_airaccelerate: 100 }, rejected: [] });
    expect(mc.getCvars()).toEqual({ ...defaultCvars, sv_airaccelerate: 100 });
  });

  it('a map without cvars goes back to plain defaults', () => {
    const mc = new MovementController();
    mc.applyMapCvars(fromJson('{"sv_airaccelerate": 100, "sv_gravity": 12}'));
    expect(mc.applyMapCvars(undefined)).toEqual({ applied: {}, rejected: [] });
    expect(mc.getCvars()).toEqual(defaultCvars);
  });

  it('takes the bhop and surf values the maps ship with', () => {
    const mc = new MovementController();
    mc.applyMapCvars(fromJson('{"sv_airaccelerate": 150}'));
    expect(mc.getCvars().sv_airaccelerate).toBe(150);
    mc.applyMapCvars(fromJson('{"sv_airaccelerate": 100}'));
    expect(mc.getCvars().sv_airaccelerate).toBe(100);
  });

  it('skips unknown names, wrong types, non-finite and out of range values', () => {
    const mc = new MovementController();
    const overrides = {
      ...fromJson(`{
        "sv_airaccelerate": 150,
        "sv_autobhop_enabled": false,
        "sv_friction": -1,
        "sv_maxspeed": "12",
        "sv_bhop_enabled": "yes",
        "sv_cheats": 1,
        "sv_gravity": 1e9,
        "sv_surf_edge_slip": 1.5,
        "__proto__": { "sv_gravity": 0 }
      }`),
      sv_jump_impulse: Number.NaN,
      surf_friction: Number.POSITIVE_INFINITY,
    };
    const result = mc.applyMapCvars(overrides);

    expect(result.applied).toEqual({ sv_airaccelerate: 150, sv_autobhop_enabled: false });
    expect([...result.rejected].sort()).toEqual([
      '__proto__',
      'surf_friction',
      'sv_bhop_enabled',
      'sv_cheats',
      'sv_friction',
      'sv_gravity',
      'sv_jump_impulse',
      'sv_maxspeed',
      'sv_surf_edge_slip',
    ]);
    expect(mc.getCvars()).toEqual({ ...defaultCvars, sv_airaccelerate: 150, sv_autobhop_enabled: false });
    expect(({} as Record<string, unknown>).sv_gravity).toBeUndefined();
  });

  it('rejects a surf angle band that is not a band', () => {
    const result = sanitizeMapCvars({ surf_min_angle_deg: 60, surf_max_angle_deg: 50, sv_gravity: 12 });
    expect(result.applied).toEqual({ sv_gravity: 12 });
    expect(result.rejected).toEqual(['surf_min_angle_deg', 'surf_max_angle_deg']);
    // only one side set, but it would cross the default of the other side
    expect(sanitizeMapCvars({ surf_min_angle_deg: 85 }).rejected).toEqual(['surf_min_angle_deg']);
  });

  it('ignores a cvars field that is not an object', () => {
    expect(sanitizeMapCvars([150])).toEqual({ applied: {}, rejected: ['cvars'] });
    expect(sanitizeMapCvars(150)).toEqual({ applied: {}, rejected: ['cvars'] });
    expect(sanitizeMapCvars(null)).toEqual({ applied: {}, rejected: [] });
  });

  it('the override really changes the simulation: S stops you slower at 100 than at 150', () => {
    // S in the air at 9.5 m/s: addspeed = 0.762 + 9.5 = 10.26. at 150 one tick can add
    // 150 * 9.5 / 128 = 11.13 so you flip to 0.762 backwards, at 100 only 7.42 so 2.08 is left
    const speedAfterOneTickOfS = (overrides: string) => {
      const mc = new MovementController();
      mc.applyMapCvars(fromJson(overrides));
      mc.reset(new Vector3(0, 50, 0), 0);
      mc.setVelocity(new Vector3(0, 0, -9.5));
      mc.tick(1 / 128, { forwardMove: -1, sideMove: 0, jumpPressed: false, jumpHeld: false }, emptyWorld());
      return horizontalSpeed(mc.getVelocity());
    };
    expect(speedAfterOneTickOfS('{}')).toBeCloseTo(0.762, 9);
    expect(speedAfterOneTickOfS('{"sv_airaccelerate": 100}')).toBeCloseTo(9.5 - (100 * 9.5) / 128, 9);
  });
});
