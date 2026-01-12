import {
  ACESFilmicToneMapping,
  AxesHelper,
  Box3,
  BufferGeometry,
  Color,
  DirectionalLight,
  Fog,
  GridHelper,
  Group,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  Mesh,
  Object3D,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { InputManager } from '../core/InputManager';
import { MovementController } from '../movement/MovementController';
import { runMovementAcceptanceDiagnostics } from '../movement/MovementAcceptanceDiagnostics';
import { logMovementAcceptance } from '../movement/MovementTestScene';
import type { MovementDebugState } from '../movement/types';
import { CosmeticsManager } from '../cosmetics/CosmeticsManager';
import { ViewmodelRenderer } from '../cosmetics/ViewmodelRenderer';
import type { LoadoutSelection } from '../cosmetics/types';
import { HUD } from '../ui/HUD';
import { MainMenu } from '../ui/MainMenu';
import { defaultSettings, loadSettings, saveSettings, type GameSettings } from '../ui/SettingsStore';
import { CollisionWorld } from '../world/CollisionWorld';
import { deleteCustomMap, listCustomMaps } from '../world/CustomMapStore';
import { MapLoader, type MapLoadReporter } from '../world/MapLoader';
import { loadBuiltinManifest } from '../world/MapManifestService';
import type { CustomMapRecord, LoadedMap, MapManifestEntry } from '../world/types';

type MapSource =
  | {
      kind: 'builtin';
      entry: MapManifestEntry;
    }
  | {
      kind: 'custom';
      entry: MapManifestEntry;
      record: CustomMapRecord;
    };

type DebugCameraMode = 'firstPerson' | 'thirdPerson' | 'freecam';

const FIXED_TICK_DT = 1 / 128;

export class GameApp {
  private readonly container: HTMLElement;
  private readonly renderer: WebGLRenderer;
  private readonly worldScene = new Scene();
  private readonly worldCamera: PerspectiveCamera;
  private readonly viewmodelRenderer: ViewmodelRenderer;
  private readonly input: InputManager;
  private readonly movement = new MovementController();
  private readonly collisionWorld = new CollisionWorld();
  private readonly mapLoader = new MapLoader();
  private readonly hud: HUD;

  private readonly cosmeticsGroup = new Group();
  private readonly cosmeticsManager: CosmeticsManager;

  private readonly crosshair: HTMLDivElement;
  private readonly statusLabel: HTMLDivElement;
  private statusHideAt = 0;
  private readonly loadingOverlay: HTMLDivElement;
  private readonly loadingTitle: HTMLDivElement;
  private readonly loadingProgress: HTMLDivElement;
  private readonly loadingDetail: HTMLPreElement;
  private loadProgressSpinnerIndex = 0;
  private currentLoadToken = 0;

  private readonly debugGrid = new GridHelper(420, 210, 0x9ec3df, 0x4d6378);
  private readonly debugAxes = new AxesHelper(8);
  private showWorldDebugHelpers = false;
  private drawSurfNormal = false;
  private readonly surfNormalGeometry = new BufferGeometry();
  private readonly surfNormalLine = new Line(
    this.surfNormalGeometry,
    new LineBasicMaterial({ color: 0xffc766 }),
  );
  private debugCameraMode: DebugCameraMode = 'firstPerson';
  private freecamInitialized = false;
  private readonly freecamPosition = new Vector3();

  private menu: MainMenu | null = null;
  private settings: GameSettings = { ...defaultSettings };
  private loadout: LoadoutSelection | null = null;

  private mapSources = new Map<string, MapSource>();
  private selectedMapId = '';
  private loadedMap: LoadedMap | null = null;
  private loadedMapRoot: Group | null = null;

  private accumulator = 0;
  private lastFrameTime = 0;
  private running = false;
  private playing = false;
  private didPlayInitialEquip = false;
  private voidResetY = -Infinity;
  private lastVoidResetAtMs = 0;

  private readonly tmpForward = new Vector3();
  private readonly tmpDesiredCameraPos = new Vector3();
  private readonly tmpLookAt = new Vector3();

  constructor(rootElement: HTMLElement) {
    this.container = rootElement;
    this.worldCamera = new PerspectiveCamera(100, window.innerWidth / window.innerHeight, 0.1, 6000);
    this.worldCamera.rotation.order = 'YXZ';

    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.autoClear = false;
    this.container.appendChild(this.renderer.domElement);

    this.input = new InputManager(this.renderer.domElement);
    this.hud = new HUD(this.container);
    this.hud.setVisible(true);

    this.viewmodelRenderer = new ViewmodelRenderer(68, window.innerWidth / window.innerHeight);
    this.viewmodelRenderer.root.add(this.cosmeticsGroup);
    this.cosmeticsManager = new CosmeticsManager(this.cosmeticsGroup);

    this.crosshair = this.createCrosshair();
    this.statusLabel = this.createStatusLabel();
    const loadingOverlay = this.createLoadingOverlay();
    this.loadingOverlay = loadingOverlay.root;
    this.loadingTitle = loadingOverlay.title;
    this.loadingProgress = loadingOverlay.progress;
    this.loadingDetail = loadingOverlay.detail;

    this.setupWorldLighting();
    this.setupWorldDebugHelpers();
    window.addEventListener('resize', this.onResize);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
  }

  public async init(): Promise<void> {
    this.settings = loadSettings();
    this.movement.setCvar('sv_autobhop_enabled', this.settings.autoBhop);
    this.hud.setVisible(this.settings.showHud);
    this.worldCamera.fov = this.settings.worldFov;
    this.worldCamera.updateProjectionMatrix();
    this.viewmodelRenderer.setFov(this.settings.viewmodelFov);
    this.cosmeticsManager.setViewmodelScale(this.settings.viewmodelScale);

    const [builtinMaps, customRecords, cosmeticsManifest] = await Promise.all([
      loadBuiltinManifest(),
      listCustomMaps(),
      this.cosmeticsManager.loadManifest(),
    ]);
    this.rebuildMapSources(builtinMaps, customRecords);
    this.selectedMapId =
      builtinMaps.find((map) => map.id === 'custom')?.id
      ?? builtinMaps.find((map) => map.id === 'movement_test_scene')?.id
      ?? builtinMaps[0]?.id
      ?? Array.from(this.mapSources.keys())[0]
      ?? '';

    this.loadout = this.cosmeticsManager.getDefaultLoadout();
    await this.cosmeticsManager.applyLoadout(this.loadout);
    this.syncViewmodelMotionStyle();

    this.menu = new MainMenu(this.container, this.settings, {
      onPlay: (mapId) => {
        void this.startPlaySession(mapId);
      },
      onReloadMap: () => {
        void this.reloadSelectedMap();
      },
      onSettingsChanged: (next) => this.applySettings(next),
      onLoadoutChanged: (next) => {
        this.loadout = next;
        void this.applyLoadout(next);
      },
    });
    this.menu.setMaps(this.getMapEntries(), this.selectedMapId);
    this.menu.setCosmetics(cosmeticsManifest, this.loadout);
    this.menu.setVisible(true);
    this.setCrosshairVisible(false);

    const acceptanceLog = runMovementAcceptanceDiagnostics();
    logMovementAcceptance(acceptanceLog);

    this.running = true;
    this.lastFrameTime = performance.now();
    requestAnimationFrame(this.loop);
  }

  public dispose(): void {
    this.running = false;
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.input.dispose();
    this.renderer.dispose();
  }

  private readonly loop = (time: number): void => {
    if (!this.running) {
      return;
    }

    const frameDt = Math.min(0.1, (time - this.lastFrameTime) / 1000);
    this.lastFrameTime = time;
    this.accumulator += frameDt;

    const look = this.input.consumeLookDelta();
    this.movement.applyLookDelta(look.x, look.y, this.settings.mouseSensitivity);

    const actions = this.input.consumeActions();
    if (actions.toggleGridPressed) {
      this.showWorldDebugHelpers = !this.showWorldDebugHelpers;
      this.debugGrid.visible = this.showWorldDebugHelpers;
      this.debugAxes.visible = this.showWorldDebugHelpers;
      this.showStatus(this.showWorldDebugHelpers ? 'World debug helpers ON' : 'World debug helpers OFF');
    }
    if (actions.toggleDebugCameraPressed) {
      this.debugCameraMode = this.nextDebugCameraMode(this.debugCameraMode);
      if (this.debugCameraMode === 'freecam') {
        this.freecamInitialized = false;
      }
      this.showStatus(this.describeDebugCameraMode(this.debugCameraMode));
    }
    if (actions.toggleSurfNormalPressed) {
      this.drawSurfNormal = !this.drawSurfNormal;
      this.showStatus(this.drawSurfNormal ? 'Surf normal debug ON' : 'Surf normal debug OFF');
    }

    let inspectQueued = actions.inspectPressed;
    let resetQueued = actions.resetPressed;
    let attackQueued = actions.attackPressed;
    let attackAltQueued = actions.attackAltPressed;

    while (this.accumulator >= FIXED_TICK_DT) {
      this.accumulator -= FIXED_TICK_DT;
      if (this.playing) {
        if (resetQueued && this.loadedMap) {
          this.resetToSpawn('Reset to spawn');
          resetQueued = false;
          inspectQueued = false;
          attackQueued = false;
          attackAltQueued = false;
          this.input.sampleMoveInput();
          continue;
        }
        if (inspectQueued) {
          this.viewmodelRenderer.triggerInspect();
          inspectQueued = false;
        }
        if (attackQueued) {
          this.cosmeticsManager.triggerAttackPrimary();
          attackQueued = false;
        }
        if (attackAltQueued) {
          this.cosmeticsManager.triggerAttackSecondary();
          attackAltQueued = false;
        }

        const moveInput = this.input.sampleMoveInput();
        this.movement.tick(FIXED_TICK_DT, moveInput, this.collisionWorld);
        if (this.loadedMap && this.movement.getFeetPosition().y < this.voidResetY) {
          const now = performance.now();
          const showMessage = now - this.lastVoidResetAtMs > 900;
          this.resetToSpawn(showMessage ? 'Out of world reset' : null);
          this.lastVoidResetAtMs = now;
          inspectQueued = false;
          attackQueued = false;
          attackAltQueued = false;
          continue;
        }
      } else {
        this.input.sampleMoveInput();
      }
    }

    this.updateCameras(frameDt, look);
    this.cosmeticsManager.update(frameDt);
    const debug = this.movement.getDebugState();
    this.hud.update(debug);
    this.updateSurfNormalLine(debug);
    this.updateStatusVisibility(time);

    this.renderer.clear();
    this.renderer.render(this.worldScene, this.worldCamera);
    if (this.playing && this.debugCameraMode === 'firstPerson') {
      this.renderer.clearDepth();
      this.renderer.render(this.viewmodelRenderer.scene, this.viewmodelRenderer.camera);
    }

    requestAnimationFrame(this.loop);
  };

  private async startPlaySession(mapId: string): Promise<void> {
    if (!this.menu) {
      return;
    }
    this.selectedMapId = mapId;

    const source = this.mapSources.get(mapId);
    if (!source) {
      this.showLoadingError(new Error(`Unknown map id: ${mapId}`), mapId);
      return;
    }

    const loadToken = ++this.currentLoadToken;
    const mapName = source.entry.name;
    const progressByUrl = new Map<string, { loaded: number; total: number }>();
    let managerItemsLoaded = 0;
    let managerItemsTotal = 0;
    let lastResolvedUrl = '';

    this.showLoadingOverlay(mapName);
    this.playing = false;
    this.setCrosshairVisible(false);

    const refreshProgress = (stageText?: string): void => {
      let loadedKnown = 0;
      let totalKnown = 0;

      for (const progress of progressByUrl.values()) {
        if (progress.total > 0) {
          totalKnown += progress.total;
          loadedKnown += Math.min(progress.loaded, progress.total);
        }
      }

      let percent: number | null = null;
      if (totalKnown > 0) {
        percent = Math.max(0, Math.min(100, (loadedKnown / totalKnown) * 100));
      } else if (managerItemsTotal > 0) {
        percent = Math.max(0, Math.min(100, (managerItemsLoaded / managerItemsTotal) * 100));
      }

      this.updateLoadingOverlay(mapName, percent, stageText);
    };

    const reporter: MapLoadReporter = {
      onStage: (message) => {
        refreshProgress(message);
      },
      onResolvedUrl: (url) => {
        lastResolvedUrl = url;
        // eslint-disable-next-line no-console
        console.log(`[MapLoader] resolved URL: ${url}`);
        this.appendLoadingDetail(`URL: ${url}`);
      },
      onAssetProgress: ({ url, loaded, total }) => {
        progressByUrl.set(url, { loaded, total });
        refreshProgress();
      },
      onManagerProgress: ({ itemsLoaded, itemsTotal }) => {
        managerItemsLoaded = itemsLoaded;
        managerItemsTotal = itemsTotal;
        refreshProgress();
      },
      onLog: (message) => {
        // eslint-disable-next-line no-console
        console.log(message);
        this.appendLoadingDetail(message);
      },
    };

    try {
      this.loadedMap =
        source.kind === 'builtin'
          ? await this.mapLoader.loadManifestEntry(source.entry, reporter)
          : await this.mapLoader.loadCustomMap(source.record, reporter);

      if (loadToken !== this.currentLoadToken) {
        return;
      }

      this.activateLoadedMap(this.loadedMap);
      this.debugCameraMode = 'firstPerson';
      this.freecamInitialized = false;
      this.hideLoadingOverlay();
      this.menu.setVisible(false);
      this.input.requestPointerLock();
      this.playing = true;
      if (!this.didPlayInitialEquip) {
        this.cosmeticsManager.triggerEquip();
        this.didPlayInitialEquip = true;
      }
      this.setCrosshairVisible(this.debugCameraMode === 'firstPerson');
      this.showStatus('Map loaded');
    } catch (error) {
      if (loadToken !== this.currentLoadToken) {
        return;
      }
      // eslint-disable-next-line no-console
      console.error(error);
      this.showLoadingError(error, lastResolvedUrl || source.entry.scenePath);
      this.playing = false;
      this.menu.setVisible(true);
      this.setCrosshairVisible(false);
    }
  }

  private activateLoadedMap(map: LoadedMap): void {
    if (this.loadedMapRoot) {
      this.worldScene.remove(this.loadedMapRoot);
    }

    const root = new Group();
    root.name = `LoadedMapRoot:${map.entry.id}`;
    root.add(map.sceneRoot);
    this.loadedMapRoot = root;
    this.worldScene.add(root);

    this.collisionWorld.setCollisionFromRoot(map.collisionRoot);

    const bounds = new Box3().setFromObject(map.sceneRoot);
    const triCount = this.countTriangles(map.sceneRoot);
    // eslint-disable-next-line no-console
    console.log(
      `[MapLoader] ${map.entry.id} bounds min=(${bounds.min.x.toFixed(2)}, ${bounds.min.y.toFixed(2)}, ${bounds.min.z.toFixed(2)}) max=(${bounds.max.x.toFixed(2)}, ${bounds.max.y.toFixed(2)}, ${bounds.max.z.toFixed(2)}) triangles=${triCount}`,
    );

    const spawn = this.resolveSpawnInLoadedWorld(map);
    this.movement.reset(spawn.position, spawn.yawDeg);

    const collisionBounds = new Box3().setFromObject(map.collisionRoot);
    if (collisionBounds.isEmpty()) {
      this.voidResetY = -1000;
    } else {
      const height = Math.max(1, collisionBounds.max.y - collisionBounds.min.y);
      const margin = Math.max(12, Math.min(120, height * 0.2));
      this.voidResetY = collisionBounds.min.y - margin;
    }
  }

  private rebuildMapSources(builtinEntries: MapManifestEntry[], customRecords: CustomMapRecord[]): void {
    this.mapSources = new Map<string, MapSource>();

    for (const entry of builtinEntries) {
      this.mapSources.set(entry.id, {
        kind: 'builtin',
        entry,
      });
    }

    for (const record of customRecords) {
      const entry: MapManifestEntry = {
        id: record.id,
        name: record.meta?.name ?? record.name,
        author: record.meta?.author ?? 'Custom',
        source: record.meta?.source ?? 'Local import',
        license: record.meta?.license ?? 'User supplied',
        scenePath: '',
        metaPath: '',
      };
      this.mapSources.set(record.id, {
        kind: 'custom',
        entry,
        record,
      });
    }
  }

  private getMapEntries(): MapManifestEntry[] {
    return Array.from(this.mapSources.values()).map((source) => source.entry);
  }

  private async reloadSelectedMap(): Promise<void> {
    if (!this.selectedMapId) {
      return;
    }
    await this.startPlaySession(this.selectedMapId);
  }

  private resolveSpawnInLoadedWorld(map: LoadedMap): { position: Vector3; yawDeg: number } {
    if (map.meta.spawns && map.meta.spawns.length > 0) {
      return {
        position: map.spawnPosition.clone(),
        yawDeg: map.spawnYawDeg,
      };
    }

    const bounds = new Box3().setFromObject(map.collisionRoot);
    if (bounds.isEmpty()) {
      return {
        position: map.spawnPosition.clone(),
        yawDeg: map.spawnYawDeg,
      };
    }

    const center = bounds.getCenter(new Vector3());
    const start = new Vector3(center.x, bounds.max.y + 2, center.z);
    const end = new Vector3(center.x, bounds.min.y - 80, center.z);
    const trace = this.collisionWorld.traceCapsule(start, end, this.movement.capsule);
    if (trace.hit) {
      return {
        position: trace.position.clone().add(new Vector3(0, 0.04, 0)),
        yawDeg: map.spawnYawDeg,
      };
    }

    return {
      position: start,
      yawDeg: map.spawnYawDeg,
    };
  }

  private countTriangles(root: Object3D): number {
    let triangles = 0;

    root.traverse((child) => {
      if (!(child instanceof Mesh) || !child.geometry) {
        return;
      }
      const geometry = child.geometry as BufferGeometry;
      if (geometry.index) {
        triangles += Math.floor(geometry.index.count / 3);
      } else {
        const positions = geometry.getAttribute('position');
        if (positions) {
          triangles += Math.floor(positions.count / 3);
        }
      }
    });

    return triangles;
  }

  private nextDebugCameraMode(current: DebugCameraMode): DebugCameraMode {
    if (current === 'firstPerson') {
      return 'thirdPerson';
    }
    if (current === 'thirdPerson') {
      return 'freecam';
    }
    return 'firstPerson';
  }

  private describeDebugCameraMode(mode: DebugCameraMode): string {
    if (mode === 'thirdPerson') {
      return 'Third-person debug camera';
    }
    if (mode === 'freecam') {
      return 'Freecam debug camera';
    }
    return 'First-person camera';
  }

  private applySettings(next: GameSettings): void {
    this.settings = { ...next };
    saveSettings(next);
    this.movement.setCvar('sv_autobhop_enabled', next.autoBhop);
    this.worldCamera.fov = next.worldFov;
    this.worldCamera.updateProjectionMatrix();
    this.viewmodelRenderer.setFov(next.viewmodelFov);
    this.cosmeticsManager.setViewmodelScale(next.viewmodelScale);
    this.hud.setVisible(next.showHud);
  }

  private async applyLoadout(selection: LoadoutSelection): Promise<void> {
    await this.cosmeticsManager.applyLoadout(selection);
    this.syncViewmodelMotionStyle();
  }

  private syncViewmodelMotionStyle(): void {
    const integratedHands = this.cosmeticsManager.usesIntegratedHands();
    this.viewmodelRenderer.setIntegratedMode(integratedHands);
    this.viewmodelRenderer.setMotionScale(integratedHands ? 0.08 : 1);
  }

  private updateCameras(dt: number, look: { x: number; y: number }): void {
    const cameraPos = this.movement.getCameraPosition();

    if (this.debugCameraMode === 'firstPerson') {
      this.freecamInitialized = false;
      this.worldCamera.position.copy(cameraPos);
      this.worldCamera.rotation.set(this.movement.getPitchRad(), this.movement.getYawRad(), 0, 'YXZ');
    } else if (this.debugCameraMode === 'thirdPerson') {
      this.freecamInitialized = false;
      this.tmpForward.copy(this.movement.getForwardVector()).setY(0);
      if (this.tmpForward.lengthSq() < 1e-6) {
        this.tmpForward.set(0, 0, 1);
      } else {
        this.tmpForward.normalize();
      }

      this.tmpDesiredCameraPos
        .copy(cameraPos)
        .addScaledVector(this.tmpForward, -8.2)
        .add(new Vector3(0, 3.2, 0));
      this.worldCamera.position.lerp(this.tmpDesiredCameraPos, 0.15);
      this.tmpLookAt.copy(cameraPos).add(new Vector3(0, 1.1, 0));
      this.worldCamera.lookAt(this.tmpLookAt);
    } else {
      if (!this.freecamInitialized) {
        this.freecamPosition.copy(cameraPos);
        this.freecamInitialized = true;
      }

      const freecamSpeed = (this.input.isKeyDown('ShiftLeft') || this.input.isKeyDown('ShiftRight')) ? 24 : 12;
      const forwardMove = (this.input.isKeyDown('KeyW') ? 1 : 0) + (this.input.isKeyDown('KeyS') ? -1 : 0);
      const sideMove = (this.input.isKeyDown('KeyD') ? 1 : 0) + (this.input.isKeyDown('KeyA') ? -1 : 0);
      const verticalMove = (this.input.isKeyDown('KeyE') ? 1 : 0) + (this.input.isKeyDown('KeyQ') ? -1 : 0);

      const yaw = this.movement.getYawRad();
      const forward = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      this.freecamPosition
        .addScaledVector(forward, forwardMove * freecamSpeed * dt)
        .addScaledVector(right, sideMove * freecamSpeed * dt)
        .add(new Vector3(0, verticalMove * freecamSpeed * dt, 0));

      this.worldCamera.position.copy(this.freecamPosition);
      this.worldCamera.rotation.set(this.movement.getPitchRad(), this.movement.getYawRad(), 0, 'YXZ');
    }

    const inspectWeight = this.viewmodelRenderer.update(dt, this.worldCamera, this.movement.getVelocity(), look);
    this.cosmeticsManager.setInspectAlpha(inspectWeight);
    this.setCrosshairVisible(this.playing && this.debugCameraMode === 'firstPerson');
  }

  private updateSurfNormalLine(debug: MovementDebugState): void {
    const show = this.showWorldDebugHelpers && this.drawSurfNormal && debug.contactPoint !== null;
    this.surfNormalLine.visible = show;
    if (!show || !debug.contactPoint) {
      return;
    }

    const start = debug.contactPoint.clone();
    const end = start.clone().addScaledVector(debug.surfaceNormal, 3);
    this.surfNormalGeometry.setFromPoints([start, end]);
  }

  private setupWorldLighting(): void {
    this.worldScene.background = new Color('#9ab9d5');
    this.worldScene.fog = new Fog('#9ab9d5', 140, 1400);

    const hemi = new HemisphereLight(0xdaf0ff, 0x4c6a81, 1.05);
    this.worldScene.add(hemi);

    const sun = new DirectionalLight(0xffffff, 1.35);
    sun.position.set(80, 140, 40);
    sun.castShadow = false;
    this.worldScene.add(sun);

    const fill = new DirectionalLight(0xc7e8ff, 0.45);
    fill.position.set(-70, 40, -80);
    this.worldScene.add(fill);
  }

  private setupWorldDebugHelpers(): void {
    this.debugGrid.position.y = 0.03;
    this.debugGrid.visible = false;
    this.debugAxes.visible = false;
    this.debugAxes.position.set(0, 0.04, 0);
    this.surfNormalGeometry.setFromPoints([new Vector3(), new Vector3()]);
    this.surfNormalLine.visible = false;
    this.worldScene.add(this.debugGrid);
    this.worldScene.add(this.debugAxes);
    this.worldScene.add(this.surfNormalLine);
  }

  private setCrosshairVisible(visible: boolean): void {
    this.crosshair.style.display = visible ? 'block' : 'none';
  }

  private resetToSpawn(message: string | null): void {
    if (!this.loadedMap) {
      return;
    }
    this.movement.reset(this.loadedMap.spawnPosition, this.loadedMap.spawnYawDeg);
    if (message) {
      this.showStatus(message);
    }
  }

  private showStatus(text: string, durationMs = 1800): void {
    this.statusLabel.textContent = text;
    this.statusLabel.style.display = 'block';
    this.statusHideAt = performance.now() + durationMs;
  }

  private updateStatusVisibility(timeMs: number): void {
    if (this.statusLabel.style.display === 'none') {
      return;
    }
    if (timeMs > this.statusHideAt) {
      this.statusLabel.style.display = 'none';
    }
  }

  private showLoadingOverlay(mapName: string): void {
    this.loadingOverlay.classList.remove('loading-overlay-error');
    this.loadingOverlay.style.display = 'grid';
    this.loadingTitle.textContent = `Loading ${mapName} ...`;
    this.loadingProgress.textContent = '0%';
    this.loadingDetail.textContent = '';
    this.loadProgressSpinnerIndex = 0;
  }

  private updateLoadingOverlay(mapName: string, percent: number | null, detail?: string): void {
    if (this.loadingOverlay.style.display === 'none') {
      return;
    }
    this.loadingTitle.textContent = `Loading ${mapName} ...`;
    if (percent === null) {
      const spinnerFrames = ['|', '/', '-', '\\'];
      const spinner = spinnerFrames[this.loadProgressSpinnerIndex % spinnerFrames.length];
      this.loadProgressSpinnerIndex += 1;
      this.loadingProgress.textContent = `${spinner} loading`;
    } else {
      this.loadingProgress.textContent = `${percent.toFixed(0)}%`;
    }
    if (detail) {
      this.appendLoadingDetail(detail);
    }
  }

  private appendLoadingDetail(detail: string): void {
    const trimmed = detail.trim();
    if (trimmed.length === 0) {
      return;
    }

    const lines = this.loadingDetail.textContent.length > 0
      ? this.loadingDetail.textContent.split('\n')
      : [];
    lines.push(trimmed);
    const maxLines = 18;
    const recent = lines.slice(Math.max(0, lines.length - maxLines));
    this.loadingDetail.textContent = recent.join('\n');
  }

  private hideLoadingOverlay(): void {
    this.loadingOverlay.style.display = 'none';
    this.loadingDetail.textContent = '';
  }

  private showLoadingError(error: unknown, assetUrl: string): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    const stack = normalized.stack ?? '';
    this.loadingOverlay.classList.add('loading-overlay-error');
    this.loadingOverlay.style.display = 'grid';
    this.loadingTitle.textContent = 'Map load failed';
    this.loadingProgress.textContent = 'Error';
    this.loadingDetail.textContent = `Asset URL: ${assetUrl || '(unknown)'}\n${normalized.message}\n${stack}`.trim();
  }

  private createCrosshair(): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'crosshair';
    this.container.appendChild(el);
    return el;
  }

  private createStatusLabel(): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'status-label';
    el.style.display = 'none';
    this.container.appendChild(el);
    return el;
  }

  private createLoadingOverlay(): {
    root: HTMLDivElement;
    title: HTMLDivElement;
    progress: HTMLDivElement;
    detail: HTMLPreElement;
  } {
    const root = document.createElement('div');
    root.className = 'loading-overlay';
    root.style.display = 'none';

    const panel = document.createElement('div');
    panel.className = 'loading-panel';

    const title = document.createElement('div');
    title.className = 'loading-title';
    title.textContent = 'Loading map ...';

    const progress = document.createElement('div');
    progress.className = 'loading-progress';
    progress.textContent = '0%';

    const detail = document.createElement('pre');
    detail.className = 'loading-detail';
    detail.textContent = '';

    panel.append(title, progress, detail);
    root.appendChild(panel);
    this.container.appendChild(root);

    return { root, title, progress, detail };
  }

  private readonly onResize = (): void => {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.worldCamera.aspect = window.innerWidth / Math.max(window.innerHeight, 1);
    this.worldCamera.updateProjectionMatrix();
    this.viewmodelRenderer.resize(window.innerWidth, window.innerHeight);
  };

  private readonly onPointerLockChange = (): void => {
    const locked = this.input.isPointerLocked();
    if (!locked) {
      this.playing = false;
      this.menu?.setVisible(true);
      this.setCrosshairVisible(false);
      return;
    }
    this.playing = this.loadedMap !== null;
    this.menu?.setVisible(false);
    this.setCrosshairVisible(this.playing && this.debugCameraMode === 'firstPerson');
  };
}

export async function clearAllCustomMaps(): Promise<void> {
  const maps = await listCustomMaps();
  await Promise.all(maps.map((map) => deleteCustomMap(map.id)));
}
