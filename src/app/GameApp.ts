import {
  ACESFilmicToneMapping,
  AxesHelper,
  Box3,
  BufferGeometry,
  GridHelper,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  Object3D,
  PMREMGenerator,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { InputManager } from '../core/InputManager';
import { FixedInputActionBuffer } from '../core/FixedInputActionBuffer';
import { selectWeaponFromInput } from '../core/GameplayWeaponInput';
import { MovementController } from '../movement/MovementController';
import { runMovementAcceptanceDiagnostics } from '../movement/MovementAcceptanceDiagnostics';
import { logMovementAcceptance } from '../movement/MovementTestScene';
import type { MovementDebugState } from '../movement/types';
import { KnifeAudio, type KnifeSoundProfile } from '../audio/KnifeAudio';
import { GunAudio, type GunAudioStatus } from '../audio/GunAudio';
import { AttackSoundThrottle } from '../audio/AttackSoundThrottle';
import { defaultLoadout, loadCosmeticsManifest } from '../cosmetics/manifest';
import { ViewmodelRenderer } from '../cosmetics/ViewmodelRenderer';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { FirearmId as GunId } from '../combat/FirearmTiming';
import { ViewmodelSystem, type ViewAction } from '../viewmodel/ViewmodelSystem';
import { parseShotRequest, type ShotRequest } from './shotMode';
import { FramePerf } from './FramePerf';
import { AdaptiveResolution } from './AdaptiveResolution';
import type { LoadoutSelection } from '../cosmetics/types';
import { HUD } from '../ui/HUD';
import { MainMenu } from '../ui/MainMenu';
import { defaultSettings, loadSettings, saveSettings, type GameSettings } from '../ui/SettingsStore';
import { LeaderboardService, sanitizeLeaderboardName } from '../network/LeaderboardService';
import { MultiplayerClient } from '../network/MultiplayerClient';
import { createMultiplayer } from '../network/createMultiplayer';
import type { MultiplayerTransport } from '../network/MultiplayerTransport';
import type { AttackKind, LeaderboardEntry, PlayerModel } from '../network/types';
import {
  RemotePlayersRenderer,
} from '../multiplayer/RemotePlayersRenderer';
import { CombatHud } from '../ui/CombatHud';
import { planHitConfirmation } from '../ui/HitmarkerFeedback';
import { CombatEffects } from '../combat/CombatEffects';
import {
  createRemoteShotHandler,
} from '../combat/FirearmShotFeedback';
import { KillFeed } from '../combat/KillFeed';
import { fireLocalWeapon } from '../combat/LocalFirearmShot';
import {
  findBackstabOpportunity,
  type BackstabTarget,
} from '../combat/BackstabOpportunity';
import { WeaponController } from '../combat/WeaponController';
import { CombatAim } from '../combat/CombatAim';
import { PLAYER_CAPSULE_HEIGHT, PLAYER_CAPSULE_RADIUS } from '../combat/CombatArena';
import { resolveHit } from '../combat/HitResolver';
import { LocalKnife } from '../combat/LocalKnife';
import type { MeleeTarget } from '../combat/MeleeResolver';
import { DEFAULT_ZOOM_SENSITIVITY_RATIO } from '../combat/Scope';
import { ScopeOverlay } from '../ui/ScopeOverlay';
import { isCombatEnabled } from '../combat/combatConfig';
import { getWeapon, type WeaponId } from '../combat/weapons';
import { DEFAULT_KNIFE_ID, getKnife, isKnifeId, type KnifeId } from '../combat/knives';
import { CollisionWorld } from '../world/CollisionWorld';
import { deleteCustomMap, listCustomMaps } from '../world/CustomMapStore';
import { MapLoader, type MapLoadReporter } from '../world/MapLoader';
import { loadBuiltinManifest } from '../world/MapManifestService';
import { loadSelectedMapId, saveSelectedMapId } from '../world/MapSelectionStore';
import { groundResolvedSpawn, type ResolvedSpawn } from '../world/SpawnResolver';
import { resolveRunGoal, type GoalPad } from '../world/RunGoal';
import { MapEnvironment } from '../world/MapEnvironment';
import { MapTriggers } from '../world/MapTriggers';
import { listMetaSpawns, pickSpawnAwayFrom, resolveBotAnchor } from '../world/SpawnPoints';
import type { CustomMapRecord, LoadedMap, MapManifestEntry } from '../world/types';
// v2 ui + audio
import { getAudioEngine } from '../audio/AudioEngine';
import { MovementAudioTracker } from '../audio/MovementAudio';
import { KNIFE_DAMAGE, KNIFE_RANGE_M } from '../combat/knives';
import type { DeathEvent, HitEvent, ShotEvent } from '../network/MultiplayerTransport';
import { GameHud } from '../ui/hud/GameHud';
import { damageDirection } from '../ui/hud/hudMath';
import { showsRunTimer } from '../ui/menu/menuInfo';

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
/** Gives the slowest remote round several rendered arrival frames before UI cover. */
const FATAL_CUE_LEAD_MS = 320;
const RESPAWN_DELAY_MS = 3000;
/** built-in maps the menu opens on when nothing is stored */
const DEFAULT_RUN_MAP_ID = 'surf_prismline';
const DEFAULT_COMBAT_MAP_ID = 'aim_ochrecut';

export class GameApp {
  private readonly container: HTMLElement;
  private readonly renderer: WebGLRenderer;
  private readonly worldScene = new Scene();
  private readonly worldCamera: PerspectiveCamera;
  private readonly viewmodelRenderer: ViewmodelRenderer;
  private readonly input: InputManager;
  private readonly fixedInputActions = new FixedInputActionBuffer();
  private readonly movement = new MovementController();
  private readonly collisionWorld = new CollisionWorld();
  private readonly mapLoader = new MapLoader();
  private readonly hud: HUD;
  private readonly leaderboard = new LeaderboardService();
  private multiplayer: MultiplayerTransport = new MultiplayerClient();
  private readonly remotePlayers = new RemotePlayersRenderer();
  private readonly knifeAudio = new KnifeAudio();
  private readonly remoteKnifeAudio = new KnifeAudio();
  private readonly gunAudio = new GunAudio();
  private combatAudioStatus: GunAudioStatus | null = null;
  private readonly remoteAttackSound = new AttackSoundThrottle();
  private readonly knownRemoteIds = new Set<string>();

  private readonly combatEnabled = isCombatEnabled();
  private combatHud: CombatHud | null = null;
  private combatEffects: CombatEffects | null = null;
  private readonly killFeed = new KillFeed();
  private readonly weapon = new WeaponController('knife');
  private localAlive = true;
  private deathPresentationTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly deadMoveInput = { forwardMove: 0, sideMove: 0, jumpPressed: false, jumpHeld: false };
  private readonly remotePlayerNames = new Map<string, string>();
  private backstabTargets: BackstabTarget[] = [];
  // combat aim: spread, recoil, awp scope and the local knife gate
  private readonly combatAim = new CombatAim();
  private readonly localKnife = new LocalKnife();
  private scopeOverlay: ScopeOverlay | null = null;
  private viewmodelHiddenForScope = false;
  /** current cone radius for the crosshair, radians */
  private crosshairSpreadRad = 0;

  private readonly viewmodel = new ViewmodelSystem();
  private readonly muzzleScratch = new Vector3();
  private readonly shot: ShotRequest | null = parseShotRequest(window.location.search);
  private framePerf: FramePerf | null = null;
  private qaMove: { forwardMove: number; sideMove: number; jumpHeld: boolean; jumpPressed: boolean } | null = null;
  private readonly adaptiveResolution = new AdaptiveResolution();

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
  private readonly mapEnvironment: MapEnvironment;
  private mapTriggers: MapTriggers | null = null;
  /** every authored spawn seated on the collision, spawns[0] first */
  private spawnPoints: ResolvedSpawn[] = [];

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
  private resumeToggleInFlight = false;
  private remotePlayersReady: Promise<void> = Promise.resolve();

  private readonly tmpForward = new Vector3();
  private readonly tmpDesiredCameraPos = new Vector3();
  private readonly tmpLookAt = new Vector3();

  // --- v2 ui + audio state ---
  private readonly audio = getAudioEngine();
  private readonly gameHud: GameHud;
  private readonly movementAudio = new MovementAudioTracker();
  private runTimerAllowed = false;
  private lastShotDirectionAtMs = 0;
  private lastDryFireAtMs = 0;
  private readonly listenerForward = new Vector3();
  private readonly listenerUp = new Vector3();

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
    this.hud.setVisible(false);
    this.gameHud = new GameHud(this.container, {
      isActive: () => this.playing,
      onToggleMovementDebug: () => this.toggleMovementDebug(),
    });

    this.viewmodelRenderer = new ViewmodelRenderer(68, window.innerWidth / window.innerHeight);
    this.viewmodelRenderer.camera.add(this.viewmodel.root);
    this.viewmodel.onEvent = (name) => this.playViewmodelEvent(name);
    // Soft studio environment so metallic weapon materials (Deagle/AWP) read as
    // lit gunmetal instead of near-black, and the knife/gloves gain gentle IBL.
    const pmrem = new PMREMGenerator(this.renderer);
    this.viewmodelRenderer.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

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

    this.mapEnvironment = new MapEnvironment(this.worldScene, this.renderer);
    this.setupWorldDebugHelpers();
    this.worldScene.add(this.remotePlayers.root);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onGlobalKeyDown);
    document.addEventListener('pointerlockerror', this.onPointerLockError);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
  }

  public async init(): Promise<void> {
    this.settings = loadSettings();
    if (this.shot?.adaptive !== null && this.shot?.adaptive !== undefined) {
      this.settings.adaptiveResolution = this.shot.adaptive;
    }
    if (this.shot?.adaptiveLowFps) {
      this.adaptiveResolution.setThresholds(this.shot.adaptiveLowFps);
    }
    this.movement.setCvar('sv_autobhop_enabled', this.settings.autoBhop);
    this.audio.installGestureUnlock();
    this.applyUiSettings(this.settings);
    this.worldCamera.fov = this.settings.worldFov;
    this.worldCamera.updateProjectionMatrix();
    this.viewmodelRenderer.setFov(this.settings.viewmodelFov);
    this.viewmodel.setScale(this.settings.viewmodelScale);
    this.applyRenderScale();

    const [builtinMaps, customRecords, cosmeticsManifest] = await Promise.all([
      loadBuiltinManifest(),
      listCustomMaps(),
      loadCosmeticsManifest(),
    ]);
    // The remote player models (~75 MB of GLBs) are only needed once a match
    // starts — not for the menu or its character preview, which loads its own
    // hero model. Kick the load off in the background so the menu paints
    // immediately instead of blocking the first render on 75 MB. Awaited before
    // a play session actually enters a map (see startPlaySession).
    this.remotePlayersReady = this.remotePlayers.load().catch((error) => {
      // eslint-disable-next-line no-console
      console.warn('[Multiplayer] Failed to load remote player models:', error);
    });
    // arms, deagle and awp are about 1.4 MB; load them behind the menu
    void this.viewmodel.load().then(() => {
      this.viewmodel.equip(this.combatEnabled ? this.weapon.getActive() : 'knife');
    }).catch((error) => {
      // eslint-disable-next-line no-console
      console.warn('[Viewmodel] Failed to load the first-person arms and weapons:', error);
    });
    this.rebuildMapSources(builtinMaps, customRecords);
    const fallbackMapId =
      builtinMaps.find((map) => map.id === (this.combatEnabled ? DEFAULT_COMBAT_MAP_ID : DEFAULT_RUN_MAP_ID))?.id
      ?? builtinMaps.find((map) => map.id === 'movement_test_scene')?.id
      ?? builtinMaps[0]?.id
      ?? Array.from(this.mapSources.keys())[0]
      ?? '';
    this.selectedMapId = loadSelectedMapId(this.mapSources.keys(), fallbackMapId);

    this.loadout = defaultLoadout(cosmeticsManifest);
    this.viewmodel.setKnife(loadKnifeStyle());
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
        this.persistSelectedMapId(mapId);
        this.remotePlayers.applySnapshot([], null);
        this.backstabTargets = [];
        void this.refreshLeaderboard(mapId);
        this.syncMultiplayerIdentity();
      },
      onSettingsChanged: (next) => this.applySettings(next),
      onLoadoutChanged: (next) => {
        this.loadout = next;
        void this.applyLoadout(next);
        this.syncMultiplayerIdentity();
      },
      onNameChanged: (name) => this.applyPlayerName(name),
      onKnifeSelected: (knifeId) => {
        this.viewmodel.setKnife(knifeId);
        saveKnifeStyle(knifeId);
        this.showStatus(`Knife: ${knifeId ? getKnife(knifeId).name : 'Legacy Knife'}`);
        this.syncHudKnifeName();
      },
    });
    this.menu.setSelectedKnife(this.viewmodel.getKnife());
    this.menu.setMaps(this.getMapEntries(), this.selectedMapId);
    this.menu.setCosmetics(cosmeticsManifest, this.loadout);
    this.menu.setLeaderboard([], this.getMapNameById(this.selectedMapId));
    this.menu.setPlayerName(this.localPlayerName);
    // Persist the (possibly auto-generated) name so identity is stable across reloads.
    savePlayerName(this.localPlayerName);
    this.menu.setVisible(true);
    this.setCrosshairVisible(false);
    this.dismissBootLoader();

    if (this.shot) {
      void this.runShot(this.shot);
    }

    // Pick the transport: Supabase Realtime when configured (serverless deploy),
    // else the self-hosted WebSocket client (local dev / LAN).
    this.multiplayer = await createMultiplayer();

    this.multiplayer.onSnapshot = (snapshot) => {
      if (snapshot.mapId !== this.selectedMapId) {
        return;
      }
      const localId = this.multiplayer.getLocalId();
      this.remotePlayers.applySnapshot(snapshot.players, localId);
      this.backstabTargets = snapshot.players
        .filter((player) => player.id !== localId)
        .map((player) => ({
          id: player.id,
          position: player.position,
          yaw: player.yaw,
          alive: player.alive !== false,
        }));
      const local = localId
        ? snapshot.players.find((player) => player.id === localId)
        : undefined;
      if (
        this.combatEnabled
        && local
        && typeof local.health === 'number'
        && Number.isFinite(local.health)
        && typeof local.alive === 'boolean'
      ) {
        // Snapshot reconciliation recovers from a transport reconnect that
        // missed the one-shot respawn event while the page was paused.
        this.applyLocalHealth(local.health, local.alive);
      }
      const present = new Set<string>();
      for (const p of snapshot.players) {
        present.add(p.id);
        if (this.combatEnabled) {
          this.remotePlayerNames.set(p.id, p.name);
        }
      }
      // Prune per-player state for anyone who left, so these maps stay bounded.
      for (const id of this.remotePlayerNames.keys()) {
        if (!present.has(id)) {
          this.remotePlayerNames.delete(id);
        }
      }
      for (const id of this.knownRemoteIds) {
        if (!present.has(id)) {
          this.remoteAttackSound.forget(id);
          this.knownRemoteIds.delete(id);
        }
      }
      for (const id of present) {
        if (id !== this.multiplayer.getLocalId()) {
          this.knownRemoteIds.add(id);
        }
      }
    };
    this.multiplayer.onAttack = ({ mapId, playerId, kind }) => {
      if (mapId !== this.selectedMapId) {
        return;
      }
      this.remotePlayers.triggerAttack(playerId, kind);
      if (playerId !== this.multiplayer.getLocalId()) {
        // Throttle per player so a spammy peer/bot can't machine-gun the SFX.
        if (!this.remoteAttackSound.shouldPlay(playerId, performance.now())) {
          return;
        }
        const remoteModel = this.remotePlayers.getPlayerModel(playerId);
        const remoteProfile = remoteModel
          ? this.getKnifeSoundProfileFromModel(remoteModel)
          : this.activeKnifeSoundProfile;
        this.remoteKnifeAudio.play(kind, 0.48, remoteProfile, this.remoteChestPosition(playerId) ?? undefined);
      }
    };
    this.multiplayer.connect();
    this.setupCombat();
    this.wireUiEvents();
    this.syncMultiplayerIdentity();
    void this.refreshLeaderboard(this.selectedMapId);

    const acceptanceLog = runMovementAcceptanceDiagnostics();
    logMovementAcceptance(acceptanceLog);

    this.running = true;
    this.lastFrameTime = performance.now();
    requestAnimationFrame(this.loop);
  }

  /** cone radius of the held gun for the crosshair, radians, refreshed every frame */
  public getCrosshairSpreadRadians(): number {
    return this.crosshairSpreadRad;
  }

  public dispose(): void {
    this.running = false;
    if (this.deathPresentationTimer !== null) {
      clearTimeout(this.deathPresentationTimer);
      this.deathPresentationTimer = null;
    }
    this.multiplayer.disconnect();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onGlobalKeyDown);
    document.removeEventListener('pointerlockerror', this.onPointerLockError);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.input.dispose();
    this.renderer.dispose();
    this.combatEffects?.dispose();
    this.combatHud?.dispose();
    this.scopeOverlay?.dispose();
    this.gunAudio.dispose();
    this.knifeAudio.dispose();
    this.remoteKnifeAudio.dispose();
    this.viewmodelRenderer.clearPresentationTransient();
    this.menu?.dispose();
    this.gameHud.dispose();
    this.audio.dispose();
  }

  private readonly loop = (time: number): void => {
    if (!this.running) {
      return;
    }
    const perf = this.framePerf;
    const loopStart = perf ? performance.now() : 0;
    if (perf) {
      perf.frame(time);
      this.renderer.info.reset();
    }

    const rawFrameMs = time - this.lastFrameTime;
    const frameDt = Math.min(0.1, rawFrameMs / 1000);
    if (this.playing && this.settings.adaptiveResolution && !this.shot?.pixelRatio
      && this.adaptiveResolution.sample(rawFrameMs)) {
      this.applyRenderScale();
    }
    this.lastFrameTime = time;
    this.accumulator += frameDt;

    const look = this.input.consumeLookDelta();
    this.movement.applyLookDelta(
      look.x,
      look.y,
      this.settings.mouseSensitivity * this.getScopeSensitivityScale(),
    );

    const actions = this.input.consumeActions();
    this.fixedInputActions.enqueue(actions);
    if (!this.playing) {
      this.fixedInputActions.clear();
    }
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

    if (this.playing && this.combatEnabled) {
      const selectedWeapon = selectWeaponFromInput(
        this.weapon.getActive(),
        actions.weaponSlotPressed,
        actions.weaponCycleDirection,
      );
      if (selectedWeapon !== this.weapon.getActive()) {
        this.equipCombatWeapon(selectedWeapon);
      }
      if (actions.resetPressed && this.localAlive) {
        this.reloadCombatWeapon(time);
      }
    }

    let inspectQueued = false;
    let resetQueued = false;
    let attackQueued = false;
    let attackAltQueued = false;
    if (this.accumulator >= FIXED_TICK_DT) {
      ({
        inspectPressed: inspectQueued,
        resetPressed: resetQueued,
        attackPressed: attackQueued,
        attackAltPressed: attackAltQueued,
      } = this.fixedInputActions.consume());
    }

    while (this.accumulator >= FIXED_TICK_DT) {
      this.accumulator -= FIXED_TICK_DT;
      if (this.playing) {
        // R resets to spawn only in non-combat (surf practice). In combat R is
        // the reload key (handled in updateCombat), so it must not teleport you.
        if (resetQueued && this.loadedMap && !this.combatEnabled) {
          this.resetToSpawn('Reset to spawn', true);
          resetQueued = false;
          inspectQueued = false;
          attackQueued = false;
          attackAltQueued = false;
          this.input.sampleMoveInput();
          continue;
        }
        const dead = this.combatEnabled && !this.localAlive;
        if (inspectQueued) {
          if (!dead && this.canInspectActiveWeapon(time)) {
            this.viewmodel.inspect();
          }
          inspectQueued = false;
        }
        if (attackQueued) {
          if (!dead) {
            this.viewmodel.cancelInspect();
            const activeWeapon = this.weapon.getActive();
            if (this.combatEnabled && activeWeapon !== 'knife') {
              this.fireCombatWeapon(time);
            } else if (this.combatEnabled) {
              this.attackCombatKnife('primary', time);
            } else {
              this.viewmodel.knifeAttack('primary');
              this.multiplayer.sendAttack('primary');
            }
          }
          attackQueued = false;
        }
        if (attackAltQueued) {
          if (!dead) {
            const activeWeapon = this.weapon.getActive();
            if (!this.combatEnabled) {
              this.viewmodel.cancelInspect();
              this.viewmodel.knifeAttack('secondary');
              this.multiplayer.sendAttack('secondary');
            } else if (activeWeapon === 'knife') {
              this.viewmodel.cancelInspect();
              this.attackCombatKnife('secondary', time);
            } else if (activeWeapon === 'awp') {
              this.combatAim.toggleScope(time, {
                reloading: this.weapon.isReloading(time),
                alive: this.localAlive,
              });
            }
            // deagle right click does nothing
          }
          attackAltQueued = false;
        }

        // Always drain the sampled input (to clear edge-triggered jump/keys),
        // but freeze movement while dead so a killed player can't keep running
        // around as a "ghost" until they respawn.
        const sampledMove = this.input.sampleMoveInput();
        const moveInput = dead ? this.deadMoveInput : this.qaMove ? { ...sampledMove, ...this.qaMove } : sampledMove;
        this.movement.tick(FIXED_TICK_DT, moveInput, this.collisionWorld);
        this.updateMapTriggers();
        if (this.combatEnabled) {
          this.tickCombatAim(FIXED_TICK_DT);
        }
        // the tick ends where the leftover accumulator begins
        this.sendMultiplayerState(Date.now() - this.accumulator * 1000);
        this.tryCompleteRun();
        if (this.loadedMap && this.movement.getFeetPosition().y < this.voidResetY) {
          const now = performance.now();
          const showMessage = now - this.lastVoidResetAtMs > 900;
          if (this.mapTriggers?.hasTriggers()) {
            // trigger maps keep the run going from the last checkpoint
            this.teleportTo(this.mapTriggers.getRespawn());
            if (showMessage) {
              this.showStatus('Back to checkpoint');
            }
          } else {
            this.resetToSpawn(showMessage ? 'Out of world reset' : null, true);
          }
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
    const cameraPosition = this.movement.getCameraPosition();
    this.viewmodel.setBackstabReady(
      this.playing
      && this.combatEnabled
      && this.localAlive
      && this.weapon.getActive() === 'knife'
      && findBackstabOpportunity({
        attackerFeet: this.movement.getFeetPosition(),
        attackerForward: this.movement.getForwardVector(),
        targets: this.backstabTargets,
        hasLineOfSight: (target) => !this.collisionWorld.segmentIntersectsGeometry(
          cameraPosition,
          new Vector3(
            target.position[0],
            target.position[1] + 1.2,
            target.position[2],
          ),
        ),
      }) !== null,
    );
    const startedKnifeAttack = this.viewmodel.consumeStartedAttack();
    if (startedKnifeAttack) {
      this.knifeAudio.play(startedKnifeAttack);
      this.playKnifeWallHit(startedKnifeAttack);
    }
    // sway, bob, landing dip and recoil kick from ViewmodelRenderer on top of the clips
    this.viewmodel.root.position.copy(this.viewmodelRenderer.motionPos);
    this.viewmodel.root.rotation.copy(this.viewmodelRenderer.motionRot);
    this.viewmodel.update(frameDt);
    this.remotePlayers.update(frameDt);
    if (this.combatEnabled) {
      this.updateCombat(time);
    }
    const debug = this.movement.getDebugState();
    this.hud.update(debug);
    this.updateUiFrame(frameDt, time, debug);
    this.updateTimerHud();
    this.updateSurfNormalLine(debug);
    this.updateStatusVisibility(time);

    this.mapEnvironment.update(frameDt, this.worldCamera);
    this.renderer.clear();
    this.renderer.render(this.worldScene, this.worldCamera);
    if (this.playing && this.debugCameraMode === 'firstPerson') {
      this.renderer.clearDepth();
      this.renderer.render(this.viewmodelRenderer.scene, this.viewmodelRenderer.camera);
    }
    if (perf) {
      perf.cpu(performance.now() - loopStart, this.renderer.info.render.calls, this.renderer.info.render.triangles);
    }

    requestAnimationFrame(this.loop);
  };

  private persistSelectedMapId(mapId: string): void {
    if (!this.mapSources.has(mapId)) {
      return;
    }
    if (!saveSelectedMapId(mapId)) {
      // eslint-disable-next-line no-console
      console.warn(`[Maps] Could not persist selected map "${mapId}"; continuing without storage.`);
    }
  }

  private async startPlaySession(mapId: string): Promise<void> {
    if (!this.menu) {
      return;
    }
    // every mode has sound now; unlock inside the Play gesture
    this.audio.unlock();
    if (this.combatEnabled) {
      // Begin Web Audio while the Play gesture is still active, before any map
      // or model await can consume browser user activation.
      void this.prepareCombatAudio(false);
    }
    // The remote player models were loaded in the background during init; make
    // sure they're ready before we drop into a map so other players render.
    await this.remotePlayersReady;
    const source = this.mapSources.get(mapId);
    if (!source) {
      this.showLoadingError(new Error(`Unknown map id: ${mapId}`), mapId);
      return;
    }
    this.selectedMapId = mapId;
    this.persistSelectedMapId(mapId);
    if (await this.tryResumeLoadedMap(mapId, 'Could not lock cursor. Press Esc or click Play to resume.')) {
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
    this.multiplayer.setCombatReady(false);
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
      if (this.combatEnabled) {
        this.resetLocalCombatState();
      }
      this.debugCameraMode = 'firstPerson';
      this.freecamInitialized = false;
      this.hideLoadingOverlay();
      this.hideRunSubmitOverlay();
      this.startRunTimer();
      const lockAcquired = this.shot ? true : await this.input.requestPointerLock();
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
      this.multiplayer.setCombatReady(true);
      this.syncMultiplayerIdentity();
      if (!this.didPlayInitialEquip) {
        this.viewmodel.equip(this.combatEnabled ? this.weapon.getActive() : 'knife');
        this.didPlayInitialEquip = true;
      }
      if (this.combatEnabled) {
        this.updateWeaponViewmodel(this.weapon.getActive());
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
    // sky, fog, exposure, lights and lightmaps from meta.environment (or the old defaults)
    this.mapEnvironment.apply(map);

    this.collisionWorld.setCollisionFromRoot(map.collisionRoot);
    this.combatEffects?.clearDecals();

    const bounds = new Box3().setFromObject(map.sceneRoot);
    const triCount = this.countTriangles(map.sceneRoot);
    // eslint-disable-next-line no-console
    console.log(
      `[MapLoader] ${map.entry.id} bounds min=(${bounds.min.x.toFixed(2)}, ${bounds.min.y.toFixed(2)}, ${bounds.min.z.toFixed(2)}) max=(${bounds.max.x.toFixed(2)}, ${bounds.max.y.toFixed(2)}, ${bounds.max.z.toFixed(2)}) triangles=${triCount}`,
    );

    const spawn = this.resolveSpawnInLoadedWorld(map);
    // Persist the validated spawn so void resets and authoritative respawns use
    // the same grounded position as initial entry.
    map.spawnPosition.copy(spawn.position);
    map.spawnYawDeg = spawn.yawDeg;
    const mapCvars = this.movement.applyMapCvars(map.meta.cvars);
    if (mapCvars.rejected.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(`[MapLoader] ${map.entry.id} ignored cvars: ${mapCvars.rejected.join(', ')}`);
    }
    // the player's autobhop setting wins over the map
    this.movement.setCvar('sv_autobhop_enabled', this.settings.autoBhop);
    this.movement.reset(spawn.position, spawn.yawDeg);
    // runs always start at spawns[0]; the rest are combat respawn points
    const spawnBounds = new Box3().setFromObject(map.collisionRoot);
    const extraSpawns = listMetaSpawns(map.meta).slice(1).map((s) =>
      groundResolvedSpawn(s, spawnBounds, this.collisionWorld, this.movement.capsule));
    this.spawnPoints = [{ position: spawn.position.clone(), yawDeg: spawn.yawDeg }, ...extraSpawns];
    this.mapTriggers = new MapTriggers(map.meta.triggers, {
      position: [spawn.position.x, spawn.position.y, spawn.position.z],
      yawDeg: spawn.yawDeg,
    });
    // arena maps stage bots on the far side (first spawn with another `side`)
    const botAnchor = resolveBotAnchor(map.meta);
    const hostBotSpawn = botAnchor && map.meta.spawns?.[0]?.side !== undefined
      ? groundResolvedSpawn(botAnchor, spawnBounds, this.collisionWorld, this.movement.capsule)
      : { position: spawn.position.clone(), yawDeg: spawn.yawDeg };

    // In Supabase mode the elected host runs the bot/combat sim; give it this
    // map's collision + spawn. (The WebSocket transport ignores this.)
    this.multiplayer.setRoomContext(
      this.combatEnabled
        ? {
            collisionWorld: this.collisionWorld,
            spawn: { position: hostBotSpawn.position.clone(), yawDeg: hostBotSpawn.yawDeg },
            botCount: 1,
          }
        : null,
    );

    const collisionBounds = new Box3().setFromObject(map.collisionRoot);
    if (collisionBounds.isEmpty()) {
      this.voidResetY = -1000;
      this.finishTargetY = -1000;
      this.goalPad = null;
    } else {
      const height = Math.max(1, collisionBounds.max.y - collisionBounds.min.y);
      const margin = Math.max(12, Math.min(120, height * 0.2));
      this.voidResetY = collisionBounds.min.y - margin;

      this.goalPad = this.resolveGoalPad(map);
      if (this.goalPad) {
        this.finishTargetY = this.goalPad.y;
      } else {
        const goalFromMeta = typeof map.meta.goalY === 'number' && Number.isFinite(map.meta.goalY)
          ? map.meta.goalY
          : null;
        this.finishTargetY = goalFromMeta ?? Number.NEGATIVE_INFINITY;
      }
    }
    this.combatHud?.setPracticeGuide(map.entry.id === 'movement_test_scene');
    this.updateRunInfoWithLeaderboard([]);
    this.onUiMapActivated(map);
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
      if (this.combatEnabled) {
        this.resetLocalCombatState();
      } else {
        this.resetToSpawn('Run restarted', true);
      }
      this.hideRunSubmitOverlay();
      this.debugCameraMode = 'firstPerson';
      this.freecamInitialized = false;
      const lockAcquired = await this.input.requestPointerLock();
      if (!lockAcquired) {
        this.pauseRunTimer();
        this.playing = false;
        this.multiplayer.setCombatReady(false);
        this.menu?.setVisible(true);
        this.setCrosshairVisible(false);
        this.showStatus('Could not lock cursor. Click Play to resume.');
        return;
      }
      if (this.combatEnabled) {
        this.startRunTimer();
      }
      this.menu?.setVisible(false);
      this.playing = true;
      this.multiplayer.setCombatReady(true);
      this.syncMultiplayerIdentity();
      this.setCrosshairVisible(true);
      this.showStatus('Run restarted');
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
    if (entries.length === 0) {
      this.runInfoLabel.textContent = 'No best time yet';
      return;
    }
    const best = entries[0];
    this.runInfoLabel.textContent = `Best ${formatRunTime(best.timeMs)} · ${best.name}`;
  }

  private resolveGoalPad(map: LoadedMap): GoalPad | null {
    const goal = resolveRunGoal(map.meta);
    if (!goal) {
      // Maps without an authored finish are open-ended play spaces. Guessing a
      // goal from their lowest floor can terminate combat as soon as a player
      // lands on a catch plane.
      // eslint-disable-next-line no-console
      console.log(`[GoalPad] ${map.entry.id} has no configured run finish; Play remains open-ended.`);
    }
    return goal;
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

  /**
   * Central place to accept a user-entered username: sanitize, keep the last
   * valid name if the new one is too short, persist it, sync it to multiplayer,
   * and reflect the cleaned value back into every name field.
   */
  private applyPlayerName(raw: string): void {
    const cleaned = sanitizeLeaderboardName(raw);
    const next = cleaned.length >= 2 ? cleaned : this.localPlayerName;
    this.localPlayerName = next;
    savePlayerName(next);
    this.menu?.setPlayerName(next);
    this.runSubmitInput.value = next;
    this.syncMultiplayerIdentity();
  }

  private setupCombat(): void {
    if (!this.combatEnabled) {
      return;
    }
    this.combatHud = new CombatHud(document.body);
    this.combatEffects = new CombatEffects(this.worldScene, this.viewmodel.root, {
      impactEffects: true,
      getLocalMuzzleWorldPosition: () => this.viewmodel.getMuzzleWorldPosition(this.muzzleScratch),
    });
    this.scopeOverlay = new ScopeOverlay(this.container);
    this.combatHud.setWeapon(this.weapon.getActive(), this.weapon.getAmmo());

    this.multiplayer.onHealth = ({ playerId, health, alive }) => {
      if (playerId !== this.multiplayer.getLocalId()) {
        return;
      }
      this.applyLocalHealth(health, alive);
    };
    this.multiplayer.onRespawn = ({ playerId }) => {
      if (playerId === this.multiplayer.getLocalId()) {
        this.restoreLocalAfterRespawn();
      }
    };
    this.multiplayer.onHit = ({ shooterId, hitbox, killed, weaponId, melee }) => {
      if (shooterId === this.multiplayer.getLocalId()) {
        if (weaponId === 'knife' && melee) {
          this.localKnife.onServerHit(melee);
        }
        const confirmation = planHitConfirmation(hitbox, killed);
        this.combatHud?.flashHitmarker(confirmation.visual);
        // Lethal headshots intentionally sequence ◆ then ✦ visually while
        // retaining one concise confirmation sound for the single hit event.
        this.gunAudio.confirm(confirmation.audio);
      }
    };
    this.multiplayer.onDeath = ({ killerId, victimId, weaponId, headshot }) => {
      const nameOf = (id: string) =>
        id === this.multiplayer.getLocalId()
          ? this.localPlayerName
          : this.remotePlayerNames.get(id) ?? 'Player';
      this.killFeed.add(
        {
          killer: nameOf(killerId),
          victim: nameOf(victimId),
          weaponId,
          headshot,
          killerIsLocal: killerId === this.multiplayer.getLocalId(),
          victimIsLocal: victimId === this.multiplayer.getLocalId(),
        },
        performance.now(),
      );
    };
    const presentRemoteShot = createRemoteShotHandler({
      effects: this.combatEffects,
      collisionWorld: this.collisionWorld,
      getLocalPlayerId: () => this.multiplayer.getLocalId(),
      nowMs: () => performance.now(),
    });
    this.multiplayer.onShot = (event) => {
      presentRemoteShot(event);
      const localId = this.multiplayer.getLocalId();
      if (
        localId
        && event.playerId !== localId
        && event.targetId === localId
        && (event.result === 'hit' || event.result === 'kill')
      ) {
        this.combatHud?.flashIncomingDamage(event.result === 'kill');
      }
    };
  }

  private applyLocalHealth(health: number, alive: boolean): void {
    const wasAlive = this.localAlive;
    this.localAlive = alive;
    // Authoritative health applies immediately, while the centered death
    // presentation waits for the incoming round to travel to its endpoint.
    // Repeated dead snapshots must not hide the delayed death banner after its
    // fatal-cue lead has elapsed. The transition snapshot still updates health
    // to zero immediately, and all living snapshots continue to reconcile it.
    if (wasAlive || alive) {
      this.combatHud?.setHealth(health, alive, false);
    }
    if (wasAlive && !alive) {
      this.combatAim.cancelScope(performance.now());
      this.viewmodel.setAlive(false);
      this.combatEffects?.clearForDeath(performance.now());
      this.combatHud?.clearTransient(true);
      this.viewmodelRenderer.clearPresentationTransient();
      this.viewmodel.cancelInspect();
      this.knifeAudio.stopAll();
      if (this.deathPresentationTimer !== null) {
        clearTimeout(this.deathPresentationTimer);
      }
      this.deathPresentationTimer = setTimeout(() => {
        this.deathPresentationTimer = null;
        if (!this.localAlive) {
          this.combatHud?.setDeathVisible(true);
          this.showStatus(
            'You died, respawning…',
            RESPAWN_DELAY_MS - FATAL_CUE_LEAD_MS,
          );
        }
      }, FATAL_CUE_LEAD_MS);
    } else if (!wasAlive && alive) {
      this.restoreLocalAfterRespawn();
      this.combatHud?.setHealth(health, true);
    }
  }

  private resetLocalCombatState(): void {
    this.localAlive = true;
    if (this.deathPresentationTimer !== null) {
      clearTimeout(this.deathPresentationTimer);
      this.deathPresentationTimer = null;
    }
    this.viewmodel.setAlive(true);
    this.combatEffects?.clear();
    this.combatHud?.clearTransient();
    this.viewmodelRenderer.clearPresentationTransient();
    this.viewmodel.cancelInspect();
    this.knifeAudio.stopAll();
    this.crosshair.classList.remove('shot-deagle', 'shot-awp');
    this.weapon.reset();
    this.combatAim.reset();
    this.combatAim.setWeapon(this.weapon.getActive(), performance.now());
    this.localKnife.reset();
    this.updateWeaponViewmodel(this.weapon.getActive());
    this.combatHud?.setWeapon(this.weapon.getActive(), this.weapon.getAmmo());
    this.combatHud?.setHealth(100, true);
    this.respawnLocalPlayer();
  }

  private restoreLocalAfterRespawn(): void {
    this.resetLocalCombatState();
    this.showStatus('Respawned', 1200);
    this.audio.play('respawn');
  }

  private pulseCrosshair(weaponId: GunId): void {
    this.crosshair.classList.remove('shot-deagle', 'shot-awp');
    void this.crosshair.offsetWidth;
    this.crosshair.classList.add(`shot-${weaponId}`);
  }

  private fireCombatWeapon(nowMs: number): void {
    if (!this.combatEnabled || !this.localAlive) {
      return;
    }
    if (!this.combatEffects) {
      throw new Error('[Combat] local firearm effects were not initialized');
    }
    const origin = this.movement.getCameraPosition();
    // view angles + aim punch + a cs spread sample; the camera's own punch is visual only
    const forward = this.combatAim.shotDirection(this.movement.getYawRad(), this.movement.getPitchRad());
    const result = fireLocalWeapon(
      {
        weapon: this.weapon,
        effects: this.combatEffects,
        collisionWorld: this.collisionWorld,
        playerOcclusion: (from, direction, maxDistance) =>
          resolveHit(from, direction, maxDistance, this.getDrawnPlayerCapsules())?.distance ?? null,
        onPresented: (weaponId) => {
          this.viewmodel.fire();
          this.viewmodelRenderer.addFireKick(weaponId);
          this.gunAudio.shot(weaponId);
          this.pulseCrosshair(weaponId);
        },
      },
      {
        origin,
        direction: forward,
        cameraUp: new Vector3(0, 1, 0).applyQuaternion(this.worldCamera.quaternion),
        nowMs,
      },
    );
    this.combatHud?.setWeapon(this.weapon.getActive(), this.weapon.getAmmo());
    if (!result.fired) {
      this.maybeDryFire(result.weapon.id, result.ammoRemaining, nowMs);
      return;
    }
    this.multiplayer.sendFire(
      [origin.x, origin.y, origin.z],
      [forward.x, forward.y, forward.z],
      this.remotePlayers.getFireView(),
    );
    this.combatAim.onShotFired(nowMs);
    if (result.magazineEmptied) {
      this.reloadCombatWeapon(nowMs);
    }
  }

  /**
   * Knife input: gated locally with the same cs cooldowns the authority uses
   * (hit or miss predicted against the drawn remotes), then the swing visual,
   * the 'attack' broadcast for remote swing visuals and the melee fire.
   */
  private attackCombatKnife(kind: AttackKind, nowMs: number): void {
    if (!this.localAlive) {
      return;
    }
    const origin = this.movement.getCameraPosition();
    const direction = this.movement.getForwardVector();
    const swing = this.localKnife.tryAttack(kind, nowMs, {
      origin,
      direction,
      targets: this.getDrawnPlayerCapsules(),
      isBlocked: (from, to) => this.collisionWorld.segmentIntersectsGeometry(from, to),
    });
    if (!swing.accepted) {
      return;
    }
    if (kind === 'primary') {
      this.viewmodel.knifeAttack('primary');
    } else {
      this.viewmodel.knifeAttack('secondary');
    }
    this.multiplayer.sendAttack(kind);
    this.multiplayer.sendFire(
      [origin.x, origin.y, origin.z],
      [direction.x, direction.y, direction.z],
      this.remotePlayers.getFireView(),
      kind,
    );
  }

  /** living remotes where they are drawn, as hit capsules (knife prediction, local tracer stops) */
  private getDrawnPlayerCapsules(): MeleeTarget[] {
    const alive = new Map(this.backstabTargets.map((target) => [target.id, target.alive]));
    return this.remotePlayers.getDisplayedPlayers()
      .filter((player) => alive.get(player.id) !== false)
      .map((player) => ({
        id: player.id,
        feet: player.position,
        height: PLAYER_CAPSULE_HEIGHT,
        radius: PLAYER_CAPSULE_RADIUS,
      }));
  }

  private tickCombatAim(dt: number): void {
    const cvars = this.movement.getCvars();
    this.combatAim.tick(dt, {
      velocity: this.movement.getVelocity(),
      grounded: this.movement.getDebugState().grounded,
      maxSpeed: cvars.sv_maxspeed,
      jumpImpulse: cvars.sv_jump_impulse,
    });
  }

  /** per frame: re-scope timer, zoomed fov, overlay, viewmodel and crosshair hooks */
  private updateCombatAimPresentation(nowMs: number): void {
    this.combatAim.update(nowMs, {
      reloading: this.weapon.isReloading(nowMs),
      alive: this.localAlive,
    });
    const scoped = this.combatAim.isScoped();
    const fov = this.combatAim.getFovDeg(this.settings.worldFov, nowMs);
    if (Math.abs(this.worldCamera.fov - fov) > 1e-4) {
      this.worldCamera.fov = fov;
      this.worldCamera.updateProjectionMatrix();
    }
    this.scopeOverlay?.setZoomLevel(this.combatAim.getZoomLevel());
    this.scopeOverlay?.setVisible(this.playing && scoped && this.debugCameraMode === 'firstPerson');
    if (scoped !== this.viewmodelHiddenForScope) {
      this.setViewmodelHiddenForScope(scoped);
    }
    this.crosshairSpreadRad = this.combatAim.getInaccuracyRadians();
    // once it exists; the value is spread + inaccuracy of the held gun, 0 for the knife
  }

  /**
   * Hides the first-person weapon while scoped (cs hides the AWP viewmodel
   * zoomed). The one place that decides it, so a new viewmodel can re-point it.
   */
  private setViewmodelHiddenForScope(hidden: boolean): void {
    this.viewmodelHiddenForScope = hidden;
    this.viewmodel.setHidden(hidden);
  }

  /** zoom sensitivity: fov ratio x zoom ratio (settings.zoomSensitivityRatio if present) */
  private getScopeSensitivityScale(): number {
    if (!this.combatEnabled) {
      return 1;
    }
    const configured = (this.settings as Partial<{ zoomSensitivityRatio: number }>).zoomSensitivityRatio;
    const ratio = typeof configured === 'number' && Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_ZOOM_SENSITIVITY_RATIO;
    return this.combatAim.getSensitivityScale(this.settings.worldFov, ratio);
  }

  private equipCombatWeapon(id: WeaponId): void {
    if (!this.combatEnabled) {
      return;
    }
    this.weapon.equip(id);
    this.combatAim.setWeapon(id, performance.now());
    this.multiplayer.sendEquip(id);
    this.audio.play('weaponDraw');
    this.combatEffects?.clear();
    this.combatHud?.clearTransient();
    this.crosshair.classList.remove('shot-deagle', 'shot-awp');
    this.combatHud?.setWeapon(id, this.weapon.getAmmo());
    this.updateWeaponViewmodel(id);
  }

  /**
   * Atomically transfers first-person visibility ownership between the authored
   * knife presentation and exactly one production firearm presentation.
   */
  private updateWeaponViewmodel(id: WeaponId): void {
    this.gunAudio.stopReload();
    const gun: GunId | null = id === 'deagle' || id === 'awp' ? id : null;
    this.viewmodelRenderer.setFirearm(gun);
    this.viewmodel.equip(id);
    if (id !== 'knife') {
      this.knifeAudio.stopAll();
    }
  }

  private reloadCombatWeapon(nowMs: number): void {
    const active = this.weapon.getActive();
    if (!this.weapon.reload(nowMs)) {
      return;
    }
    this.combatAim.cancelScope(nowMs);
    this.multiplayer.sendReload();
    if (active === 'deagle' || active === 'awp') {
      this.viewmodel.reload(getWeapon(active).reloadMs);
      this.gunAudio.reload(active);
    }
  }

  private canInspectActiveWeapon(nowMs: number): boolean {
    const active = this.weapon.getActive();
    if (active === 'knife') {
      return this.viewmodel.canInspect();
    }
    return !this.weapon.isReloading(nowMs)
      && this.viewmodel.getActiveItem() === active
      && this.viewmodel.canInspect();
  }

  private async prepareCombatAudio(announce: boolean): Promise<void> {
    const status = await this.gunAudio.resume();
    const changed = status !== this.combatAudioStatus;
    this.combatAudioStatus = status;
    this.combatHud?.setAudioStatus(status);

    if (changed) {
      if (status === 'running') {
        console.info('[GunAudio] Audio context ready (running).');
      } else if (status === 'suspended') {
        console.info('[GunAudio] Audio context is suspended pending a browser gesture.');
      }
    }
    if (!announce && !changed) {
      return;
    }

    const message = status === 'running'
      ? 'Combat audio ready · Deagle/AWP fire + reload active'
      : status === 'suspended'
        ? 'Combat audio waiting for a browser gesture'
        : status === 'unavailable'
          ? 'Combat audio unavailable · visual feedback remains active'
          : 'Combat audio failed to start · see console for details';
    this.showStatus(message, status === 'running' ? 3200 : 5000);
  }

  private updateCombat(nowMs: number): void {
    this.weapon.update(nowMs);
    this.updateCombatAimPresentation(nowMs);
    this.combatHud?.setWeapon(
      this.weapon.getActive(),
      this.weapon.getAmmo(),
      this.weapon.isReloading(nowMs),
    );
    this.combatEffects?.update(nowMs);
    this.combatHud?.update(nowMs);
    this.killFeed.prune(nowMs);
    this.combatHud?.setVisible(this.playing);
    if (!this.playing) {
      return;
    }
    this.combatHud?.renderKillFeed(this.killFeed, nowMs);
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

  private sendMultiplayerState(tickWallMs: number): void {
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
      t: tickWallMs,
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
      this.timerLabel.textContent = '';
      return;
    }

    const elapsedMs = this.getCurrentRunTimeMs();
    this.timerLabel.textContent = formatRunTime(elapsedMs);
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

    this.completeRun();
  }

  /** stops the timer and opens the leaderboard prompt, shared by goal pads and finish triggers */
  private completeRun(): void {
    if (!this.playing || this.runComplete || !this.loadedMap) {
      return;
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
    const bounds = new Box3().setFromObject(map.collisionRoot);
    return groundResolvedSpawn(
      {
        position: map.spawnPosition,
        yawDeg: map.spawnYawDeg,
      },
      bounds,
      this.collisionWorld,
      this.movement.capsule,
    );
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
    this.viewmodel.setScale(next.viewmodelScale);
    if (!next.adaptiveResolution) {
      this.adaptiveResolution.reset();
    }
    this.applyRenderScale();
    this.applyUiSettings(next);
  }

  private async applyLoadout(selection: LoadoutSelection): Promise<void> {
    this.activeKnifeSoundProfile = this.getKnifeSoundProfileFromLoadout(selection);
    this.knifeAudio.setProfile(this.activeKnifeSoundProfile);
    this.syncViewmodelMotionStyle();
  }

  private syncViewmodelMotionStyle(): void {
    this.viewmodelRenderer.setIntegratedMode(false);
    this.viewmodelRenderer.setMotionScale(1);
  }

  private updateCameras(dt: number, look: { x: number; y: number }): void {
    const cameraPos = this.movement.getCameraPosition();

    if (this.debugCameraMode === 'firstPerson') {
      this.freecamInitialized = false;
      this.worldCamera.position.copy(cameraPos);
      // cs style view punch: a camera offset on top of the real view angles
      const punch = this.combatEnabled ? this.combatAim.getViewPunch() : { pitch: 0, yaw: 0 };
      this.worldCamera.rotation.set(
        this.movement.getPitchRad() + punch.pitch,
        this.movement.getYawRad() + punch.yaw,
        0,
        'YXZ',
      );
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

    this.viewmodelRenderer.update(dt, this.worldCamera, this.movement.getVelocity(), look);
    this.setCrosshairVisible(
      this.playing && this.debugCameraMode === 'firstPerson' && !this.combatAim.isScoped(),
    );
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

  /**
   * teleports the local player to a spawn after a combat death. maps with several
   * spawns pick one away from living enemies, others use the map spawn.
   */
  private respawnLocalPlayer(): void {
    if (!this.loadedMap) {
      return;
    }
    const pick = this.spawnPoints.length > 1
      ? pickSpawnAwayFrom(this.spawnPoints, this.backstabTargets)
      : null;
    if (pick) {
      this.movement.reset(pick.position, pick.yawDeg);
    } else {
      this.movement.reset(this.loadedMap.spawnPosition, this.loadedMap.spawnYawDeg);
    }
    this.mapTriggers?.reset();
    this.resetMovementFeedback();
  }

  /**
   * feeds the feet position to the map's trigger volumes after each movement
   * tick. the start zone holds the timer at zero, checkpoints store the respawn,
   * teleports move the player (velocity zeroed) and the finish ends the run.
   */
  private updateMapTriggers(): void {
    if (!this.loadedMap || !this.mapTriggers?.hasTriggers()) {
      return;
    }
    const update = this.mapTriggers.update(this.movement.getFeetPosition());
    if (update.inStartZone && !this.runComplete) {
      this.startRunTimer();
    }
    for (const event of update.events) {
      if (event.type === 'checkpoint') {
        if (event.changed) {
          this.showStatus(`Checkpoint ${event.stage}`, 1200);
        }
      } else if (event.type === 'teleport') {
        this.teleportTo(event.respawn);
      } else if (event.type === 'finish') {
        this.completeRun();
      }
    }
  }

  private teleportTo(target: { position: [number, number, number]; yawDeg: number }): void {
    this.movement.reset(new Vector3(target.position[0], target.position[1], target.position[2]), target.yawDeg);
  }

  private resetToSpawn(message: string | null, restartTimer = false): void {
    if (!this.loadedMap) {
      return;
    }
    this.movement.reset(this.loadedMap.spawnPosition, this.loadedMap.spawnYawDeg);
    this.mapTriggers?.reset();
    this.resetMovementFeedback();
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
    // the settings driven crosshair keeps the .crosshair root and kick classes
    return this.gameHud.crosshair.root;
  }

  private createStatusLabel(): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'status-label';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.style.display = 'none';
    this.container.appendChild(el);
    return el;
  }

  /** Fades out and removes the instant boot loader painted from index.html. */
  private dismissBootLoader(): void {
    const boot = document.getElementById('boot-loader');
    if (!boot) {
      return;
    }
    boot.classList.add('is-hiding');
    window.setTimeout(() => boot.remove(), 360);
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
    timer.style.display = 'none';

    const info = document.createElement('div');
    info.className = 'run-info';
    info.style.display = 'none';

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
      this.fixedInputActions.clear();
      if (this.playing && !this.runComplete && this.finishedRunTimeMs === null) {
        this.pauseRunTimer();
      }
      this.playing = false;
      this.multiplayer.setCombatReady(false);
      this.combatAim.cancelScope(performance.now());
      this.viewmodelRenderer.clearPresentationTransient();
      this.viewmodel.cancelInspect();
      this.knifeAudio.stopAll();
      this.menu?.setVisible(true);
      this.setCrosshairVisible(false);
      return;
    }
    if (this.loadedMap !== null && !this.runComplete && this.finishedRunTimeMs === null) {
      this.resumeRunTimer();
    }
    this.playing = this.loadedMap !== null && !this.runComplete;
    this.multiplayer.setCombatReady(this.playing);
    void this.prepareCombatAudio(true);
    if (this.combatEnabled && this.localAlive && this.weapon.getActive() === 'knife') {
      this.viewmodel.equip('knife');
    }
    this.menu?.setVisible(false);
    this.setCrosshairVisible(this.playing && this.debugCameraMode === 'firstPerson');
  };

  private readonly onPointerLockError = (): void => {
    if (!this.loadedMap || this.input.isPointerLocked()) {
      return;
    }
    this.playing = false;
    this.menu?.setVisible(true);
    this.setCrosshairVisible(false);
    this.showStatus('Cursor lock was blocked. Press Esc again or click Play.');
  };

  private readonly onGlobalKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== 'Escape') {
      return;
    }
    if (this.input.isPointerLocked()) {
      // Do not rely on the browser's implicit Escape default: automated native
      // input and some kiosk shells suppress it. Explicitly release the same
      // pointer lock a normal player entered, then pointerlockchange opens menu.
      event.preventDefault();
      document.exitPointerLock();
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
    this.debugCameraMode = 'firstPerson';
    this.freecamInitialized = false;
    if (this.combatEnabled) {
      this.resetLocalCombatState();
    }
    const lockAcquired = await this.input.requestPointerLock();
    if (!lockAcquired) {
      this.playing = false;
      this.multiplayer.setCombatReady(false);
      this.menu?.setVisible(true);
      this.setCrosshairVisible(false);
      this.showStatus(lockFailureMessage);
      return true;
    }

    if (this.combatEnabled) {
      this.startRunTimer();
    } else {
      this.resumeRunTimer();
    }
    this.menu?.setVisible(false);
    this.playing = true;
    this.multiplayer.setCombatReady(true);
    this.syncMultiplayerIdentity();
    if (this.combatEnabled) {
      this.updateWeaponViewmodel(this.weapon.getActive());
    }
    this.setCrosshairVisible(true);
    if (showResumedStatus) {
      this.showStatus(this.combatEnabled ? 'Combat restarted' : 'Resumed');
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

  // --- v2 ui + audio wiring ------------------------------------------------

  /** everything the hud, crosshair and sound engine take from settings */
  private applyUiSettings(settings: GameSettings): void {
    this.hud.setVisible(settings.showMovementDebug);
    this.gameHud.applySettings(settings);
    this.gameHud.setVerticalFov(settings.worldFov);
    this.combatHud?.setHudEnabled(settings.showHud);
    this.audio.setVolumes({
      master: settings.masterVolume,
      effects: settings.effectsVolume,
      ui: settings.uiVolume,
    });
  }

  private toggleMovementDebug(): void {
    const next = { ...this.settings, showMovementDebug: !this.settings.showMovementDebug };
    this.applySettings(next);
    this.menu?.updateSettings(next);
    this.showStatus(next.showMovementDebug ? 'Movement debug on (F3)' : 'Movement debug off (F3)', 1200);
  }

  /**
   * Layers hud and audio feedback on top of the transport handlers that init
   * and setupCombat installed. Call once, after setupCombat.
   */
  private wireUiEvents(): void {
    const onSnapshot = this.multiplayer.onSnapshot;
    this.multiplayer.onSnapshot = (snapshot) => {
      onSnapshot?.(snapshot);
      if (snapshot.mapId === this.selectedMapId) {
        this.gameHud.setPlayers(snapshot.players, this.multiplayer.getLocalId());
      }
    };
    const onDeath = this.multiplayer.onDeath;
    this.multiplayer.onDeath = (event) => {
      onDeath?.(event);
      this.handleDeathFeedback(event);
    };
    const onHit = this.multiplayer.onHit;
    this.multiplayer.onHit = (event) => {
      onHit?.(event);
      this.handleHitFeedback(event);
    };
    const onShot = this.multiplayer.onShot;
    this.multiplayer.onShot = (event) => {
      onShot?.(event);
      this.handleShotFeedback(event);
    };
    this.syncHudKnifeName();
  }

  private updateUiFrame(frameDt: number, nowMs: number, debug: MovementDebugState): void {
    const live = this.playing && (!this.combatEnabled || this.localAlive);
    let jumped = false;
    if (live) {
      const events = this.movementAudio.update(
        { grounded: debug.grounded, surfing: debug.surfing, velocity: debug.velocity, position: debug.feetPosition },
        frameDt,
      );
      for (const event of events) {
        if (event.kind === 'footstep') {
          this.audio.play('footstep', { intensity: event.intensity, variant: event.foot });
        } else if (event.kind === 'jump') {
          jumped = true;
          this.audio.play('jump');
        } else {
          this.audio.play('land', { intensity: event.intensity, volume: event.withJump ? 0.7 : 1 });
        }
      }
    } else {
      this.movementAudio.reset();
    }

    this.gameHud.setPlaying(this.playing);
    this.gameHud.setSpread(this.crosshairSpreadRad);
    this.gameHud.update({
      nowMs,
      frameMs: frameDt * 1000,
      speed: debug.speed,
      grounded: debug.grounded,
      jumped,
      strafeStats: this.readStrafeStats(),
      pingMs: this.multiplayer.getPingMs?.() ?? null,
    });
    const showTimer = this.playing && this.runTimerAllowed && this.settings.showHud;
    this.timerLabel.style.display = showTimer ? 'block' : 'none';
    this.runInfoLabel.style.display = showTimer ? 'block' : 'none';

    this.worldCamera.getWorldDirection(this.listenerForward);
    this.listenerUp.set(0, 1, 0).applyQuaternion(this.worldCamera.quaternion);
    this.audio.setListener(this.worldCamera.position, this.listenerForward, this.listenerUp);
  }

  /** movement.getStrafeStats() once the movement side ships it */
  private readStrafeStats(): unknown {
    const source = this.movement as unknown as { getStrafeStats?: () => unknown };
    return typeof source.getStrafeStats === 'function' ? source.getStrafeStats() : null;
  }

  private onUiMapActivated(map: LoadedMap): void {
    const hasFinish = this.goalPad !== null || Number.isFinite(this.finishTargetY);
    this.runTimerAllowed = showsRunTimer(map.entry.id, hasFinish);
    this.gameHud.setMap(map.entry.id, map.entry.name);
    this.gameHud.resetScores();
    this.resetMovementFeedback();
  }

  /** after teleports: no landing thud, no stale jump chain */
  private resetMovementFeedback(): void {
    this.movementAudio.reset();
    this.gameHud.resetMovement();
  }

  /** test hooks for the multiplayer smoke test, only with ?shot=...&qa=1 */
  private installQaHooks(): void {
    const qa = {
      state: () => ({
        localId: this.multiplayer.getLocalId(),
        hosting: this.multiplayer.isHosting?.() ?? null,
        alive: this.localAlive,
        weapon: this.weapon.getActive(),
        ammo: this.weapon.getAmmo(),
        feet: this.movement.getFeetPosition().toArray(),
        players: this.remotePlayers.getDisplayedPlayers().map((p) => ({ id: p.id, pos: p.position.toArray() })),
      }),
      equip: (id: WeaponId) => this.equipCombatWeapon(id),
      teleport: (x: number, y: number, z: number, yawDeg: number) => this.movement.reset(new Vector3(x, y, z), yawDeg),
      move: (forwardMove: number, sideMove: number, jump = false) => {
        this.qaMove = forwardMove === 0 && sideMove === 0 && !jump ? null : { forwardMove, sideMove, jumpHeld: jump, jumpPressed: jump };
      },
      aimAt: (id: string) => {
        const target = this.remotePlayers.getDisplayedPlayers().find((p) => p.id === id);
        if (!target) return false;
        const eye = this.movement.getCameraPosition();
        const d = target.position.clone().add(new Vector3(0, 1.3, 0)).sub(eye);
        const yaw = Math.atan2(-d.x, -d.z);
        const pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
        this.movement.setView(yaw, pitch);
        return true;
      },
      fire: () => {
        const now = performance.now();
        if (this.weapon.getActive() === 'knife') this.attackCombatKnife('primary', now);
        else this.fireCombatWeapon(now);
      },
      stab: () => this.attackCombatKnife('secondary', performance.now()),
      scope: () => this.combatAim.toggleScope(performance.now(), { reloading: this.weapon.isReloading(performance.now()), alive: this.localAlive }),
      scoped: () => this.combatAim.isScoped(),
      canSee: (id: string) => {
        const target = this.remotePlayers.getDisplayedPlayers().find((p) => p.id === id);
        if (!target) return false;
        const eye = this.movement.getCameraPosition();
        return !this.collisionWorld.segmentIntersectsGeometry(eye, target.position.clone().add(new Vector3(0, 1.3, 0)));
      },
      scoreboardText: () => document.querySelector('.hud-scoreboard')?.textContent ?? null,
      killfeedLines: () => Array.from(document.querySelectorAll('.combat-killfeed-line')).map((el) => el.textContent ?? ''),
    };
    (window as unknown as { __qa?: unknown }).__qa = qa;
  }

  /** screen pixel ratio x the resolution scale setting x the adaptive scale */
  private applyRenderScale(): void {
    const adaptive = this.settings.adaptiveResolution ? this.adaptiveResolution.getScale() : 1;
    const screen = this.shot?.dpr ?? Math.min(window.devicePixelRatio || 1, 2);
    const ratio = this.shot?.pixelRatio ?? Math.round(screen * this.settings.renderScale * adaptive * 100) / 100;
    if (Math.abs(ratio - this.renderer.getPixelRatio()) < 1e-3) {
      return;
    }
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private async runShot(shot: ShotRequest): Promise<void> {
    if (shot.time) this.viewmodel.setClockOverride(shot.time);
    if (shot.knife) this.viewmodel.setKnife(shot.knife as KnifeId);
    await this.viewmodel.load();
    await this.startPlaySession(shot.mapId);
    if (shot.weapon && this.combatEnabled) {
      this.equipCombatWeapon(shot.weapon);
    } else if (shot.weapon) {
      this.viewmodel.equip(shot.weapon);
    }
    if (shot.position || shot.yawDeg !== null) {
      const pos = shot.position
        ? new Vector3(...shot.position)
        : this.movement.getFeetPosition().clone();
      this.movement.reset(pos, shot.yawDeg ?? 0);
    }
    if (shot.yawDeg !== null || shot.pitchDeg !== null) {
      this.movement.setView(
        ((shot.yawDeg ?? 0) * Math.PI) / 180,
        ((shot.pitchDeg ?? 0) * Math.PI) / 180,
      );
    }
    if (!shot.hud) {
      this.container.classList.add('shot-no-hud');
    }
    if (shot.pixelRatio) {
      this.applyRenderScale();
    }
    if (shot.scope > 0 && this.combatEnabled) {
      for (let i = 0; i < shot.scope; i += 1) {
        this.combatAim.toggleScope(performance.now() + i * 100, { reloading: false, alive: true });
      }
    }
    this.viewmodel.seek(shot.clip as ViewAction, shot.t);
    if (shot.qa) {
      this.installQaHooks();
      this.viewmodel.setPaused(false);
      (window as unknown as { __shotReady?: boolean }).__shotReady = true;
      return;
    }
    if (shot.perfSeconds > 0) {
      this.renderer.info.autoReset = false;
      this.viewmodel.setLoopAction(shot.clip !== 'idle');
      const perf = new FramePerf(shot.perfSeconds * 1000);
      this.framePerf = perf;
      while (!perf.done) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      this.framePerf = null;
      this.renderer.info.autoReset = true;
      const size = this.renderer.getDrawingBufferSize(new Vector2());
      (window as unknown as { __perfResult?: unknown }).__perfResult = perf.result(this.renderer.getPixelRatio(), [size.x, size.y]);
    } else {
      this.viewmodel.setPaused(true);
    }
    // let the map, lightmaps and a few frames settle before the capture
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const info = this.renderer.info.render;
    (window as unknown as { __shotInfo?: unknown }).__shotInfo = { calls: info.calls, triangles: info.triangles };
    (window as unknown as { __shotReady?: boolean }).__shotReady = true;
  }

  /** sounds for viewmodel clip events GunAudio doesn't already schedule */
  private playViewmodelEvent(name: string): void {
    switch (name) {
      case 'sound:slide':
        this.audio.play('deagleSlideRelease');
        break;
      case 'sound:bolt_back':
        this.audio.play('awpBoltUp');
        this.audio.play('awpBoltBack', { volume: 0.9 });
        break;
      case 'sound:bolt_forward':
        this.audio.play('awpBoltForward');
        this.audio.play('awpBoltDown', { volume: 0.8 });
        break;
      case 'sound:knife_open':
      case 'sound:knife_draw':
        this.audio.play('weaponDraw', { volume: 0.7 });
        break;
      case 'sound:knife_spin':
      case 'sound:knife_toss':
        this.audio.play('knifeSwing', { volume: 0.35 });
        break;
      case 'sound:knife_catch':
        this.audio.play('weaponDraw', { volume: 0.5 });
        break;
      default:
        break;
    }
  }

  private syncHudKnifeName(): void {
    this.combatHud?.setKnifeName(getKnife(this.viewmodel.getKnife()).name);
  }

  private handleDeathFeedback(event: DeathEvent): void {
    this.gameHud.recordDeath(event);
    const localId = this.multiplayer.getLocalId();
    if (!localId || event.victimId !== localId) {
      return;
    }
    const bySelf = event.killerId === localId || !event.killerId;
    this.combatHud?.setDeathInfo(
      {
        killerName: this.remotePlayerNames.get(event.killerId) ?? 'Player',
        weaponId: event.weaponId,
        headshot: event.headshot,
        bySelf,
      },
      performance.now() + RESPAWN_DELAY_MS,
    );
  }

  private handleHitFeedback(event: HitEvent): void {
    const localId = this.multiplayer.getLocalId();
    if (event.weaponId === 'knife') {
      const heavy = event.damage >= KNIFE_DAMAGE.primaryBackstab;
      if (event.shooterId === localId) {
        this.audio.play(heavy ? 'backstab' : 'knifeHitFlesh');
      } else if (event.targetId === localId) {
        this.audio.play(heavy ? 'backstab' : 'knifeHitFlesh', { volume: 0.8 });
      } else {
        const at = this.remoteChestPosition(event.targetId);
        if (at) {
          this.audio.playAt(heavy ? 'backstab' : 'knifeHitFlesh', at);
        }
      }
    }
    if (!localId || event.targetId !== localId || event.shooterId === localId) {
      return;
    }
    // firearm hits already got a precise arc from the shot event just before
    if (event.weaponId !== 'knife' && performance.now() - this.lastShotDirectionAtMs < 150) {
      return;
    }
    const attacker = this.remoteChestPosition(event.shooterId);
    this.combatHud?.flashDamageDirection(
      attacker ? damageDirection(this.movement.getFeetPosition(), this.movement.getYawRad(), attacker) : null,
    );
  }

  private handleShotFeedback(event: ShotEvent): void {
    const localId = this.multiplayer.getLocalId();
    if (event.playerId === localId) {
      return;
    }
    if (event.weaponId === 'deagle' || event.weaponId === 'awp') {
      this.gunAudio.shotAt(event.weaponId, event.origin);
    }
    if (localId && event.targetId === localId && (event.result === 'hit' || event.result === 'kill')) {
      this.lastShotDirectionAtMs = performance.now();
      this.combatHud?.flashDamageDirection(
        damageDirection(this.movement.getFeetPosition(), this.movement.getYawRad(), event.origin),
      );
    }
  }

  private remoteChestPosition(playerId: string): [number, number, number] | null {
    const target = this.backstabTargets.find((candidate) => candidate.id === playerId);
    if (!target) {
      return null;
    }
    return [target.position[0], target.position[1] + 1.2, target.position[2]];
  }

  /** clink when a local swing reaches world geometry and no player is in the way */
  private playKnifeWallHit(kind: 'primary' | 'secondary'): void {
    if (!this.playing || !this.loadedMap || (this.combatEnabled && !this.localAlive)) {
      return;
    }
    const origin = this.movement.getCameraPosition();
    const forward = this.movement.getForwardVector();
    const reach = KNIFE_RANGE_M[kind] + 0.35;
    const hit = this.collisionWorld.raycastGeometry(origin, forward, reach);
    if (!hit) {
      return;
    }
    const playerInWay = this.backstabTargets.some((target) => {
      if (!target.alive) {
        return false;
      }
      const dx = target.position[0] - origin.x;
      const dz = target.position[2] - origin.z;
      const distance = Math.hypot(dx, dz);
      return distance < hit.distance + 0.5 && (dx * forward.x + dz * forward.z) / Math.max(distance, 1e-3) > 0.7;
    });
    if (!playerInWay) {
      this.audio.playAt('knifeHitWall', hit.point, { delay: kind === 'primary' ? 0.09 : 0.16 });
    }
  }

  private maybeDryFire(weaponId: WeaponId, ammoRemaining: number, nowMs: number): void {
    if (weaponId === 'knife' || ammoRemaining > 0 || nowMs - this.lastDryFireAtMs < 250) {
      return;
    }
    this.lastDryFireAtMs = nowMs;
    this.gunAudio.dryFire();
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

const KNIFE_STYLE_KEY = 'webstrafe:knife-style:v1';
const LEGACY_KNIFE = 'legacy';

/** Stored knife choice; defaults to the procedural karambit. */
function loadKnifeStyle(): KnifeId | null {
  try {
    const raw = globalThis.localStorage?.getItem(KNIFE_STYLE_KEY);
    if (raw === LEGACY_KNIFE) return null;
    return isKnifeId(raw) ? raw : DEFAULT_KNIFE_ID;
  } catch {
    return DEFAULT_KNIFE_ID;
  }
}

function saveKnifeStyle(id: KnifeId | null): void {
  try {
    globalThis.localStorage?.setItem(KNIFE_STYLE_KEY, id ?? LEGACY_KNIFE);
  } catch {
    // storage blocked, the choice just won't persist
  }
}
