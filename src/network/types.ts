export type PlayerModel = 'terrorist' | 'counterterrorist';

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
}

export interface MultiplayerSnapshot {
  mapId: string;
  players: MultiplayerSnapshotPlayer[];
  serverTimeMs: number;
}
