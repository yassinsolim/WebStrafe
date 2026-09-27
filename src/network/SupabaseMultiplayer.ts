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
import { broadcastRateHz, DEFAULT_BUDGET, type BudgetOptions } from '../netcode/RateBudget';

const SESSION_KEY = 'webstrafe:session-id:v1';
/**
 * Wire protocol version, part of the channel name so clients running the old
 * message format never share a room with this one.
 */
export const SUPABASE_PROTOCOL = 'p2';
const PLAYER_STALE_MS = 8000;
/** idle/paused clients only need to prove they are still here */
const KEEPALIVE_MS = 1000;
/** how often the pump checks for host/keepalive broadcasts */
const PUMP_MS = 25;
const HOST_STEP_MS = 1000 / 60;

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
  /** willing to host (tab visible) */
  e: 0 | 1;
  /** bot rows, only from the elected host */
  b?: WireBot[];
  /** host clock time of the step that produced `b` */
  bt?: number;
}

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
}

interface RemoteRecord {
  name: string;
  model: PlayerModel;
  state: OutgoingState | null;
  t: number | null;
  combatReady: boolean;
  hostEligible: boolean;
  lastSeen: number;
}

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
  private readonly detachVisibility: (() => void) | null;

  /** Messages this client has broadcast, by event (diagnostics/bench). */
  public readonly sentCounts = new Map<string, number>();

  private readonly budget: BudgetOptions;
  private readonly isVisible: () => boolean;

  constructor(
    private readonly client: SupabaseClient,
    private readonly config: SupabaseConfig,
    options: SupabaseMultiplayerOptions = {},
  ) {
    this.budget = options.budget ?? DEFAULT_BUDGET;
    this.isVisible = options.isVisible ?? isDocumentVisible;
    this.localId = options.sessionId ?? loadSessionId();
    this.detachVisibility = watchVisibility(() => {
      this.cadence.flush();
      this.updateHostRole();
    });
  }

  connect(): void {
    // Connection is established lazily on join (the channel per map).
  }

  disconnect(): void {
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

  join(mapId: string, name: string, model: PlayerModel): void {
    const profileChanged = name !== this.localName || model !== this.localModel;
    this.localName = name;
    this.localModel = model;

    // Same map: refresh presence only when the profile actually changed
    // (presence track is limited to 5 calls per client per 30 s).
    if (this.channel && mapId === this.activeMapId) {
      if (profileChanged && this.subscribed) {
        void this.channel.track(this.presencePayload());
      }
      return;
    }

    if (this.channel) {
      void this.client.removeChannel(this.channel);
      this.channel = null;
    }
    this.stopPump();
    this.stopHost();
    this.botRows = [];
    this.remotes.clear();
    this.activeMapId = mapId;
    this.presenceSynced = false;
    this.subscribed = false;

    const channel = this.client.channel(
      `${this.config.lobbyChannelPrefix}_${SUPABASE_PROTOCOL}_${mapId}`,
      { config: { presence: { key: this.localId }, broadcast: { self: false } } },
    );
    this.channel = channel;

    channel.on('presence', { event: 'sync' }, () => {
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
      if (status === 'SUBSCRIBED') {
        this.subscribed = true;
        void channel.track(this.presencePayload());
        this.cadence.flush();
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
    // rides on the next state message, sent right away
    this.cadence.flush();
    this.broadcastState(Date.now());
  }

  sendState(state: OutgoingState): void {
    this.localState = state;
    this.localStateAtMs = Date.now();
    const t = state.t ?? this.localStateAtMs;
    this.cadence.setRate(this.getBroadcastHz());
    if (this.cadence.due(t)) {
      this.broadcastState(t);
    }
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
  ): void {
    const fireView: FireView = typeof view === 'number' ? { observedAtMs: view } : view ?? {};
    const shooterT = this.localState?.t ?? Date.now();
    if (this.hostSim) {
      this.hostSim.applyFire(this.localId, origin, dir, fireView.observedAtMs, {
        targetTimes: fireView.targets,
        shooterTimeMs: shooterT,
      });
      this.flushCombat();
      return;
    }
    this.broadcast('fire', {
      id: this.localId,
      origin,
      dir,
      targets: fireView.targets,
      t: shooterT,
    });
  }

  sendReload(): void {
    if (this.hostSim) {
      this.hostSim.applyReload(this.localId);
      return;
    }
    this.broadcast('reload', { id: this.localId });
  }

  sendEquip(weaponId: string): void {
    if (this.hostSim) {
      this.hostSim.applyEquip(this.localId, weaponId);
      return;
    }
    this.broadcast('equip', { id: this.localId, weaponId });
  }

  setRoomContext(context: RoomContext | null): void {
    this.roomContext = context;
    this.updateHostRole();
  }

  private presencePayload(): Record<string, unknown> {
    return {
      id: this.localId,
      name: this.localName,
      model: this.localModel,
    };
  }

  /**
   * Host = lowest id among peers whose tab is visible. Background tabs get
   * their timers throttled to ~1 Hz by the browser, which used to freeze bots
   * and stall combat for everyone while the host was alt-tabbed. Falls back to
   * lowest id overall when nobody is visible.
   */
  private electedHostId(): string | null {
    if (!this.presenceSynced) {
      return null;
    }
    const eligible: string[] = this.isVisible() ? [this.localId] : [];
    const everyone = [this.localId];
    for (const [id, record] of this.remotes) {
      everyone.push(id);
      if (record.hostEligible) eligible.push(id);
    }
    const pool = eligible.length > 0 ? eligible : everyone;
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
      const queue = (event: CombatWireEvent) => this.pendingCombat.push(event);
      const emitter: HostEmitter = {
        hit: (e) => { this.onHit?.(e); queue({ k: 'hit', e }); },
        death: (e) => { this.onDeath?.(e); queue({ k: 'death', e }); },
        health: (e) => { this.onHealth?.(e); queue({ k: 'health', e }); },
        respawn: (e) => { this.onRespawn?.(e); queue({ k: 'respawn', e }); },
        shot: (e) => { this.onShot?.(e); queue({ k: 'shot', e }); },
      };
      this.hostSim = new HostSimulation(
        this.roomContext.collisionWorld,
        this.roomContext.spawn,
        this.roomContext.botCount,
        emitter,
      );
      this.hostLastTickMs = Date.now();
      this.hostAccumulatorMs = 0;
      this.cadence.flush();
    } else if (!shouldHost && this.hostSim) {
      this.stopHost();
    }
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
    const now = Date.now();
    if (this.hostSim) {
      this.tickHost(now);
    }
    const ticking = now - this.localStateAtMs < 250;
    if (ticking) {
      return;
    }
    const interval = this.hostSim ? 1000 / this.getBroadcastHz() : KEEPALIVE_MS;
    if (now - this.lastBroadcastAtMs >= interval) {
      this.broadcastState(now);
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
        combatReady: this.localCombatReady,
        yaw: this.localState.yaw,
        pitch: this.localState.pitch,
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
          combatReady: record.combatReady,
          yaw: record.state.yaw,
          pitch: record.state.pitch,
        });
      }
    }
    this.hostSim.syncHumans(humans);
    let stepped = false;
    while (this.hostAccumulatorMs >= HOST_STEP_MS) {
      this.hostAccumulatorMs -= HOST_STEP_MS;
      this.botRows = this.hostSim.tick(HOST_STEP_MS);
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
    const events = this.pendingCombat;
    this.pendingCombat = [];
    this.broadcast('cb', { host: this.localId, ev: events });
  }

  private broadcastState(t: number): void {
    if (!this.channel || !this.subscribed) {
      return;
    }
    const s = this.localState;
    const payload: WireState = {
      id: this.localId,
      t: Math.round(t),
      s: s ? pack(s.position, s.velocity, s.yaw, s.pitch) : null,
      r: this.localCombatReady ? 1 : 0,
      e: this.isVisible() ? 1 : 0,
    };
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
    this.lastBroadcastAtMs = Date.now();
    this.broadcast('st', payload);
  }

  private broadcast(event: string, payload: unknown): void {
    if (!this.channel) {
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
      record = {
        name: 'Player',
        model: 'terrorist',
        state: null,
        t: null,
        combatReady: false,
        hostEligible: true,
        lastSeen: Date.now(),
      };
      this.remotes.set(p.id, record);
    }
    const wasEligible = record.hostEligible;
    record.lastSeen = Date.now();
    record.combatReady = p.r === 1;
    record.hostEligible = p.e === 1;
    if (Array.isArray(p.s) && p.s.length === 8 && (record.t === null || p.t > record.t)) {
      record.state = unpack(p.s);
      record.t = p.t;
      this.hostSim?.recordHumanSample(p.id, record.state.position, p.t, record.state.velocity);
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
      this.botRowsAt = Date.now();
    }

    if (wasEligible !== record.hostEligible) {
      this.updateHostRole();
    }
    this.emitSnapshot();
  }

  private onCombatBatch(payload: unknown): void {
    const p = payload as { host?: string; ev?: CombatWireEvent[] };
    if (this.hostSim || !Array.isArray(p.ev)) {
      return;
    }
    for (const item of p.ev) {
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

  private onRemoteFire(payload: unknown): void {
    const p = payload as {
      id?: string;
      origin?: [number, number, number];
      dir?: [number, number, number];
      targets?: Record<string, number>;
      t?: number;
    };
    if (this.hostSim && p.id && p.origin && p.dir) {
      this.hostSim.applyFire(p.id, p.origin, p.dir, undefined, {
        targetTimes: sanitizeTargets(p.targets),
        shooterTimeMs: Number.isFinite(p.t) ? p.t : undefined,
      });
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
    }>();
    const present = new Set<string>();
    for (const entries of Object.values(state)) {
      for (const entry of entries) {
        if (entry.id === this.localId) {
          continue;
        }
        present.add(entry.id);
        const existing = this.remotes.get(entry.id);
        this.remotes.set(entry.id, {
          name: entry.name,
          model: entry.model,
          state: existing?.state ?? null,
          t: existing?.t ?? null,
          combatReady: existing?.combatReady ?? false,
          hostEligible: existing?.hostEligible ?? true,
          lastSeen: existing?.lastSeen ?? Date.now(),
        });
      }
    }
    for (const id of [...this.remotes.keys()]) {
      if (!present.has(id)) {
        this.remotes.delete(id);
      }
    }
    this.cadence.setRate(this.getBroadcastHz());
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
    const now = Date.now();
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
      });
    }

    if (now - this.botRowsAt <= PLAYER_STALE_MS) {
      for (const bot of this.botRows) {
        players.push({ ...bot, t: this.botRowsT, clock: this.botRowsClock });
      }
    }

    this.onSnapshot({ mapId: this.activeMapId, players, serverTimeMs: now });
  }
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
