import {
  AmbientLight,
  Color,
  DirectionalLight,
  Euler,
  Group,
  HemisphereLight,
  PerspectiveCamera,
  PointLight,
  Scene,
  Vector3,
} from 'three';
import type { Camera, Texture } from 'three';
import type { FirearmId as GunId } from '../combat/FirearmTiming';
import type { QualityPreset } from '../render/quality';
import { createSpring, dampingFromHalflife, springStep, type SpringState } from '../viewmodel/motion';

/**
 * the world's environment light on the viewmodel is scaled up a little so dark
 * gloves and steel still read against a sunlit floor the exposure is set for
 */
const VIEWMODEL_ENV_LIFT = 1.2;

export interface ViewmodelWorldLighting {
  environment: Texture | null;
  environmentIntensity: number;
  /** world space, towards the sun */
  sunDirection: Vector3;
  sunColor: Color;
  sunIntensity: number;
  /** 0 in full shadow, 1 in the open */
  sunVisibility: number;
  hemiSky: Color;
  hemiGround: Color;
  hemiIntensity: number;
}

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
  /** how quickly the sway catches up with the view (critically damped halflife, seconds); heavier guns lag more */
  swayHalflife: number;
}

const KNIFE_MOTION: MotionProfile = {
  bob: 1.12,
  sway: 1.08,
  rotationSway: 1.12,
  lower: 0.72,
  swayHalflife: 0.06,
};

const FIREARM_MOTION: Readonly<Record<GunId, MotionProfile>> = {
  deagle: {
    bob: 0.88,
    sway: 0.82,
    rotationSway: 0.78,
    lower: 0.82,
    swayHalflife: 0.07,
  },
  awp: {
    bob: 0.5,
    sway: 0.55,
    rotationSway: 0.62,
    lower: 0.58,
    swayHalflife: 0.09,
  },
};

// the sway gains were tuned on one 60 fps frame of mouse movement; they now
// take the look rate (per second), so the same flick sways the same at any fps
const LOOK_RATE_TO_FRAME = 1 / 60;
// walk bob fades in and out with leaving and touching the ground, and with speed
const GROUND_HALFLIFE = 0.08;
const MOVE_HALFLIFE = 0.12;
// landing: the fall's speed goes into a spring, so the dip builds over a few frames and settles
const LAND_HALFLIFE = 0.1;
const AIR_HALFLIFE = 0.08;
// stacked recoil softly tops out here
const KICK_LIMIT = 1.35;
const KICK_KNEE = 1;
const MAX_KICKS = 4;

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

  // Sway (position + rotation lag behind the view), on springs.
  private readonly swayX = createSpring();
  private readonly swayY = createSpring();
  private readonly swayRotX = createSpring();
  private readonly swayRotY = createSpring();

  // how much the walk bob shows: on the ground, and moving
  private readonly groundBlend = createSpring(1);
  private readonly moveBlend = createSpring();

  // Vertical-velocity driven dip and lift.
  private prevVy = 0;
  private wasGrounded = true;
  private readonly land = createSpring();
  private readonly air = createSpring();

  // Recoil kicks (each recovering on its own, summed) and the reload envelope are
  // firearm-only and cleared on lifecycle changes.
  private readonly kicks: { age: number; magnitude: number }[] = [];
  private reloadTimer = 0;
  private reloadDuration = 0;
  private firearmId: GunId | null = null;

  private motionScale = 1;
  private integratedMode = false;

  private readonly ambient = new AmbientLight(0xffffff, 0.95);
  private readonly key = new DirectionalLight(0xffffff, 1.35);
  private readonly fill = new DirectionalLight(0xbcd2ff, 0.55);
  private readonly sun = new DirectionalLight(0xffffff, 1);
  private readonly hemi = new HemisphereLight();
  private readonly flash = new PointLight(0xffc27a, 0, 1.6, 2);
  private studioEnvironment: Texture | null = null;
  private flashEnabled = true;
  private flashStrength = 0;
  private flashAge = 0;

  constructor(viewmodelFov: number, aspect: number) {
    this.camera = new PerspectiveCamera(viewmodelFov, aspect, 0.01, 12);
    this.camera.name = 'ViewmodelCamera';

    this.root.name = 'ViewmodelRoot';
    this.camera.add(this.root);
    this.scene.add(this.camera);

    this.root.position.set(0.18, -0.18, -0.35);
    this.root.rotation.set(0.02, -0.02, 0);

    this.scene.add(this.ambient, this.key, this.fill, this.sun, this.sun.target, this.hemi, this.flash);
    this.key.position.set(1.5, 1.8, 2.2);
    // fill from the opposite side so the weapon never reads as a flat black silhouette
    this.fill.position.set(-1.6, 0.4, -1.2);
    this.sun.visible = false;
    this.hemi.visible = false;
    // the flash light always exists so firing never changes the light count (no shader recompiles)
    this.flash.intensity = 0;
  }

  /**
   * lights the viewmodel with the world: the map's sky capture, the sun from
   * its real direction (dimmed by `sunVisibility` when the player stands in
   * shadow) and the hemisphere light on maps without a sky. the viewmodel
   * camera copies the world camera, so this scene is already in world space.
   * falls back to the old studio rig when there is no world lighting.
   */
  public syncWorldLighting(world: ViewmodelWorldLighting): void {
    if (world.environment) {
      this.scene.environment = world.environment;
      this.scene.environmentIntensity = world.environmentIntensity * VIEWMODEL_ENV_LIFT;
    } else {
      this.scene.environment = this.studioEnvironment;
      this.scene.environmentIntensity = 1;
    }
    const lit = world.environment !== null || world.hemiIntensity > 0;
    this.ambient.visible = !lit;
    this.key.visible = !lit;
    this.fill.visible = !lit;
    this.sun.visible = lit;
    this.sun.color.copy(world.sunColor);
    this.sun.intensity = world.sunIntensity * world.sunVisibility;
    this.sun.position.copy(world.sunDirection).multiplyScalar(10);
    this.sun.target.position.set(0, 0, 0);
    this.hemi.visible = world.environment === null && world.hemiIntensity > 0;
    if (this.hemi.visible) {
      this.hemi.color.copy(world.hemiSky);
      this.hemi.groundColor.copy(world.hemiGround);
      this.hemi.intensity = world.hemiIntensity;
      this.hemi.position.set(0, 1, 0);
    }
  }

  /** studio lighting for the viewmodel when no map is loaded */
  public setStudioEnvironment(texture: Texture | null): void {
    this.studioEnvironment = texture;
    if (!this.sun.visible) {
      this.scene.environment = texture;
    }
  }

  public setQuality(preset: QualityPreset): void {
    this.flashEnabled = preset.level !== 'low';
    if (!this.flashEnabled) {
      this.flash.intensity = 0;
      this.flashStrength = 0;
    }
  }

  /** muzzle flash light at a point in viewmodel space, fades in `update` */
  public flashAt(position: Vector3, color: number, strength: number): void {
    if (!this.flashEnabled) return;
    this.flash.position.copy(position);
    this.flash.color.setHex(color);
    this.flashStrength = strength;
    this.flashAge = 0;
  }

  private updateFlash(dt: number): void {
    if (this.flashStrength <= 0) return;
    this.flashAge += dt;
    const t = this.flashAge / 0.06;
    if (t >= 1) {
      this.flashStrength = 0;
      this.flash.intensity = 0;
      return;
    }
    this.flash.intensity = this.flashStrength * (1 - t) * (1 - t);
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
    this.kicks.length = 0;
    this.reloadTimer = 0;
    this.reloadDuration = 0;
  }


  public clearPresentationTransient(): void {
    this.clearFirearmTransient();
    this.cancelInspect();
    this.walkTimer = 0;
    for (const spring of [this.swayX, this.swayY, this.swayRotX, this.swayRotY, this.moveBlend, this.land, this.air]) {
      spring.x = 0;
      spring.v = 0;
    }
    this.groundBlend.x = 1;
    this.groundBlend.v = 0;
    this.prevVy = 0;
    this.wasGrounded = true;
    this.motionPos.set(0, 0, 0);
    this.motionRot.set(0, 0, 0);
  }

  public addFireKick(weaponId: GunId): void {
    this.cancelInspect();
    if (this.firearmId !== weaponId) this.kicks.length = 0;
    // a new kick stacks on the ones still recovering instead of restarting them
    if (this.kicks.length >= MAX_KICKS) this.kicks.shift();
    this.kicks.push({ age: 0, magnitude: FIREARM_RECOIL_PROFILES[weaponId].impulse });
  }

  /**
   * `grounded`: whether the player stands on something (bob only plays on the
   * ground and landings dip on touching down). left out, it is guessed from
   * the vertical speed
   */
  public update(
    dt: number,
    worldCamera: Camera,
    velocity: Vector3,
    lookDelta: { x: number; y: number },
    grounded?: boolean,
  ): number {
    this.camera.position.copy(worldCamera.position);
    this.camera.quaternion.copy(worldCamera.quaternion);
    this.updateFlash(dt);
    const step = Math.max(0, dt);

    // The integrated knife rig was authored close to camera-space neutral, so it
    // needs more readable procedural travel than its large baked hand clips.
    const knifeIntegratedGain = this.integratedMode && !this.firearmId ? 7 : 1;
    const ms = Math.min(1, this.motionScale * knifeIntegratedGain);
    const profile = this.firearmId ? FIREARM_MOTION[this.firearmId] : KNIFE_MOTION;
    const speed = Math.hypot(velocity.x, velocity.z);
    const onGround = grounded ?? Math.abs(velocity.y) < 0.5;

    springStep(this.groundBlend, onGround ? 1 : 0, GROUND_HALFLIFE, step);
    springStep(this.moveBlend, Math.min(1, speed / 8), MOVE_HALFLIFE, step);
    const groundAmt = clamp01(this.groundBlend.x);
    const moveAmt = clamp01(this.moveBlend.x) * ms;
    // the bob only plays with feet on the ground (not while bhopping or surfing)
    const bobAmt = moveAmt * (grounded === undefined ? 1 : groundAmt);
    this.walkTimer += step * (5 + Math.min(6, speed * 0.7)) * (grounded === undefined ? 1 : groundAmt);
    const bobX = Math.sin(this.walkTimer) * 0.011 * bobAmt * profile.bob;
    const bobY = Math.cos(this.walkTimer * 2) * 0.007 * bobAmt * profile.bob;
    const bobRoll = Math.sin(this.walkTimer) * 0.02 * bobAmt * profile.bob;

    const clamp = (value: number, magnitude: number): number =>
      Math.max(-magnitude, Math.min(magnitude, value));
    // per second look rate scaled back to the per-frame gains, sprung so it reads as weight
    const lookX = step > 0 ? (lookDelta.x / step) * LOOK_RATE_TO_FRAME : 0;
    const lookY = step > 0 ? (lookDelta.y / step) * LOOK_RATE_TO_FRAME : 0;
    springStep(this.swayX, clamp(-lookX * 0.00022 * ms * profile.sway, 0.03), profile.swayHalflife, step);
    springStep(this.swayY, clamp(lookY * 0.00022 * ms * profile.sway, 0.03), profile.swayHalflife, step);
    springStep(this.swayRotY, clamp(-lookX * 0.0002 * ms * profile.rotationSway, 0.06), profile.swayHalflife, step);
    springStep(this.swayRotX, clamp(lookY * 0.0002 * ms * profile.rotationSway, 0.06), profile.swayHalflife, step);

    const lowerY = -0.02 * moveAmt * profile.lower;
    const lowerPitch = 0.06 * moveAmt * profile.lower;

    // a hard landing kicks the spring downward; it dips over a few frames and settles
    const touchedDown = grounded === undefined ? velocity.y > -1 : grounded && !this.wasGrounded;
    if (touchedDown && this.prevVy < -6) {
      const impact = Math.min(1, Math.abs(this.prevVy) / 18);
      this.land.v += impact * (dampingFromHalflife(LAND_HALFLIFE) / 2) * Math.E;
    }
    this.prevVy = velocity.y;
    this.wasGrounded = onGround;
    springStep(this.land, 0, LAND_HALFLIFE, step);
    springStep(this.air, clamp(velocity.y / 12, 1), AIR_HALFLIFE, step);
    settle(this.land);
    settle(this.air);
    const landEase = Math.max(0, this.land.x);
    const knifeLandScale = this.firearmId ? 1 : 0.78;
    const airLift = this.air.x * 0.01 * ms;
    const dipY = -landEase * 0.05 * knifeLandScale + airLift;
    const dipPitch = landEase * 0.13 * knifeLandScale;

    let kickZ = 0;
    let kickPitch = 0;
    let kickRoll = 0;
    if (this.firearmId && this.kicks.length > 0) {
      const recoil = FIREARM_RECOIL_PROFILES[this.firearmId];
      let total = 0;
      for (const kick of this.kicks) {
        kick.age = Math.min(recoil.durationSec, kick.age + step);
        total += this.sampleFireKick(recoil, kick.age) * kick.magnitude;
      }
      for (let i = this.kicks.length - 1; i >= 0; i -= 1) {
        if (this.kicks[i].age >= recoil.durationSec) this.kicks.splice(i, 1);
      }
      const kick = softLimit(total);
      kickZ = kick * recoil.back;
      kickPitch = -kick * recoil.pitch;
      kickRoll = kick * recoil.roll;
    }

    let reloadDip = 0;
    let reloadPitch = 0;
    let reloadRoll = 0;
    if (this.reloadTimer > 0 && this.reloadDuration > 0) {
      this.reloadTimer = Math.max(0, this.reloadTimer - step);
      const progress = 1 - this.reloadTimer / this.reloadDuration;
      // eases in and out (a plain sine starts and ends at full speed)
      const envelope = Math.sin(Math.PI * progress) ** 2;
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
      bobX + this.swayX.x,
      bobY + this.swayY.x + lowerY + dipY + reloadDip,
      kickZ,
    );
    this.motionRot.set(
      this.swayRotX.x + lowerPitch + dipPitch + kickPitch + reloadPitch,
      this.swayRotY.x,
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

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** stacked kicks pass through up to the knee, then round off toward the limit */
function softLimit(total: number): number {
  if (total <= KICK_KNEE) return total;
  const room = KICK_LIMIT - KICK_KNEE;
  return KICK_KNEE + room * Math.tanh((total - KICK_KNEE) / room);
}

/** a spring that has all but stopped is put to rest, so motion ends at exactly zero */
function settle(spring: SpringState): void {
  if (Math.abs(spring.x) < 1e-4 && Math.abs(spring.v) < 1e-3) {
    spring.x = 0;
    spring.v = 0;
  }
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
