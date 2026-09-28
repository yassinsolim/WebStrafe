import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  CanvasTexture,
  CircleGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  PMREMGenerator,
  PointLight,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { PlayerModel } from '../network/types';
import { createCharacter, type CharacterHandle } from '../characters/CharacterFactory';
import { defaultLook, type CharacterLook } from '../characters/look';
import { attachKnifeModel, loadKnifeMesh } from '../multiplayer/playerRig';

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

// the armored characters are authored at real scale; the stage frames this box
const STAGE_BOUNDS = new Box3(new Vector3(-0.42, 0, -0.3), new Vector3(0.42, 1.86, 0.3));

/**
 * Self-contained 3D character stage for the main menu: its own transparent
 * renderer and scene with the player's armored character in the knife stance,
 * lit by a studio environment so paint finishes read. Paused while hidden.
 */
export class CharacterPreview {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly pivot = new Group();
  private character: CharacterHandle | null = null;
  private look: CharacterLook = defaultLook('terrorist');
  private team: PlayerModel = 'terrorist';
  private loadToken = 0;
  private knifePromise: Promise<Object3D | null> | null = null;
  private rafHandle: number | null = null;
  private startTime = 0;
  private lastFrame = 0;
  private baseYaw = 0;
  private running = false;
  private readonly resizeObserver: ResizeObserver;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.domElement.className = 'character-preview-canvas';
    container.appendChild(this.renderer.domElement);

    this.camera = new PerspectiveCamera(30, 1, 0.1, 100);
    this.camera.position.set(0, 1.12, 4.2);
    this.camera.lookAt(0, 1.0, 0);

    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.5;
    pmrem.dispose();

    this.scene.add(this.pivot);
    this.setupLights();
    this.setupFloor();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  private setupLights(): void {
    this.scene.add(new HemisphereLight(0xdfeaff, 0x0a0c12, 0.7));
    this.scene.add(new AmbientLight(0xffffff, 0.08));
    // warm key from the front-upper-left
    const key = new DirectionalLight(0xfff2e6, 2.3);
    key.position.set(-2.4, 3.4, 3.2);
    this.scene.add(key);
    // cool fill from the right
    const fill = new DirectionalLight(0xaecbff, 0.6);
    fill.position.set(3.0, 1.6, 1.4);
    this.scene.add(fill);
    // hot rim from behind for the silhouette
    const rim = new PointLight(0xff7a2c, 3.2, 12, 2);
    rim.position.set(0.6, 2.6, -2.6);
    this.scene.add(rim);
    const rimCool = new DirectionalLight(0x8fb8ff, 1.2);
    rimCool.position.set(-2.5, 2.2, -3.5);
    this.scene.add(rimCool);
  }

  private setupFloor(): void {
    // a soft contact shadow under the feet
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const mat = new MeshBasicMaterial({ map: new CanvasTexture(canvas), transparent: true, depthWrite: false });
    const shadow = new Mesh(new CircleGeometry(0.55, 32), mat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.002;
    this.scene.add(shadow);
  }

  /** Shows the team's side (keeps the current look). */
  async setModel(model: PlayerModel): Promise<void> {
    this.team = model;
    await this.rebuild();
  }

  /** Shows a look, for the given team when passed. */
  async setLook(look: CharacterLook, team: PlayerModel = this.team): Promise<void> {
    this.look = look;
    const teamChanged = team !== this.team;
    this.team = team;
    if (this.character && !teamChanged) {
      this.character.setLook(look, team);
      return;
    }
    await this.rebuild();
  }

  private async rebuild(): Promise<void> {
    const token = ++this.loadToken;
    if (this.character) {
      this.character.setLook(this.look, this.team);
      return;
    }
    const [character, knife] = await Promise.all([
      createCharacter(this.look, this.team, { pose: 'stance', lod: 0 }),
      this.getKnife(),
    ]);
    if (token !== this.loadToken) {
      character.dispose();
      return;
    }
    if (character.rig) attachKnifeModel(character.rig.rightWeaponHand, knife);
    this.character = character;
    this.pivot.add(character.root);
    this.frameCharacter();
  }

  private getKnife(): Promise<Object3D | null> {
    this.knifePromise ??= loadKnifeMesh().catch(() => null);
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
    this.lastFrame = this.startTime;
    const loop = () => {
      if (!this.running) {
        return;
      }
      const now = performance.now();
      const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      this.pivot.rotation.y = this.baseYaw;
      this.character?.update(dt, (now - this.startTime) / 1000);
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
    this.character?.dispose();
    this.character = null;
    this.scene.environment?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.frameCharacter();
  }

  private frameCharacter(): void {
    const size = STAGE_BOUNDS.getSize(new Vector3());
    const center = STAGE_BOUNDS.getCenter(new Vector3());
    const distance = previewCameraDistance(size.x, size.y, size.z, this.camera.aspect, this.camera.fov);
    const targetY = center.y - size.y * 0.025;
    this.camera.position.set(center.x, targetY + 0.08, center.z + distance);
    this.camera.lookAt(center.x, targetY, center.z);
  }
}

export const PREVIEW_BG = new Color(0x0a0c12);
