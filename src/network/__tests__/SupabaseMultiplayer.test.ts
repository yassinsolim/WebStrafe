import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseMultiplayer } from '../SupabaseMultiplayer';
import type { MultiplayerSnapshot } from '../types';
import { CollisionWorld } from '../../world/CollisionWorld';
import { SUPABASE_FREE_EVENTS_PER_SEC } from '../../netcode/RateBudget';

// in-memory stand-in for supabase realtime: broadcast (self: false) + presence,
// with a counter that bills events the way supabase does (sent + each delivery)
class FakeBus {
  readonly topics = new Map<string, Set<FakeChannel>>();
  events = 0;
  readonly byEvent = new Map<string, number>();

  join(ch: FakeChannel): void {
    const set = this.topics.get(ch.topic) ?? new Set();
    set.add(ch);
    this.topics.set(ch.topic, set);
  }

  leave(ch: FakeChannel): void {
    this.topics.get(ch.topic)?.delete(ch);
    this.syncPresence(ch.topic);
  }

  syncPresence(topic: string): void {
    for (const ch of this.topics.get(topic) ?? []) ch.emit('presence', 'sync', {});
  }

  broadcast(from: FakeChannel, event: string, payload: unknown): void {
    this.events += 1;
    this.byEvent.set(event, (this.byEvent.get(event) ?? 0) + 1);
    for (const ch of this.topics.get(from.topic) ?? []) {
      if (ch === from) continue;
      this.events += 1;
      ch.emit('broadcast', event, { event, payload });
    }
  }
}

class FakeChannel {
  presence: Record<string, unknown> | null = null;
  private readonly handlers: Array<{ type: string; event: string; cb: (arg: any) => void }> = [];

  constructor(private readonly bus: FakeBus, readonly topic: string, readonly key: string) {}

  on(type: string, filter: { event?: string }, cb: (arg: any) => void): this {
    this.handlers.push({ type, event: filter.event ?? '*', cb });
    return this;
  }

  emit(type: string, event: string, arg: unknown): void {
    for (const h of this.handlers) {
      if (h.type === type && (h.event === event || h.event === '*')) h.cb(arg);
    }
  }

  subscribe(cb: (status: string) => void): this {
    this.bus.join(this);
    cb('SUBSCRIBED');
    return this;
  }

  track(payload: Record<string, unknown>): Promise<string> {
    this.presence = payload;
    this.bus.syncPresence(this.topic);
    return Promise.resolve('ok');
  }

  presenceState(): Record<string, unknown[]> {
    const out: Record<string, unknown[]> = {};
    for (const ch of this.bus.topics.get(this.topic) ?? []) {
      if (ch.presence) out[ch.key] = [ch.presence];
    }
    return out;
  }

  send(msg: { event: string; payload: unknown }): Promise<string> {
    this.bus.broadcast(this, msg.event, msg.payload);
    return Promise.resolve('ok');
  }
}

function fakeClient(bus: FakeBus): SupabaseClient {
  return {
    channel: (topic: string, opts: { config: { presence: { key: string } } }) =>
      new FakeChannel(bus, topic, opts.config.presence.key),
    removeChannel: (ch: FakeChannel) => {
      bus.leave(ch);
      return Promise.resolve('ok');
    },
  } as unknown as SupabaseClient;
}

const config = {
  supabaseUrl: 'https://x.supabase.co',
  supabaseKey: 'k',
  leaderboardTable: 't',
  lobbyChannelPrefix: 'test_room',
};

function makePeer(bus: FakeBus, id: string, visible = () => true): SupabaseMultiplayer {
  return new SupabaseMultiplayer(fakeClient(bus), config, { sessionId: id, isVisible: visible });
}

/** drives one peer like GameApp does: a state every 128 Hz tick */
function tickAll(peers: SupabaseMultiplayer[], ms: number): void {
  const step = 1000 / 128;
  for (let t = 0; t < ms; t += step) {
    vi.advanceTimersByTime(step);
    const now = Date.now();
    for (const [i, p] of peers.entries()) {
      p.sendState({ position: [i, 0, now / 1000], velocity: [0, 0, 1], yaw: 0, pitch: 0, t: now });
    }
  }
}

describe('SupabaseMultiplayer (p2 protocol)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a 3 player room with bots under the free-plan event cap', () => {
    const bus = new FakeBus();
    const peers = ['p_a', 'p_b', 'p_c'].map((id) => makePeer(bus, id));
    for (const p of peers) {
      p.join('map1', 'Player', 'terrorist');
      p.setRoomContext({
        collisionWorld: new CollisionWorld(),
        spawn: { position: new Vector3(0, 0, 0), yawDeg: 0 },
        botCount: 1,
      });
      p.setCombatReady(true);
    }
    tickAll(peers, 1000);
    bus.events = 0;
    bus.byEvent.clear();
    tickAll(peers, 5000);
    const perSec = bus.events / 5;
    expect(perSec).toBeLessThan(SUPABASE_FREE_EVENTS_PER_SEC);
    // bots ride on the host's state message, there is no separate bot stream
    expect(bus.byEvent.has('botstate')).toBe(false);
    for (const p of peers) p.disconnect();
  });

  it('delivers bot rows and timestamped player rows to non-hosts', () => {
    const bus = new FakeBus();
    const host = makePeer(bus, 'p_a');
    const guest = makePeer(bus, 'p_b');
    let last: MultiplayerSnapshot | null = null;
    guest.onSnapshot = (s) => { last = s; };
    for (const p of [host, guest]) {
      p.join('map1', 'Player', 'terrorist');
      p.setRoomContext({
        collisionWorld: new CollisionWorld(),
        spawn: { position: new Vector3(0, 0, 0), yawDeg: 0 },
        botCount: 1,
      });
    }
    tickAll([host, guest], 1000);
    const snap = last as MultiplayerSnapshot | null;
    expect(snap).not.toBeNull();
    const bot = snap!.players.find((p) => p.id.startsWith('bot:'));
    const hostRow = snap!.players.find((p) => p.id === 'p_a');
    expect(bot?.clock).toBe('p_a');
    expect(typeof bot?.t).toBe('number');
    expect(hostRow?.clock).toBe('p_a');
    expect(typeof hostRow?.t).toBe('number');
    host.disconnect();
    guest.disconnect();
  });

  it('hands hosting to a visible peer when the lowest id tab is hidden', () => {
    const bus = new FakeBus();
    let aVisible = true;
    const a = makePeer(bus, 'p_a', () => aVisible);
    const b = makePeer(bus, 'p_b');
    const ctx = {
      collisionWorld: new CollisionWorld(),
      spawn: { position: new Vector3(0, 0, 0), yawDeg: 0 },
      botCount: 1,
    };
    for (const p of [a, b]) {
      p.join('map1', 'Player', 'terrorist');
      p.setRoomContext(ctx);
    }
    tickAll([a, b], 500);
    const isHost = (p: SupabaseMultiplayer) => (p as unknown as { hostSim: unknown }).hostSim !== null;
    expect(isHost(a)).toBe(true);
    expect(isHost(b)).toBe(false);

    aVisible = false;
    // the hidden tab still sends 1 Hz keepalives carrying e=0
    tickAll([b], 1500);
    (a as unknown as { updateHostRole(): void }).updateHostRole();
    expect(isHost(a)).toBe(false);
    expect(isHost(b)).toBe(true);
    a.disconnect();
    b.disconnect();
  });

  it('drops to a 1 Hz keepalive while paused', () => {
    const bus = new FakeBus();
    const a = makePeer(bus, 'p_a');
    const b = makePeer(bus, 'p_b');
    a.join('map1', 'Player', 'terrorist');
    b.join('map1', 'Player', 'terrorist');
    tickAll([a, b], 500);
    bus.byEvent.clear();
    // nobody ticks (both in the menu) for 5 s
    vi.advanceTimersByTime(5000);
    const st = bus.byEvent.get('st') ?? 0;
    expect(st).toBeGreaterThanOrEqual(8);
    expect(st).toBeLessThanOrEqual(12);
    a.disconnect();
    b.disconnect();
  });
});
