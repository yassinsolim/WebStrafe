import { MathUtils, Vector3 } from 'three';
import { defaultCvars } from './cvars';
import {
  accelerate,
  applyFriction,
  clampHorizontalSpeed,
  clipVelocity,
  horizontalLength,
  projectDirectionOnPlane,
} from './MovementMath';
import type { CapsuleShape, GroundProbe, MoveInput, MovementDebugState, MovementMode, SourceCvars } from './types';
import type { CollisionAdapter } from '../world/CollisionWorld';

const UP = new Vector3(0, 1, 0);
const WALKABLE_EPS = 0.5;
const WALKABLE_MAX_ANGLE_DEG = 40;
const GROUND_PROBE_DIST = 0.18;
const SURF_PROBE_DIST = 0.55;
const GROUND_SNAP_DIST = 0.08;
const MAX_BUMPS = 4;
const MAX_PLANES = 4;
const PLANE_SIMILARITY_EPS = 0.99;
const SURF_CONTACT_GRACE_TICKS = 20;
const SURF_EDGE_GROUND_OVERRIDE_MIN_ANGLE_DEG = 1;
const SURF_EDGE_OVERRIDE_MIN_SPEED = 1.2;
const SURF_EDGE_LAUNCH_MIN_SPEED = 5;

export class MovementController {
  public readonly capsule: CapsuleShape = {
    height: 1.76,
    radius: 0.34,
  };

  public readonly eyeHeight = 1.6;

  private readonly cvars: SourceCvars = { ...defaultCvars };
  private readonly position = new Vector3(0, 4, 0); // feet
  private readonly velocity = new Vector3();
  private readonly surfContactNormal = new Vector3(0, 1, 0);
  private surfContactGraceTicks = 0;
  private yawRad = 0;
  private pitchRad = 0;

  private readonly debugState: MovementDebugState = {
    speed: 0,
    grounded: false,
    surfing: false,
    slopeAngleDeg: 0,
    wishSpeed: 0,
    wishDir: new Vector3(),
    surfaceNormal: new Vector3(0, 1, 0),
    contactPoint: null,
    movementMode: 'air',
    frictionApplied: false,
    collisionSpeedBefore: 0,
    collisionSpeedAfter: 0,
    collisionSpeedDropWarn: false,
    lastCollisionNormal: new Vector3(0, 1, 0),
    lastCollisionAngleDeg: 0,
    recommendedStrafe: 'NONE',
  };

  public getCvars(): SourceCvars {
    return { ...this.cvars };
  }

  public setCvar<K extends keyof SourceCvars>(name: K, value: SourceCvars[K]): void {
    this.cvars[name] = value;
  }

  public setCvars(next: Partial<SourceCvars>): void {
    Object.assign(this.cvars, next);
  }

  public reset(position: Vector3, yawDeg: number): void {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.surfContactGraceTicks = 0;
    this.surfContactNormal.set(0, 1, 0);
    this.yawRad = MathUtils.degToRad(yawDeg);
    this.pitchRad = 0;
  }

  public applyLookDelta(deltaX: number, deltaY: number, sensitivity: number): void {
    const yawScale = 0.0022 * sensitivity;
    const pitchScale = 0.0022 * sensitivity;
    this.yawRad -= deltaX * yawScale;
    this.pitchRad -= deltaY * pitchScale;
    this.pitchRad = MathUtils.clamp(this.pitchRad, MathUtils.degToRad(-89), MathUtils.degToRad(89));
  }

  public tick(dt: number, input: MoveInput, world: CollisionAdapter): void {
    const wish = this.computeWish(input);
    let groundProbe = world.queryGround(this.position, this.capsule, GROUND_PROBE_DIST);
    let mode = this.pickMode(groundProbe);
    let activeSurfNormal = this.getSurfNormalFromProbe(groundProbe);
    const walkableAngle = this.getWalkableAngleDeg();
    const hasWalkableProbe = groundProbe !== null && groundProbe.slopeAngleDeg <= walkableAngle;
    if (!activeSurfNormal && this.surfContactGraceTicks > 0 && !hasWalkableProbe) {
      activeSurfNormal = this.surfContactNormal.clone();
      mode = 'surf';
    }
    if (
      mode === 'ground'
      && this.surfContactGraceTicks > 0
      && groundProbe
      && horizontalLength(this.velocity) > SURF_EDGE_OVERRIDE_MIN_SPEED
      && groundProbe.slopeAngleDeg >= SURF_EDGE_GROUND_OVERRIDE_MIN_ANGLE_DEG
    ) {
      mode = 'surf';
      activeSurfNormal = activeSurfNormal ?? this.surfContactNormal.clone();
    }
    const preserveLaunchFromSurf =
      mode === 'ground'
      && this.surfContactGraceTicks > 0
      && groundProbe !== null
      && groundProbe.slopeAngleDeg <= walkableAngle + 1
      && horizontalLength(this.velocity) > Math.max(SURF_EDGE_LAUNCH_MIN_SPEED, this.cvars.sv_maxspeed * 0.9)
      && this.velocity.y <= 0.9;
    if (preserveLaunchFromSurf) {
      mode = 'air';
    }
    let frictionApplied = false;
    let contactPoint = groundProbe?.position.clone() ?? null;

    const jumpRequested =
      this.cvars.sv_bhop_enabled && (input.jumpPressed || (this.cvars.sv_autobhop_enabled && input.jumpHeld));
    let jumped = false;

    if ((mode === 'ground' || mode === 'surf') && jumpRequested) {
      this.velocity.y = this.cvars.sv_jump_impulse;
      mode = 'air';
      jumped = true;
    }

    switch (mode) {
      case 'ground':
        if (!jumpRequested) {
          this.applyGroundFriction(dt);
          frictionApplied = true;
        }
        this.accelerateGround(wish.wishDir, wish.wishSpeed, dt);
        if (this.velocity.y < 0) {
          this.velocity.y = 0;
        }
        break;
      case 'surf':
        if (activeSurfNormal) {
          const rampNormal = activeSurfNormal.clone().normalize();
          this.velocity.copy(clipVelocity(this.velocity, rampNormal, this.cvars.overbounce));
          this.removeIntoRamp(rampNormal);

          const surfWish = projectDirectionOnPlane(wish.wishDir, rampNormal);
          if (surfWish.lengthSq() > 0) {
            this.velocity.copy(
              accelerate(this.velocity, surfWish, wish.wishSpeed, this.cvars.sv_airaccelerate, dt),
            );
          }
          this.removeIntoRamp(rampNormal);

          if (this.cvars.surf_friction > 0) {
            const frictionScale = Math.max(0, 1 - this.cvars.surf_friction * dt);
            this.velocity.multiplyScalar(frictionScale);
          }
        }
        break;
      case 'air':
      default:
        if (wish.wishDir.lengthSq() > 0) {
          this.velocity.copy(
            accelerate(this.velocity, wish.wishDir, wish.wishSpeed, this.cvars.sv_airaccelerate, dt),
          );
        }
        break;
    }

    if (mode !== 'ground' || jumped) {
      this.velocity.y -= this.cvars.sv_gravity * dt;
    }

    const preSlideVelocity = this.velocity.clone();
    const collisionSpeedBefore = this.velocity.length();
    const slideResult = this.slideMove(world, dt, mode === 'surf', activeSurfNormal ?? groundProbe?.normal ?? null);
    let collisionSpeedAfter = this.velocity.length();
    const dropWarnRatio = 0.5;
    let collisionDropWarn = collisionSpeedBefore > 0.2 && collisionSpeedAfter < collisionSpeedBefore * dropWarnRatio;

    groundProbe = world.queryGround(this.position, this.capsule, GROUND_PROBE_DIST);
    contactPoint = groundProbe?.position.clone() ?? contactPoint;
    const surfFromProbe = this.getSurfNormalFromProbe(groundProbe);
    const surfFromCollision = slideResult.surfCollisionNormal
      ?? this.getSurfNormalFromNormal(slideResult.lastCollisionNormal);
    const fallbackSurfFromMode =
      mode === 'surf'
      && activeSurfNormal
      && slideResult.lastCollisionNormal !== null
      && Math.abs(slideResult.lastCollisionNormal.y) < 0.45;
    const surfNormal =
      surfFromProbe
      ?? surfFromCollision
      ?? (fallbackSurfFromMode && activeSurfNormal ? activeSurfNormal.clone() : null);
    if (surfNormal) {
      this.surfContactNormal.copy(surfNormal);
      this.surfContactGraceTicks = SURF_CONTACT_GRACE_TICKS;
      this.velocity.copy(clipVelocity(this.velocity, surfNormal, this.cvars.overbounce));
      this.removeIntoRamp(surfNormal);
      this.recoverSurfEdgeSpeed(preSlideVelocity, surfNormal, collisionSpeedBefore);
      collisionSpeedAfter = this.velocity.length();
      collisionDropWarn = collisionSpeedBefore > 0.2 && collisionSpeedAfter < collisionSpeedBefore * dropWarnRatio;
    } else if (
      this.surfContactGraceTicks > 0
      && collisionDropWarn
      && slideResult.lastCollisionNormal !== null
      && Math.abs(slideResult.lastCollisionNormal.y) < 0.35
    ) {
      this.recoverSurfEdgeSpeed(preSlideVelocity, this.surfContactNormal, collisionSpeedBefore);
      collisionSpeedAfter = this.velocity.length();
      collisionDropWarn = collisionSpeedBefore > 0.2 && collisionSpeedAfter < collisionSpeedBefore * dropWarnRatio;
      this.surfContactGraceTicks = Math.max(0, this.surfContactGraceTicks - 1);
    } else if (this.surfContactGraceTicks > 0) {
      const maintainGraceOnEdgeWall =
        slideResult.lastCollisionNormal !== null
        && Math.abs(slideResult.lastCollisionNormal.y) < 0.25
        && horizontalLength(this.velocity) > SURF_EDGE_OVERRIDE_MIN_SPEED;
      if (!maintainGraceOnEdgeWall) {
        this.surfContactGraceTicks -= 1;
      }
    }
    if (
      slideResult.lastCollisionNormal !== null
      && Math.abs(slideResult.lastCollisionNormal.y) < 0.25
      && horizontalLength(this.velocity) > SURF_EDGE_OVERRIDE_MIN_SPEED
    ) {
      this.surfContactGraceTicks = Math.max(this.surfContactGraceTicks, 2);
    }

    const preserveRampLaunch =
      !jumped
      && this.surfContactGraceTicks > 0
      && groundProbe !== null
      && groundProbe.slopeAngleDeg <= walkableAngle + 1
      && horizontalLength(this.velocity) > Math.max(SURF_EDGE_LAUNCH_MIN_SPEED, this.cvars.sv_maxspeed * 0.9)
      && this.velocity.y <= 0.9;

    const walkable = this.isWalkable(groundProbe);
    if (!preserveRampLaunch && !jumped && walkable && groundProbe && groundProbe.distance <= GROUND_SNAP_DIST) {
      this.position.copy(groundProbe.position);
      if (this.velocity.y < 0) {
        this.velocity.y = 0;
      }
    }

    mode = this.pickMode(groundProbe);
    if (preserveRampLaunch && mode === 'ground') {
      mode = 'air';
    }
    if (mode === 'air' && this.surfContactGraceTicks > 0 && !preserveRampLaunch) {
      mode = 'surf';
    }
    const lastNormal = slideResult.lastCollisionNormal ?? groundProbe?.normal ?? UP;
    this.refreshDebug(
      mode,
      groundProbe,
      wish.wishDir,
      wish.wishSpeed,
      frictionApplied,
      contactPoint,
      collisionSpeedBefore,
      collisionSpeedAfter,
      collisionDropWarn,
      lastNormal,
    );
  }

  public getFeetPosition(): Vector3 {
    return this.position.clone();
  }

  public getVelocity(): Vector3 {
    return this.velocity.clone();
  }

  public setVelocity(velocity: Vector3): void {
    this.velocity.copy(velocity);
  }

  public setFeetPosition(position: Vector3): void {
    this.position.copy(position);
  }

  public getCameraPosition(): Vector3 {
    return this.position.clone().addScaledVector(UP, this.eyeHeight);
  }

  public getYawRad(): number {
    return this.yawRad;
  }

  public getPitchRad(): number {
    return this.pitchRad;
  }

  public getForwardVector(): Vector3 {
    const cosPitch = Math.cos(this.pitchRad);
    return new Vector3(
      -Math.sin(this.yawRad) * cosPitch,
      Math.sin(this.pitchRad),
      -Math.cos(this.yawRad) * cosPitch,
    ).normalize();
  }

  public getDebugState(): MovementDebugState {
    return {
      ...this.debugState,
      wishDir: this.debugState.wishDir.clone(),
      surfaceNormal: this.debugState.surfaceNormal.clone(),
      contactPoint: this.debugState.contactPoint?.clone() ?? null,
      lastCollisionNormal: this.debugState.lastCollisionNormal.clone(),
    };
  }

  private computeWish(input: MoveInput): { wishDir: Vector3; wishSpeed: number } {
    const forward = new Vector3(-Math.sin(this.yawRad), 0, -Math.cos(this.yawRad));
    const right = new Vector3(Math.cos(this.yawRad), 0, -Math.sin(this.yawRad));

    const wishVel = new Vector3()
      .addScaledVector(forward, input.forwardMove)
      .addScaledVector(right, input.sideMove);
    const len = wishVel.length();
    if (len <= 1e-6) {
      return { wishDir: new Vector3(), wishSpeed: 0 };
    }

    const wishDir = wishVel.multiplyScalar(1 / len);
    const wishSpeed = Math.min(this.cvars.sv_maxspeed, len * this.cvars.sv_maxspeed);
    return { wishDir, wishSpeed };
  }

  private applyGroundFriction(dt: number): void {
    this.velocity.copy(
      applyFriction(this.velocity, dt, this.cvars.sv_friction, this.cvars.sv_stopspeed),
    );
  }

  private accelerateGround(wishDir: Vector3, wishSpeed: number, dt: number): void {
    if (wishSpeed <= 0 || wishDir.lengthSq() <= 0) {
      return;
    }
    this.velocity.copy(accelerate(this.velocity, wishDir, wishSpeed, this.cvars.sv_accelerate, dt));
    this.velocity.copy(clampHorizontalSpeed(this.velocity, this.cvars.sv_maxspeed));
  }

  private pickMode(groundProbe: GroundProbe | null): MovementMode {
    if (this.isWalkable(groundProbe)) {
      return 'ground';
    }
    if (this.isSurfSlope(groundProbe)) {
      return 'surf';
    }
    return 'air';
  }

  private isWalkable(groundProbe: GroundProbe | null): boolean {
    if (!groundProbe) {
      return false;
    }
    const walkableAngle = this.getWalkableAngleDeg();
    return (
      groundProbe.distance <= GROUND_PROBE_DIST &&
      groundProbe.slopeAngleDeg <= walkableAngle
    );
  }

  private isSurfSlope(groundProbe: GroundProbe | null): boolean {
    if (!groundProbe) {
      return false;
    }
    const walkableAngle = this.getWalkableAngleDeg();
    return (
      groundProbe.distance <= GROUND_PROBE_DIST &&
      groundProbe.slopeAngleDeg > walkableAngle &&
      groundProbe.slopeAngleDeg >= this.cvars.surf_min_angle_deg &&
      groundProbe.slopeAngleDeg <= this.cvars.surf_max_angle_deg
    );
  }

  private slideMove(
    world: CollisionAdapter,
    dt: number,
    surfingTick: boolean,
    surfNormal: Vector3 | null,
  ): { lastCollisionNormal: Vector3 | null; surfCollisionNormal: Vector3 | null } {
    const planes: Vector3[] = [];
    let remainingTime = dt;
    let lastCollisionNormal: Vector3 | null = null;
    let surfCollisionNormal: Vector3 | null = null;

    for (let bump = 0; bump < MAX_BUMPS; bump += 1) {
      if (this.velocity.lengthSq() < 1e-10 || remainingTime <= 1e-6) {
        break;
      }

      const end = this.position.clone().addScaledVector(this.velocity, remainingTime);
      const trace = world.traceCapsule(this.position, end, this.capsule);
      this.position.copy(trace.position);

      if (!trace.hit) {
        break;
      }

      const hitNormal = trace.normal.clone().normalize();
      if (hitNormal.dot(this.velocity) > 0) {
        hitNormal.negate();
      }
      lastCollisionNormal = hitNormal.clone();
      const collisionSurfNormal = this.getSurfNormalFromNormal(hitNormal);
      if (collisionSurfNormal) {
        if (!surfCollisionNormal || collisionSurfNormal.y < surfCollisionNormal.y) {
          surfCollisionNormal = collisionSurfNormal.clone();
        }
      }

      const surfGraceEdgeCollision =
        collisionSurfNormal === null
        && this.surfContactGraceTicks > 0
        && Math.abs(hitNormal.y) < 0.28
        && this.velocity.dot(hitNormal) < -0.02
        && horizontalLength(this.velocity) > SURF_EDGE_OVERRIDE_MIN_SPEED;
      const ignoreRampCapFromSurfGrace =
        surfGraceEdgeCollision
        && Math.abs(hitNormal.dot(this.surfContactNormal)) < 0.45
        && this.velocity.y <= 0.5
        && trace.fraction > 0.45;
      if (ignoreRampCapFromSurfGrace) {
        const edgeClipAssist = Math.max(0.1, this.cvars.sv_surf_edge_clip_passthrough);
        const passthrough = Math.max(
          this.capsule.radius * (1 + edgeClipAssist),
          horizontalLength(this.velocity) * dt * edgeClipAssist,
        );
        this.position.copy(end).addScaledVector(this.velocity.clone().normalize(), passthrough);
        remainingTime = 0;
        break;
      }
      const surfThisCollision = surfingTick || collisionSurfNormal !== null || surfGraceEdgeCollision;

      if (surfThisCollision) {
        const normal = (
          surfNormal
          ?? collisionSurfNormal
          ?? (surfGraceEdgeCollision ? this.surfContactNormal : null)
          ?? hitNormal
        ).clone().normalize();
        this.velocity.copy(clipVelocity(this.velocity, normal, this.cvars.overbounce));
        this.removeIntoRamp(normal);
        if (surfGraceEdgeCollision) {
          this.velocity.copy(clipVelocity(this.velocity, hitNormal, this.cvars.overbounce));
          const intoWall = this.velocity.dot(hitNormal);
          if (intoWall < 0) {
            this.velocity.addScaledVector(hitNormal, -intoWall);
          }
        }

        const fraction = MathUtils.clamp(trace.fraction, 0, 1);
        if (fraction <= 1e-5) {
          if (this.velocity.lengthSq() > 1e-8) {
            this.position.addScaledVector(this.velocity, Math.min(remainingTime, dt) * 0.25);
          }
          remainingTime *= 0.5;
        } else {
          remainingTime *= 1 - fraction;
        }
        continue;
      }

      let isDuplicatePlane = false;
      for (const existing of planes) {
        if (existing.dot(hitNormal) > PLANE_SIMILARITY_EPS) {
          isDuplicatePlane = true;
          break;
        }
      }
      if (!isDuplicatePlane) {
        planes.push(hitNormal);
      }

      if (planes.length > MAX_PLANES) {
        break;
      }

      let clippedVelocity = this.velocity.clone();
      const originalVelocity = this.velocity.clone();
      clippedVelocity = clipVelocity(clippedVelocity, hitNormal, this.cvars.overbounce);

      for (const plane of planes) {
        if (clippedVelocity.dot(plane) < 0) {
          clippedVelocity = clipVelocity(clippedVelocity, plane, this.cvars.overbounce);
        }
      }

      if (planes.length >= 2 && this.isIntoAnyPlane(clippedVelocity, planes)) {
        let bestCreaseVelocity: Vector3 | null = null;
        let bestCreaseSpeedSq = 0;
        for (let i = 0; i < planes.length; i += 1) {
          for (let j = i + 1; j < planes.length; j += 1) {
            const creaseDir = new Vector3().crossVectors(planes[i], planes[j]);
            if (creaseDir.lengthSq() <= 1e-10) {
              continue;
            }
            creaseDir.normalize();
            const creaseSpeed = originalVelocity.dot(creaseDir);
            const candidate = creaseDir.multiplyScalar(creaseSpeed);
            if (this.isIntoAnyPlane(candidate, planes)) {
              continue;
            }
            const candidateSpeedSq = candidate.lengthSq();
            if (candidateSpeedSq > bestCreaseSpeedSq) {
              bestCreaseSpeedSq = candidateSpeedSq;
              bestCreaseVelocity = candidate;
            }
          }
        }
        if (bestCreaseVelocity) {
          clippedVelocity = bestCreaseVelocity;
        }
      }

      if (clippedVelocity.lengthSq() <= 1e-10) {
        const fallback = clipVelocity(originalVelocity, hitNormal, this.cvars.overbounce);
        if (fallback.lengthSq() > clippedVelocity.lengthSq()) {
          clippedVelocity = fallback;
        }
      }

      this.velocity.copy(clippedVelocity);

      const fraction = MathUtils.clamp(trace.fraction, 0, 1);
      if (fraction <= 1e-5) {
        if (this.velocity.lengthSq() > 1e-8) {
          this.position.addScaledVector(this.velocity, Math.min(remainingTime, dt) * 0.125);
        }
        remainingTime *= 0.5;
      } else {
        remainingTime *= 1 - fraction;
      }
    }

    const resolved = world.resolveCapsulePosition(this.position, this.capsule);
    this.position.copy(resolved.position);
    if (resolved.collided) {
      lastCollisionNormal = resolved.normal.clone();
    }

    if (surfingTick) {
      const normal = surfNormal ?? resolved.normal;
      this.velocity.copy(clipVelocity(this.velocity, normal, this.cvars.overbounce));
      this.removeIntoRamp(normal);
    }

    return { lastCollisionNormal, surfCollisionNormal };
  }

  private refreshDebug(
    mode: MovementMode,
    groundProbe: GroundProbe | null,
    wishDir: Vector3,
    wishSpeed: number,
    frictionApplied: boolean,
    contactPoint: Vector3 | null,
    collisionSpeedBefore: number,
    collisionSpeedAfter: number,
    collisionSpeedDropWarn: boolean,
    lastCollisionNormal: Vector3,
  ): void {
    const normal = groundProbe?.normal ?? UP;
    const slope = groundProbe?.slopeAngleDeg ?? 90;
    const horizontalVelocity = this.velocity.clone().setY(0);
    let recommendedStrafe: 'A' | 'D' | 'NONE' = 'NONE';

    if (mode === 'surf' && horizontalVelocity.lengthSq() > 1e-6) {
      const rampRight = new Vector3().crossVectors(UP, normal).normalize();
      const side = horizontalVelocity.dot(rampRight);
      if (Math.abs(side) > 0.05) {
        recommendedStrafe = side > 0 ? 'D' : 'A';
      }
    }

    this.debugState.speed = horizontalLength(this.velocity);
    this.debugState.grounded = mode === 'ground';
    this.debugState.surfing = mode === 'surf';
    this.debugState.slopeAngleDeg = slope;
    this.debugState.wishSpeed = wishSpeed;
    this.debugState.wishDir.copy(wishDir);
    this.debugState.surfaceNormal.copy(normal);
    this.debugState.contactPoint = contactPoint?.clone() ?? null;
    this.debugState.movementMode = mode;
    this.debugState.frictionApplied = frictionApplied;
    this.debugState.collisionSpeedBefore = collisionSpeedBefore;
    this.debugState.collisionSpeedAfter = collisionSpeedAfter;
    this.debugState.collisionSpeedDropWarn = collisionSpeedDropWarn;
    this.debugState.lastCollisionNormal.copy(lastCollisionNormal);
    this.debugState.lastCollisionAngleDeg = MathUtils.radToDeg(
      Math.acos(MathUtils.clamp(lastCollisionNormal.dot(UP), -1, 1)),
    );
    this.debugState.recommendedStrafe = recommendedStrafe;
  }

  private removeIntoRamp(normal: Vector3): void {
    const into = this.velocity.dot(normal);
    if (into < 0) {
      this.velocity.addScaledVector(normal, -into);
    }
  }

  private isIntoAnyPlane(velocity: Vector3, planes: Vector3[]): boolean {
    for (const plane of planes) {
      if (velocity.dot(plane) < -1e-6) {
        return true;
      }
    }
    return false;
  }

  private getSurfNormalFromProbe(groundProbe: GroundProbe | null): Vector3 | null {
    if (!groundProbe) {
      return null;
    }
    const normal = this.upwardNormal(groundProbe.normal);
    const walkableAngle = this.getWalkableAngleDeg();
    if (
      groundProbe.distance > SURF_PROBE_DIST ||
      groundProbe.slopeAngleDeg <= walkableAngle ||
      groundProbe.slopeAngleDeg < this.cvars.surf_min_angle_deg ||
      groundProbe.slopeAngleDeg > this.cvars.surf_max_angle_deg
    ) {
      return null;
    }
    return normal;
  }

  private getSurfNormalFromNormal(normal: Vector3 | null): Vector3 | null {
    if (!normal) {
      return null;
    }
    const normalized = this.upwardNormal(normal);
    const walkableAngle = this.getWalkableAngleDeg();
    const angle = MathUtils.radToDeg(Math.acos(MathUtils.clamp(normalized.dot(UP), -1, 1)));
    if (
      angle <= walkableAngle
      || angle < this.cvars.surf_min_angle_deg
      || angle > this.cvars.surf_max_angle_deg
    ) {
      return null;
    }
    return normalized;
  }

  private getWalkableAngleDeg(): number {
    return Math.min(WALKABLE_MAX_ANGLE_DEG, this.cvars.surf_min_angle_deg - WALKABLE_EPS);
  }

  private recoverSurfEdgeSpeed(previousVelocity: Vector3, surfNormal: Vector3, speedBeforeCollision: number): void {
    const currentSpeed = this.velocity.length();
    if (speedBeforeCollision <= 1e-4 || currentSpeed >= speedBeforeCollision * 0.6) {
      return;
    }

    const rescuedVelocity = clipVelocity(previousVelocity, surfNormal, this.cvars.overbounce);
    const into = rescuedVelocity.dot(surfNormal);
    if (into < 0) {
      rescuedVelocity.addScaledVector(surfNormal, -into);
    }

    const rescuedSpeed = rescuedVelocity.length();
    if (rescuedSpeed <= currentSpeed + 0.05) {
      return;
    }

    const cappedSpeed = Math.min(rescuedSpeed, speedBeforeCollision * 0.97);
    if (cappedSpeed <= 1e-4) {
      return;
    }
    rescuedVelocity.setLength(cappedSpeed);
    this.velocity.copy(rescuedVelocity);
  }

  private upwardNormal(normal: Vector3): Vector3 {
    const n = normal.clone().normalize();
    if (n.y < 0) {
      n.negate();
    }
    return n;
  }
}
