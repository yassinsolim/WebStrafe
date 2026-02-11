import type { SourceCvars } from './types';

// Units:
// - Distance: meters (Three.js units)
// - Time: seconds
// - Speed: meters / second
// Values are tuned for a Source-like feel under a 128 Hz simulation step.
export const defaultCvars: SourceCvars = {
  sv_gravity: 19.0,
  sv_accelerate: 13.0,
  // Lowered from 120 so air-strafe/surf speed gain takes much more effort.
  sv_airaccelerate: 24.0,
  sv_friction: 5.2,
  sv_stopspeed: 2.4,
  sv_maxspeed: 9.5,
  sv_jump_impulse: 5.4,
  sv_bhop_enabled: true,
  sv_autobhop_enabled: false,
  surf_min_angle_deg: 40,
  surf_max_angle_deg: 82,
  // Keep surf friction near-zero so ramps carry speed and do not feel sticky.
  surf_friction: 0.0,
  // Edge clipping assist amount. Increase slightly if you still snag on ramp lips.
  sv_surf_edge_clip_passthrough: 0.75,
  overbounce: 1.001,
};

export function cloneCvars(cvars: SourceCvars): SourceCvars {
  return { ...cvars };
}
