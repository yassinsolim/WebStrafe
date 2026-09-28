import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_REMOTE_LOOKS, MultiplayerClient } from '../MultiplayerClient';
import type { MultiplayerSnapshot } from '../types';
import { defaultLook, encodeLook } from '../../characters/look';

class FakeWebSocket extends EventTarget {
  public static readonly CONNECTING = 0;
  public static readonly OPEN = 1;
  public static readonly CLOSING = 2;
  public static readonly CLOSED = 3;
  public static instances: FakeWebSocket[] = [];

  public readyState = FakeWebSocket.CONNECTING;
  public readonly sent: string[] = [];

  constructor(public readonly url: string) {
    super();
    FakeWebSocket.instances.push(this);
  }

  public open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  public serverMessage(payload: Record<string, unknown>): void {
    const event = new Event('message') as MessageEvent;
    Object.defineProperty(event, 'data', { value: JSON.stringify(payload) });
    this.dispatchEvent(event);
  }

  public send(data: string): void {
    this.sent.push(data);
  }

  public close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new Event('close'));
  }

  /** what the client sent, parsed, minus heartbeat pings */
  public messages(): Array<Record<string, unknown>> {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>).filter((m) => m.type !== 'ping');
  }
}

const lookN = (i: number) => encodeLook({ ...defaultLook(), tag: `W${i}` });
const row = (id: string) => ({
  id,
  name: 'P',
  model: 'terrorist',
  position: [0, 0, 0],
  velocity: [0, 0, 0],
  yaw: 0,
  pitch: 0,
  t: 1,
});

function connect() {
  const client = new MultiplayerClient('ws://test.invalid/ws');
  let last: MultiplayerSnapshot | null = null;
  client.onSnapshot = (snap) => { last = snap; };
  client.connect();
  const socket = FakeWebSocket.instances.at(-1)!;
  return { client, socket, last: () => last };
}

/** opens the socket and answers the join the way the server does */
function enter(socket: FakeWebSocket, mapId = 'map1', id = 'me'): void {
  socket.open();
  socket.serverMessage({ type: 'welcome', id });
  socket.serverMessage({ type: 'joined', id, mapId });
  socket.sent.length = 0;
}

function snapshot(socket: FakeWebSocket, ids: string[], mapId = 'map1'): void {
  socket.serverMessage({ type: 'snapshot', mapId, serverTimeMs: 1, players: ids.map(row) });
}

const rowOf = (snap: MultiplayerSnapshot | null, id: string) => snap?.players.find((p) => p.id === id);

describe('MultiplayerClient looks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    // reconnect and heartbeat timers go through window
    vi.stubGlobal('window', globalThis);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    FakeWebSocket.instances = [];
  });

  it('sends the look with join and leaves it out when there is none', () => {
    const styled = connect();
    styled.client.join('map1', 'Me', 'terrorist', lookN(1));
    styled.socket.open();
    expect(styled.socket.messages()).toEqual([
      { type: 'join', mapId: 'map1', name: 'Me', model: 'terrorist', cosmetics: lookN(1) },
    ]);

    for (const cosmetics of [undefined, '', 'not a look!']) {
      const plain = connect();
      plain.client.join('map1', 'Me', 'terrorist', cosmetics);
      plain.socket.open();
      expect(plain.socket.messages()).toEqual([{ type: 'join', mapId: 'map1', name: 'Me', model: 'terrorist' }]);
      plain.client.disconnect();
    }
    styled.client.disconnect();
  });

  it('sends a cosmetics message instead of a re-join when only the look changes', () => {
    const { client, socket } = connect();
    client.join('map1', 'Me', 'terrorist', lookN(1));
    enter(socket);

    client.join('map1', 'Me', 'terrorist', lookN(2));
    expect(socket.messages()).toEqual([{ type: 'cosmetics', cosmetics: lookN(2) }]);
    socket.sent.length = 0;
    // dropping the look is a look-only change too
    client.join('map1', 'Me', 'terrorist');
    expect(socket.messages()).toEqual([{ type: 'cosmetics' }]);
    socket.sent.length = 0;
    // nothing changed at all: a full join, same as before looks
    client.join('map1', 'Me', 'terrorist');
    expect(socket.messages()).toEqual([{ type: 'join', mapId: 'map1', name: 'Me', model: 'terrorist' }]);
    socket.sent.length = 0;
    // a name, model or map change is a full join that carries the look
    client.join('map1', 'Renamed', 'terrorist', lookN(3));
    client.join('map1', 'Renamed', 'counterterrorist', lookN(3));
    client.join('map2', 'Renamed', 'counterterrorist', lookN(3));
    expect(socket.messages()).toEqual([
      { type: 'join', mapId: 'map1', name: 'Renamed', model: 'terrorist', cosmetics: lookN(3) },
      { type: 'join', mapId: 'map1', name: 'Renamed', model: 'counterterrorist', cosmetics: lookN(3) },
      { type: 'join', mapId: 'map2', name: 'Renamed', model: 'counterterrorist', cosmetics: lookN(3) },
    ]);
    client.disconnect();
  });

  it('puts looks from profile and profiles on matching snapshot rows only', () => {
    const { client, socket, last } = connect();
    client.join('map1', 'Me', 'terrorist', lookN(0));
    enter(socket);
    socket.serverMessage({ type: 'profiles', players: [{ id: 'p2', cosmetics: lookN(2) }, { id: 'p3', cosmetics: lookN(3) }] });
    socket.serverMessage({ type: 'profile', id: 'p4', cosmetics: lookN(4) });
    snapshot(socket, ['me', 'p2', 'p3', 'p4', 'p5', 'bot:0']);
    expect(rowOf(last(), 'me')?.cosmetics).toBe(lookN(0));
    expect(rowOf(last(), 'p2')?.cosmetics).toBe(lookN(2));
    expect(rowOf(last(), 'p3')?.cosmetics).toBe(lookN(3));
    expect(rowOf(last(), 'p4')).toEqual({ ...row('p4'), clock: 'server', cosmetics: lookN(4) });
    expect(rowOf(last(), 'p5')).toEqual({ ...row('p5'), clock: 'server' });
    expect(rowOf(last(), 'bot:0')).not.toHaveProperty('cosmetics');

    // a profile with the look missing or empty drops it
    socket.serverMessage({ type: 'profile', id: 'p2' });
    socket.serverMessage({ type: 'profile', id: 'p3', cosmetics: '' });
    socket.serverMessage({ type: 'profile', id: 'p4', cosmetics: lookN(5) });
    snapshot(socket, ['p2', 'p3', 'p4']);
    expect(rowOf(last(), 'p2')).not.toHaveProperty('cosmetics');
    expect(rowOf(last(), 'p3')).not.toHaveProperty('cosmetics');
    expect(rowOf(last(), 'p4')?.cosmetics).toBe(lookN(5));
    client.disconnect();
  });

  it('ignores invalid looks from the server, including one on a snapshot row', () => {
    const { client, socket, last } = connect();
    client.join('map1', 'Me', 'terrorist');
    enter(socket);
    socket.serverMessage({ type: 'profile', id: 'p2', cosmetics: lookN(2) });
    for (const cosmetics of [42, true, 'has spaces', '<b>', 'x'.repeat(97), { wire: lookN(9) }]) {
      socket.serverMessage({ type: 'profile', id: 'p2', cosmetics });
      socket.serverMessage({ type: 'profile', id: 'p3', cosmetics });
    }
    socket.serverMessage({ type: 'profile', id: 42, cosmetics: lookN(6) });
    socket.serverMessage({
      type: 'profiles',
      players: [null, 7, 'p5', { id: 5, cosmetics: lookN(7) }, { id: 'p6', cosmetics: 'no good' }, { id: 'p7' }],
    });
    socket.serverMessage({ type: 'profiles', players: 'nope' });
    socket.serverMessage({
      type: 'snapshot',
      mapId: 'map1',
      serverTimeMs: 1,
      players: [...['me', 'p2', 'p3', 'p5', 'p6', 'p7'].map(row), { ...row('p8'), cosmetics: lookN(8) }],
    });

    // the good look survived the junk after it
    expect(rowOf(last(), 'p2')?.cosmetics).toBe(lookN(2));
    for (const id of ['me', 'p3', 'p5', 'p6', 'p7', 'p8']) {
      expect(rowOf(last(), id), id).toBeDefined();
      expect(rowOf(last(), id), id).not.toHaveProperty('cosmetics');
    }
    client.disconnect();
  });

  it('forgets looks when the joined map changes and on reconnect', () => {
    const { client, socket, last } = connect();
    client.join('map1', 'Me', 'terrorist', lookN(0));
    enter(socket);
    socket.serverMessage({ type: 'profile', id: 'p2', cosmetics: lookN(2) });
    // a re-join on the same map keeps them
    socket.serverMessage({ type: 'joined', id: 'me', mapId: 'map1' });
    snapshot(socket, ['p2']);
    expect(rowOf(last(), 'p2')?.cosmetics).toBe(lookN(2));

    client.join('map2', 'Me', 'terrorist', lookN(0));
    socket.serverMessage({ type: 'joined', id: 'me', mapId: 'map2' });
    snapshot(socket, ['p2'], 'map2');
    expect(rowOf(last(), 'p2')).not.toHaveProperty('cosmetics');

    socket.serverMessage({ type: 'profile', id: 'p3', cosmetics: lookN(3) });
    expect((client as any).remoteLooks.size).toBe(1);
    socket.close();
    expect((client as any).remoteLooks.size).toBe(0);
    vi.advanceTimersByTime(1500);
    const next = FakeWebSocket.instances.at(-1)!;
    expect(next).not.toBe(socket);
    next.open();
    expect(next.messages()).toEqual([
      { type: 'join', mapId: 'map2', name: 'Me', model: 'terrorist', cosmetics: lookN(0) },
    ]);
    next.serverMessage({ type: 'welcome', id: 'me2' });
    next.serverMessage({ type: 'joined', id: 'me2', mapId: 'map2' });
    snapshot(next, ['me2', 'p3'], 'map2');
    expect(rowOf(last(), 'p3')).not.toHaveProperty('cosmetics');
    expect(rowOf(last(), 'me2')?.cosmetics).toBe(lookN(0));
    client.disconnect();
  });

  it(`keeps at most ${MAX_REMOTE_LOOKS} looks and drops the one unchanged longest`, () => {
    const { client, socket, last } = connect();
    client.join('map1', 'Me', 'terrorist');
    enter(socket);
    const ids = Array.from({ length: MAX_REMOTE_LOOKS }, (_, i) => `p${i}`);
    for (const [i, id] of ids.entries()) socket.serverMessage({ type: 'profile', id, cosmetics: lookN(i) });
    // p0 changes its look, so p1 becomes the oldest and goes when a new one arrives
    socket.serverMessage({ type: 'profile', id: 'p0', cosmetics: lookN(100) });
    socket.serverMessage({ type: 'profile', id: 'new', cosmetics: lookN(101) });
    snapshot(socket, [...ids, 'new']);
    expect(rowOf(last(), 'p0')?.cosmetics).toBe(lookN(100));
    expect(rowOf(last(), 'p1')).not.toHaveProperty('cosmetics');
    expect(rowOf(last(), 'p2')?.cosmetics).toBe(lookN(2));
    expect(rowOf(last(), 'new')?.cosmetics).toBe(lookN(101));
    expect(last()!.players.filter((p) => p.cosmetics)).toHaveLength(MAX_REMOTE_LOOKS);
    client.disconnect();
  });
});
