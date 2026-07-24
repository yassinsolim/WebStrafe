import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  BACKSTAB_READY_SURFACE_RANGE,
  findBackstabOpportunity,
  type BackstabTarget,
} from '../BackstabOpportunity';
import { PLAYER_CAPSULE_RADIUS } from '../CombatArena';

const target = (overrides: Partial<BackstabTarget> = {}): BackstabTarget => ({
  id: 'target',
  position: [0, 0, -1.7],
  yaw: 0,
  alive: true,
  ...overrides,
});

const query = (candidate: BackstabTarget) => findBackstabOpportunity({
  attackerFeet: new Vector3(0, 0, 0),
  attackerForward: new Vector3(0, 0, -1),
  targets: [candidate],
});

describe('findBackstabOpportunity', () => {
  it('detects a living target directly ahead while the attacker is behind it', () => {
    expect(query(target())?.id).toBe('target');
  });

  it('rejects front-facing, dead, occluded, and off-aim targets', () => {
    expect(query(target({ yaw: Math.PI }))).toBeNull();
    expect(query(target({ alive: false }))).toBeNull();
    expect(findBackstabOpportunity({
      attackerFeet: new Vector3(),
      attackerForward: new Vector3(0, 0, -1),
      targets: [target()],
      hasLineOfSight: () => false,
    })).toBeNull();
    expect(findBackstabOpportunity({
      attackerFeet: new Vector3(),
      attackerForward: new Vector3(1, 0, 0),
      targets: [target()],
    })).toBeNull();
  });

  it('begins only within the short pre-strike readiness margin', () => {
    const centerDistance = BACKSTAB_READY_SURFACE_RANGE + PLAYER_CAPSULE_RADIUS;
    expect(query(target({ position: [0, 0, -centerDistance] }))).not.toBeNull();
    expect(query(target({ position: [0, 0, -(centerDistance + 0.01)] }))).toBeNull();
  });
});
