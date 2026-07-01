import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { AttackKind, MultiplayerSnapshot, MultiplayerSnapshotPlayer, PlayerModel } from './types';
import type {
  AttackEvent,
  DeathEvent,
  HealthEvent,
  HitEvent,
  MultiplayerTransport,
  OutgoingState,
  RespawnEvent,
  ShotEvent,
} from './MultiplayerTransport';
import type { SupabaseConfig } from './supabaseConfig';

const SESSION_KEY = 'webstrafe:session-id:v1';
const STATE_BROADCAST_HZ = 20;
const SNAPSHOT_HZ = 20;
const PLAYER_STALE_MS = 8000;

interface RemoteRecord {
  name: string;
  model: PlayerModel;
  state: OutgoingState | null;
  lastSeen: number;
}

/**
 * Serverless multiplayer over Supabase Realtime — the same pattern the
 * Nordschleife racer uses. Players share a channel per map; presence tracks the
 * roster and a broadcast carries each player's position. Assembles a
 * {@link MultiplayerSnapshot} locally at a fixed rate so the rest of the game is
 * transport-agnostic. Combat/bot events (host-authoritative) layer on top.
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
  private activeMapId = '';
  private localName = '';
  private localModel: PlayerModel = 'terrorist';
  private localState: OutgoingState | null = null;
  private readonly remotes = new Map<string, RemoteRecord>();
  private stateTimer: ReturnType<typeof setInterval> | null = null;
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly client: SupabaseClient,
    private readonly config: SupabaseConfig,
  ) {
    this.localId = loadSessionId();
  }

  connect(): void {
    // Connection is established lazily on join (the channel per map).
  }

  disconnect(): void {
    this.stopTimers();
    if (this.channel) {
      void this.client.removeChannel(this.channel);
      this.channel = null;
    }
    this.remotes.clear();
    this.onConnectedChange?.(false);
  }

  getLocalId(): string | null {
    return this.localId;
  }

  getActiveMapId(): string {
    return this.activeMapId;
  }

  join(mapId: string, name: string, model: PlayerModel): void {
    this.localName = name;
    this.localModel = model;

    // Same map: just refresh our presence profile.
    if (this.channel && mapId === this.activeMapId) {
      void this.channel.track(this.presencePayload());
      return;
    }

    // Different map: tear down and open a fresh channel.
    if (this.channel) {
      void this.client.removeChannel(this.channel);
      this.channel = null;
    }
    this.remotes.clear();
    this.activeMapId = mapId;

    const channel = this.client.channel(`${this.config.lobbyChannelPrefix}_${mapId}`, {
      config: { presence: { key: this.localId }, broadcast: { self: false } },
    });
    this.channel = channel;

    channel.on('presence', { event: 'sync' }, () => this.syncPresence());
    channel.on('broadcast', { event: 'state' }, ({ payload }) => this.onRemoteState(payload));
    channel.on('broadcast', { event: 'attack' }, ({ payload }) => this.onRemoteAttack(payload));

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        void channel.track(this.presencePayload());
        this.startTimers();
        this.onConnectedChange?.(true);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        this.onConnectedChange?.(false);
      }
    });
  }

  sendState(state: OutgoingState): void {
    this.localState = state;
  }

  sendAttack(kind: AttackKind): void {
    void this.channel?.send({
      type: 'broadcast',
      event: 'attack',
      payload: { id: this.localId, mapId: this.activeMapId, kind },
    });
  }

  // Combat sends are relayed for the host-authoritative layer (PR: host bots).
  sendFire(origin: [number, number, number], dir: [number, number, number]): void {
    void this.channel?.send({
      type: 'broadcast',
      event: 'fire',
      payload: { id: this.localId, origin, dir },
    });
  }

  sendReload(): void {
    void this.channel?.send({ type: 'broadcast', event: 'reload', payload: { id: this.localId } });
  }

  sendEquip(weaponId: string): void {
    void this.channel?.send({ type: 'broadcast', event: 'equip', payload: { id: this.localId, weaponId } });
  }

  private presencePayload(): Record<string, unknown> {
    return { id: this.localId, name: this.localName, model: this.localModel };
  }

  private syncPresence(): void {
    if (!this.channel) {
      return;
    }
    const state = this.channel.presenceState<{ id: string; name: string; model: PlayerModel }>();
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
          lastSeen: existing?.lastSeen ?? Date.now(),
        });
      }
    }
    for (const id of [...this.remotes.keys()]) {
      if (!present.has(id)) {
        this.remotes.delete(id);
      }
    }
  }

  private onRemoteState(payload: unknown): void {
    const p = payload as { id?: string; state?: OutgoingState };
    if (!p.id || p.id === this.localId || !p.state) {
      return;
    }
    const record = this.remotes.get(p.id);
    if (record) {
      record.state = p.state;
      record.lastSeen = Date.now();
    }
  }

  private onRemoteAttack(payload: unknown): void {
    const p = payload as { id?: string; mapId?: string; kind?: AttackKind };
    if (!p.id || p.id === this.localId || !p.kind) {
      return;
    }
    this.onAttack?.({ mapId: p.mapId ?? this.activeMapId, playerId: p.id, kind: p.kind });
  }

  private startTimers(): void {
    this.stopTimers();
    this.stateTimer = setInterval(() => {
      if (this.channel && this.localState) {
        void this.channel.send({
          type: 'broadcast',
          event: 'state',
          payload: { id: this.localId, state: this.localState },
        });
      }
    }, Math.round(1000 / STATE_BROADCAST_HZ));

    this.snapshotTimer = setInterval(() => this.emitSnapshot(), Math.round(1000 / SNAPSHOT_HZ));
  }

  private stopTimers(): void {
    if (this.stateTimer) {
      clearInterval(this.stateTimer);
      this.stateTimer = null;
    }
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
  }

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
      });
    }

    this.onSnapshot({ mapId: this.activeMapId, players, serverTimeMs: now });
  }
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
