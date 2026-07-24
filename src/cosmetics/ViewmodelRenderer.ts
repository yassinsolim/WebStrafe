import {
  AmbientLight,
  DirectionalLight,
  Euler,
  Group,
  PerspectiveCamera,
  Scene,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import type { GunId } from './WeaponViewmodels';

/**
 * Drives the first-person viewmodel camera and computes the CS2-inspired
 * procedural weapon motion (sway/lag, walk bob, sprint lower, jump/land dip,
 * fire kick). See docs/VIEWMODEL_FEEL.md.
 *
 * Every frame it produces a small dynamic transform delta ({@link motionPos} +
 * {@link motionRot}). It applies `base + delta` to its own `root` (the knife),
 * and exposes the raw delta so GameApp can apply the *same* motion to the gun
 * viewmodels (which hang off the camera directly), so guns are no longer
 * statically pinned to the view.
 */
interface MotionProfile {
  bob: number;
  sway: number;
  rotationSway: number;
  lower: number;
}

const KNIFE_MOTION: MotionProfile = {
  bob: 1.12,
  sway: 1.08,
  rotationSway: 1.12,
  lower: 0.72,
};

const FIREARM_MOTION: Readonly<Record<GunId, MotionProfile>> = {
  deagle: {
    bob: 0.88,
    sway: 0.82,
    rotationSway: 0.78,
    lower: 0.82,
  },
  awp: {
    bob: 0.5,
    sway: 0.55,
    rotationSway: 0.62,
    lower: 0.58,
  },
};

export interface FirearmRecoilProfile {
  /** Fast kick onset before the longer authored recovery, in seconds. */
  attackSec: number;
  /** Total visual recoil window, in seconds. */
  durationSec: number;
  impulse: number;
  back: number;
  pitch: number;
  roll: number;
}

export const FIREARM_RECOIL_PROFILES: Readonly<Record<GunId, FirearmRecoilProfile>> = {
  deagle: {
    attackSec: 0.04,
    durationSec: 0.52,
    impulse: 0.94,
    back: 0.055,
    pitch: 0.145,
    roll: 0.032,
  },
  awp: {
    attackSec: 0.065,
    durationSec: 0.82,
    impulse: 1.16,
    back: 0.09,
    pitch: 0.205,
    roll: -0.02,
  },
};

export class ViewmodelRenderer {
  public readonly scene = new Scene();
  public readonly camera: PerspectiveCamera;
  public readonly root = new Group();

  /** Dynamic position delta this frame (guns apply this on top of their pose). */
  public readonly motionPos = new Vector3();
  /** Dynamic rotation delta this frame (XYZ euler). */
  public readonly motionRot = new Euler();

  private inspectTimer = 0;
  private inspectProgress = 0;
  private walkTimer = 0;
  private readonly inspectDuration = 2.4;

  // Eased sway state (position + rotation lag behind the view).
  private swayX = 0;
  private swayY = 0;
  private swayRotX = 0;
  private swayRotY = 0;

  // Vertical-velocity driven dip.
  private prevVy = 0;
  private landKick = 0;

  // Recoil and reload impulses are firearm-only and cleared on lifecycle changes.
  private fireKickAgeSec = Number.POSITIVE_INFINITY;
  private fireKickMagnitude = 0;
  private reloadTimer = 0;
  private reloadDuration = 0;
  private firearmId: GunId | null = null;

  private motionScale = 1;
  private integratedMode = false;

  constructor(viewmodelFov: number, aspect: number) {
    this.camera = new PerspectiveCamera(viewmodelFov, aspect, 0.01, 12);
    this.camera.name = 'ViewmodelCamera';

    this.root.name = 'ViewmodelRoot';
    this.camera.add(this.root);
    this.scene.add(this.camera);

    this.root.position.set(0.18, -0.18, -0.35);
    this.root.rotation.set(0.02, -0.02, 0);

    const ambient = new AmbientLight(0xffffff, 0.95);
    this.scene.add(ambient);

    const key = new DirectionalLight(0xffffff, 1.35);
    key.position.set(1.5, 1.8, 2.2);
    this.scene.add(key);

    // Fill from the opposite side so the weapon never reads as a flat black
    // silhouette (the gun textures are quite dark).
    const fill = new DirectionalLight(0xbcd2ff, 0.55);
    fill.position.set(-1.6, 0.4, -1.2);
    this.scene.add(fill);
  }

  public resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  public setFov(fov: number): void {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  public setMotionScale(scale: number): void {
    this.motionScale = Math.max(0, Math.min(1, scale));
  }

  public setIntegratedMode(enabled: boolean): void {
    this.integratedMode = enabled;
  }

  public triggerInspect(): void {
    this.inspectTimer = this.inspectDuration;
    this.inspectProgress = 0;
  }

  public cancelInspect(): void {
    this.inspectTimer = 0;
    this.inspectProgress = 0;
  }

  public getInspectProgress(): number {
    return this.inspectProgress;
  }

  /** Adds a recoil kick (weapon punches back + up, then recovers). */
  public setFirearm(weaponId: GunId | null): void {
    if (this.firearmId === weaponId) {
      return;
    }
    this.cancelInspect();
    this.firearmId = weaponId;
    this.clearFirearmTransient();
  }

  public triggerReload(durationMs: number): void {
    if (!this.firearmId) {
      return;
    }
    this.cancelInspect();
    this.reloadDuration = Math.max(0.1, durationMs / 1000);
    this.reloadTimer = this.reloadDuration;
  }

  public clearFirearmTransient(): void {
    this.fireKickAgeSec = Number.POSITIVE_INFINITY;
    this.fireKickMagnitude = 0;
    this.reloadTimer = 0;
    this.reloadDuration = 0;
  }


  public clearPresentationTransient(): void {
    this.clearFirearmTransient();
    this.cancelInspect();
    this.walkTimer = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.swayRotX = 0;
    this.swayRotY = 0;
    this.prevVy = 0;
    this.landKick = 0;
    this.motionPos.set(0, 0, 0);
    this.motionRot.set(0, 0, 0);
  }

  public addFireKick(weaponId: GunId): void {
    this.cancelInspect();
    const profile = FIREARM_RECOIL_PROFILES[weaponId];
    const carried = this.firearmId === weaponId
      ? this.sampleFireKick(profile, this.fireKickAgeSec) * this.fireKickMagnitude
      : 0;
    this.fireKickMagnitude = Math.min(
      1.35,
      Math.max(profile.impulse, carried + profile.impulse * 0.65),
    );
    this.fireKickAgeSec = 0;
  }

  public update(
    dt: number,
    worldCamera: Camera,
    velocity: Vector3,
    lookDelta: { x: number; y: number },
  ): number {
    this.camera.position.copy(worldCamera.position);
    this.camera.quaternion.copy(worldCamera.quaternion);

    // The integrated knife rig was authored close to camera-space neutral, so it
    // needs more readable procedural travel than its large baked hand clips.
    // Firearm scale remains byte-for-byte equivalent to the polished profiles.
    const knifeIntegratedGain = this.integratedMode && !this.firearmId ? 7 : 1;
    const ms = Math.min(1, this.motionScale * knifeIntegratedGain);
    const profile = this.firearmId ? FIREARM_MOTION[this.firearmId] : KNIFE_MOTION;
    const speed = Math.hypot(velocity.x, velocity.z);
    const moveAmt = Math.min(1, speed / 8) * ms;

    this.walkTimer += dt * (5 + Math.min(6, speed * 0.7));
    const bobX = Math.sin(this.walkTimer) * 0.011 * moveAmt * profile.bob;
    const bobY = Math.cos(this.walkTimer * 2) * 0.007 * moveAmt * profile.bob;
    const bobRoll = Math.sin(this.walkTimer) * 0.02 * moveAmt * profile.bob;

    const clamp = (value: number, magnitude: number): number =>
      Math.max(-magnitude, Math.min(magnitude, value));
    const frameStableAlpha = (alphaAt60Fps: number): number =>
      1 - (1 - alphaAt60Fps) ** (Math.max(0, dt) * 60);
    const positionSwayAlpha = this.firearmId ? 0.14 : frameStableAlpha(0.14);
    const rotationSwayAlpha = this.firearmId ? 0.12 : frameStableAlpha(0.12);
    this.swayX = this.lerp(
      this.swayX,
      clamp(-lookDelta.x * 0.00022 * ms * profile.sway, 0.03),
      positionSwayAlpha,
    );
    this.swayY = this.lerp(
      this.swayY,
      clamp(lookDelta.y * 0.00022 * ms * profile.sway, 0.03),
      positionSwayAlpha,
    );
    this.swayRotY = this.lerp(
      this.swayRotY,
      clamp(-lookDelta.x * 0.0002 * ms * profile.rotationSway, 0.06),
      rotationSwayAlpha,
    );
    this.swayRotX = this.lerp(
      this.swayRotX,
      clamp(lookDelta.y * 0.0002 * ms * profile.rotationSway, 0.06),
      rotationSwayAlpha,
    );

    const lowerY = -0.02 * moveAmt * profile.lower;
    const lowerPitch = 0.06 * moveAmt * profile.lower;

    if (this.prevVy < -6 && velocity.y > -1) {
      this.landKick = Math.min(1, Math.abs(this.prevVy) / 18);
    }
    this.prevVy = velocity.y;
    this.landKick = Math.max(0, this.landKick - dt * 4.5);
    const landEase = this.landKick * this.landKick;
    const knifeLandScale = this.firearmId ? 1 : 0.78;
    const airLift = clamp(velocity.y / 12, 1) * 0.01 * ms;
    const dipY = -landEase * 0.05 * knifeLandScale + airLift;
    const dipPitch = landEase * 0.13 * knifeLandScale;

    let kickZ = 0;
    let kickPitch = 0;
    let kickRoll = 0;
    if (this.firearmId) {
      const recoil = FIREARM_RECOIL_PROFILES[this.firearmId];
      this.fireKickAgeSec = Math.min(
        recoil.durationSec,
        this.fireKickAgeSec + Math.max(0, dt),
      );
      const kick = this.sampleFireKick(recoil, this.fireKickAgeSec)
        * this.fireKickMagnitude;
      kickZ = kick * recoil.back;
      kickPitch = -kick * recoil.pitch;
      kickRoll = kick * recoil.roll;
      if (this.fireKickAgeSec >= recoil.durationSec) {
        this.fireKickMagnitude = 0;
      }
    }

    let reloadDip = 0;
    let reloadPitch = 0;
    let reloadRoll = 0;
    if (this.reloadTimer > 0 && this.reloadDuration > 0) {
      this.reloadTimer = Math.max(0, this.reloadTimer - dt);
      const progress = 1 - this.reloadTimer / this.reloadDuration;
      const envelope = Math.sin(Math.PI * progress);
      reloadDip = (this.firearmId === 'awp' ? 0.015 : 0.08) * envelope;
      reloadPitch = 0.12 * envelope;
      const direction = this.firearmId === 'awp' ? -1 : 1;
      reloadRoll = direction * 0.1 * Math.sin(Math.PI * 2 * progress) * envelope;
    }

    if (this.inspectTimer > 0) {
      this.inspectTimer = Math.max(0, this.inspectTimer - dt);
      if (this.inspectTimer < 1e-6) {
        this.inspectTimer = 0;
      }
    }
    this.inspectProgress = this.inspectTimer > 0
      ? 1 - this.inspectTimer / this.inspectDuration
      : 0;
    const inspectWeight = this.inspectTimer > 0
      ? sampleInspectWeight(this.inspectProgress)
      : 0;

    this.motionPos.set(
      bobX + this.swayX,
      bobY + this.swayY + lowerY + dipY + reloadDip,
      kickZ,
    );
    this.motionRot.set(
      this.swayRotX + lowerPitch + dipPitch + kickPitch + reloadPitch,
      this.swayRotY,
      bobRoll + kickRoll + reloadRoll,
    );

    const baseX = this.integratedMode ? 0.12 : 0.18;
    const baseY = this.integratedMode ? -0.14 : -0.18;
    const baseZ = this.integratedMode ? -0.28 : -0.35;
    const basePitch = this.integratedMode ? 0.01 : 0.02;
    const baseYaw = this.integratedMode ? -0.01 : -0.02;

    this.root.position.set(
      baseX + this.motionPos.x,
      baseY + this.motionPos.y,
      baseZ + this.motionPos.z,
    );
    this.root.rotation.set(
      basePitch + this.motionRot.x,
      baseYaw + this.motionRot.y,
      this.motionRot.z,
    );

    return inspectWeight;
  }

  private lerp(current: number, target: number, alpha: number): number {
    return current + (target - current) * alpha;
  }

  private sampleFireKick(profile: FirearmRecoilProfile, ageSec: number): number {
    if (!Number.isFinite(ageSec) || ageSec >= profile.durationSec) {
      return 0;
    }
    if (ageSec <= profile.attackSec) {
      return easeOutCubic(ageSec / profile.attackSec);
    }
    const recovery = Math.min(
      1,
      (ageSec - profile.attackSec) / (profile.durationSec - profile.attackSec),
    );
    // Cosine recovery keeps a readable shoulder/slide displacement through
    // ordinary capture latency, then reaches zero without a snap.
    return Math.cos(recovery * Math.PI * 0.5) ** 1.35;
  }
}

function easeOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - (1 - x) * (1 - x) * (1 - x);
}

function easeInOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5
    ? 4 * x * x * x
    : 1 - (-2 * x + 2) ** 3 / 2;
}

function sampleInspectWeight(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress));
  if (clamped < 0.22) {
    return easeInOutCubic(clamped / 0.22);
  }
  if (clamped > 0.7) {
    return easeInOutCubic((1 - clamped) / 0.3);
  }
  return 1;
}
