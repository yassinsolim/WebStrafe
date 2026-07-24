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
  PMREMGenerator,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
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
import { CosmeticsManager } from '../cosmetics/CosmeticsManager';
import { ViewmodelRenderer } from '../cosmetics/ViewmodelRenderer';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { WeaponViewmodels, type GunId } from '../cosmetics/WeaponViewmodels';
import { ViewmodelPresentation } from '../cosmetics/ViewmodelPresentation';
import type { LoadoutSelection } from '../cosmetics/types';
import { HUD } from '../ui/HUD';
import { MainMenu } from '../ui/MainMenu';
import { defaultSettings, loadSettings, saveSettings, type GameSettings } from '../ui/SettingsStore';
import { LeaderboardService, sanitizeLeaderboardName } from '../network/LeaderboardService';
import { MultiplayerClient } from '../network/MultiplayerClient';
import { createMultiplayer } from '../network/createMultiplayer';
import type { MultiplayerTransport } from '../network/MultiplayerTransport';
import type { LeaderboardEntry, PlayerModel } from '../network/types';
import {
  REMOTE_PRESENTATION_DELAY_MS,
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
import { isCombatEnabled } from '../combat/combatConfig';
import { getWeapon, type WeaponId } from '../combat/weapons';
import { CollisionWorld } from '../world/CollisionWorld';
import { deleteCustomMap, listCustomMaps } from '../world/CustomMapStore';
import { MapLoader, type MapLoadReporter } from '../world/MapLoader';
import { loadBuiltinManifest } from '../world/MapManifestService';
import { loadSelectedMapId, saveSelectedMapId } from '../world/MapSelectionStore';
import { groundResolvedSpawn } from '../world/SpawnResolver';
import { resolveRunGoal, type GoalPad } from '../world/RunGoal';
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
/** Gives the slowest remote round several rendered arrival frames before UI cover. */
const FATAL_CUE_LEAD_MS = 320;
const RESPAWN_DELAY_MS = 3000;

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
  private latestSnapshotServerTimeMs: number | null = null;

  private readonly cosmeticsGroup = new Group();
  private readonly weaponViewmodels = new WeaponViewmodels();
  private readonly viewmodelPresentation = new ViewmodelPresentation(
    this.cosmeticsGroup,
    this.weaponViewmodels,
  );
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
  private remotePlayersReady: Promise<void> = Promise.resolve();

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
    this.viewmodelRenderer.camera.add(this.weaponViewmodels.root);
    // Soft studio environment so metallic weapon materials (Deagle/AWP) read as
    // lit gunmetal instead of near-black, and the knife/gloves gain gentle IBL.
    const pmrem = new PMREMGenerator(this.renderer);
    this.viewmodelRenderer.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
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
    document.addEventListener('pointerlockerror', this.onPointerLockError);
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
    // The remote player models (~75 MB of GLBs) are only needed once a match
    // starts — not for the menu or its character preview, which loads its own
    // hero model. Kick the load off in the background so the menu paints
    // immediately instead of blocking the first render on 75 MB. Awaited before
    // a play session actually enters a map (see startPlaySession).
    this.remotePlayersReady = this.remotePlayers.load().catch((error) => {
      // eslint-disable-next-line no-console
      console.warn('[Multiplayer] Failed to load remote player models:', error);
    });
    // Gun viewmodels (~9 MB) are only needed once combat play starts; load them
    // in the background so they don't block the menu paint.
    if (this.combatEnabled) {
      void this.weaponViewmodels.load().catch((error) => {
        // eslint-disable-next-line no-console
        console.warn('[Combat] Failed to load gun viewmodels:', error);
      });
    }
    this.rebuildMapSources(builtinMaps, customRecords);
    const fallbackMapId =
      (this.combatEnabled
        ? builtinMaps.find((map) => map.id === 'movement_test_scene')?.id
        : builtinMaps.find((map) => map.id === 'surf_skyworld_x')?.id)
      ?? builtinMaps.find((map) => map.id === 'movement_test_scene')?.id
      ?? builtinMaps[0]?.id
      ?? Array.from(this.mapSources.keys())[0]
      ?? '';
    this.selectedMapId = loadSelectedMapId(this.mapSources.keys(), fallbackMapId);

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
        this.persistSelectedMapId(mapId);
        this.remotePlayers.applySnapshot([], null);
        this.backstabTargets = [];
        this.latestSnapshotServerTimeMs = null;
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
    });
    this.menu.setMaps(this.getMapEntries(), this.selectedMapId);
    this.menu.setCosmetics(cosmeticsManifest, this.loadout);
    this.menu.setLeaderboard([], this.getMapNameById(this.selectedMapId));
    this.menu.setPlayerName(this.localPlayerName);
    // Persist the (possibly auto-generated) name so identity is stable across reloads.
    savePlayerName(this.localPlayerName);
    this.menu.setVisible(true);
    this.setCrosshairVisible(false);
    this.dismissBootLoader();

    // Pick the transport: Supabase Realtime when configured (serverless deploy),
    // else the self-hosted WebSocket client (local dev / LAN).
    this.multiplayer = await createMultiplayer();

    this.multiplayer.onSnapshot = (snapshot) => {
      if (snapshot.mapId !== this.selectedMapId) {
        return;
      }
      const localId = this.multiplayer.getLocalId();
      this.latestSnapshotServerTimeMs = snapshot.serverTimeMs;
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
        this.remoteKnifeAudio.play(kind, 0.48, remoteProfile);
      }
    };
    this.multiplayer.connect();
    this.setupCombat();
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
    this.gunAudio.dispose();
    this.knifeAudio.dispose();
    this.remoteKnifeAudio.dispose();
    this.cosmeticsManager.resetKnifePresentation();
    this.viewmodelRenderer.clearPresentationTransient();
    this.menu?.dispose();
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
            this.viewmodelRenderer.triggerInspect();
          }
          inspectQueued = false;
        }
        if (attackQueued) {
          if (!dead) {
            this.viewmodelRenderer.cancelInspect();
            const activeWeapon = this.weapon.getActive();
            if (this.combatEnabled && activeWeapon !== 'knife') {
              this.fireCombatWeapon(time);
            } else {
              this.cosmeticsManager.triggerAttackPrimary();
              this.multiplayer.sendAttack('primary');
              if (this.combatEnabled) {
                this.fireCombatWeapon(time);
              }
            }
          }
          attackQueued = false;
        }
        if (attackAltQueued) {
          if (!dead && (!this.combatEnabled || this.weapon.getActive() === 'knife')) {
            this.viewmodelRenderer.cancelInspect();
            this.cosmeticsManager.triggerAttackSecondary();
            this.multiplayer.sendAttack('secondary');
          }
          attackAltQueued = false;
        }

        // Always drain the sampled input (to clear edge-triggered jump/keys),
        // but freeze movement while dead so a killed player can't keep running
        // around as a "ghost" until they respawn.
        const sampledMove = this.input.sampleMoveInput();
        const moveInput = dead ? this.deadMoveInput : sampledMove;
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
    const cameraPosition = this.movement.getCameraPosition();
    this.cosmeticsManager.setBackstabReady(
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
    this.cosmeticsManager.update(frameDt);
    const startedKnifeAttack = this.cosmeticsManager.consumeStartedAttack();
    if (startedKnifeAttack) {
      this.knifeAudio.play(startedKnifeAttack);
    }
    this.weaponViewmodels.update(frameDt);
    // Guns hang off the camera directly, so apply the same CS2-style sway/bob/
    // dip/kick delta the ViewmodelRenderer computed for the knife — otherwise
    // they'd be rigidly pinned to the view and feel dead.
    this.weaponViewmodels.root.position.copy(this.viewmodelRenderer.motionPos);
    this.weaponViewmodels.root.rotation.copy(this.viewmodelRenderer.motionRot);
    this.remotePlayers.update(frameDt);
    if (this.combatEnabled) {
      this.updateCombat(time);
    }
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
      this.multiplayer.setCombatReady(true);
      this.syncMultiplayerIdentity();
      if (!this.didPlayInitialEquip) {
        this.cosmeticsManager.triggerEquip();
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

    this.collisionWorld.setCollisionFromRoot(map.collisionRoot);

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
    this.movement.reset(spawn.position, spawn.yawDeg);

    // In Supabase mode the elected host runs the bot/combat sim; give it this
    // map's collision + spawn. (The WebSocket transport ignores this.)
    this.multiplayer.setRoomContext(
      this.combatEnabled
        ? {
            collisionWorld: this.collisionWorld,
            spawn: { position: spawn.position.clone(), yawDeg: spawn.yawDeg },
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
    this.combatEffects = new CombatEffects(this.worldScene, this.weaponViewmodels.root);
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
    this.multiplayer.onHit = ({ shooterId, hitbox, killed }) => {
      if (shooterId === this.multiplayer.getLocalId()) {
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
      this.viewmodelPresentation.setAlive(false);
      this.combatEffects?.clearForDeath(performance.now());
      this.combatHud?.clearTransient(true);
      this.viewmodelRenderer.clearPresentationTransient();
      this.cosmeticsManager.resetKnifePresentation();
      this.knifeAudio.stopAll();
      if (this.deathPresentationTimer !== null) {
        clearTimeout(this.deathPresentationTimer);
      }
      this.deathPresentationTimer = setTimeout(() => {
        this.deathPresentationTimer = null;
        if (!this.localAlive) {
          this.combatHud?.setDeathVisible(true);
          this.showStatus(
            'You died — respawning…',
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
    this.viewmodelPresentation.setAlive(true);
    this.combatEffects?.clear();
    this.combatHud?.clearTransient();
    this.viewmodelRenderer.clearPresentationTransient();
    this.cosmeticsManager.resetKnifePresentation();
    this.knifeAudio.stopAll();
    this.crosshair.classList.remove('shot-deagle', 'shot-awp');
    this.weapon.reset();
    this.updateWeaponViewmodel(this.weapon.getActive());
    this.combatHud?.setWeapon(this.weapon.getActive(), this.weapon.getAmmo());
    this.combatHud?.setHealth(100, true);
    this.respawnLocalPlayer();
  }

  private restoreLocalAfterRespawn(): void {
    this.resetLocalCombatState();
    this.showStatus('Respawned', 1200);
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
    const forward = new Vector3(0, 0, -1).applyEuler(this.worldCamera.rotation).normalize();
    const result = fireLocalWeapon(
      {
        weapon: this.weapon,
        effects: this.combatEffects,
        collisionWorld: this.collisionWorld,
        onPresented: (weaponId) => {
          this.weaponViewmodels.triggerFire();
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
      return;
    }
    this.multiplayer.sendFire(
      [origin.x, origin.y, origin.z],
      [forward.x, forward.y, forward.z],
      this.latestSnapshotServerTimeMs === null
        ? undefined
        : this.latestSnapshotServerTimeMs - REMOTE_PRESENTATION_DELAY_MS,
    );
    if (result.magazineEmptied) {
      this.reloadCombatWeapon(nowMs);
    }
  }

  private equipCombatWeapon(id: WeaponId): void {
    if (!this.combatEnabled) {
      return;
    }
    this.weapon.equip(id);
    this.multiplayer.sendEquip(id);
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
    this.viewmodelPresentation.setWeapon(id);
    this.viewmodelRenderer.setFirearm(gun);
    if (id === 'knife') {
      this.cosmeticsManager.triggerEquip();
    } else {
      this.cosmeticsManager.resetKnifePresentation();
      this.knifeAudio.stopAll();
    }
  }

  private reloadCombatWeapon(nowMs: number): void {
    const active = this.weapon.getActive();
    if (!this.weapon.reload(nowMs)) {
      return;
    }
    this.multiplayer.sendReload();
    this.weaponViewmodels.triggerReload();
    if (active === 'deagle' || active === 'awp') {
      this.viewmodelRenderer.triggerReload(getWeapon(active).reloadMs);
      this.gunAudio.reload(active);
    }
  }

  private canInspectActiveWeapon(nowMs: number): boolean {
    const active = this.weapon.getActive();
    if (active === 'knife') {
      return this.cosmeticsManager.canInspect();
    }
    const presentation = this.weaponViewmodels.getPresentationState();
    return !this.weapon.isReloading(nowMs)
      && presentation.active === active
      && presentation.action === 'idle';
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
    this.weaponViewmodels.setInspectPose(
      this.viewmodelRenderer.getInspectProgress(),
      inspectWeight,
    );
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

  /** Teleports the local player back to the map spawn after a combat death. */
  private respawnLocalPlayer(): void {
    if (!this.loadedMap) {
      return;
    }
    this.movement.reset(this.loadedMap.spawnPosition, this.loadedMap.spawnYawDeg);
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
      this.fixedInputActions.clear();
      if (this.playing && !this.runComplete && this.finishedRunTimeMs === null) {
        this.pauseRunTimer();
      }
      this.playing = false;
      this.multiplayer.setCombatReady(false);
      this.viewmodelRenderer.clearPresentationTransient();
      this.cosmeticsManager.resetKnifePresentation();
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
      this.cosmeticsManager.triggerEquip();
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
