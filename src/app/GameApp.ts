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
import { KnifeAudio, type KnifeSoundProfile } from '../audio/KnifeAudio';
import { CosmeticsManager } from '../cosmetics/CosmeticsManager';
import { ViewmodelRenderer } from '../cosmetics/ViewmodelRenderer';
import type { LoadoutSelection } from '../cosmetics/types';
import { HUD } from '../ui/HUD';
import { MainMenu } from '../ui/MainMenu';
import { defaultSettings, loadSettings, saveSettings, type GameSettings } from '../ui/SettingsStore';
import { LeaderboardService, sanitizeLeaderboardName } from '../network/LeaderboardService';
import { MultiplayerClient } from '../network/MultiplayerClient';
import type { LeaderboardEntry, PlayerModel } from '../network/types';
import { RemotePlayersRenderer } from '../multiplayer/RemotePlayersRenderer';
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

interface GoalPad {
  center: Vector3;
  radius: number;
  y: number;
  tolerance: number;
}

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
  private readonly leaderboard = new LeaderboardService();
  private readonly multiplayer = new MultiplayerClient();
  private readonly remotePlayers = new RemotePlayersRenderer();
  private readonly knifeAudio = new KnifeAudio();

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
  private readonly timerLabel: HTMLDivElement;
  private readonly runInfoLabel: HTMLDivElement;
  private readonly runSubmitOverlay: HTMLDivElement;
  private readonly runSubmitInput: HTMLInputElement;
  private readonly runSubmitStatus: HTMLDivElement;
  private activeKnifeSoundProfile: KnifeSoundProfile = 'knifeGloves1';

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
  private runStartTimeMs = 0;
  private runPauseStartedAtMs: number | null = null;
  private finishedRunTimeMs: number | null = null;
  private finishTargetY = -Infinity;
  private goalPad: GoalPad | null = null;
  private runComplete = false;
  private localPlayerName = loadPlayerName();
  private multiplayerSendAccumulator = 0;
  private resumeToggleInFlight = false;

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
    const runHud = this.createRunHud();
    this.timerLabel = runHud.timer;
    this.runInfoLabel = runHud.info;
    const submitOverlay = this.createRunSubmitOverlay();
    this.runSubmitOverlay = submitOverlay.root;
    this.runSubmitInput = submitOverlay.input;
    this.runSubmitStatus = submitOverlay.status;

    this.setupWorldLighting();
    this.setupWorldDebugHelpers();
    this.worldScene.add(this.remotePlayers.root);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onGlobalKeyDown);
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
    try {
      await this.remotePlayers.load();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[Multiplayer] Failed to load remote player models:', error);
    }
    this.rebuildMapSources(builtinMaps, customRecords);
    this.selectedMapId =
      builtinMaps.find((map) => map.id === 'custom')?.id
      ?? builtinMaps.find((map) => map.id === 'movement_test_scene')?.id
      ?? builtinMaps[0]?.id
      ?? Array.from(this.mapSources.keys())[0]
      ?? '';

    this.loadout = this.cosmeticsManager.getDefaultLoadout();
    await this.cosmeticsManager.applyLoadout(this.loadout);
    this.activeKnifeSoundProfile = this.getKnifeSoundProfileFromLoadout(this.loadout);
    this.knifeAudio.setProfile(this.activeKnifeSoundProfile);
    this.syncViewmodelMotionStyle();

    this.menu = new MainMenu(this.container, this.settings, {
      onPlay: (mapId) => {
        void this.startPlaySession(mapId);
      },
      onReloadMap: () => {
        void this.reloadSelectedMap();
      },
      onMapSelected: (mapId) => {
        this.selectedMapId = mapId;
        this.remotePlayers.applySnapshot([], null);
        void this.refreshLeaderboard(mapId);
        this.syncMultiplayerIdentity();
      },
      onSettingsChanged: (next) => this.applySettings(next),
      onLoadoutChanged: (next) => {
        this.loadout = next;
        void this.applyLoadout(next);
        this.syncMultiplayerIdentity();
      },
    });
    this.menu.setMaps(this.getMapEntries(), this.selectedMapId);
    this.menu.setCosmetics(cosmeticsManifest, this.loadout);
    this.menu.setLeaderboard([], this.getMapNameById(this.selectedMapId));
    this.menu.setVisible(true);
    this.setCrosshairVisible(false);

    this.multiplayer.onSnapshot = (snapshot) => {
      if (snapshot.mapId !== this.selectedMapId) {
        return;
      }
      this.remotePlayers.applySnapshot(snapshot.players, this.multiplayer.getLocalId());
    };
    this.multiplayer.onAttack = ({ mapId, playerId, kind }) => {
      if (mapId !== this.selectedMapId) {
        return;
      }
      this.remotePlayers.triggerAttack(playerId, kind);
      if (playerId !== this.multiplayer.getLocalId()) {
        const remoteModel = this.remotePlayers.getPlayerModel(playerId);
        const remoteProfile = remoteModel
          ? this.getKnifeSoundProfileFromModel(remoteModel)
          : this.activeKnifeSoundProfile;
        this.knifeAudio.play(kind, 0.48, remoteProfile);
      }
    };
    this.multiplayer.connect();
    this.syncMultiplayerIdentity();
    void this.refreshLeaderboard(this.selectedMapId);

    const acceptanceLog = runMovementAcceptanceDiagnostics();
    logMovementAcceptance(acceptanceLog);

    this.running = true;
    this.lastFrameTime = performance.now();
    requestAnimationFrame(this.loop);
  }

  public dispose(): void {
    this.running = false;
    this.multiplayer.disconnect();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onGlobalKeyDown);
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
          this.resetToSpawn('Reset to spawn', true);
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
          this.multiplayer.sendAttack('primary');
          this.knifeAudio.play('primary');
          attackQueued = false;
        }
        if (attackAltQueued) {
          this.cosmeticsManager.triggerAttackSecondary();
          this.multiplayer.sendAttack('secondary');
          this.knifeAudio.play('secondary');
          attackAltQueued = false;
        }

        const moveInput = this.input.sampleMoveInput();
        this.movement.tick(FIXED_TICK_DT, moveInput, this.collisionWorld);
        this.multiplayerSendAccumulator += FIXED_TICK_DT;
        this.sendMultiplayerStateIfReady();
        this.tryCompleteRun();
        if (this.loadedMap && this.movement.getFeetPosition().y < this.voidResetY) {
          const now = performance.now();
          const showMessage = now - this.lastVoidResetAtMs > 900;
          this.resetToSpawn(showMessage ? 'Out of world reset' : null, true);
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
    this.remotePlayers.update(frameDt);
    const debug = this.movement.getDebugState();
    this.hud.update(debug);
    this.updateTimerHud();
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
    if (await this.tryResumeLoadedMap(mapId, 'Could not lock cursor. Press Esc or click Play to resume.')) {
      return;
    }

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
      this.hideRunSubmitOverlay();
      this.startRunTimer();
      const lockAcquired = await this.input.requestPointerLock();
      if (!lockAcquired) {
        this.pauseRunTimer();
        this.playing = false;
        this.menu.setVisible(true);
        this.setCrosshairVisible(false);
        this.showStatus('Map loaded. Click Play to lock cursor.');
        return;
      }
      this.menu.setVisible(false);
      this.playing = true;
      this.syncMultiplayerIdentity();
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
      this.finishTargetY = -1000;
      this.goalPad = null;
    } else {
      const height = Math.max(1, collisionBounds.max.y - collisionBounds.min.y);
      const margin = Math.max(12, Math.min(120, height * 0.2));
      this.voidResetY = collisionBounds.min.y - margin;

      this.goalPad = this.resolveGoalPad(map, collisionBounds);
      if (this.goalPad) {
        this.finishTargetY = this.goalPad.y;
      } else {
        const goalFromMeta = typeof map.meta.goalY === 'number' && Number.isFinite(map.meta.goalY)
          ? map.meta.goalY
          : null;
        this.finishTargetY = goalFromMeta ?? Number.NEGATIVE_INFINITY;
      }
    }
    this.updateRunInfoWithLeaderboard([]);
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
    if (this.loadedMap && this.loadedMap.entry.id === this.selectedMapId) {
      this.resetToSpawn('Run restarted', true);
      this.hideRunSubmitOverlay();
      const lockAcquired = await this.input.requestPointerLock();
      if (!lockAcquired) {
        this.pauseRunTimer();
        this.playing = false;
        this.menu?.setVisible(true);
        this.setCrosshairVisible(false);
        this.showStatus('Could not lock cursor. Click Play to resume.');
        return;
      }
      this.menu?.setVisible(false);
      this.playing = true;
      this.setCrosshairVisible(this.debugCameraMode === 'firstPerson');
      return;
    }
    await this.startPlaySession(this.selectedMapId);
  }

  private getMapNameById(mapId: string): string {
    return this.mapSources.get(mapId)?.entry.name ?? mapId;
  }

  private async refreshLeaderboard(mapId: string): Promise<void> {
    const mapName = this.getMapNameById(mapId);
    try {
      const entries = await this.leaderboard.fetchLeaderboard(mapId);
      this.menu?.setLeaderboard(entries, mapName);
      this.updateRunInfoWithLeaderboard(entries);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[Leaderboard] Failed to refresh:', error);
      this.menu?.setLeaderboard([], mapName);
      this.updateRunInfoWithLeaderboard([]);
    }
  }

  private updateRunInfoWithLeaderboard(entries: LeaderboardEntry[]): void {
    const goalText = this.goalPad
      ? `Pad (${this.goalPad.center.x.toFixed(1)}, ${this.goalPad.center.z.toFixed(1)}) r=${this.goalPad.radius.toFixed(1)}`
      : (Number.isFinite(this.finishTargetY) ? `Y <= ${this.finishTargetY.toFixed(2)}` : '--');
    if (entries.length === 0) {
      this.runInfoLabel.textContent = `Goal: ${goalText} | Best: --`;
      return;
    }
    const best = entries[0];
    const bestText = `${best.name} ${formatRunTime(best.timeMs)}`;
    this.runInfoLabel.textContent = `Goal: ${goalText} | Best: ${bestText}`;
  }

  private resolveGoalPad(map: LoadedMap, collisionBounds: Box3): GoalPad | null {
    const fromMeta = map.meta.goalPad;
    if (fromMeta) {
      const [x, y, z] = fromMeta.center;
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) && Number.isFinite(fromMeta.radius)) {
        return {
          center: new Vector3(x, y, z),
          radius: Math.max(0.25, fromMeta.radius),
          y,
          tolerance: Math.max(0.2, fromMeta.tolerance ?? 0.6),
        };
      }
    }

    const inferred = this.detectGoalPadFromCollisionRoot(map.collisionRoot, collisionBounds);
    if (inferred) {
      // eslint-disable-next-line no-console
      console.log(
        `[GoalPad] inferred center=(${inferred.center.x.toFixed(3)}, ${inferred.center.y.toFixed(3)}, ${inferred.center.z.toFixed(3)}) radius=${inferred.radius.toFixed(3)} tolerance=${inferred.tolerance.toFixed(3)}`,
      );
    } else {
      // eslint-disable-next-line no-console
      console.warn('[GoalPad] No circular bottom pad detected. Set meta.goalPad to enforce exact run finish area.');
    }
    return inferred;
  }

  private detectGoalPadFromCollisionRoot(root: Object3D, collisionBounds: Box3): GoalPad | null {
    const minY = collisionBounds.min.y;
    const upDotThreshold = 0.94;
    const yBand = Math.max(0.9, this.movement.capsule.radius * 3.2);

    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    const ab = new Vector3();
    const ac = new Vector3();
    const normal = new Vector3();
    const centroid = new Vector3();

    let weightedArea = 0;
    let weightedX = 0;
    let weightedY = 0;
    let weightedZ = 0;

    root.updateWorldMatrix(true, true);
    root.traverse((child) => {
      if (!(child instanceof Mesh)) {
        return;
      }

      const geometry = child.geometry as BufferGeometry;
      const positions = geometry.getAttribute('position');
      if (!positions) {
        return;
      }

      const index = geometry.index;
      const triCount = index ? Math.floor(index.count / 3) : Math.floor(positions.count / 3);
      for (let tri = 0; tri < triCount; tri += 1) {
        const i0 = index ? index.getX(tri * 3) : tri * 3;
        const i1 = index ? index.getX(tri * 3 + 1) : tri * 3 + 1;
        const i2 = index ? index.getX(tri * 3 + 2) : tri * 3 + 2;

        a.fromBufferAttribute(positions, i0).applyMatrix4(child.matrixWorld);
        b.fromBufferAttribute(positions, i1).applyMatrix4(child.matrixWorld);
        c.fromBufferAttribute(positions, i2).applyMatrix4(child.matrixWorld);

        ab.copy(b).sub(a);
        ac.copy(c).sub(a);
        normal.copy(ab).cross(ac);
        const doubleArea = normal.length();
        if (doubleArea <= 1e-7) {
          continue;
        }
        normal.multiplyScalar(1 / doubleArea);
        if (normal.y < upDotThreshold) {
          continue;
        }

        centroid.copy(a).add(b).add(c).multiplyScalar(1 / 3);
        if (centroid.y > minY + yBand) {
          continue;
        }

        const area = doubleArea * 0.5;
        weightedArea += area;
        weightedX += centroid.x * area;
        weightedY += centroid.y * area;
        weightedZ += centroid.z * area;
      }
    });

    if (weightedArea <= 1e-4) {
      return null;
    }

    const centerX = weightedX / weightedArea;
    const centerY = weightedY / weightedArea;
    const centerZ = weightedZ / weightedArea;

    const distances: number[] = [];
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;

    root.traverse((child) => {
      if (!(child instanceof Mesh)) {
        return;
      }

      const geometry = child.geometry as BufferGeometry;
      const positions = geometry.getAttribute('position');
      if (!positions) {
        return;
      }

      const index = geometry.index;
      const triCount = index ? Math.floor(index.count / 3) : Math.floor(positions.count / 3);
      for (let tri = 0; tri < triCount; tri += 1) {
        const i0 = index ? index.getX(tri * 3) : tri * 3;
        const i1 = index ? index.getX(tri * 3 + 1) : tri * 3 + 1;
        const i2 = index ? index.getX(tri * 3 + 2) : tri * 3 + 2;

        a.fromBufferAttribute(positions, i0).applyMatrix4(child.matrixWorld);
        b.fromBufferAttribute(positions, i1).applyMatrix4(child.matrixWorld);
        c.fromBufferAttribute(positions, i2).applyMatrix4(child.matrixWorld);

        ab.copy(b).sub(a);
        ac.copy(c).sub(a);
        normal.copy(ab).cross(ac);
        const doubleArea = normal.length();
        if (doubleArea <= 1e-7) {
          continue;
        }
        normal.multiplyScalar(1 / doubleArea);
        if (normal.y < upDotThreshold) {
          continue;
        }

        centroid.copy(a).add(b).add(c).multiplyScalar(1 / 3);
        if (centroid.y > minY + yBand) {
          continue;
        }

        const radiusA = Math.hypot(a.x - centerX, a.z - centerZ);
        const radiusB = Math.hypot(b.x - centerX, b.z - centerZ);
        const radiusC = Math.hypot(c.x - centerX, c.z - centerZ);
        distances.push(radiusA, radiusB, radiusC);

        minX = Math.min(minX, a.x, b.x, c.x);
        maxX = Math.max(maxX, a.x, b.x, c.x);
        minZ = Math.min(minZ, a.z, b.z, c.z);
        maxZ = Math.max(maxZ, a.z, b.z, c.z);
      }
    });

    if (distances.length < 12) {
      return null;
    }

    distances.sort((lhs, rhs) => lhs - rhs);
    const p90 = distances[Math.floor((distances.length - 1) * 0.9)];
    const areaRadius = Math.sqrt(weightedArea / Math.PI);
    const radius = Math.max(0.6, Math.min(220, Math.max(p90 * 0.92, areaRadius * 0.92)));

    const width = Math.max(1e-3, maxX - minX);
    const depth = Math.max(1e-3, maxZ - minZ);
    const aspect = Math.max(width, depth) / Math.min(width, depth);
    const fill = weightedArea / (Math.PI * radius * radius);
    if (aspect > 2.35 || fill < 0.24) {
      return null;
    }

    return {
      center: new Vector3(centerX, centerY, centerZ),
      radius,
      y: centerY,
      tolerance: Math.max(0.45, this.movement.capsule.radius * 1.35),
    };
  }

  private syncMultiplayerIdentity(): void {
    if (!this.loadout || !this.selectedMapId) {
      return;
    }
    this.multiplayer.join(
      this.selectedMapId,
      this.localPlayerName,
      this.getPlayerModelFromLoadout(this.loadout),
    );
  }

  private getPlayerModelFromLoadout(loadout: LoadoutSelection): PlayerModel {
    return loadout.knifeId === 'real_knife_viewmodel' ? 'terrorist' : 'counterterrorist';
  }

  private getKnifeSoundProfileFromLoadout(loadout: LoadoutSelection): KnifeSoundProfile {
    return this.getPlayerModelFromLoadout(loadout) === 'terrorist' ? 'knifeGloves1' : 'knifeGloves2';
  }

  private getKnifeSoundProfileFromModel(model: PlayerModel): KnifeSoundProfile {
    return model === 'terrorist' ? 'knifeGloves1' : 'knifeGloves2';
  }

  private sendMultiplayerStateIfReady(): void {
    if (this.multiplayerSendAccumulator < 1 / 20) {
      return;
    }
    this.multiplayerSendAccumulator = 0;
    if (!this.playing || !this.loadedMap) {
      return;
    }

    const position = this.movement.getFeetPosition();
    const velocity = this.movement.getVelocity();
    this.multiplayer.sendState({
      position: [position.x, position.y, position.z],
      velocity: [velocity.x, velocity.y, velocity.z],
      yaw: this.movement.getYawRad(),
      pitch: this.movement.getPitchRad(),
    });
  }

  private startRunTimer(): void {
    this.runStartTimeMs = performance.now();
    this.runPauseStartedAtMs = null;
    this.finishedRunTimeMs = null;
    this.runComplete = false;
    this.updateTimerHud();
  }

  private updateTimerHud(): void {
    if (this.runStartTimeMs <= 0) {
      this.timerLabel.textContent = 'Run: --';
      return;
    }

    const elapsedMs = this.getCurrentRunTimeMs();
    this.timerLabel.textContent = `Run: ${formatRunTime(elapsedMs)}`;
  }

  private tryCompleteRun(): void {
    if (!this.playing || this.runComplete || !this.loadedMap) {
      return;
    }

    const feet = this.movement.getFeetPosition();
    const debug = this.movement.getDebugState();

    if (this.goalPad) {
      if (!debug.grounded) {
        return;
      }
      const dy = Math.abs(feet.y - this.goalPad.y);
      if (dy > this.goalPad.tolerance) {
        return;
      }
      const dx = feet.x - this.goalPad.center.x;
      const dz = feet.z - this.goalPad.center.z;
      if (dx * dx + dz * dz > this.goalPad.radius * this.goalPad.radius) {
        return;
      }
    } else {
      if (!Number.isFinite(this.finishTargetY)) {
        return;
      }
      if (feet.y > this.finishTargetY + 0.08) {
        return;
      }
    }

    this.runComplete = true;
    this.finishedRunTimeMs = this.getCurrentRunTimeMs();
    this.runPauseStartedAtMs = null;
    this.playing = false;
    this.showStatus(`Run complete: ${formatRunTime(this.finishedRunTimeMs)}`);
    this.openRunSubmitOverlay();
    if (document.pointerLockElement === this.renderer.domElement) {
      void document.exitPointerLock();
    }
  }

  private openRunSubmitOverlay(): void {
    this.runSubmitOverlay.style.display = 'grid';
    this.runSubmitInput.value = this.localPlayerName;
    this.runSubmitStatus.textContent = this.finishedRunTimeMs !== null
      ? `Finished in ${formatRunTime(this.finishedRunTimeMs)}`
      : '';
    this.runSubmitInput.focus();
    this.runSubmitInput.select();
  }

  private hideRunSubmitOverlay(): void {
    this.runSubmitOverlay.style.display = 'none';
    this.runSubmitStatus.textContent = '';
  }

  private async submitRunResult(): Promise<void> {
    if (!this.loadedMap || this.finishedRunTimeMs === null || !this.loadout) {
      return;
    }

    const cleanedName = sanitizeLeaderboardName(this.runSubmitInput.value);
    if (cleanedName.length < 2) {
      this.runSubmitStatus.textContent = 'Name must be at least 2 characters.';
      return;
    }

    this.localPlayerName = cleanedName;
    savePlayerName(cleanedName);
    this.syncMultiplayerIdentity();

    this.runSubmitStatus.textContent = 'Submitting...';
    try {
      const model = this.getPlayerModelFromLoadout(this.loadout);
      const entries = await this.leaderboard.submitRun(
        this.loadedMap.entry.id,
        cleanedName,
        this.finishedRunTimeMs,
        model,
      );
      this.menu?.setLeaderboard(entries, this.getMapNameById(this.loadedMap.entry.id));
      this.updateRunInfoWithLeaderboard(entries);
      this.runSubmitStatus.textContent = 'Run submitted.';
      window.setTimeout(() => {
        this.hideRunSubmitOverlay();
      }, 650);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.runSubmitStatus.textContent = message;
    }
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
    this.activeKnifeSoundProfile = this.getKnifeSoundProfileFromLoadout(selection);
    this.knifeAudio.setProfile(this.activeKnifeSoundProfile);
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

  private resetToSpawn(message: string | null, restartTimer = false): void {
    if (!this.loadedMap) {
      return;
    }
    this.movement.reset(this.loadedMap.spawnPosition, this.loadedMap.spawnYawDeg);
    this.runComplete = false;
    this.finishedRunTimeMs = null;
    if (restartTimer) {
      this.startRunTimer();
    }
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

  private createRunHud(): { timer: HTMLDivElement; info: HTMLDivElement } {
    const timer = document.createElement('div');
    timer.className = 'run-timer';
    timer.textContent = 'Run: --';

    const info = document.createElement('div');
    info.className = 'run-info';
    info.textContent = 'Goal Y: -- | Best: --';

    this.container.append(timer, info);
    return { timer, info };
  }

  private createRunSubmitOverlay(): {
    root: HTMLDivElement;
    input: HTMLInputElement;
    status: HTMLDivElement;
  } {
    const root = document.createElement('div');
    root.className = 'run-submit-overlay';
    root.style.display = 'none';

    const panel = document.createElement('div');
    panel.className = 'run-submit-panel';

    const title = document.createElement('div');
    title.className = 'run-submit-title';
    title.textContent = 'Run Complete';

    const subtitle = document.createElement('div');
    subtitle.className = 'run-submit-subtitle';
    subtitle.textContent = 'Enter a name to submit your run to the leaderboard.';

    const input = document.createElement('input');
    input.className = 'run-submit-input';
    input.type = 'text';
    input.maxLength = 24;
    input.value = this.localPlayerName;
    input.placeholder = 'Player name';

    const actions = document.createElement('div');
    actions.className = 'run-submit-actions';

    const submitButton = document.createElement('button');
    submitButton.className = 'run-submit-button';
    submitButton.type = 'button';
    submitButton.textContent = 'Submit';
    submitButton.addEventListener('click', () => {
      void this.submitRunResult();
    });

    const skipButton = document.createElement('button');
    skipButton.className = 'run-submit-button run-submit-button-secondary';
    skipButton.type = 'button';
    skipButton.textContent = 'Skip';
    skipButton.addEventListener('click', () => {
      this.hideRunSubmitOverlay();
    });

    actions.append(submitButton, skipButton);

    const status = document.createElement('div');
    status.className = 'run-submit-status';
    status.textContent = '';

    panel.append(title, subtitle, input, actions, status);
    root.appendChild(panel);
    this.container.appendChild(root);

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void this.submitRunResult();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        this.hideRunSubmitOverlay();
      }
    });

    return { root, input, status };
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
      if (this.playing && !this.runComplete && this.finishedRunTimeMs === null) {
        this.pauseRunTimer();
      }
      this.playing = false;
      this.menu?.setVisible(true);
      this.setCrosshairVisible(false);
      return;
    }
    if (this.loadedMap !== null && !this.runComplete && this.finishedRunTimeMs === null) {
      this.resumeRunTimer();
    }
    this.playing = this.loadedMap !== null && !this.runComplete;
    this.menu?.setVisible(false);
    this.setCrosshairVisible(this.playing && this.debugCameraMode === 'firstPerson');
  };

  private readonly onGlobalKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== 'Escape') {
      return;
    }
    if (this.input.isPointerLocked()) {
      return;
    }
    if (!this.loadedMap || this.runComplete || this.finishedRunTimeMs !== null) {
      return;
    }
    if (this.loadingOverlay.style.display !== 'none') {
      return;
    }
    if (this.runSubmitOverlay.style.display !== 'none') {
      return;
    }
    if (this.resumeToggleInFlight) {
      return;
    }

    event.preventDefault();
    this.resumeToggleInFlight = true;
    const mapId = this.loadedMap.entry.id;
    void this.tryResumeLoadedMap(
      mapId,
      'Could not lock cursor. Press Esc again or click Play to resume.',
      false,
    ).finally(() => {
      this.resumeToggleInFlight = false;
    });
  };

  private async tryResumeLoadedMap(
    mapId: string,
    lockFailureMessage: string,
    showResumedStatus = true,
  ): Promise<boolean> {
    if (
      !this.loadedMap
      || this.loadedMap.entry.id !== mapId
      || this.runComplete
      || this.finishedRunTimeMs !== null
      || this.input.isPointerLocked()
    ) {
      return false;
    }

    this.hideLoadingOverlay();
    this.hideRunSubmitOverlay();
    const lockAcquired = await this.input.requestPointerLock();
    if (!lockAcquired) {
      this.playing = false;
      this.menu?.setVisible(true);
      this.setCrosshairVisible(false);
      this.showStatus(lockFailureMessage);
      return true;
    }

    this.resumeRunTimer();
    this.menu?.setVisible(false);
    this.playing = true;
    this.setCrosshairVisible(this.debugCameraMode === 'firstPerson');
    if (showResumedStatus) {
      this.showStatus('Resumed');
    }
    return true;
  }

  private pauseRunTimer(): void {
    if (this.runPauseStartedAtMs !== null || this.runStartTimeMs <= 0 || this.finishedRunTimeMs !== null) {
      return;
    }
    this.runPauseStartedAtMs = performance.now();
    this.updateTimerHud();
  }

  private resumeRunTimer(): void {
    if (this.runPauseStartedAtMs === null || this.runStartTimeMs <= 0 || this.finishedRunTimeMs !== null) {
      return;
    }
    const pausedDuration = Math.max(0, performance.now() - this.runPauseStartedAtMs);
    this.runPauseStartedAtMs = null;
    this.runStartTimeMs += pausedDuration;
    this.updateTimerHud();
  }

  private getCurrentRunTimeMs(): number {
    if (this.finishedRunTimeMs !== null) {
      return this.finishedRunTimeMs;
    }
    const nowMs = this.runPauseStartedAtMs ?? performance.now();
    return Math.max(0, nowMs - this.runStartTimeMs);
  }
}

export async function clearAllCustomMaps(): Promise<void> {
  const maps = await listCustomMaps();
  await Promise.all(maps.map((map) => deleteCustomMap(map.id)));
}

const PLAYER_NAME_STORAGE_KEY = 'webstrafe-player-name-v1';

function loadPlayerName(): string {
  try {
    const value = localStorage.getItem(PLAYER_NAME_STORAGE_KEY);
    if (!value) {
      return `Player_${Math.floor(Math.random() * 900 + 100)}`;
    }
    const cleaned = sanitizeLeaderboardName(value);
    return cleaned.length >= 2 ? cleaned : `Player_${Math.floor(Math.random() * 900 + 100)}`;
  } catch {
    return `Player_${Math.floor(Math.random() * 900 + 100)}`;
  }
}

function savePlayerName(name: string): void {
  localStorage.setItem(PLAYER_NAME_STORAGE_KEY, name);
}

function formatRunTime(totalMs: number): string {
  const clamped = Math.max(0, totalMs);
  const ms = Math.floor(clamped % 1000);
  const totalSeconds = Math.floor(clamped / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60);
  const minutePrefix = minutes > 0 ? `${minutes}:` : '';
  const secondText = minutes > 0 ? seconds.toString().padStart(2, '0') : seconds.toString();
  return `${minutePrefix}${secondText}.${ms.toString().padStart(3, '0')}`;
}
