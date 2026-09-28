import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { AttackKind, MultiplayerSnapshot, MultiplayerSnapshotPlayer, PlayerModel } from './types';
import type {
  AttackEvent,
  DeathEvent,
  FireView,
  HealthEvent,
  HitEvent,
  MultiplayerTransport,
  OutgoingState,
  RespawnEvent,
  RoomContext,
  ShotEvent,
} from './MultiplayerTransport';
import type { SupabaseConfig } from './supabaseConfig';
import { HostSimulation, type HostBotRow, type HostEmitter } from './HostSimulation';
import { SendCadence } from '../netcode/SendCadence';
import { broadcastRateHz, DEFAULT_BUDGET, MAX_ROOM_PLAYERS, type BudgetOptions } from '../netcode/RateBudget';
import { RESPAWN_DELAY_MS } from '../combat/CombatState';
import { decodeCosmetics, encodeCosmetics, type PlayerCosmetics } from './cosmetics';
import { CosmeticsPublisher } from './cosmeticsPublisher';
import { clampDuck } from '../movement/hull';

const SESSION_KEY = 'webstrafe:session-id:v1';
/**
 * Wire protocol version, part of the channel name so clients running the old
 * message format never share a room with this one. p4 (v2): knife swings are
 * flagged melee with the cs knife damage table and backstabs, hits carry
 * melee/backstab, and fires carry the shooter's weapon. a p3 host would resolve
 * those differently, so p3 and p4 tabs must never share a room. p5 moves fires
 * and combat events onto state messages. p6 (knives, #51) swaps in the cs2 hull
 * hit capsules (72 u standing, 54 u crouched, rounded ends at the feet and the top
 * of the head) and crouch on the wire (`k`). p7 adds per player pvp opt-in (an
 * older host would let peaceful players be hit) and the host's room scoreboard.
 */
export const SUPABASE_PROTOCOL = 'p7';
const PLAYER_STALE_MS = 8000;
/** idle/paused clients only need to prove they are still here */
const KEEPALIVE_MS = 1000;
/** how often the pump checks for host/keepalive broadcasts */
const PUMP_MS = 25;
const HOST_STEP_MS = 1000 / 60;
/** a peer not heard from for this long can't host (suspended tab, hung main thread) */
export const HOST_STALE_MS = 3000;
/** after joining, wait this long for an existing host's claim before self-electing */
export const JOIN_GRACE_MS = 2500;
/**
 * a forgotten tab kept a channel open forever: a keepalive every second plus
 * every message the room sends it, ~86K billed messages a day. after this long
 * hidden, on the menu or out of play the tab leaves the channel (presence goes
 * with it) and rejoins as a fresh joiner when it comes back.
 */
export const IDLE_DISCONNECT_MS = 60_000;
/** a host with a visible peer waits up to this long past the idle limit for the handoff */
export const IDLE_HANDOFF_GRACE_MS = 10_000;

type Packed = [number, number, number, number, number, number, number, number];

interface WireBot {
  id: string;
  n: string;
  m: PlayerModel;
  s: Packed;
  h: number;
  a: 0 | 1;
}

/** the one position message every client sends ('st') */
interface WireState {
  id: string;
  /** sender wall clock at the sim tick */
  t: number;
  s: Packed | null;
  /** combat ready */
  r: 0 | 1;
  /** host eligibility: 0 no map loaded (menu), 1 map loaded but tab hidden, 2 visible in a map */
  e: 0 | 1 | 2;
  /** host claim epoch, only while this peer is hosting */
  h?: number;
  /** active weapon, so a new host restores it */
  w?: string;
  /** ms until this player respawns, only while dead */
  d?: number;
  /** bot rows, only from the elected host */
  b?: WireBot[];
  /** host clock time of the step that produced `b` */
  bt?: number;
  /** fire requests from this sender, for the host to resolve */
  f?: WireFire[];
  /** combat events, only from the elected host */
  ev?: CombatWireEvent[];
  /** pvp off (0); omitted means on */
  pv?: 0;
  /** own kills/deaths from the last host scoreboard */
  sc?: [number, number];
  /** room scoreboard [id, kills, deaths], only from the elected host */
  sb?: Array<[string, number, number]>;
  /** crouch 0..1 in hundredths, only while crouching (sizes the host's hit capsule) */
  k?: number;
}

interface WireFire {
  origin: [number, number, number];
  dir: [number, number, number];
  targets?: Record<string, number>;
  t: number;
  w?: string;
  melee?: AttackKind;
  /** shooter's magazine before the shot; peers from before p5 omit it */
  a?: number;
}

/** fires waiting for a carrier past this many are stale, drop the oldest */
export const MAX_PENDING_FIRES = 16;

/**
 * Fires and combat batches ride on an immediate state message instead of
 * their own broadcasts (each broadcast is billed once per receiver), at most
 * one such early send per this many ms per client.
 */
export const CARRIER_MIN_GAP_MS = 25;

type CombatWireEvent =
  | { k: 'hit'; e: HitEvent }
  | { k: 'death'; e: DeathEvent }
  | { k: 'health'; e: HealthEvent }
  | { k: 'respawn'; e: RespawnEvent }
  | { k: 'shot'; e: ShotEvent };

export interface SupabaseMultiplayerOptions {
  budget?: BudgetOptions;
  /** defaults to document.visibilityState */
  isVisible?: () => boolean;
  sessionId?: string;
  /** clock override for tests */
  now?: () => number;
  /**
   * leave the channel after this long hidden, on the menu or out of play, and
   * rejoin on return (default IDLE_DISCONNECT_MS; Infinity keeps it connected)
   */
  idleDisconnectMs?: number;
}

interface RemoteRecord {
  name: string;
  model: PlayerModel;
  state: OutgoingState | null;
  t: number | null;
  combatReady: boolean;
  eligibility: 0 | 1 | 2;
  hostEpoch: number | null;
  weapon: string | null;
  deadForMs: number | null;
  /** opted into pvp; false = immune and harmless */
  pvp: boolean;
  /** kills/deaths this peer last saw for itself, seeds a new host */
  score: { kills: number; deaths: number } | null;
  cosmetics: PlayerCosmetics | undefined;
  joinedAt: number;
  lastSeen: number;
}

/** room kills/deaths as published by the host */
export interface RoomScore {
  id: string;
  kills: number;
  deaths: number;
}

/** how often the host republishes the room scoreboard on its state */
const SCOREBOARD_EVERY_MS = 2000;
/** quiet time before a cosmetics change is tracked, and the least time between two tracks */
export const COSMETICS_DEBOUNCE_MS = 1000;
export const COSMETICS_MIN_INTERVAL_MS = 10000;

/**
 * Serverless multiplayer over Supabase Realtime broadcast + presence.
 *
 * Supabase counts each broadcast once when sent and once per receiver, and the
 * free plan drops the whole project's sockets (`tenant_events`) above 100
 * events/s. So every client sends a single merged state message ('st') at a
 * rate budgeted from the room size, the host's bot rows ride along on its own
 * state message, combat events are batched per host step, and paused clients
 * drop to a 1 Hz keepalive.
 *
 * Every state carries the sender's tick time so receivers can interpolate on a
 * real timeline and the host can rewind targets to what a shooter saw.
 */
export class SupabaseMultiplayer implements MultiplayerTransport {
  public onSnapshot: ((snapshot: MultiplayerSnapshot) => void) | null = null;
  public onAttack: ((event: AttackEvent) => void) | null = null;
  public onHit: ((event: HitEvent) => void) | null = null;
  public onDeath: ((event: DeathEvent) => void) | null = null;
  public onHealth: ((event: HealthEvent) => void) | null = null;
  public onRespawn: ((event: RespawnEvent) => void) | null = null;
  public onShot: ((event: ShotEvent) => void) | null = null;
  public onConnectedChange: ((connected: boolean) => void) | null = null;
  /** fired when the room already holds MAX_ROOM_PLAYERS and this client backed out */
  public onRoomFull: (() => void) | null = null;
  /** live room kills/deaths from the elected host (or our own sim while hosting) */
  public onScoreboard: ((rows: RoomScore[]) => void) | null = null;

  private readonly localId: string;
  private channel: RealtimeChannel | null = null;
  private subscribed = false;
  private activeMapId = '';
  private localName = '';
  private localModel: PlayerModel = 'terrorist';
  private localState: OutgoingState | null = null;
  private localStateAtMs = 0;
  private localCombatReady = false;
  private readonly remotes = new Map<string, RemoteRecord>();
  private readonly cadence = new SendCadence(DEFAULT_BUDGET.maxHz);
  private lastBroadcastAtMs = 0;
  private pumpTimer: ReturnType<typeof setInterval> | null = null;

  private roomContext: RoomContext | null = null;
  private hostSim: HostSimulation | null = null;
  private hostLastTickMs = 0;
  private hostAccumulatorMs = 0;
  private botRows: HostBotRow[] = [];
  private botRowsT = 0;
  private botRowsClock = '';
  private botRowsAt = 0;
  private presenceSynced = false;
  private pendingCombat: CombatWireEvent[] = [];
  private pendingFires: WireFire[] = [];
  private carrierTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly detachVisibility: (() => void) | null;
  private localWeapon: string | null = null;
  private localPvp = true;
  private roomScores: RoomScore[] = [];
  private roomScoresKey = '';
  private lastScoreboardSentAt = 0;
  /** cosmetics peers have been told (what presence carries) */
  private localCosmetics: PlayerCosmetics | null = null;
  // presence track costs ~N events per room and is capped at 5 per client per
  // 30 s, so changes are collapsed and spaced out; joins carry the latest
  private readonly cosmeticsPublisher = new CosmeticsPublisher((cosmetics) => {
    this.localCosmetics = cosmetics;
    if (this.channel && this.subscribed) void this.channel.track(this.presencePayload());
  }, { debounceMs: COSMETICS_DEBOUNCE_MS, minIntervalMs: COSMETICS_MIN_INTERVAL_MS, now: () => this.now() });
  /** Date.now() when the local player respawns, while dead */
  private localDeadUntil: number | null = null;
  /** our claim epoch while hosting, and the highest epoch seen in this room */
  private hostEpoch = 0;
  private maxEpochSeen = 0;
  private joinedChannelAt = 0;
  /** set once the paused pose went out with zero velocity */
  private restSent = false;
  private roomFull = false;

  /** Messages this client has broadcast, by event (diagnostics/bench). */
  public readonly sentCounts = new Map<string, number>();

  private readonly budget: BudgetOptions;
  private readonly isVisible: () => boolean;
  private readonly idleDisconnectMs: number;
  /** what the game asked to join, kept while parked */
  private desiredJoin: { mapId: string; name: string; model: PlayerModel } | null = null;
  /** left the channel while idle; rejoins on return */
  private parked = false;
  private idleSince: number | null = null;
  private readonly now: () => number;

  constructor(
    private readonly client: SupabaseClient,
    private readonly config: SupabaseConfig,
    options: SupabaseMultiplayerOptions = {},
  ) {
    this.budget = options.budget ?? DEFAULT_BUDGET;
    this.isVisible = options.isVisible ?? isDocumentVisible;
    this.now = options.now ?? (() => Date.now());
    this.localId = options.sessionId ?? loadSessionId();
    this.idleDisconnectMs = options.idleDisconnectMs ?? IDLE_DISCONNECT_MS;
    this.detachVisibility = watchVisibility(() => {
      this.wake();
      this.cadence.flush();
      this.updateHostRole();
      // tell the room right away, so a hidden host hands off early
      if (this.channel && this.subscribed) this.broadcastState();
    });
  }

  connect(): void {
    // Connection is established lazily on join (the channel per map).
  }

  disconnect(): void {
    this.desiredJoin = null;
    this.parked = false;
    this.idleSince = null;
    this.cosmeticsPublisher.dispose();
    this.localCombatReady = false;
    this.stopPump();
    this.stopHost();
    if (this.channel) {
      void this.client.removeChannel(this.channel);
      this.channel = null;
    }
    this.subscribed = false;
    this.remotes.clear();
    this.botRows = [];
    this.detachVisibility?.();
    this.onConnectedChange?.(false);
  }

  getLocalId(): string | null {
    return this.localId;
  }

  getActiveMapId(): string {
    return this.activeMapId;
  }

  /** Current per-client state broadcast rate for this room size. */
  getBroadcastHz(): number {
    return broadcastRateHz(this.remotes.size + 1, this.budget);
  }

  /** true while parked: left the channel after sitting idle, rejoins on return */
  isParked(): boolean {
    return this.parked;
  }

  join(mapId: string, name: string, model: PlayerModel): void {
    const profileChanged = name !== this.localName || model !== this.localModel;
    this.localName = name;
    this.localModel = model;
    this.desiredJoin = { mapId, name, model };
    if (this.parked) {
      // parked on the menu: remember the pick, join when the player comes back
      this.activeMapId = mapId;
      this.wake();
      return;
    }

    // Same map: refresh presence only when the profile actually changed
    // (presence track is limited to 5 calls per client per 30 s).
    if (this.channel && mapId === this.activeMapId) {
      if (profileChanged && this.subscribed) {
        void this.channel.track(this.presencePayload());
      }
      return;
    }

    this.openChannel(mapId);
  }

  /** leaves any channel and joins the one for `mapId` as a fresh joiner */
  private openChannel(mapId: string): void {
    if (this.channel) {
      void this.client.removeChannel(this.channel);
      this.channel = null;
    }
    this.stopPump();
    this.stopHost();
    this.botRows = [];
    this.remotes.clear();
    this.parked = false;
    this.idleSince = null;
    this.activeMapId = mapId;
    this.presenceSynced = false;
    this.subscribed = false;
    this.hostEpoch = 0;
    this.maxEpochSeen = 0;
    this.roomFull = false;
    this.pendingFires = [];
    this.joinedChannelAt = this.now();

    const channel = this.client.channel(
      `${this.config.lobbyChannelPrefix}_${SUPABASE_PROTOCOL}_${mapId}`,
      { config: { presence: { key: this.localId }, broadcast: { self: false } } },
    );
    this.channel = channel;

    channel.on('presence', { event: 'sync' }, () => {
      if (this.channel !== channel) return;
      this.presenceSynced = true;
      this.syncPresence();
      this.updateHostRole();
    });
    channel.on('broadcast', { event: 'st' }, ({ payload }) => this.onRemoteState(payload as WireState));
    channel.on('broadcast', { event: 'attack' }, ({ payload }) => this.onRemoteAttack(payload));
    channel.on('broadcast', { event: 'fire' }, ({ payload }) => this.onRemoteFire(payload));
    channel.on('broadcast', { event: 'equip' }, ({ payload }) => this.onRemoteEquip(payload));
    channel.on('broadcast', { event: 'reload' }, ({ payload }) => this.onRemoteReload(payload));
    channel.on('broadcast', { event: 'cb' }, ({ payload }) => this.onCombatBatch(payload));

    channel.subscribe((status) => {
      // a channel we already left (parked, changed map) reports CLOSED late
      if (this.channel !== channel) return;
      if (status === 'SUBSCRIBED') {
        this.subscribed = true;
        this.localCosmetics = this.cosmeticsPublisher.joined();
        void channel.track(this.presencePayload());
        this.cadence.flush();
        // everything dropped while joining (weapon, ready, pvp, score) rides on this one state
        this.broadcastState();
        this.startPump();
        this.onConnectedChange?.(true);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        this.subscribed = false;
        this.onConnectedChange?.(false);
      }
    });
  }

  setCombatReady(ready: boolean): void {
    if (this.localCombatReady === ready) {
      return;
    }
    this.localCombatReady = ready;
    this.wake();
    // rides on the next state message, sent right away
    this.cadence.flush();
    this.broadcastState();
  }

  sendState(state: OutgoingState): void {
    if (this.parked) this.wake();
    this.localState = { ...state, t: state.t ?? this.now() };
    this.localStateAtMs = this.now();
    this.restSent = false;
    this.cadence.setRate(this.getBroadcastHz());
    if (!this.cadence.due(this.localState.t!)) {
      return;
    }
    // nobody else in the room: a 1 Hz keepalive is enough for newcomers to
    // find us (and our host claim), full rate would only burn message quota
    if (this.remotes.size === 0 && this.now() - this.lastBroadcastAtMs < KEEPALIVE_MS) {
      return;
    }
    this.broadcastState();
  }

  sendAttack(kind: AttackKind): void {
    this.broadcast('attack', { id: this.localId, mapId: this.activeMapId, kind });
  }

  // Combat is resolved by the elected host. If we ARE the host, apply directly;
  // otherwise broadcast for the host to resolve.
  sendFire(
    origin: [number, number, number],
    dir: [number, number, number],
    view?: FireView | number,
    melee?: AttackKind,
  ): void {
    const fireView: FireView = typeof view === 'number' ? { observedAtMs: view } : view ?? {};
    const shooterT = this.localState?.t ?? this.now();
    if (this.hostSim) {
      this.hostSim.applyFire(this.localId, origin, dir, fireView.observedAtMs, {
        targetTimes: fireView.targets,
        shooterTimeMs: shooterT,
        attackTimeMs: Date.now(),
        clientAmmo: fireView.ammo,
        weapon: this.localWeapon ?? undefined,
      }, melee);
      this.flushCombat();
      return;
    }
    if (this.roomFull || !this.joined()) {
      // turned away by a full room, or not in one yet: nobody hosts for us, nothing to send
      return;
    }
    this.pendingFires.push({
      origin,
      dir,
      targets: fireView.targets,
      t: shooterT,
      ...(this.localWeapon ? { w: this.localWeapon } : {}),
      ...(melee ? { melee } : {}),
      ...(Number.isFinite(fireView.ammo) ? { a: fireView.ammo } : {}),
    });
    if (this.pendingFires.length > MAX_PENDING_FIRES) {
      this.pendingFires.splice(0, this.pendingFires.length - MAX_PENDING_FIRES);
    }
    this.requestCarrier();
  }

  /** Sends state now (carrying queued fires/combat), or as soon as the gap allows. */
  private requestCarrier(): void {
    const wait = CARRIER_MIN_GAP_MS - (this.now() - this.lastBroadcastAtMs);
    if (wait <= 0) {
      this.sendCarrier();
      return;
    }
    if (this.carrierTimer === null) {
      this.carrierTimer = setTimeout(() => {
        this.carrierTimer = null;
        this.sendCarrier();
      }, wait);
    }
  }

  private sendCarrier(): void {
    if (this.pendingFires.length === 0 && this.pendingCombat.length === 0) {
      return;
    }
    this.broadcastState();
    this.cadence.markSent(this.localState?.t ?? this.now());
  }

  sendReload(): void {
    if (this.hostSim) {
      this.hostSim.applyReload(this.localId);
      return;
    }
    this.broadcast('reload', { id: this.localId });
  }

  sendEquip(weaponId: string): void {
    this.localWeapon = weaponId;
    if (this.hostSim) {
      this.hostSim.applyEquip(this.localId, weaponId);
      return;
    }
    this.broadcast('equip', { id: this.localId, weaponId });
  }

  /**
   * Opt in or out of pvp. Enforced by the host: off means immune and unable to
   * damage anyone (players or bots). Goes out on the next pump tick.
   */
  setPvp(on: boolean): void {
    if (this.localPvp === on) return;
    this.localPvp = on;
    // the next pump tick sends it, one message instead of two
    this.cadence.flush();
  }

  getPvp(): boolean {
    return this.localPvp;
  }

  getRoomScores(): RoomScore[] {
    return this.roomScores.map((r) => ({ ...r }));
  }

  private ownScore(): { kills: number; deaths: number } | null {
    const row = this.roomScores.find((r) => r.id === this.localId);
    return row ? { kills: row.kills, deaths: row.deaths } : null;
  }

  private setRoomScores(rows: RoomScore[]): void {
    const key = JSON.stringify(rows);
    if (key === this.roomScoresKey) return;
    this.roomScoresKey = key;
    this.roomScores = rows;
    this.onScoreboard?.(this.getRoomScores());
  }

  setRoomContext(context: RoomContext | null): void {
    this.roomContext = context;
    this.wake();
    // eligibility rides on state, tell the room right away
    this.cadence.flush();
    this.broadcastState();
    this.updateHostRole();
  }

  /** Whether this client is currently the elected host (diagnostics/tests). */
  isHosting(): boolean {
    return this.hostSim !== null;
  }

  /** 2 = visible with a map loaded, 1 = map loaded but hidden, 0 = no map (menu). */
  private localEligibility(): 0 | 1 | 2 {
    if (!this.roomContext) return 0;
    return this.isVisible() ? 2 : 1;
  }

  private presencePayload(): Record<string, unknown> {
    return {
      id: this.localId,
      name: this.localName,
      model: this.localModel,
      j: this.joinedChannelAt,
      ...(this.localCosmetics ? { c: encodeCosmetics(this.localCosmetics) } : {}),
    };
  }

  /** re-tracks presence when the choice changed, debounced and spaced out (presence is rate limited) */
  setCosmetics(cosmetics: PlayerCosmetics | null): void {
    this.cosmeticsPublisher.set(cosmetics);
  }

  /**
   * Host election, evaluated independently by every peer from shared state:
   *
   * 1. Only live peers count (heard from within HOST_STALE_MS), so a suspended
   *    or hung host fails over instead of silently eating every shot.
   * 2. Sticky: if anyone live and eligible is already hosting, the claim with
   *    the highest epoch wins (ties to lowest id). A new host always claims
   *    epoch max+1, so a returning low-id tab doesn't take the room back and
   *    reset everyone's weapons and health.
   * 3. Otherwise the lowest id among visible peers with a map loaded; if none
   *    are visible, the lowest id with a map loaded. Menu tabs never host.
   *
   * A freshly joined peer waits JOIN_GRACE_MS for an existing claim before
   * self-electing, so it can't grab hosting before it has heard the room.
   */
  electedHostId(): string | null {
    if (!this.presenceSynced) {
      return null;
    }
    const now = this.now();
    const localElig = this.localEligibility();
    const claims: Array<{ id: string; epoch: number }> = [];
    if (this.hostSim && localElig > 0) {
      claims.push({ id: this.localId, epoch: this.hostEpoch });
    }
    const visible: string[] = localElig === 2 ? [this.localId] : [];
    const mapped: string[] = localElig > 0 ? [this.localId] : [];
    for (const [id, r] of this.remotes) {
      if (now - r.lastSeen > HOST_STALE_MS) continue;
      if (r.eligibility > 0) mapped.push(id);
      if (r.eligibility === 2) visible.push(id);
      if (r.hostEpoch !== null && r.eligibility > 0) claims.push({ id, epoch: r.hostEpoch });
    }
    if (claims.length > 0) {
      claims.sort((a, b) => b.epoch - a.epoch || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const best = claims[0];
      // a hidden claimant keeps the room only until someone visible can take over
      const bestVisible = best.id === this.localId ? localElig === 2 : this.remotes.get(best.id)?.eligibility === 2;
      if (bestVisible || visible.length === 0) {
        return best.id;
      }
    }
    if (this.remotes.size > 0 && now - this.joinedChannelAt < JOIN_GRACE_MS && !this.hostSim) {
      return null;
    }
    const pool = visible.length > 0 ? visible : mapped;
    pool.sort();
    return pool[0] ?? null;
  }

  /**
   * Starts/stops the host simulation. Combat state lives only in the host's
   * arena, so a handoff resets HP to full (acceptable for a casual game).
   */
  private updateHostRole(): void {
    const shouldHost =
      this.electedHostId() === this.localId && this.roomContext !== null;

    if (shouldHost && !this.hostSim && this.roomContext) {
      const queue = (event: CombatWireEvent) => {
        this.trackLocalLife(event);
        this.pendingCombat.push(event);
      };
      const emitter: HostEmitter = {
        hit: (e) => { this.onHit?.(e); queue({ k: 'hit', e }); },
        death: (e) => { this.onDeath?.(e); queue({ k: 'death', e }); },
        health: (e) => { this.onHealth?.(e); queue({ k: 'health', e }); },
        respawn: (e) => { this.onRespawn?.(e); queue({ k: 'respawn', e }); },
        shot: (e) => { this.onShot?.(e); queue({ k: 'shot', e }); },
      };
      this.hostEpoch = this.maxEpochSeen + 1;
      this.maxEpochSeen = this.hostEpoch;
      this.hostSim = new HostSimulation(
        this.roomContext.collisionWorld,
        this.roomContext.spawn,
        this.roomContext.botCount,
        emitter,
      );
      this.hostLastTickMs = this.now();
      this.hostAccumulatorMs = 0;
      this.cadence.flush();
    } else if (!shouldHost && this.hostSim) {
      this.stopHost();
    }
  }

  /**
   * hidden, or not playing (menu, paused, dead menu, run over). combat ready is
   * only set while playing a loaded map, and builds with combat off never get a
   * room context, so it can't be part of this
   */
  private isIdle(): boolean {
    return !this.isVisible() || !this.localCombatReady;
  }

  /** runs from the pump: parks the tab once it has been idle long enough */
  private checkIdle(): void {
    if (this.parked || !this.channel || !Number.isFinite(this.idleDisconnectMs)) return;
    const now = this.now();
    if (!this.isIdle()) {
      this.idleSince = null;
      return;
    }
    this.idleSince ??= now;
    const idleFor = now - this.idleSince;
    if (idleFor < this.idleDisconnectMs) return;
    // a hidden host hands the room to a visible peer first (it stops being
    // eligible once hidden); only past the grace does it leave regardless. a
    // visible paused host stays eligible, nobody takes over, so no wait
    const handoffPending = this.hostSim !== null && !this.isVisible() && this.hasVisiblePeer();
    if (handoffPending && idleFor < this.idleDisconnectMs + IDLE_HANDOFF_GRACE_MS) return;
    this.park();
  }

  private hasVisiblePeer(): boolean {
    const now = this.now();
    for (const r of this.remotes.values()) {
      if (r.eligibility === 2 && now - r.lastSeen <= HOST_STALE_MS) return true;
    }
    return false;
  }

  /** leaves the channel (and presence) but remembers the join, see IDLE_DISCONNECT_MS */
  private park(): void {
    this.parked = true;
    this.idleSince = null;
    this.stopPump();
    this.stopHost();
    if (this.channel) {
      void this.client.removeChannel(this.channel);
      this.channel = null;
    }
    this.subscribed = false;
    this.presenceSynced = false;
    this.remotes.clear();
    this.botRows = [];
    this.roomFull = false;
    this.pendingFires = [];
    // clear the remote players the game is drawing
    this.emitSnapshot();
    this.onConnectedChange?.(false);
  }

  /** a parked tab that is wanted again (visible, or back in a map) rejoins */
  private wake(): void {
    if (!this.parked || !this.desiredJoin) return;
    // back on a visible tab rejoins even on the menu (and parks again later if it stays there)
    if (!this.isVisible()) return;
    this.openChannel(this.desiredJoin.mapId);
  }

  private stopHost(): void {
    this.hostSim?.dispose();
    this.hostSim = null;
    this.pendingCombat = [];
  }

  private startPump(): void {
    this.stopPump();
    this.pumpTimer = setInterval(() => this.pump(), PUMP_MS);
  }

  private stopPump(): void {
    if (this.carrierTimer !== null) {
      clearTimeout(this.carrierTimer);
      this.carrierTimer = null;
    }
    if (this.pumpTimer) {
      clearInterval(this.pumpTimer);
      this.pumpTimer = null;
    }
  }

  /**
   * Timer-driven work: host bot steps, host broadcasts while the host's own
   * player is paused (no ticks arriving), and idle keepalives.
   */
  private pump(): void {
    this.checkIdle();
    if (this.parked) return;
    const now = this.now();
    // liveness and grace windows expire on their own, re-run the election
    this.updateHostRole();
    if (this.hostSim) {
      this.tickHost(now);
    }
    const ticking = now - this.localStateAtMs < 250;
    if (ticking) {
      return;
    }
    // paused: publish one final pose at rest (zero velocity, fresh time) so
    // nobody extrapolates the last strafe, then keepalives repeat that sample
    // with its original time, which receivers drop as a duplicate
    if (this.localState && !this.restSent) {
      this.localState = { ...this.localState, velocity: [0, 0, 0], t: now };
      this.restSent = true;
      this.broadcastState();
      return;
    }
    const busyHost = this.hostSim !== null && this.remotes.size > 0;
    const interval = busyHost ? 1000 / this.getBroadcastHz() : KEEPALIVE_MS;
    if (now - this.lastBroadcastAtMs >= interval) {
      this.broadcastState();
    }
  }

  private tickHost(now: number): void {
    if (!this.hostSim) {
      return;
    }
    // fixed 60 Hz bot steps regardless of timer jitter; cap catch-up so a
    // stalled tab doesn't fast-forward bots through walls
    this.hostAccumulatorMs = Math.min(this.hostAccumulatorMs + (now - this.hostLastTickMs), HOST_STEP_MS * 6);
    this.hostLastTickMs = now;

    const humans = [];
    if (this.localState) {
      humans.push({
        id: this.localId,
        name: this.localName,
        model: this.localModel,
        position: this.localState.position,
        velocity: this.localState.velocity,
        t: this.localState.t,
        weapon: this.localWeapon ?? undefined,
        deadForMs: this.localDeadUntil !== null ? Math.max(0, this.localDeadUntil - now) : undefined,
        pvp: this.localPvp,
        score: this.ownScore() ?? undefined,
        combatReady: this.localCombatReady,
        yaw: this.localState.yaw,
        pitch: this.localState.pitch,
        duck: this.localState.duck,
      });
    }
    for (const [id, record] of this.remotes) {
      if (record.state) {
        humans.push({
          id,
          name: record.name,
          model: record.model,
          position: record.state.position,
          velocity: record.state.velocity,
          t: record.t ?? undefined,
          weapon: record.weapon ?? undefined,
          deadForMs: record.deadForMs ?? undefined,
          pvp: record.pvp,
          score: record.score ?? undefined,
          combatReady: record.combatReady,
          yaw: record.state.yaw,
          pitch: record.state.pitch,
          duck: record.state.duck,
        });
      }
    }
    this.hostSim.syncHumans(humans);
    let stepped = false;
    while (this.hostAccumulatorMs >= HOST_STEP_MS) {
      this.hostAccumulatorMs -= HOST_STEP_MS;
      this.botRows = this.hostSim.tick(HOST_STEP_MS);
      this.setRoomScores(this.hostSim.scoreboard());
      stepped = true;
    }
    if (stepped) {
      this.botRowsT = now;
      this.botRowsClock = this.localId;
      this.botRowsAt = now;
      this.emitSnapshot();
    }
    this.flushCombat();
  }

  private flushCombat(): void {
    if (this.pendingCombat.length === 0) {
      return;
    }
    this.requestCarrier();
  }

  /**
   * Sends our state. The message time is always the time of the pose it
   * carries, never "now": a repeated pose must look like the same sample.
   */
  private broadcastState(): void {
    if (!this.joined() || this.roomFull) {
      return;
    }
    const now = this.now();
    const s = this.localState;
    const payload: WireState = {
      id: this.localId,
      t: Math.round(s?.t ?? now),
      s: s ? pack(s.position, s.velocity, s.yaw, s.pitch) : null,
      r: this.localCombatReady ? 1 : 0,
      e: this.localEligibility(),
    };
    if (this.hostSim) payload.h = this.hostEpoch;
    if (this.localWeapon) payload.w = this.localWeapon;
    if (this.localDeadUntil !== null) payload.d = Math.max(0, Math.round(this.localDeadUntil - now));
    if (!this.localPvp) payload.pv = 0;
    const own = this.ownScore();
    if (own) payload.sc = [own.kills, own.deaths];
    if (this.hostSim && now - this.lastScoreboardSentAt >= SCOREBOARD_EVERY_MS) {
      payload.sb = this.roomScores.slice(0, 16).map((r) => [r.id, r.kills, r.deaths] as [string, number, number]);
      this.lastScoreboardSentAt = now;
    }
    const duck = Math.round(clampDuck(s?.duck) * 100) / 100;
    if (duck > 0) payload.k = duck;
    if (this.hostSim && this.botRows.length > 0) {
      payload.b = this.botRows.map((row) => ({
        id: row.id,
        n: row.name,
        m: row.model,
        s: pack(row.position, row.velocity, row.yaw, row.pitch),
        h: row.health,
        a: row.alive ? 1 : 0,
      }));
      // bot poses come from the last host step, not this tick
      payload.bt = Math.round(this.botRowsT);
    }
    if (this.pendingFires.length > 0) {
      payload.f = this.pendingFires;
      this.pendingFires = [];
    }
    if (this.hostSim && this.pendingCombat.length > 0) {
      payload.ev = this.pendingCombat;
      this.pendingCombat = [];
    }
    this.lastBroadcastAtMs = now;
    this.broadcast('st', payload);
  }

  /**
   * realtime-js sends a broadcast it can't push over the socket (joining, leaving,
   * socket closing) as a REST post instead, billed like any message. so nothing
   * goes out unless the channel is joined; what matters rides on the first state
   * after the join
   */
  private joined(): boolean {
    return this.channel !== null && this.subscribed && String(this.channel.state) === 'joined';
  }

  private broadcast(event: string, payload: unknown): void {
    if (!this.channel || !this.joined()) {
      return;
    }
    this.sentCounts.set(event, (this.sentCounts.get(event) ?? 0) + 1);
    void this.channel.send({ type: 'broadcast', event, payload });
  }

  private onRemoteState(p: WireState): void {
    if (!p || typeof p.id !== 'string' || p.id === this.localId || !Number.isFinite(p.t)) {
      return;
    }
    let record = this.remotes.get(p.id);
    if (!record) {
      // state can beat the presence sync; keep it with a placeholder profile
      record = newRecord('Player', 'terrorist', this.now());
      this.remotes.set(p.id, record);
    }
    const before = `${record.eligibility}|${record.hostEpoch}`;
    record.lastSeen = this.now();
    record.combatReady = p.r === 1;
    record.eligibility = p.e === 2 ? 2 : p.e === 1 ? 1 : 0;
    record.hostEpoch = typeof p.h === 'number' && Number.isFinite(p.h) ? p.h : null;
    if (record.hostEpoch !== null) this.maxEpochSeen = Math.max(this.maxEpochSeen, record.hostEpoch);
    record.weapon = typeof p.w === 'string' ? p.w : record.weapon;
    record.deadForMs = typeof p.d === 'number' && Number.isFinite(p.d) ? p.d : null;
    record.pvp = p.pv !== 0;
    if (Array.isArray(p.sc) && p.sc.length === 2) {
      record.score = { kills: Number(p.sc[0]) || 0, deaths: Number(p.sc[1]) || 0 };
    }
    if (Array.isArray(p.sb) && p.id === this.electedHostId() && !this.hostSim) {
      this.setRoomScores(parseScores(p.sb));
    }
    if (Array.isArray(p.s) && p.s.length === 8 && (record.t === null || p.t > record.t)) {
      record.state = { ...unpack(p.s), duck: clampDuck(p.k) };
      record.t = p.t;
      this.hostSim?.recordHumanSample(
        p.id,
        record.state.position,
        p.t,
        record.state.velocity,
        record.state.yaw,
        record.state.duck,
      );
    }

    if (Array.isArray(p.b) && p.id === this.electedHostId() && !this.hostSim) {
      this.botRows = p.b.map((bot) => {
        const st = unpack(bot.s);
        return {
          id: bot.id,
          name: bot.n,
          model: bot.m,
          position: st.position,
          velocity: st.velocity,
          yaw: st.yaw,
          pitch: st.pitch,
          health: bot.h,
          alive: bot.a === 1,
        };
      });
      this.botRowsT = Number.isFinite(p.bt) ? (p.bt as number) : p.t;
      this.botRowsClock = p.id;
      this.botRowsAt = this.now();
    }

    if (before !== `${record.eligibility}|${record.hostEpoch}`) {
      this.updateHostRole();
    }
    this.onCarried(p);
    this.emitSnapshot();
  }

  private onCombatBatch(payload: unknown): void {
    const p = payload as { host?: string; ev?: CombatWireEvent[] };
    // only the elected host resolves combat; a stale or rogue sender is ignored
    if (this.hostSim || !Array.isArray(p.ev) || !p.host || p.host !== this.electedHostId()) {
      return;
    }
    for (const item of p.ev) {
      this.trackLocalLife(item);
      switch (item.k) {
        case 'hit': this.onHit?.(item.e); break;
        case 'death': this.onDeath?.(item.e); break;
        case 'health': this.onHealth?.(item.e); break;
        case 'respawn': this.onRespawn?.(item.e); break;
        case 'shot': this.onShot?.(item.e); break;
        default: break;
      }
    }
  }

  /** Remembers our own death so a new host can keep the respawn timer going. */
  private trackLocalLife(item: CombatWireEvent): void {
    if (item.k === 'death' && item.e.victimId === this.localId) {
      this.localDeadUntil = this.now() + RESPAWN_DELAY_MS;
    } else if (
      (item.k === 'respawn' && item.e.playerId === this.localId)
      || (item.k === 'health' && item.e.playerId === this.localId && item.e.alive)
    ) {
      this.localDeadUntil = null;
    }
  }

  /** Fires and combat events carried by a state message. */
  private onCarried(p: WireState): void {
    if (Array.isArray(p.f)) {
      for (const f of p.f.slice(0, 16)) {
        this.onRemoteFire({ id: p.id, ...f });
      }
    }
    if (Array.isArray(p.ev)) {
      this.onCombatBatch({ host: p.id, ev: p.ev });
    }
  }

  private onRemoteFire(payload: unknown): void {
    const p = payload as {
      id?: string;
      origin?: [number, number, number];
      dir?: [number, number, number];
      targets?: Record<string, number>;
      t?: number;
      w?: unknown;
      melee?: unknown;
      a?: unknown;
    };
    const melee = p.melee === undefined ? undefined : parseMelee(p.melee);
    if (melee === null) {
      return;
    }
    if (this.hostSim && p.id && p.origin && p.dir) {
      this.hostSim.applyFire(p.id, p.origin, p.dir, undefined, {
        targetTimes: sanitizeTargets(p.targets),
        shooterTimeMs: Number.isFinite(p.t) ? p.t : undefined,
        weapon: typeof p.w === 'string' ? p.w : undefined,
        clientAmmo: typeof p.a === 'number' && Number.isFinite(p.a) ? p.a : undefined,
      }, melee);
      this.flushCombat();
    }
  }

  private onRemoteEquip(payload: unknown): void {
    const p = payload as { id?: string; weaponId?: string };
    if (this.hostSim && p.id && p.weaponId) {
      this.hostSim.applyEquip(p.id, p.weaponId);
    }
  }

  private onRemoteReload(payload: unknown): void {
    const p = payload as { id?: string };
    if (this.hostSim && p.id) {
      this.hostSim.applyReload(p.id);
    }
  }

  private syncPresence(): void {
    if (!this.channel) {
      return;
    }
    const state = this.channel.presenceState<{
      id: string;
      name: string;
      model: PlayerModel;
      j?: number;
      c?: unknown;
    }>();
    const present = new Set<string>();
    for (const entries of Object.values(state)) {
      for (const entry of entries) {
        if (entry.id === this.localId) {
          continue;
        }
        present.add(entry.id);
        const existing = this.remotes.get(entry.id) ?? newRecord(entry.name, entry.model, this.now());
        existing.name = entry.name;
        existing.model = entry.model;
        existing.joinedAt = typeof entry.j === 'number' ? entry.j : existing.joinedAt;
        existing.cosmetics = decodeCosmetics(entry.c);
        this.remotes.set(entry.id, existing);
      }
    }
    for (const id of [...this.remotes.keys()]) {
      if (!present.has(id)) {
        this.remotes.delete(id);
      }
    }
    this.cadence.setRate(this.getBroadcastHz());
    this.enforceRoomCap();
  }

  /**
   * Past MAX_ROOM_PLAYERS the per-client rate budget can't stay under the
   * project event cap, so the latest joiners (by join time, then id) back out.
   */
  private enforceRoomCap(): void {
    if (this.remotes.size + 1 <= MAX_ROOM_PLAYERS || this.roomFull) {
      return;
    }
    const roster = [{ id: this.localId, j: this.joinedChannelAt }];
    for (const [id, r] of this.remotes) roster.push({ id, j: r.joinedAt });
    roster.sort((a, b) => a.j - b.j || (a.id < b.id ? -1 : 1));
    const seat = roster.findIndex((r) => r.id === this.localId);
    if (seat >= MAX_ROOM_PLAYERS) {
      this.roomFull = true;
      this.pendingFires = [];
      this.stopPump();
      this.stopHost();
      if (this.channel) {
        void this.client.removeChannel(this.channel);
        this.channel = null;
      }
      this.subscribed = false;
      this.remotes.clear();
      this.onRoomFull?.();
      this.onConnectedChange?.(false);
    }
  }

  private onRemoteAttack(payload: unknown): void {
    const p = payload as { id?: string; mapId?: string; kind?: AttackKind };
    if (!p.id || p.id === this.localId || !p.kind) {
      return;
    }
    this.onAttack?.({ mapId: p.mapId ?? this.activeMapId, playerId: p.id, kind: p.kind });
  }

  /** Builds the full roster; rows carry their sample time and clock. */
  private emitSnapshot(): void {
    if (!this.onSnapshot) {
      return;
    }
    const now = this.now();
    const players: MultiplayerSnapshotPlayer[] = [];

    if (this.localState) {
      players.push({
        id: this.localId,
        name: this.localName,
        model: this.localModel,
        position: this.localState.position,
        velocity: this.localState.velocity,
        yaw: this.localState.yaw,
        pitch: this.localState.pitch,
        pvp: this.localPvp,
      });
    }
    for (const [id, record] of this.remotes) {
      if (!record.state || now - record.lastSeen > PLAYER_STALE_MS) {
        continue;
      }
      players.push({
        id,
        name: record.name,
        model: record.model,
        position: record.state.position,
        velocity: record.state.velocity,
        yaw: record.state.yaw,
        pitch: record.state.pitch,
        t: record.t ?? undefined,
        clock: id,
        pvp: record.pvp,
        ...(record.cosmetics ? { cosmetics: record.cosmetics } : {}),
      });
    }

    if (now - this.botRowsAt <= PLAYER_STALE_MS) {
      for (const bot of this.botRows) {
        players.push({ ...bot, t: this.botRowsT, clock: this.botRowsClock, pvp: true });
      }
    }

    this.onSnapshot({ mapId: this.activeMapId, players, serverTimeMs: now });
  }
}

function parseScores(raw: unknown[]): RoomScore[] {
  const out: RoomScore[] = [];
  for (const row of raw.slice(0, 16)) {
    if (!Array.isArray(row) || typeof row[0] !== 'string') continue;
    const kills = Number(row[1]);
    const deaths = Number(row[2]);
    if (!Number.isFinite(kills) || !Number.isFinite(deaths)) continue;
    out.push({ id: row[0], kills: Math.max(0, Math.floor(kills)), deaths: Math.max(0, Math.floor(deaths)) });
  }
  return out;
}

function newRecord(name: string, model: PlayerModel, now: number): RemoteRecord {
  return {
    name,
    model,
    state: null,
    t: null,
    combatReady: false,
    eligibility: 0,
    hostEpoch: null,
    weapon: null,
    cosmetics: undefined,
    deadForMs: null,
    pvp: true,
    score: null,
    // unknown join time sorts last, so an unseen peer never bumps a seated one
    joinedAt: Number.MAX_SAFE_INTEGER,
    lastSeen: now,
  };
}

function pack(
  position: [number, number, number],
  velocity: [number, number, number],
  yaw: number,
  pitch: number,
): Packed {
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const r4 = (v: number) => Math.round(v * 10000) / 10000;
  return [r3(position[0]), r3(position[1]), r3(position[2]), r3(velocity[0]), r3(velocity[1]), r3(velocity[2]), r4(yaw), r4(pitch)];
}

function unpack(s: Packed): OutgoingState {
  return {
    position: [s[0], s[1], s[2]],
    velocity: [s[3], s[4], s[5]],
    yaw: s[6],
    pitch: s[7],
  };
}

/** a malformed melee field drops the whole fire instead of guessing */
function parseMelee(value: unknown): AttackKind | null {
  return value === 'primary' || value === 'secondary' ? value : null;
}

function sanitizeTargets(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const out: Record<string, number> = {};
  let n = 0;
  for (const [id, t] of Object.entries(value as Record<string, unknown>)) {
    if (n >= 32) break;
    if (typeof t === 'number' && Number.isFinite(t)) {
      out[id] = t;
      n += 1;
    }
  }
  return n > 0 ? out : undefined;
}

function isDocumentVisible(): boolean {
  const doc = (globalThis as { document?: { visibilityState?: string } }).document;
  return !doc || doc.visibilityState !== 'hidden';
}

function watchVisibility(onChange: () => void): (() => void) | null {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc || typeof doc.addEventListener !== 'function') {
    return null;
  }
  doc.addEventListener('visibilitychange', onChange);
  return () => doc.removeEventListener('visibilitychange', onChange);
}

function loadSessionId(): string {
  try {
    const existing = globalThis.localStorage?.getItem(SESSION_KEY);
    if (existing) {
      return existing;
    }
    const id = randomId();
    globalThis.localStorage?.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return randomId();
  }
}

function randomId(): string {
  return `p_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}
