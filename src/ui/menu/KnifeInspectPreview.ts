import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  DirectionalLight,
  Group,
  type Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  Sphere,
  type Texture,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { getKnife, type KnifeId } from '../../combat/knives';
import { applyKnifeFinish, type KnifeFinishSelection } from '../../cosmetics/finishes/applyFinish';
import { buildProceduralKnife, disposeProceduralKnife } from '../../cosmetics/ProceduralKnife';

/** swatches show the blade of this knife, a plain drop point */
const SWATCH_KNIFE: KnifeId = 'classic';
const AUTO_SPIN = 0.4;
const RESUME_AFTER_MS = 1600;

interface SwatchJob {
  selection: KnifeFinishSelection;
  target: HTMLCanvasElement;
}

/**
 * small 3d inspect view for the loadout: the selected knife with its finish on
 * a slow turntable that can be dragged. renders only while the menu shows it,
 * and renders the finish swatches through the same webgl context.
 */
export class KnifeInspectPreview {
  readonly canvas: HTMLCanvasElement;
  private renderer: WebGLRenderer | null = null;
  private failed = false;
  private env: Texture | null = null;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(28, 2, 0.01, 10);
  private readonly turntable = new Group();
  private readonly tilt = new Group();
  private knife: Group | null = null;
  private knifeId: KnifeId;
  private finish: KnifeFinishSelection;
  private radius = 0.15;

  private readonly swatchScene = new Scene();
  private readonly swatchCamera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
  private swatchKnife: Group | null = null;
  private readonly swatchJobs: SwatchJob[] = [];

  private yaw = 0.5;
  private pitch = 0.28;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private lastInteraction = 0;
  private lastFrame = 0;
  private raf = 0;
  private active = false;
  private onScreen = false;
  private readonly observer: IntersectionObserver | null;
  private readonly resizeObserver: ResizeObserver | null;

  constructor(knifeId: KnifeId, finish: KnifeFinishSelection) {
    this.knifeId = knifeId;
    this.finish = { ...finish };
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'finish-inspect-canvas';
    this.scene.add(this.turntable);
    this.turntable.add(this.tilt);
    this.camera.position.set(0, 0, 1);
    this.addLights(this.scene);
    this.addLights(this.swatchScene);

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    document.addEventListener('visibilitychange', this.updateLoop);
    this.observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
      this.onScreen = entries.some((e) => e.isIntersecting);
      this.updateLoop();
    });
    this.observer?.observe(this.canvas);
    this.resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.resize());
    this.resizeObserver?.observe(this.canvas);
  }

  setKnife(id: KnifeId): void {
    if (id === this.knifeId && this.knife) return;
    this.knifeId = id;
    if (this.renderer) this.rebuildKnife();
  }

  setFinish(selection: KnifeFinishSelection): void {
    this.finish = { ...selection };
    if (this.knife) applyKnifeFinish(this.knife, this.finish);
  }

  /** the menu is open on the loadout tab */
  setActive(active: boolean): void {
    this.active = active;
    this.updateLoop();
  }

  /** draws a finish swatch into `target` (2d canvas) as soon as the renderer runs */
  queueSwatch(selection: KnifeFinishSelection, target: HTMLCanvasElement): void {
    const existing = this.swatchJobs.find((j) => j.target === target);
    if (existing) existing.selection = { ...selection };
    else this.swatchJobs.push({ selection: { ...selection }, target });
  }

  dispose(): void {
    this.active = false;
    this.updateLoop();
    this.observer?.disconnect();
    this.resizeObserver?.disconnect();
    document.removeEventListener('visibilitychange', this.updateLoop);
    for (const knife of [this.knife, this.swatchKnife]) {
      if (knife) {
        knife.removeFromParent();
        disposeProceduralKnife(knife);
      }
    }
    this.knife = null;
    this.swatchKnife = null;
    this.env?.dispose();
    this.renderer?.dispose();
    this.renderer = null;
  }

  // ---------------------------------------------------------------- internals

  private addLights(scene: Scene): void {
    scene.add(new AmbientLight(0xffffff, 0.35));
    const key = new DirectionalLight(0xfff4ea, 1.6);
    key.position.set(0.5, 1.2, 1.4);
    scene.add(key);
    const rim = new DirectionalLight(0xaecbff, 0.8);
    rim.position.set(-1.2, 0.3, -0.8);
    scene.add(rim);
  }

  private ensureRenderer(): boolean {
    if (this.renderer) return true;
    if (this.failed) return false;
    try {
      const renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = SRGBColorSpace;
      renderer.toneMapping = ACESFilmicToneMapping;
      renderer.setClearColor(0x000000, 0);
      const pmrem = new PMREMGenerator(renderer);
      this.env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
      this.scene.environment = this.env;
      this.swatchScene.environment = this.env;
      this.renderer = renderer;
    } catch {
      // no webgl: the picker still works with the css swatches
      this.failed = true;
      return false;
    }
    this.resize();
    this.rebuildKnife();
    this.buildSwatchKnife();
    return true;
  }

  private rebuildKnife(): void {
    if (this.knife) {
      this.knife.removeFromParent();
      disposeProceduralKnife(this.knife);
    }
    const knife = buildProceduralKnife(getKnife(this.knifeId));
    applyKnifeFinish(knife, this.finish);
    // centre the knife on the turntable and frame its bounding sphere so turning never clips
    const sphere = new Box3().setFromObject(knife).getBoundingSphere(new Sphere());
    knife.position.copy(sphere.center).negate();
    this.radius = sphere.radius;
    this.tilt.add(knife);
    this.knife = knife;
    this.frame();
  }

  private buildSwatchKnife(): void {
    const knife = buildProceduralKnife(getKnife(SWATCH_KNIFE));
    knife.rotation.set(-0.45, 0.28, 0.04);
    this.swatchScene.add(knife);
    knife.updateMatrixWorld(true);
    // frame the middle of the blade, where the pattern reads best
    const blade = knife.getObjectByName('blade') as Mesh | undefined;
    const box = new Box3().setFromObject(blade ?? knife);
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    const halfH = size.y * 0.5;
    const halfW = halfH * 2.4;
    this.swatchCamera.left = -halfW;
    this.swatchCamera.right = halfW;
    this.swatchCamera.top = halfH;
    this.swatchCamera.bottom = -halfH;
    this.swatchCamera.position.set(center.x + size.x * 0.06, center.y, center.z + 1);
    this.swatchCamera.lookAt(center.x + size.x * 0.06, center.y, center.z);
    this.swatchCamera.updateProjectionMatrix();
    this.swatchKnife = knife;
  }

  private frame(): void {
    const fov = (this.camera.fov * Math.PI) / 180;
    const aspect = Math.max(0.5, this.camera.aspect);
    const fitV = this.radius / Math.sin(fov / 2);
    const fitH = this.radius / Math.sin(Math.atan(Math.tan(fov / 2) * aspect));
    // a knife is long and thin, so fitting its length is enough on a wide canvas
    this.camera.position.set(0, 0, Math.min(fitV, fitH) * 1.04);
    this.camera.near = 0.01;
    this.camera.far = 10;
    this.camera.updateProjectionMatrix();
  }

  private resize(): void {
    if (!this.renderer) return;
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.frame();
    this.draw();
  }

  private readonly updateLoop = (): void => {
    const run = this.active && this.onScreen && document.visibilityState !== 'hidden';
    if (run && !this.raf) {
      if (!this.ensureRenderer()) return;
      this.lastFrame = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    } else if (!run && this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  };

  private readonly tick = (now: number): void => {
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (!this.dragging && now - this.lastInteraction > RESUME_AFTER_MS) this.yaw += dt * AUTO_SPIN;
    this.drawSwatches(2);
    this.draw();
  };

  private draw(): void {
    if (!this.renderer) return;
    this.turntable.rotation.set(0, this.yaw, 0);
    this.tilt.rotation.set(this.pitch, 0, -0.12);
    this.renderer.render(this.scene, this.camera);
  }

  /** renders a few swatches into a corner of the canvas and copies them out */
  private drawSwatches(count: number): void {
    const renderer = this.renderer;
    const knife = this.swatchKnife;
    if (!renderer || !knife) return;
    const ratio = renderer.getPixelRatio();
    for (let i = 0; i < count && this.swatchJobs.length > 0; i += 1) {
      const job = this.swatchJobs.shift()!;
      const w = job.target.width;
      const h = job.target.height;
      if (w > this.canvas.width || h > this.canvas.height) continue;
      applyKnifeFinish(knife, job.selection);
      renderer.setScissorTest(true);
      renderer.setViewport(0, 0, w / ratio, h / ratio);
      renderer.setScissor(0, 0, w / ratio, h / ratio);
      renderer.render(this.swatchScene, this.swatchCamera);
      const ctx = job.target.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(this.canvas, 0, this.canvas.height - h, w, h, 0, 0, w, h);
      }
      job.target.classList.add('is-rendered');
    }
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, this.canvas.width / ratio, this.canvas.height / ratio);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.dragging = true;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.lastInteraction = performance.now();
    this.canvas.setPointerCapture(event.pointerId);
    this.canvas.classList.add('is-dragging');
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging) return;
    this.yaw += (event.clientX - this.lastX) * 0.012;
    this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch + (event.clientY - this.lastY) * 0.01));
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.lastInteraction = performance.now();
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.dragging) return;
    this.dragging = false;
    this.lastInteraction = performance.now();
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    this.canvas.classList.remove('is-dragging');
  };
}
