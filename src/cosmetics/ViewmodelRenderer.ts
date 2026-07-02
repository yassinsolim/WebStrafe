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
export class ViewmodelRenderer {
  public readonly scene = new Scene();
  public readonly camera: PerspectiveCamera;
  public readonly root = new Group();

  /** Dynamic position delta this frame (guns apply this on top of their pose). */
  public readonly motionPos = new Vector3();
  /** Dynamic rotation delta this frame (XYZ euler). */
  public readonly motionRot = new Euler();

  private inspectTimer = 0;
  private walkTimer = 0;
  private inspectDuration = 1.1;

  // Eased sway state (position + rotation lag behind the view).
  private swayX = 0;
  private swayY = 0;
  private swayRotX = 0;
  private swayRotY = 0;

  // Vertical-velocity driven dip.
  private prevVy = 0;
  private landKick = 0;

  // Recoil kick accumulator (0..1+), decays each frame.
  private fireKick = 0;

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
  }

  /** Adds a recoil kick (weapon punches back + up, then recovers). */
  public addFireKick(amount = 1): void {
    this.fireKick = Math.min(1.4, this.fireKick + amount);
  }

  public update(
    dt: number,
    worldCamera: Camera,
    velocity: Vector3,
    lookDelta: { x: number; y: number },
  ): number {
    // Keep the viewmodel camera aligned to the player view camera.
    this.camera.position.copy(worldCamera.position);
    this.camera.quaternion.copy(worldCamera.quaternion);

    const ms = this.motionScale;
    const speed = Math.hypot(velocity.x, velocity.z);
    const moveAmt = Math.min(1, speed / 8) * ms; // 0 when still, ~1 at run speed

    // --- Walk/run bob (figure-8: horizontal at step freq, vertical at 2x). ---
    this.walkTimer += dt * (5 + Math.min(6, speed * 0.7));
    const bobX = Math.sin(this.walkTimer) * 0.011 * moveAmt;
    const bobY = Math.cos(this.walkTimer * 2) * 0.007 * moveAmt;
    const bobRoll = Math.sin(this.walkTimer) * 0.02 * moveAmt;

    // --- Sway: weapon lags behind view rotation, in both position and angle. ---
    const clamp = (v: number, m: number): number => Math.max(-m, Math.min(m, v));
    this.swayX = this.lerp(this.swayX, clamp(-lookDelta.x * 0.00022 * ms, 0.03), 0.14);
    this.swayY = this.lerp(this.swayY, clamp(lookDelta.y * 0.00022 * ms, 0.03), 0.14);
    this.swayRotY = this.lerp(this.swayRotY, clamp(-lookDelta.x * 0.0002 * ms, 0.06), 0.12);
    this.swayRotX = this.lerp(this.swayRotX, clamp(lookDelta.y * 0.0002 * ms, 0.06), 0.12);

    // --- Sprint lower: drop + pitch the weapon down when moving fast. ---
    const lowerY = -0.02 * moveAmt;
    const lowerPitch = 0.06 * moveAmt;

    // --- Jump/land dip driven by vertical velocity. ---
    if (this.prevVy < -6 && velocity.y > -1) {
      // Just landed: punch scales with impact speed.
      this.landKick = Math.min(1, Math.abs(this.prevVy) / 18);
    }
    this.prevVy = velocity.y;
    this.landKick = Math.max(0, this.landKick - dt * 4.5);
    const landEase = this.landKick * this.landKick;
    const airLift = clamp(velocity.y / 12, 1) * 0.01 * ms; // subtle rise while rising
    const dipY = -landEase * 0.05 + airLift;
    const dipPitch = landEase * 0.13;

    // --- Fire kick: back (+Z) and muzzle up (−pitch), quick recovery. ---
    this.fireKick = Math.max(0, this.fireKick - dt * 9);
    const kick = this.fireKick;
    const kickZ = kick * 0.045;
    const kickPitch = -kick * 0.11;

    // --- Inspect (knife twirl) — a one-shot that eases back to idle. ---
    if (this.inspectTimer > 0) {
      this.inspectTimer = Math.max(0, this.inspectTimer - dt);
    }
    const inspectAlpha = easeOutCubic(1 - this.inspectTimer / this.inspectDuration);
    const inspectWeight = this.inspectTimer > 0 ? inspectAlpha : 0;

    // --- Compose the dynamic delta (shared by knife + guns). ---
    this.motionPos.set(
      bobX + this.swayX,
      bobY + this.swayY + lowerY + dipY,
      kickZ,
    );
    this.motionRot.set(
      this.swayRotX + lowerPitch + dipPitch + kickPitch,
      this.swayRotY,
      bobRoll,
    );

    // Knife root = base offset + dynamic delta.
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
}

function easeOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - (1 - x) * (1 - x) * (1 - x);
}
