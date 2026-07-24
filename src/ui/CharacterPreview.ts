import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PointLight,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  addPlayerEyeDetails,
  applyKnifeIdlePose,
  attachKnifeModel,
  buildArmRig,
  loadKnifeMesh,
  type ArmRig,
} from '../multiplayer/playerRig';

const TARGET_HEIGHT = 1.85;
const TAU = Math.PI * 2;
const FRAME_PADDING = 1.18;

/** Slow normalized breathing cycle for the preview skeleton. */
export function previewBreath(elapsedMs: number, periodMs = 4400): number {
  return Math.sin((elapsedMs / periodMs) * TAU);
}

/** Camera distance that fits a complete bounding box in a perspective frame. */
export function previewCameraDistance(
  width: number,
  height: number,
  depth: number,
  aspect: number,
  verticalFovDeg: number,
  padding = FRAME_PADDING,
): number {
  const verticalFov = (verticalFovDeg * Math.PI) / 180;
  const safeAspect = Math.max(0.1, aspect);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * safeAspect);
  const verticalDistance = (height * 0.5 * padding) / Math.tan(verticalFov / 2);
  const horizontalDistance = (width * 0.5 * padding) / Math.tan(horizontalFov / 2);
  return Math.max(verticalDistance, horizontalDistance) + depth * 0.5;
}

const loader = new GLTFLoader();

/**
 * Self-contained 3D character stage for the main menu. Owns its own transparent
 * WebGL renderer + scene, loads a player model GLB, and animates a restrained
 * breathing pose with a soft rim light. Paused while hidden to save the GPU.
 * Completely independent of the game's renderer.
 */
export class CharacterPreview {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly pivot = new Group();
  private current: Object3D | null = null;
  private currentBounds: Box3 | null = null;
  private currentRig: ArmRig | null = null;
  private loadToken = 0;
  private knifePromise: Promise<Object3D | null> | null = null;
  private rafHandle: number | null = null;
  private startTime = 0;
  private baseYaw = 0;
  private running = false;
  private readonly resizeObserver: ResizeObserver;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.domElement.className = 'character-preview-canvas';
    container.appendChild(this.renderer.domElement);

    this.camera = new PerspectiveCamera(32, 1, 0.1, 100);
    this.camera.position.set(0, 1.12, 4.2);
    this.camera.lookAt(0, 1.0, 0);

    this.scene.add(this.pivot);
    this.setupLights();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  private setupLights(): void {
    const hemi = new HemisphereLight(0xdfeaff, 0x0a0c12, 1.1);
    this.scene.add(hemi);

    const ambient = new AmbientLight(0xffffff, 0.35);
    this.scene.add(ambient);

    // Warm key light from the front-upper-left.
    const key = new DirectionalLight(0xfff2e6, 2.2);
    key.position.set(-2.4, 3.4, 3.2);
    this.scene.add(key);

    // Cool fill from the right to shape the form.
    const fill = new DirectionalLight(0xaecbff, 0.7);
    fill.position.set(3.0, 1.6, 1.4);
    this.scene.add(fill);

    // Hot rim/back light for a gamey edge glow.
    const rim = new PointLight(0xff7a2c, 3.2, 12, 2);
    rim.position.set(0.6, 2.6, -2.6);
    this.scene.add(rim);
  }

  /** Loads and frames a player model GLB, replacing any current one. */
  async setModel(url: string): Promise<void> {
    const token = ++this.loadToken;
    let root: Object3D;
    try {
      const gltf = await loader.loadAsync(url);
      root = gltf.scene;
    } catch {
      return;
    }
    if (token !== this.loadToken) {
      return; // a newer load superseded this one
    }

    this.clearModel();
    normalizeToHeight(root, TARGET_HEIGHT);
    addPlayerEyeDetails(root);
    root.traverse((child) => {
      if (child instanceof Mesh) {
        child.castShadow = false;
        child.receiveShadow = false;
        child.frustumCulled = false;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
          const std = material as MeshStandardMaterial;
          if (std.map) {
            std.map.colorSpace = SRGBColorSpace;
          }
          std.needsUpdate = true;
        }
      }
    });

    // Pose the arms into the combat knife-hold stance and put a knife in hand,
    // so the menu character matches the in-game models instead of T-posing.
    const rig = buildArmRig(root);
    if (rig) {
      const knife = await this.getKnife();
      if (token !== this.loadToken) {
        return; // superseded while the knife loaded
      }
      attachKnifeModel(rig.rightWeaponHand, knife);
      applyKnifeIdlePose(rig);
      this.currentRig = rig;
    }

    this.current = root;
    this.pivot.add(root);
    root.updateWorldMatrix(true, true);
    this.currentBounds = new Box3().setFromObject(root);
    this.frameCurrentModel();
  }

  private getKnife(): Promise<Object3D | null> {
    if (!this.knifePromise) {
      this.knifePromise = loadKnifeMesh(loader);
    }
    return this.knifePromise;
  }

  /** Static model yaw in radians. */
  setBaseYaw(yaw: number): void {
    this.baseYaw = yaw;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.startTime = performance.now();
    const loop = () => {
      if (!this.running) {
        return;
      }
      const elapsed = performance.now() - this.startTime;
      this.pivot.rotation.y = this.baseYaw;
      this.pivot.position.y = 0;
      if (this.currentRig) {
        applyKnifeIdlePose(this.currentRig, previewBreath(elapsed));
      }
      this.renderer.render(this.scene, this.camera);
      this.rafHandle = requestAnimationFrame(loop);
    };
    this.rafHandle = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
  }

  dispose(): void {
    this.stop();
    this.resizeObserver.disconnect();
    this.clearModel();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private clearModel(): void {
    if (!this.current) {
      return;
    }
    this.pivot.remove(this.current);
    this.currentBounds = null;
    this.currentRig = null;
    // The attached knife is a clone that SHARES geometry/materials with the
    // cached knife template — detach it so we don't dispose those shared
    // resources (which would break the knife on the next model load).
    const knife = this.current.getObjectByName('RemoteKnifeModel');
    knife?.parent?.remove(knife);
    this.current.traverse((child) => {
      if (child instanceof Mesh) {
        child.geometry.dispose();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
          material.dispose();
        }
      }
    });
    this.current = null;
  }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.frameCurrentModel();
  }

  private frameCurrentModel(): void {
    if (!this.currentBounds) {
      return;
    }
    const size = this.currentBounds.getSize(new Vector3());
    const center = this.currentBounds.getCenter(new Vector3());
    const distance = previewCameraDistance(
      size.x,
      size.y,
      size.z,
      this.camera.aspect,
      this.camera.fov,
    );
    const targetY = center.y - size.y * 0.025;
    this.camera.position.set(center.x, targetY, center.z + distance);
    this.camera.lookAt(center.x, targetY, center.z);
  }
}

/** Scales a model to a target height and re-centres it with feet at y=0. */
function normalizeToHeight(root: Object3D, targetHeight: number): void {
  root.updateWorldMatrix(true, true);
  const box = new Box3().setFromObject(root);
  const size = box.getSize(new Vector3());
  if (size.y > 1e-4) {
    root.scale.multiplyScalar(targetHeight / size.y);
  }
  root.updateWorldMatrix(true, true);
  const scaled = new Box3().setFromObject(root);
  const center = scaled.getCenter(new Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= scaled.min.y;
}

export const PREVIEW_BG = new Color(0x0a0c12);
