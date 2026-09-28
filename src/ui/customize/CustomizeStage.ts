import {
  ACESFilmicToneMapping,
  CanvasTexture,
  CircleGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { TEAM_LIGHT } from '../../characters/catalog';
import { createCharacter, type CharacterHandle } from '../../characters/CharacterFactory';
import { looksEqual, type CharacterLook } from '../../characters/look';
import type { PlayerModel } from '../../network/types';
import {
  focusView,
  orbitByDrag,
  panByDrag,
  pinchView,
  refitView,
  dampView,
  stepSpin,
  viewCameraPosition,
  viewsSettled,
  wheelZoomFactor,
  zoomView,
  type OrbitView,
  type ViewFocus,
} from './customizeLogic';

const FOV = 30;
/** fastest flick spin we keep after a drag, rad/s */
const MAX_SPIN = 10;
/** frames with the character on screen before the stage calls itself ready */
const READY_FRAMES = 5;

export type StageStatus = 'loading' | 'ready' | 'error';

/**
 * the customize screen's 3d preview: its own renderer, studio lighting, a soft
 * floor and an orbit camera. only renders between start() and stop().
 */
export class CustomizeStage {
  /** loading, ready or error, for the screen's status text */
  onStatus: ((status: StageStatus) => void) | null = null;

  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV, 1, 0.05, 60);
  // lights ride with the camera yaw like a turntable, so every angle is lit the same
  private readonly lightRig = new Group();
  private readonly characterGroup = new Group();
  private readonly envTarget: WebGLRenderTarget;
  private readonly floor: Mesh<CircleGeometry, MeshBasicMaterial>;
  private readonly ring: Mesh<CircleGeometry, MeshBasicMaterial>;
  private readonly resizeObserver: ResizeObserver;

  private handle: CharacterHandle | null = null;
  private loading = false;
  // a failed build is only retried the next time the screen opens
  private loadFailed = false;
  private disposed = false;
  private wantLook: CharacterLook | null = null;
  private wantTeam: PlayerModel = 'terrorist';
  private shownLook: CharacterLook | null = null;
  private shownTeam: PlayerModel | null = null;

  private focus: ViewFocus = 'full';
  private view: OrbitView;
  private goal: OrbitView;
  private spin = 0;
  private aspect = 1;
  private width = 0;
  private height = 0;

  private running = false;
  private raf: number | null = null;
  private lastFrame = 0;
  private readyFrames = 0;

  private readonly pointers = new Map<number, { x: number; y: number }>();
  private dragMode: 'orbit' | 'pan' | null = null;
  private pinch: { gap: number; view: OrbitView } | null = null;
  private lastMoveTime = 0;
  private spinSample = 0;

  constructor(private readonly mount: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    const canvas = this.renderer.domElement;
    canvas.className = 'cz-canvas';
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'Character preview. Drag or use the arrow keys to turn it, scroll or plus and minus to zoom.');
    mount.appendChild(canvas);

    // image based lighting so metal and gloss paint have something to reflect
    const pmrem = new PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.envTarget = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 0.6;

    this.scene.add(this.lightRig, this.characterGroup);
    this.setupLights();
    this.floor = makeFloor();
    this.ring = makeRing();
    this.scene.add(this.floor, this.ring);

    this.goal = focusView('full', 1, FOV);
    this.view = { ...this.goal };

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('dblclick', this.onDoubleClick);
    canvas.addEventListener('contextmenu', this.onContextMenu);
    canvas.addEventListener('keydown', this.onKeyDown);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(mount);
  }

  /** what to show; the first call builds the character, later ones restyle it in place */
  setCharacter(look: CharacterLook, team: PlayerModel): void {
    this.wantLook = { ...look };
    this.wantTeam = team;
    this.ring.material.color.set(TEAM_LIGHT[team]);
    if (!this.handle && !this.loading && !this.loadFailed) {
      this.load();
    }
  }

  /** eases the camera to frame a slot, or the whole character */
  setFocus(focus: ViewFocus): void {
    this.focus = focus;
    this.spin = 0;
    this.goal = focusView(focus, this.aspect, FOV, this.goal.yaw);
  }

  resetView(): void {
    this.setFocus('full');
  }

  /** full body shot that swings in a little, for when the screen opens */
  intro(): void {
    this.resize();
    this.focus = 'full';
    this.spin = 0;
    this.goal = focusView('full', this.aspect, FOV);
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.view = calm ? { ...this.goal } : {
      ...this.goal,
      yaw: this.goal.yaw + 0.5,
      pitch: this.goal.pitch + 0.05,
      distance: this.goal.distance * 1.12,
    };
    this.applyCamera();
  }

  start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.lastFrame = 0;
    this.readyFrames = 0;
    this.resize();
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    if (this.raf !== null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
    this.pointers.clear();
    this.pinch = null;
    this.dragMode = null;
    this.spin = 0;
    this.loadFailed = false;
    this.renderer.domElement.classList.remove('is-dragging');
    delete this.mount.dataset.ready;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerUp);
    canvas.removeEventListener('wheel', this.onWheel);
    canvas.removeEventListener('dblclick', this.onDoubleClick);
    canvas.removeEventListener('contextmenu', this.onContextMenu);
    canvas.removeEventListener('keydown', this.onKeyDown);
    if (this.handle) {
      this.characterGroup.remove(this.handle.root);
      this.handle.dispose();
      this.handle = null;
    }
    for (const mesh of [this.floor, this.ring]) {
      mesh.material.map?.dispose();
      mesh.material.dispose();
      mesh.geometry.dispose();
    }
    this.scene.environment = null;
    this.envTarget.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    canvas.remove();
  }

  // --- internals ---------------------------------------------------------------

  private setupLights(): void {
    // soft sky and ground bounce under everything else
    this.lightRig.add(new HemisphereLight(0xc4d6ff, 0x1c140e, 0.15));

    // warm key, front left and high
    const key = new DirectionalLight(0xffe2c6, 2.9);
    key.position.set(-2.6, 3.4, 2.6);
    // cool fill from the other side, lower and a lot weaker
    const fill = new DirectionalLight(0x8fb8ff, 0.5);
    fill.position.set(3.0, 1.2, 1.9);
    // two rims from behind and off to the sides so the silhouette reads on the dark backdrop
    const rim = new DirectionalLight(0xdce8ff, 3.2);
    rim.position.set(3.0, 2.4, -2.2);
    const rimLow = new DirectionalLight(0xffc294, 2.0);
    rimLow.position.set(-3.0, 1.3, -2.0);
    this.lightRig.add(key, fill, rim, rimLow);
  }

  private load(): void {
    const look = this.wantLook;
    if (!look) return;
    const team = this.wantTeam;
    this.loading = true;
    this.onStatus?.('loading');
    createCharacter(look, team, { pose: 'stance' }).then(
      (handle) => {
        this.loading = false;
        if (this.disposed) {
          handle.dispose();
          return;
        }
        this.handle = handle;
        this.shownLook = look;
        this.shownTeam = team;
        this.characterGroup.add(handle.root);
        this.onStatus?.('ready');
      },
      (error: unknown) => {
        this.loading = false;
        this.loadFailed = true;
        console.warn('[Customize] could not build the preview character', error);
        this.onStatus?.('error');
      },
    );
  }

  /** pushes the latest look into the character, at most once a frame */
  private syncCharacter(): void {
    const handle = this.handle;
    const look = this.wantLook;
    if (!handle || !look) return;
    if (this.shownTeam === this.wantTeam && this.shownLook && looksEqual(this.shownLook, look)) return;
    handle.setLook({ ...look }, this.wantTeam);
    this.shownLook = look;
    this.shownTeam = this.wantTeam;
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    const dt = this.lastFrame > 0 ? Math.min(0.1, (now - this.lastFrame) / 1000) : 1 / 60;
    this.lastFrame = now;

    this.syncCharacter();
    if (this.spin !== 0 && this.dragMode === null) {
      const step = stepSpin(this.spin, dt);
      this.spin = step.velocity;
      this.goal = { ...this.goal, yaw: this.goal.yaw + step.delta };
    }
    this.view = dampView(this.view, this.goal, dt);
    this.applyCamera();
    this.handle?.update(dt, now / 1000);
    this.renderer.render(this.scene, this.camera);

    // screenshots wait for this: character drawn a few times and the camera at rest
    if (this.handle && this.mount.dataset.ready !== 'true') {
      this.readyFrames += 1;
      if (this.readyFrames >= READY_FRAMES && viewsSettled(this.view, this.goal, 2e-3)) {
        this.mount.dataset.ready = 'true';
      }
    }
  };

  private applyCamera(): void {
    const p = viewCameraPosition(this.view);
    this.camera.position.set(p.x, p.y, p.z);
    this.camera.lookAt(0, this.view.targetY, 0);
    this.lightRig.rotation.y = this.view.yaw;
  }

  private resize(): void {
    const width = this.mount.clientWidth;
    const height = this.mount.clientHeight;
    if (width < 2 || height < 2 || (width === this.width && height === this.height)) return;
    const aspect = width / height;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    // keep whatever zoom the player had, just refit it to the new shape
    this.goal = refitView(this.goal, this.focus, this.aspect, aspect, FOV);
    this.view = refitView(this.view, this.focus, this.aspect, aspect, FOV);
    this.aspect = aspect;
    this.width = width;
    this.height = height;
  }

  private pointerGap(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button > 2) return;
    // middle drag pans, keep windows from starting autoscroll
    if (event.button === 1) event.preventDefault();
    const canvas = this.renderer.domElement;
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.spin = 0;
    this.spinSample = 0;
    this.lastMoveTime = event.timeStamp;
    if (this.pointers.size >= 2) {
      this.dragMode = null;
      this.pinch = { gap: this.pointerGap(), view: { ...this.goal } };
    } else {
      this.dragMode = event.button === 1 || event.button === 2 || event.shiftKey ? 'pan' : 'orbit';
    }
    canvas.classList.add('is-dragging');
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const last = this.pointers.get(event.pointerId);
    if (!last) return;
    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;
    last.x = event.clientX;
    last.y = event.clientY;
    if (this.pinch) {
      this.goal = pinchView(this.pinch.view, this.pinch.gap, this.pointerGap());
      return;
    }
    if (this.dragMode === 'orbit') {
      const next = orbitByDrag(this.goal, dx, dy);
      const ms = Math.max(1, event.timeStamp - this.lastMoveTime);
      this.spinSample = this.spinSample * 0.5 + (((next.yaw - this.goal.yaw) * 1000) / ms) * 0.5;
      this.goal = next;
    } else if (this.dragMode === 'pan') {
      this.goal = panByDrag(this.goal, dy, this.height, FOV);
    }
    this.lastMoveTime = event.timeStamp;
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.pointers.delete(event.pointerId)) return;
    const canvas = this.renderer.domElement;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    if (this.pointers.size >= 2) return;
    this.pinch = null;
    if (this.pointers.size === 1) {
      // one finger left after a pinch keeps orbiting from here
      this.dragMode = 'orbit';
      return;
    }
    // a flick keeps spinning, a drag that stopped before letting go doesn't
    if (this.dragMode === 'orbit' && event.timeStamp - this.lastMoveTime < 80) {
      this.spin = Math.max(-MAX_SPIN, Math.min(MAX_SPIN, this.spinSample));
    }
    this.dragMode = null;
    canvas.classList.remove('is-dragging');
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.spin = 0;
    this.goal = zoomView(this.goal, wheelZoomFactor(event.deltaY, event.deltaMode, event.ctrlKey));
  };

  private readonly onDoubleClick = (event: MouseEvent): void => {
    event.preventDefault();
    this.resetView();
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const step = 36;
    let handled = true;
    switch (event.key) {
      case 'ArrowLeft':
        this.goal = orbitByDrag(this.goal, -step, 0);
        break;
      case 'ArrowRight':
        this.goal = orbitByDrag(this.goal, step, 0);
        break;
      case 'ArrowUp':
        this.goal = orbitByDrag(this.goal, 0, -step);
        break;
      case 'ArrowDown':
        this.goal = orbitByDrag(this.goal, 0, step);
        break;
      case '+':
      case '=':
        this.goal = zoomView(this.goal, 1 / 1.15);
        break;
      case '-':
      case '_':
        this.goal = zoomView(this.goal, 1.15);
        break;
      case 'Home':
      case '0':
        this.resetView();
        break;
      default:
        handled = false;
    }
    if (handled) {
      this.spin = 0;
      event.preventDefault();
    }
  };
}

function radialTexture(stops: ReadonlyArray<[number, string]>): CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (const [at, color] of stops) gradient.addColorStop(at, color);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function flatDisc(radius: number, map: CanvasTexture, y: number): Mesh<CircleGeometry, MeshBasicMaterial> {
  const material = new MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false });
  const mesh = new Mesh(new CircleGeometry(radius, 72), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  mesh.renderOrder = -1;
  return mesh;
}

/** a faint lit floor with a darker contact shadow in the middle */
function makeFloor(): Mesh<CircleGeometry, MeshBasicMaterial> {
  const floor = flatDisc(1.6, radialTexture([
    [0, 'rgba(0, 0, 0, 0.8)'],
    [0.12, 'rgba(0, 0, 0, 0.62)'],
    [0.24, 'rgba(14, 16, 20, 0.42)'],
    [0.42, 'rgba(92, 106, 124, 0.2)'],
    [0.7, 'rgba(92, 106, 124, 0.08)'],
    [1, 'rgba(92, 106, 124, 0)'],
  ]), 0.002);
  floor.renderOrder = -2;
  return floor;
}

/** thin glowing ring in the team light colour, tinted through material.color */
function makeRing(): Mesh<CircleGeometry, MeshBasicMaterial> {
  const ring = flatDisc(0.78, radialTexture([
    [0, 'rgba(255, 255, 255, 0)'],
    [0.8, 'rgba(255, 255, 255, 0)'],
    [0.9, 'rgba(255, 255, 255, 0.16)'],
    [0.935, 'rgba(255, 255, 255, 0.75)'],
    [0.96, 'rgba(255, 255, 255, 0.16)'],
    [1, 'rgba(255, 255, 255, 0)'],
  ]), 0.004);
  ring.material.opacity = 0.7;
  return ring;
}
