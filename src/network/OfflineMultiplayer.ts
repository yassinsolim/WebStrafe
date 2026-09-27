import type { MultiplayerTransport } from './MultiplayerTransport';

/**
 * a transport that never connects. screenshot and perf runs (?shot= without
 * qa) use it so capture tools never show up in anyone's room.
 */
export class OfflineMultiplayer implements MultiplayerTransport {
  onSnapshot: MultiplayerTransport['onSnapshot'] = null;
  onAttack: MultiplayerTransport['onAttack'] = null;
  onHit: MultiplayerTransport['onHit'] = null;
  onDeath: MultiplayerTransport['onDeath'] = null;
  onHealth: MultiplayerTransport['onHealth'] = null;
  onRespawn: MultiplayerTransport['onRespawn'] = null;
  onShot: MultiplayerTransport['onShot'] = null;
  onConnectedChange: MultiplayerTransport['onConnectedChange'] = null;
  private mapId = '';

  connect(): void {}
  disconnect(): void {}
  getLocalId(): string | null {
    return 'offline';
  }
  getActiveMapId(): string {
    return this.mapId;
  }
  join(mapId: string): void {
    this.mapId = mapId;
  }
  setCombatReady(): void {}
  sendState(): void {}
  sendAttack(): void {}
  sendFire(): void {}
  sendReload(): void {}
  sendEquip(): void {}
  setRoomContext(): void {}
}
