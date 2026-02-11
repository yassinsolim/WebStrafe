import { Vector3 } from 'three';

export type MovementMode = 'ground' | 'air' | 'surf';

export interface CapsuleShape {
  height: number;
  radius: number;
}

export interface MoveInput {
  forwardMove: number;
  sideMove: number;
  jumpPressed: boolean;
  jumpHeld: boolean;
}

export interface GroundProbe {
  distance: number;
  position: Vector3;
  normal: Vector3;
  slopeAngleDeg: number;
}

export interface MovementDebugState {
  speed: number;
  feetPosition: Vector3;
  cameraPosition: Vector3;
  velocity: Vector3;
  grounded: boolean;
  surfing: boolean;
  surfGraceTicks: number;
  slopeAngleDeg: number;
  wishSpeed: number;
  wishDir: Vector3;
  surfaceNormal: Vector3;
  contactPoint: Vector3 | null;
  movementMode: MovementMode;
  frictionApplied: boolean;
  collisionSpeedBefore: number;
  collisionSpeedAfter: number;
  collisionSpeedDropWarn: boolean;
  lastCollisionNormal: Vector3;
  lastCollisionAngleDeg: number;
  recommendedStrafe: 'A' | 'D' | 'NONE';
}

export interface SourceCvars {
  sv_gravity: number;
  sv_accelerate: number;
  sv_airaccelerate: number;
  sv_friction: number;
  sv_stopspeed: number;
  sv_maxspeed: number;
  sv_jump_impulse: number;
  sv_bhop_enabled: boolean;
  sv_autobhop_enabled: boolean;
  surf_min_angle_deg: number;
  surf_max_angle_deg: number;
  surf_friction: number;
  sv_surf_edge_slip: number;
  overbounce: number;
}
