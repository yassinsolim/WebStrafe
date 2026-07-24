import type { AttackKind, MultiplayerSnapshot, PlayerModel } from './types';
import { resolveWsUrl } from './endpoints';
import type {
  MultiplayerTransport,
  OutgoingState,
  ShotEvent,
} from './MultiplayerTransport';

interface DesiredJoin {
  mapId: string;
  name: string;
  model: PlayerModel;
}

export class MultiplayerClient implements MultiplayerTransport {
  private ws: WebSocket | null = null;
  private reconnectHandle: number | null = null;
  private heartbeatHandle: number | null = null;
  private shouldReconnect = true;
  private readonly url: string;

  private desiredJoin: DesiredJoin | null = null;
  private localId: string | null = null;
  private activeMapId = '';
  private combatReady = false;
  private latestSnapshotServerTimeMs: number | null = null;

  public onSnapshot: ((snapshot: MultiplayerSnapshot) => void) | null = null;
  public onAttack: ((event: { mapId: string; playerId: string; kind: AttackKind }) => void) | null = null;
  public onHit:
    | ((event: { shooterId: string; targetId: string; weaponId: string; damage: number; hitbox: string; killed: boolean }) => void)
    | null = null;
  public onDeath:
    | ((event: { victimId: string; killerId: string; weaponId: string; headshot: boolean }) => void)
    | null = null;
  public onHealth: ((event: { playerId: string; health: number; alive: boolean }) => void) | null = null;
  public onRespawn: ((event: { playerId: string; position: [number, number, number] }) => void) | null = null;
  public onShot: ((event: ShotEvent) => void) | null = null;
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

  public setCombatReady(ready: boolean): void {
    this.combatReady = ready;
    if (this.activeMapId && this.localId) {
      this.send({ type: 'combat-ready', ready });
    }
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

  public sendFire(
    origin: [number, number, number],
    dir: [number, number, number],
    observedAtMs?: number,
  ): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    if (!this.localId || !this.desiredJoin) {
      return;
    }
    this.send({
      type: 'fire',
      origin,
      dir,
      observedAtMs: observedAtMs ?? this.latestSnapshotServerTimeMs,
    });
  }

  public sendReload(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.localId) {
      return;
    }
    this.send({ type: 'reload' });
  }

  public sendEquip(weaponId: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.localId) {
      return;
    }
    this.send({ type: 'equip', weaponId });
  }

  // The WebSocket server runs its own authoritative sim; no client host role.
  public setRoomContext(): void {
    // no-op
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
            this.send({ type: 'combat-ready', ready: this.combatReady });
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

          const serverTimeMs = typeof payload.serverTimeMs === 'number'
            ? payload.serverTimeMs
            : Date.now();
          this.latestSnapshotServerTimeMs = serverTimeMs;
          this.onSnapshot?.({
            mapId: payload.mapId,
            players,
            serverTimeMs,
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
        case 'hit': {
          if (
            typeof payload.shooterId === 'string' &&
            typeof payload.targetId === 'string' &&
            typeof payload.weaponId === 'string' &&
            typeof payload.damage === 'number' &&
            (payload.hitbox === 'body' || payload.hitbox === 'head') &&
            typeof payload.killed === 'boolean'
          ) {
            this.onHit?.({
              shooterId: payload.shooterId,
              targetId: payload.targetId,
              weaponId: payload.weaponId,
              damage: payload.damage,
              hitbox: payload.hitbox,
              killed: payload.killed,
            });
          }
          break;
        }
        case 'death': {
          if (
            typeof payload.victimId === 'string' &&
            typeof payload.killerId === 'string' &&
            typeof payload.weaponId === 'string' &&
            typeof payload.headshot === 'boolean'
          ) {
            this.onDeath?.({
              victimId: payload.victimId,
              killerId: payload.killerId,
              weaponId: payload.weaponId,
              headshot: payload.headshot,
            });
          }
          break;
        }
        case 'health': {
          if (
            typeof payload.playerId === 'string' &&
            typeof payload.health === 'number' &&
            typeof payload.alive === 'boolean'
          ) {
            this.onHealth?.({
              playerId: payload.playerId,
              health: payload.health,
              alive: payload.alive,
            });
          }
          break;
        }
        case 'respawn': {
          if (typeof payload.playerId === 'string' && isVec3(payload.position)) {
            this.onRespawn?.({ playerId: payload.playerId, position: payload.position });
          }
          break;
        }
        case 'shot': {
          if (
            typeof payload.sequence === 'number' &&
            Number.isSafeInteger(payload.sequence) &&
            payload.sequence > 0 &&
            (payload.result === 'miss' || payload.result === 'hit' || payload.result === 'kill') &&
            typeof payload.playerId === 'string' &&
            typeof payload.weaponId === 'string' &&
            isVec3(payload.origin) &&
            isVec3(payload.dir)
          ) {
            this.onShot?.({
              sequence: payload.sequence,
              result: payload.result,
              playerId: payload.playerId,
              targetId: typeof payload.targetId === 'string'
                ? payload.targetId
                : undefined,
              origin: payload.origin,
              dir: payload.dir,
              weaponId: payload.weaponId,
              endpoint: isVec3(payload.endpoint) ? payload.endpoint : undefined,
              impactNormal: isVec3(payload.impactNormal)
                ? payload.impactNormal
                : undefined,
            });
          }
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
  return resolveWsUrl(import.meta.env, window.location);
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
