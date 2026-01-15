import { describe, expect, it } from 'vitest';
import { MathUtils, Vector3 } from 'three';
import { MovementController } from '../MovementController';
import type { CapsuleShape, GroundProbe } from '../types';
import type { CollisionAdapter, OverlapResult, TraceResult } from '../../world/CollisionWorld';

type WorldMode = 'flat' | 'ramp' | 'none';

class TestCollisionWorld implements CollisionAdapter {
  private readonly rampAngleDeg = 55;
  private readonly rampTan = Math.tan(MathUtils.degToRad(this.rampAngleDeg));
  private readonly rampNormal = new Vector3(this.rampTan, 1, 0).normalize();

  constructor(private readonly mode: WorldMode) {}

  public queryGround(feetPosition: Vector3, _capsule: CapsuleShape, probeDistance: number): GroundProbe | null {
    const surface = this.getSurface(feetPosition.x, feetPosition.z);
    if (!surface) {
      return null;
    }
    const distance = feetPosition.y - surface.height;
    if (distance < -0.1 || distance > probeDistance) {
      return null;
    }
    return {
      distance: Math.max(0, distance),
      position: new Vector3(feetPosition.x, surface.height, feetPosition.z),
      normal: surface.normal.clone(),
      slopeAngleDeg: surface.slopeAngleDeg,
    };
  }

  public traceCapsule(startFeet: Vector3, endFeet: Vector3, _capsule: CapsuleShape): TraceResult {
    const startSurface = this.getSurface(startFeet.x, startFeet.z);
    const endSurface = this.getSurface(endFeet.x, endFeet.z);

    if (!startSurface && !endSurface) {
      return {
        hit: false,
        fraction: 1,
        normal: new Vector3(0, 1, 0),
        position: endFeet.clone(),
      };
    }

    const normal = (endSurface ?? startSurface)!.normal.clone();
    const h0 = startSurface?.height ?? -999;
    const h1 = endSurface?.height ?? -999;
    const d0 = startFeet.y - h0;
    const d1 = endFeet.y - h1;

    if (d1 >= 0) {
      return {
        hit: false,
        fraction: 1,
        normal,
        position: endFeet.clone(),
      };
    }

    let fraction = d0 / (d0 - d1);
    fraction = MathUtils.clamp(Number.isFinite(fraction) ? fraction : 0, 0, 1);
    const hitPos = startFeet.clone().lerp(endFeet, fraction);
    const hitSurface = this.getSurface(hitPos.x, hitPos.z);
    if (hitSurface) {
      hitPos.y = hitSurface.height;
      return {
        hit: true,
        fraction,
        normal: hitSurface.normal.clone(),
        position: hitPos,
      };
    }

    return {
      hit: false,
      fraction: 1,
      normal,
      position: endFeet.clone(),
    };
  }

  public resolveCapsulePosition(feetPosition: Vector3, _capsule: CapsuleShape): OverlapResult {
    const surface = this.getSurface(feetPosition.x, feetPosition.z);
    if (!surface) {
      return {
        collided: false,
        depth: 0,
        normal: new Vector3(0, 1, 0),
        position: feetPosition.clone(),
      };
    }

    const penetration = surface.height - feetPosition.y;
    if (penetration <= 0) {
      return {
        collided: false,
        depth: 0,
        normal: surface.normal.clone(),
        position: feetPosition.clone(),
      };
    }

    return {
      collided: true,
      depth: penetration,
      normal: surface.normal.clone(),
      position: new Vector3(feetPosition.x, surface.height, feetPosition.z),
    };
  }

  private getSurface(x: number, _z: number):
    | { height: number; normal: Vector3; slopeAngleDeg: number }
    | null {
    if (this.mode === 'none') {
      return null;
    }

    if (this.mode === 'flat') {
      return {
        height: 0,
        normal: new Vector3(0, 1, 0),
        slopeAngleDeg: 0,
      };
    }

    // Ramp segment from x:[0..10], y = 8 - tan(angle) * x.
    if (x < 0 || x > 10) {
      return null;
    }

    const height = 8 - this.rampTan * x;
    return {
      height,
      normal: this.rampNormal,
      slopeAngleDeg: this.rampAngleDeg,
    };
  }
}

function speed2d(v: Vector3): number {
  return Math.hypot(v.x, v.z);
}

describe('Movement behavior acceptance', () => {
  const dt = 1 / 128;

  it('bunnyhop with auto-bhop keeps speed from collapsing', () => {
    const world = new TestCollisionWorld('flat');
    const player = new MovementController();
    player.setCvars({
      sv_autobhop_enabled: true,
      sv_bhop_enabled: true,
      sv_maxspeed: 9,
    });
    player.reset(new Vector3(0, 0, 0), 0);

    for (let i = 0; i < 100; i += 1) {
      player.tick(
        dt,
        {
          forwardMove: 1,
          sideMove: 0,
          jumpHeld: false,
          jumpPressed: false,
        },
        world,
      );
    }
    const baseline = speed2d(player.getVelocity());

    const samples: number[] = [];
    for (let i = 0; i < 360; i += 1) {
      const sideMove = i % 40 < 20 ? -1 : 1;
      player.applyLookDelta(sideMove * 3, 0, 1);
      player.tick(
        dt,
        {
          forwardMove: 1,
          sideMove,
          jumpHeld: true,
          jumpPressed: false,
        },
        world,
      );
      samples.push(speed2d(player.getVelocity()));
    }

    const minPostHop = Math.min(...samples.slice(80));
    const finalSpeed = samples[samples.length - 1];
    expect(minPostHop).toBeGreaterThan(baseline * 0.35);
    expect(finalSpeed).toBeGreaterThan(baseline * 0.8);
  });

  it('air-strafing gains speed over no-input air movement', () => {
    const world = new TestCollisionWorld('none');
    const noInput = new MovementController();
    const withStrafe = new MovementController();

    noInput.reset(new Vector3(0, 12, 0), 0);
    withStrafe.reset(new Vector3(0, 12, 0), 0);
    noInput.setVelocity(new Vector3(6, 0, 0));
    withStrafe.setVelocity(new Vector3(6, 0, 0));

    for (let i = 0; i < 160; i += 1) {
      noInput.tick(
        dt,
        {
          forwardMove: 0,
          sideMove: 0,
          jumpHeld: false,
          jumpPressed: false,
        },
        world,
      );

      withStrafe.applyLookDelta(-3, 0, 1);
      withStrafe.tick(
        dt,
        {
          forwardMove: 0,
          sideMove: 1,
          jumpHeld: false,
          jumpPressed: false,
        },
        world,
      );
    }

    const noInputSpeed = speed2d(noInput.getVelocity());
    const strafeSpeed = speed2d(withStrafe.getVelocity());
    expect(strafeSpeed).toBeGreaterThan(noInputSpeed + 0.25);
  });

  it('surfing on a steep ramp keeps speed and launches cleanly', () => {
    const world = new TestCollisionWorld('ramp');
    const player = new MovementController();
    player.reset(new Vector3(7.8, 8 - Math.tan(MathUtils.degToRad(55)) * 7.8, 0), -90);
    player.setVelocity(new Vector3(-11.5, 0, 0));

    let sawSurfTick = false;
    let minX = Number.POSITIVE_INFINITY;
    let peakSpeed = 0;

    for (let i = 0; i < 220; i += 1) {
      player.applyLookDelta(-2, 0, 1);
      player.tick(
        dt,
        {
          forwardMove: 0,
          sideMove: -1,
          jumpHeld: false,
          jumpPressed: false,
        },
        world,
      );

      const debug = player.getDebugState();
      if (debug.surfing) {
        sawSurfTick = true;
      }
      const speed = speed2d(player.getVelocity());
      peakSpeed = Math.max(peakSpeed, speed);
      minX = Math.min(minX, player.getFeetPosition().x);
    }

    const endSpeed = speed2d(player.getVelocity());
    expect(sawSurfTick).toBe(true);
    expect(minX).toBeLessThan(7.7);
    expect(peakSpeed).toBeGreaterThan(6);
    expect(endSpeed).toBeGreaterThan(2);
  });
});
