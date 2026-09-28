export type PlayerModel = 'terrorist' | 'counterterrorist';
export type AttackKind = 'primary' | 'secondary';

export interface LeaderboardEntry {
  id: string;
  mapId: string;
  name: string;
  timeMs: number;
  model: PlayerModel;
  createdAt: string;
}

export interface MultiplayerSnapshotPlayer {
  id: string;
  name: string;
  model: PlayerModel;
  position: [number, number, number];
  velocity: [number, number, number];
  yaw: number;
  pitch: number;
  health?: number;
  alive?: boolean;
  /** Sample time in the authority clock named by `clock`, ms. */
  t?: number;
  /** Which clock `t` is in: 'server', or the sending peer id in Supabase mode. */
  clock?: string;
  /**
   * look wire string (characters/look.ts), humans only. comes from presence or
   * profile messages, never from state, and is left out when unknown
   */
  cosmetics?: string;
}

export interface MultiplayerSnapshot {
  mapId: string;
  players: MultiplayerSnapshotPlayer[];
  serverTimeMs: number;
}
