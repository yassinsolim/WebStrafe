import type { SourceCvars } from './types';

/** source units are inches */
export const METRES_PER_UNIT = 0.0254;
const U = METRES_PER_UNIT;

// units: metres, seconds, metres / second. cs2 values are converted from source
// units, see docs/movement-cs2.md for every value and where it comes from.
export const defaultCvars: SourceCvars = {
  // cs2 sv_gravity 800 u/s^2
  sv_gravity: 800 * U,
  sv_accelerate: 13.0,
  // typical cs bhop/surf server value. the 30 u/s air wishspeed cap below is
  // what keeps this from being too strong, gain only comes from synced turning.
  sv_airaccelerate: 150.0,
  // 30 u/s * 0.0254 m/u
  sv_air_max_wishspeed: 0.762,
  sv_friction: 5.2,
  sv_stopspeed: 2.4,
  sv_maxspeed: 9.5,
  // cs2 sv_jump_impulse 301.99338 u/s = sqrt(2 * 800 * 57), a 57 u (1.45 m) jump
  sv_jump_impulse: 301.99338 * U,
  sv_bhop_enabled: true,
  sv_autobhop_enabled: true,
  surf_min_angle_deg: 40,
  surf_max_angle_deg: 82,
  // Keep surf friction near-zero so ramps carry speed and do not feel sticky.
  surf_friction: 0.0,
  // 0..1: amount of speed preserved when sliding across steep surf edges.
  // Higher means "slipperier" ramp lips with less speed loss.
  sv_surf_edge_slip: 0.92,
  overbounce: 1.001,
};

export function cloneCvars(cvars: SourceCvars): SourceCvars {
  return { ...cvars };
}

export type CvarRule = { kind: 'number'; min: number; max: number } | { kind: 'boolean' };

// what a map's meta.json "cvars" block may set and the range each value has to
// be in (same units as above). it's a full Record so a new cvar has to pick a rule.
export const mapCvarRules: Record<keyof SourceCvars, CvarRule> = {
  sv_gravity: { kind: 'number', min: 0, max: 100 },
  sv_accelerate: { kind: 'number', min: 0, max: 100 },
  sv_airaccelerate: { kind: 'number', min: 0, max: 10000 },
  sv_air_max_wishspeed: { kind: 'number', min: 0, max: 10 },
  sv_friction: { kind: 'number', min: 0, max: 20 },
  sv_stopspeed: { kind: 'number', min: 0, max: 20 },
  sv_maxspeed: { kind: 'number', min: 0.1, max: 50 },
  sv_jump_impulse: { kind: 'number', min: 0, max: 20 },
  sv_bhop_enabled: { kind: 'boolean' },
  sv_autobhop_enabled: { kind: 'boolean' },
  surf_min_angle_deg: { kind: 'number', min: 0, max: 89 },
  surf_max_angle_deg: { kind: 'number', min: 1, max: 90 },
  surf_friction: { kind: 'number', min: 0, max: 10 },
  sv_surf_edge_slip: { kind: 'number', min: 0, max: 1 },
  overbounce: { kind: 'number', min: 1, max: 2 },
};

export interface MapCvarResult {
  /** overrides that passed validation */
  applied: Partial<SourceCvars>;
  /** keys that were skipped: unknown name, wrong type, not finite or out of range */
  rejected: string[];
}

/** filters untrusted map json down to known cvars with sane values */
export function sanitizeMapCvars(overrides: unknown): MapCvarResult {
  const applied: Partial<Record<keyof SourceCvars, number | boolean>> = {};
  const rejected: string[] = [];
  if (overrides === undefined || overrides === null) {
    return { applied: {}, rejected };
  }
  if (typeof overrides !== 'object' || Array.isArray(overrides)) {
    return { applied: {}, rejected: ['cvars'] };
  }

  for (const [key, value] of Object.entries(overrides)) {
    const rule = Object.hasOwn(mapCvarRules, key) ? mapCvarRules[key as keyof SourceCvars] : undefined;
    if (!rule || !passesRule(rule, value)) {
      rejected.push(key);
      continue;
    }
    applied[key as keyof SourceCvars] = value as number | boolean;
  }

  // the surf band has to stay a band or every slope turns into ground or surf
  const surfMin = applied.surf_min_angle_deg ?? defaultCvars.surf_min_angle_deg;
  const surfMax = applied.surf_max_angle_deg ?? defaultCvars.surf_max_angle_deg;
  if (surfMin >= surfMax) {
    for (const key of ['surf_min_angle_deg', 'surf_max_angle_deg'] as const) {
      if (key in applied) {
        delete applied[key];
        rejected.push(key);
      }
    }
  }

  return { applied: applied as Partial<SourceCvars>, rejected };
}

function passesRule(rule: CvarRule, value: unknown): boolean {
  if (rule.kind === 'boolean') {
    return typeof value === 'boolean';
  }
  return typeof value === 'number' && Number.isFinite(value) && value >= rule.min && value <= rule.max;
}
