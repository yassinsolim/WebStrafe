import type { AttackKind, MultiplayerSnapshot, PlayerModel } from './types';
import type { CollisionWorld } from '../world/CollisionWorld';
import type { HostSpawn } from './HostSimulation';

export interface OutgoingState {
  position: [number, number, number];
  velocity: [number, number, number];
  yaw: number;
  pitch: number;
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
  hitbox: string;
}

export interface DeathEvent {
  victimId: string;
  killerId: string;
  weaponId: string;
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

export interface ShotEvent {
  playerId: string;
  origin: [number, number, number];
  dir: [number, number, number];
  weaponId: string;
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

  connect(): void;
  disconnect(): void;
  getLocalId(): string | null;
  getActiveMapId(): string;
  join(mapId: string, name: string, model: PlayerModel): void;
  sendState(state: OutgoingState): void;
  sendAttack(kind: AttackKind): void;
  sendFire(origin: [number, number, number], dir: [number, number, number]): void;
  sendReload(): void;
  sendEquip(weaponId: string): void;
  /** Provides (or clears) the host-simulation context for the active map. */
  setRoomContext(context: RoomContext | null): void;
}
