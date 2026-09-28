import type { PlayerCosmetics } from './cosmetics';
import type { AttackKind, MultiplayerSnapshot, PlayerModel } from './types';
import type { CollisionWorld } from '../world/CollisionWorld';
import type { HostSpawn } from './HostSimulation';

export interface OutgoingState {
  position: [number, number, number];
  velocity: [number, number, number];
  yaw: number;
  pitch: number;
  /** Wall-clock (Date.now) time of the sim tick this state came from. */
  t?: number;
  /** 0 standing, 1 fully crouched; sizes the hit capsule on the authority */
  duck?: number;
}

/**
 * What the shooter was looking at when it fired. `targets` maps each remote
 * id to the source-clock time of the pose that was on screen; the authority
 * rewinds each target to that time. `observedAtMs` is the server-clock
 * fallback for authorities that only understand one timestamp.
 */
export interface FireView {
  targets?: Record<string, number>;
  observedAtMs?: number;
  /** rounds in the shooter's magazine before this shot (lets the host self-correct) */
  ammo?: number;
}

/** Per-map context the elected host needs to run the bot/combat simulation. */
export interface RoomContext {
  collisionWorld: CollisionWorld;
  spawn: HostSpawn;
  botCount: number;
}

export interface AttackEvent {
  mapId: string;
  playerId: string;
  kind: AttackKind;
}

export interface HitEvent {
  shooterId: string;
  targetId: string;
  weaponId: string;
  damage: number;
  hitbox: 'body' | 'head';
  killed: boolean;
  /** knife attack kind, on knife hits */
  melee?: AttackKind;
  /** knife hit from behind */
  backstab?: boolean;
}

export interface DeathEvent {
  victimId: string;
  killerId: string;
  weaponId: string;
  headshot: boolean;
}

export interface HealthEvent {
  playerId: string;
  health: number;
  alive: boolean;
}

export interface RespawnEvent {
  playerId: string;
  position: [number, number, number];
}

export type ShotResult = 'miss' | 'hit' | 'kill';

export interface ShotEvent {
  /** Monotonic authority-local order for deterministic delivery and diagnostics. */
  sequence: number;
  /** Whether this accepted round missed, damaged, or killed a player. */
  result: ShotResult;
  playerId: string;
  /** Authoritative victim for hit/kill cues; absent for misses and wall hits. */
  targetId?: string;
  origin: [number, number, number];
  dir: [number, number, number];
  weaponId: string;
  /** Server-resolved player endpoint. World misses remain client-raycast. */
  endpoint?: [number, number, number];
  /** Surface/player-facing normal for the endpoint effect. */
  impactNormal?: [number, number, number];
}

/**
 * The multiplayer surface GameApp depends on. Implemented by both the
 * self-hosted WebSocket client ({@link MultiplayerClient}) and the serverless
 * Supabase Realtime transport ({@link SupabaseMultiplayer}), so the game can use
 * either interchangeably.
 */
export interface MultiplayerTransport {
  onSnapshot: ((snapshot: MultiplayerSnapshot) => void) | null;
  onAttack: ((event: AttackEvent) => void) | null;
  onHit: ((event: HitEvent) => void) | null;
  onDeath: ((event: DeathEvent) => void) | null;
  onHealth: ((event: HealthEvent) => void) | null;
  onRespawn: ((event: RespawnEvent) => void) | null;
  onShot: ((event: ShotEvent) => void) | null;
  onConnectedChange: ((connected: boolean) => void) | null;
  /** set by transports with a room size limit; fired when this client was turned away */
  onRoomFull?: (() => void) | null;

  connect(): void;
  disconnect(): void;
  getLocalId(): string | null;
  getActiveMapId(): string;
  join(mapId: string, name: string, model: PlayerModel): void;
  /** Marks pointer-locked active play; false removes the player from bot targets. */
  setCombatReady(ready: boolean): void;
  /** Called every fixed sim tick; the transport decides which ticks to send. */
  sendState(state: OutgoingState): void;
  sendAttack(kind: AttackKind): void;
  /**
   * `melee` marks a knife swing (primary slash or secondary stab). Omitted for
   * guns; authorities that predate it treat a knife fire as a slash.
   */
  sendFire(
    origin: [number, number, number],
    dir: [number, number, number],
    view?: FireView | number,
    melee?: AttackKind,
  ): void;
  sendReload(): void;
  sendEquip(weaponId: string): void;
  /** Provides (or clears) the host-simulation context for the active map. */
  setRoomContext(context: RoomContext | null): void;
  /** Smoothed round trip to the authority in ms, null when not measured. */
  getPingMs?(): number | null;
  /** knife, finish and armour choices shown to other players */
  setCosmetics?(cosmetics: PlayerCosmetics | null): void;
  /** peer-hosted transports: whether this client runs the host simulation */
  isHosting?(): boolean;
}
