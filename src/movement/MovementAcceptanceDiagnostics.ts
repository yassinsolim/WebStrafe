import { MathUtils, Vector3 } from 'three';
import type { CollisionAdapter, OverlapResult, TraceResult } from '../world/CollisionWorld';
import type { CapsuleShape, GroundProbe, MoveInput } from './types';
import { MovementController } from './MovementController';
import type { MovementAcceptanceLog } from './MovementTestScene';

type SimWorldMode = 'flat' | 'ramp' | 'none';

class SimWorld implements CollisionAdapter {
  private readonly rampAngleDeg = 55;
  private readonly rampTan = Math.tan(MathUtils.degToRad(this.rampAngleDeg));
  private readonly rampNormal = new Vector3(this.rampTan, 1, 0).normalize();

  constructor(private readonly mode: SimWorldMode) {}

  public queryGround(feetPosition: Vector3, _capsule: CapsuleShape, probeDistance: number): GroundProbe | null {
    const surface = this.surface(feetPosition.x);
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
    const endSurface = this.surface(endFeet.x);
    if (!endSurface) {
      return {
        hit: false,
        fraction: 1,
        normal: new Vector3(0, 1, 0),
        position: endFeet.clone(),
      };
    }

    const startSurface = this.surface(startFeet.x);
    const startDist = startFeet.y - (startSurface?.height ?? endSurface.height);
    const endDist = endFeet.y - endSurface.height;
    if (endDist >= 0) {
      return {
        hit: false,
        fraction: 1,
        normal: endSurface.normal.clone(),
        position: endFeet.clone(),
      };
    }

    const rawFraction = startDist / (startDist - endDist);
    const fraction = MathUtils.clamp(Number.isFinite(rawFraction) ? rawFraction : 0, 0, 1);
    const pos = startFeet.clone().lerp(endFeet, fraction);
    pos.y = endSurface.height;
    return {
      hit: true,
      fraction,
      normal: endSurface.normal.clone(),
      position: pos,
    };
  }

  public resolveCapsulePosition(feetPosition: Vector3, _capsule: CapsuleShape): OverlapResult {
    const surface = this.surface(feetPosition.x);
    if (!surface) {
      return {
        collided: false,
        depth: 0,
        normal: new Vector3(0, 1, 0),
        position: feetPosition.clone(),
      };
    }

    if (feetPosition.y >= surface.height) {
      return {
        collided: false,
        depth: 0,
        normal: surface.normal.clone(),
        position: feetPosition.clone(),
      };
    }

    return {
      collided: true,
      depth: surface.height - feetPosition.y,
      normal: surface.normal.clone(),
      position: new Vector3(feetPosition.x, surface.height, feetPosition.z),
    };
  }

  private surface(x: number):
    | {
        height: number;
        normal: Vector3;
        slopeAngleDeg: number;
      }
    | null {
    switch (this.mode) {
      case 'none':
        return null;
      case 'flat':
        return {
          height: 0,
          normal: new Vector3(0, 1, 0),
          slopeAngleDeg: 0,
        };
      case 'ramp':
        if (x < 0 || x > 10) {
          return null;
        }
        return {
          height: 8 - this.rampTan * x,
          normal: this.rampNormal,
          slopeAngleDeg: this.rampAngleDeg,
        };
      default:
        return null;
    }
  }
}

const DT = 1 / 128;

export function runMovementAcceptanceDiagnostics(): MovementAcceptanceLog {
  const bunnyhopSpeed = runBunnyhop();
  const airStrafeGain = runAirStrafe();
  const surfSpeed = runSurf();
  return {
    bunnyhopSpeed,
    airStrafeGain,
    surfSpeed,
  };
}

function runBunnyhop(): number {
  const world = new SimWorld('flat');
  const player = new MovementController();
  player.setCvars({ sv_autobhop_enabled: true });
  player.reset(new Vector3(0, 0, 0), 0);

  for (let i = 0; i < 96; i += 1) {
    tick(player, world, {
      forwardMove: 1,
      sideMove: 0,
      jumpHeld: false,
      jumpPressed: false,
    });
  }
  for (let i = 0; i < 240; i += 1) {
    const side = i % 48 < 24 ? -1 : 1;
    player.applyLookDelta(side * 3, 0, 1);
    tick(player, world, {
      forwardMove: 0,
      sideMove: side,
      jumpHeld: true,
      jumpPressed: false,
    });
  }
  return Math.hypot(player.getVelocity().x, player.getVelocity().z);
}

function runAirStrafe(): number {
  const world = new SimWorld('none');
  const baseline = new MovementController();
  const strafing = new MovementController();
  baseline.reset(new Vector3(0, 10, 0), 0);
  strafing.reset(new Vector3(0, 10, 0), 0);
  baseline.setVelocity(new Vector3(6, 0, 0));
  strafing.setVelocity(new Vector3(6, 0, 0));

  for (let i = 0; i < 150; i += 1) {
    tick(baseline, world, {
      forwardMove: 0,
      sideMove: 0,
      jumpHeld: false,
      jumpPressed: false,
    });

    strafing.applyLookDelta(-3, 0, 1);
    tick(strafing, world, {
      forwardMove: 0,
      sideMove: 1,
      jumpHeld: false,
      jumpPressed: false,
    });
  }

  const baselineSpeed = Math.hypot(baseline.getVelocity().x, baseline.getVelocity().z);
  const strafingSpeed = Math.hypot(strafing.getVelocity().x, strafing.getVelocity().z);
  return strafingSpeed - baselineSpeed;
}

function runSurf(): number {
  const world = new SimWorld('ramp');
  const player = new MovementController();
  const angle = MathUtils.degToRad(55);
  player.reset(new Vector3(7.8, 8 - Math.tan(angle) * 7.8, 0), -90);
  player.setVelocity(new Vector3(-11, 0, 0));

  for (let i = 0; i < 160; i += 1) {
    player.applyLookDelta(-2, 0, 1);
    tick(player, world, {
      forwardMove: 0,
      sideMove: -1,
      jumpHeld: false,
      jumpPressed: false,
    });
  }
  return Math.hypot(player.getVelocity().x, player.getVelocity().z);
}

function tick(player: MovementController, world: SimWorld, input: MoveInput): void {
  player.tick(DT, input, world);
}
