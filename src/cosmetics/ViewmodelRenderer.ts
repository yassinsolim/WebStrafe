import {
  AmbientLight,
  DirectionalLight,
  Group,
  PerspectiveCamera,
  Scene,
} from 'three';
import type { Camera, Vector3 } from 'three';

export class ViewmodelRenderer {
  public readonly scene = new Scene();
  public readonly camera: PerspectiveCamera;
  public readonly root = new Group();

  private inspectTimer = 0;
  private walkTimer = 0;
  private inspectDuration = 1.1;

  private swayX = 0;
  private swayY = 0;
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

    const ambient = new AmbientLight(0xffffff, 0.72);
    this.scene.add(ambient);

    const key = new DirectionalLight(0xffffff, 1.05);
    key.position.set(1.5, 1.8, 2.2);
    this.scene.add(key);
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

  public update(
    dt: number,
    worldCamera: Camera,
    horizontalVelocity: Vector3,
    lookDelta: { x: number; y: number },
  ): number {
    // Keep the viewmodel camera aligned to the player view camera.
    this.camera.position.copy(worldCamera.position);
    this.camera.quaternion.copy(worldCamera.quaternion);

    const speed = Math.hypot(horizontalVelocity.x, horizontalVelocity.z);
    this.walkTimer += dt * Math.min(1.8, speed * 0.25 + 0.3);
    const bobX = Math.sin(this.walkTimer * 8) * 0.012 * Math.min(1, speed / 8) * this.motionScale;
    const bobY = Math.abs(Math.sin(this.walkTimer * 16)) * 0.01 * Math.min(1, speed / 8) * this.motionScale;

    this.swayX = this.lerp(this.swayX, -lookDelta.x * 0.00018 * this.motionScale, 0.18);
    this.swayY = this.lerp(this.swayY, lookDelta.y * 0.00018 * this.motionScale, 0.18);

    if (this.inspectTimer > 0) {
      this.inspectTimer = Math.max(0, this.inspectTimer - dt);
    }
    const inspectAlpha = easeOutCubic(1 - this.inspectTimer / this.inspectDuration);
    const inspectWeight = this.inspectTimer > 0 ? inspectAlpha : 0;

    const baseX = this.integratedMode ? 0.12 : 0.18;
    const baseY = this.integratedMode ? -0.14 : -0.18;
    const baseZ = this.integratedMode ? -0.28 : -0.35;
    const basePitch = this.integratedMode ? 0.01 : 0.02;
    const baseYaw = this.integratedMode ? -0.01 : -0.02;

    this.root.position.set(baseX + bobX + this.swayX, baseY - bobY + this.swayY, baseZ);
    this.root.rotation.set(
      basePitch + this.swayY * 3.5,
      baseYaw + this.swayX * 4.5,
      Math.sin(this.walkTimer * 4) * 0.02 * Math.min(1, speed / 8) * this.motionScale,
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
