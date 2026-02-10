import type { AttackKind, MultiplayerSnapshot, PlayerModel } from './types';

interface DesiredJoin {
  mapId: string;
  name: string;
  model: PlayerModel;
}

interface OutgoingState {
  position: [number, number, number];
  velocity: [number, number, number];
  yaw: number;
  pitch: number;
}

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private reconnectHandle: number | null = null;
  private heartbeatHandle: number | null = null;
  private shouldReconnect = true;
  private readonly url: string;

  private desiredJoin: DesiredJoin | null = null;
  private localId: string | null = null;
  private activeMapId = '';

  public onSnapshot: ((snapshot: MultiplayerSnapshot) => void) | null = null;
  public onAttack: ((event: { mapId: string; playerId: string; kind: AttackKind }) => void) | null = null;
  public onConnectedChange: ((connected: boolean) => void) | null = null;

  constructor(url = buildDefaultWsUrl()) {
    this.url = url;
  }

  public connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.shouldReconnect = true;
    this.openSocket();
  }

  public disconnect(): void {
    this.shouldReconnect = false;
    this.clearReconnect();
    this.clearHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setConnected(false);
  }

  public getLocalId(): string | null {
    return this.localId;
  }

  public getActiveMapId(): string {
    return this.activeMapId;
  }

  public join(mapId: string, name: string, model: PlayerModel): void {
    this.desiredJoin = {
      mapId,
      name,
      model,
    };

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendJoin();
      return;
    }

    this.connect();
  }

  public sendState(state: OutgoingState): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    if (!this.localId || !this.desiredJoin) {
      return;
    }

    this.send({
      type: 'state',
      position: state.position,
      velocity: state.velocity,
      yaw: state.yaw,
      pitch: state.pitch,
    });
  }

  public sendAttack(kind: AttackKind): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    if (!this.localId || !this.desiredJoin) {
      return;
    }

    this.send({
      type: 'attack',
      kind,
    });
  }

  private openSocket(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.setConnected(true);
      this.clearReconnect();
      this.startHeartbeat();
      this.sendJoin();
    });

    ws.addEventListener('close', () => {
      this.setConnected(false);
      this.clearHeartbeat();
      this.localId = null;
      this.activeMapId = '';

      if (this.ws === ws) {
        this.ws = null;
      }

      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    });

    ws.addEventListener('error', () => {
      // no-op: close event handles reconnect path
    });

    ws.addEventListener('message', (event) => {
      const payload = this.parseMessage(event.data);
      if (!payload || typeof payload.type !== 'string') {
        return;
      }

      switch (payload.type) {
        case 'welcome': {
          if (typeof payload.id === 'string') {
            this.localId = payload.id;
          }
          break;
        }
        case 'joined': {
          if (typeof payload.mapId === 'string') {
            this.activeMapId = payload.mapId;
          }
          break;
        }
        case 'snapshot': {
          if (!Array.isArray(payload.players) || typeof payload.mapId !== 'string') {
            return;
          }
          const players = payload.players.filter((entry): entry is MultiplayerSnapshot['players'][number] => {
            if (!entry || typeof entry !== 'object') {
              return false;
            }

            const casted = entry as Record<string, unknown>;
            if (typeof casted.id !== 'string' || typeof casted.name !== 'string') {
              return false;
            }
            if (casted.model !== 'terrorist' && casted.model !== 'counterterrorist') {
              return false;
            }
            if (!isVec3(casted.position) || !isVec3(casted.velocity)) {
              return false;
            }
            if (typeof casted.yaw !== 'number' || typeof casted.pitch !== 'number') {
              return false;
            }
            return true;
          });

          this.onSnapshot?.({
            mapId: payload.mapId,
            players,
            serverTimeMs: typeof payload.serverTimeMs === 'number' ? payload.serverTimeMs : Date.now(),
          });
          break;
        }
        case 'attack': {
          if (typeof payload.mapId !== 'string' || typeof payload.playerId !== 'string') {
            return;
          }
          if (payload.kind !== 'primary' && payload.kind !== 'secondary') {
            return;
          }
          this.onAttack?.({
            mapId: payload.mapId,
            playerId: payload.playerId,
            kind: payload.kind,
          });
          break;
        }
        case 'error': {
          // eslint-disable-next-line no-console
          console.warn('[Multiplayer] server error:', payload.reason ?? 'unknown');
          break;
        }
        default:
          break;
      }
    });
  }

  private sendJoin(): void {
    if (!this.desiredJoin || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.send({
      type: 'join',
      mapId: this.desiredJoin.mapId,
      name: this.desiredJoin.name,
      model: this.desiredJoin.model,
    });
  }

  private send(payload: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ws.send(JSON.stringify(payload));
  }

  private parseMessage(raw: unknown): Record<string, unknown> | null {
    if (typeof raw !== 'string') {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectHandle !== null) {
      return;
    }
    this.reconnectHandle = window.setTimeout(() => {
      this.reconnectHandle = null;
      if (!this.shouldReconnect) {
        return;
      }
      this.openSocket();
    }, 1500);
  }

  private clearReconnect(): void {
    if (this.reconnectHandle === null) {
      return;
    }
    window.clearTimeout(this.reconnectHandle);
    this.reconnectHandle = null;
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatHandle = window.setInterval(() => {
      this.send({ type: 'ping' });
    }, 5000);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatHandle === null) {
      return;
    }
    window.clearInterval(this.heartbeatHandle);
    this.heartbeatHandle = null;
  }

  private setConnected(next: boolean): void {
    this.onConnectedChange?.(next);
  }
}

function buildDefaultWsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

function isVec3(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value)
    && value.length === 3
    && typeof value[0] === 'number'
    && typeof value[1] === 'number'
    && typeof value[2] === 'number'
  );
}
