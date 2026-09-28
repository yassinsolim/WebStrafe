import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import type { SupabaseClient } from '@supabase/supabase-js';
import { HOST_STALE_MS, JOIN_GRACE_MS, SupabaseMultiplayer } from '../SupabaseMultiplayer';
import type { MultiplayerSnapshot } from '../types';
import { CollisionWorld } from '../../world/CollisionWorld';
import { MAX_ROOM_PLAYERS, SUPABASE_FREE_EVENTS_PER_SEC } from '../../netcode/RateBudget';
import { RESPAWN_DELAY_MS } from '../../combat/CombatState';

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

  readonly sent: Array<{ from: string; event: string; payload: any; at: number }> = [];

  broadcast(from: FakeChannel, event: string, payload: unknown): void {
    this.sent.push({ from: from.key, event, payload, at: Date.now() });
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


const ctx = () => ({
  collisionWorld: new CollisionWorld(),
  spawn: { position: new Vector3(0, 0, 0), yawDeg: 0 },
  botCount: 1,
});

/** joins a map and loads it, like GameApp does on Play */
function enter(p: SupabaseMultiplayer, withMap = true): void {
  p.join('map1', 'Player', 'terrorist');
  if (withMap) p.setRoomContext(ctx());
  p.setCombatReady(withMap);
}

const hosting = (p: SupabaseMultiplayer) => p.isHosting();
const arenaOf = (p: SupabaseMultiplayer) => (p as any).hostSim.arena;
const statesFrom = (bus: FakeBus, id: string, since = 0) =>
  bus.sent.filter((m) => m.from === id && m.event === 'st' && m.at >= since).map((m) => m.payload);

describe('SupabaseMultiplayer (p3 protocol)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).document;
  });

  it('keeps a 3 player room with bots under the free-plan event cap', () => {
    const bus = new FakeBus();
    const peers = ['p_a', 'p_b', 'p_c'].map((id) => makePeer(bus, id));
    for (const p of peers) enter(p);
    tickAll(peers, JOIN_GRACE_MS + 1000);
    bus.events = 0;
    bus.byEvent.clear();
    tickAll(peers, 5000);
    expect(bus.events / 5).toBeLessThan(SUPABASE_FREE_EVENTS_PER_SEC);
    expect(bus.byEvent.has('botstate')).toBe(false);
    expect(peers.filter(hosting)).toHaveLength(1);
    for (const p of peers) p.disconnect();
  });

  it('delivers bot rows and timestamped player rows to non-hosts', () => {
    const bus = new FakeBus();
    const host = makePeer(bus, 'p_a');
    const guest = makePeer(bus, 'p_b');
    let last: MultiplayerSnapshot | null = null;
    guest.onSnapshot = (s) => { last = s; };
    enter(host);
    enter(guest);
    tickAll([host, guest], JOIN_GRACE_MS + 1000);
    const snap = last as MultiplayerSnapshot | null;
    const bot = snap!.players.find((p) => p.id.startsWith('bot:'));
    const hostRow = snap!.players.find((p) => p.id === 'p_a');
    expect(bot?.clock).toBe('p_a');
    expect(typeof bot?.t).toBe('number');
    expect(hostRow?.clock).toBe('p_a');
    host.disconnect();
    guest.disconnect();
  });

  it('resolves a guest knife stab on the host and reports it with weaponId knife', () => {
    const bus = new FakeBus();
    const host = makePeer(bus, 'p_a');
    const guest = makePeer(bus, 'p_b');
    const guestHits: unknown[] = [];
    const guestDeaths: unknown[] = [];
    guest.onHit = (e) => guestHits.push(e);
    guest.onDeath = (e) => guestDeaths.push(e);
    for (const p of [host, guest]) {
      p.join('map1', 'Player', 'terrorist');
      p.setRoomContext({
        collisionWorld: new CollisionWorld(),
        spawn: { position: new Vector3(0, 0, 0), yawDeg: 0 },
        botCount: 0,
      });
      p.setCombatReady(true);
    }
    // host stands 1.1 m ahead of the guest, facing away from it
    const step = 1000 / 128;
    for (let t = 0; t < 4200; t += step) {
      vi.advanceTimersByTime(step);
      const now = Date.now();
      host.sendState({ position: [0, 0, -1.1], velocity: [0, 0, 0], yaw: 0, pitch: 0, t: now });
      guest.sendState({ position: [0, 0, 0], velocity: [0, 0, 0], yaw: 0, pitch: 0, t: now });
    }
    guest.sendFire([0, 1.6, 0], [0, 0, -1], undefined, 'secondary');
    vi.advanceTimersByTime(50);

    expect(guestHits).toContainEqual(expect.objectContaining({
      shooterId: 'p_b',
      targetId: 'p_a',
      weaponId: 'knife',
      melee: 'secondary',
      backstab: true,
      killed: true,
    }));
    expect(guestDeaths).toContainEqual({ victimId: 'p_a', killerId: 'p_b', weaponId: 'knife', headshot: false });
    host.disconnect();
    guest.disconnect();
  });

  it('paused: one zero-velocity rest sample, then keepalives that repeat its time', () => {
    const bus = new FakeBus();
    const a = makePeer(bus, 'p_a');
    const b = makePeer(bus, 'p_b');
    enter(a);
    enter(b);
    // b strafes hard, then stops ticking (menu open mid-strafe)
    const step = 1000 / 128;
    for (let t = 0; t < 1500; t += step) {
      vi.advanceTimersByTime(step);
      const now = Date.now();
      a.sendState({ position: [0, 0, 0], velocity: [0, 0, 0], yaw: 0, pitch: 0, t: now });
      b.sendState({ position: [now / 100, 0, 0], velocity: [-9.5, 0, 0], yaw: 0, pitch: 0, t: now });
    }
    const pausedAt = Date.now();
    const lastPlaying = statesFrom(bus, 'p_b').at(-1);
    vi.advanceTimersByTime(5000);
    const paused = statesFrom(bus, 'p_b', pausedAt + 1);
    expect(paused.length).toBeGreaterThanOrEqual(4);
    const rest = paused[0];
    // where the player actually stopped (last tick, at most a send interval past
    // the last broadcast), no velocity, newer than anything sent while playing
    expect(rest.s[0]).toBeGreaterThanOrEqual(lastPlaying.s[0]);
    expect(rest.s[0] - lastPlaying.s[0]).toBeLessThan(1);
    expect(rest.s.slice(3, 6)).toEqual([0, 0, 0]);
    expect(rest.t).toBeGreaterThan(lastPlaying.t);
    // every keepalive after it is the same sample: same time, same pose
    for (const k of paused.slice(1)) {
      expect(k.t).toBe(rest.t);
      expect(k.s).toEqual(rest.s);
    }
    // receivers see one sample for the whole pause, nothing to extrapolate
    let rows = 0;
    const seen = new Set<number>();
    a.onSnapshot = (snap) => {
      const row = snap.players.find((p) => p.id === 'p_b');
      if (row?.t !== undefined) { rows += 1; seen.add(row.t); }
    };
    vi.advanceTimersByTime(3000);
    expect(rows).toBeGreaterThan(0);
    expect([...seen]).toEqual([rest.t]);
    a.disconnect();
    b.disconnect();
  });

  it('a tab on the main menu never wins the election, even with the lowest id', () => {
    const bus = new FakeBus();
    const menu = makePeer(bus, 'p_a');
    const player = makePeer(bus, 'p_b');
    enter(menu, false);
    enter(player);
    tickAll([player], JOIN_GRACE_MS + 2000);
    vi.advanceTimersByTime(0);
    expect(hosting(menu)).toBe(false);
    expect(hosting(player)).toBe(true);
    expect(statesFrom(bus, 'p_a').at(-1).e).toBe(0);
    menu.disconnect();
    player.disconnect();
  });

  it('uses the real visibility listener: hiding the host hands off, and hosting sticks', () => {
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as 'visible' | 'hidden' });
    (globalThis as any).document = doc;
    const bus = new FakeBus();
    // p_a reads document.visibilityState through the default listener
    const a = new SupabaseMultiplayer(fakeClient(bus), config, { sessionId: 'p_a' });
    const b = makePeer(bus, 'p_b');
    enter(a);
    enter(b);
    tickAll([a, b], JOIN_GRACE_MS + 1000);
    expect(hosting(a)).toBe(true);

    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    tickAll([b], 1500);
    expect(hosting(a)).toBe(false);
    expect(hosting(b)).toBe(true);

    // a comes back; b keeps the room instead of bouncing it back to the lowest id
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    tickAll([a, b], 3000);
    expect(hosting(b)).toBe(true);
    expect(hosting(a)).toBe(false);
    a.disconnect();
    b.disconnect();
  });

  it('a silent host fails over after HOST_STALE_MS', () => {
    const bus = new FakeBus();
    const a = makePeer(bus, 'p_a');
    const b = makePeer(bus, 'p_b');
    enter(a);
    enter(b);
    tickAll([a, b], JOIN_GRACE_MS + 1000);
    expect(hosting(a)).toBe(true);
    // a's main thread hangs: no timers, no messages, still in presence
    (a as any).stopPump();
    tickAll([b], HOST_STALE_MS + 1000);
    expect(hosting(b)).toBe(true);
    a.disconnect();
    b.disconnect();
  });

  it('a new host restores weapons and pending deaths, and sends the respawn', () => {
    const bus = new FakeBus();
    const a = makePeer(bus, 'p_a');
    const b = makePeer(bus, 'p_b');
    const c = makePeer(bus, 'p_c');
    for (const p of [a, b, c]) enter(p);
    tickAll([a, b, c], JOIN_GRACE_MS + 1000);
    expect(hosting(a)).toBe(true);
    b.sendEquip('deagle');
    c.sendEquip('awp');
    // a (host) kills c; c learns about its own death from a's combat batch
    (a as any).hostSim.emit.death({ victimId: 'p_c', killerId: 'p_b', weaponId: 'deagle', headshot: false });
    const respawns: string[] = [];
    c.onRespawn = (e) => respawns.push(e.playerId);
    tickAll([a, b, c], 800);
    expect(statesFrom(bus, 'p_c').at(-1).d).toBeGreaterThan(0);

    // host leaves right after the kill
    a.disconnect();
    tickAll([b, c], 1500);
    const newHost = [b, c].find(hosting)!;
    expect(newHost).toBeDefined();
    expect(arenaOf(newHost).getActiveWeapon('p_b')).toBe('deagle');
    expect(arenaOf(newHost).getActiveWeapon('p_c')).toBe('awp');
    expect(arenaOf(newHost).isAlive('p_c')).toBe(false);
    tickAll([b, c], RESPAWN_DELAY_MS + 500);
    expect(respawns).toContain('p_c');
    expect(arenaOf(newHost).isAlive('p_c')).toBe(true);
    b.disconnect();
    c.disconnect();
  });

  it('ignores combat batches that are not from the elected host', () => {
    const bus = new FakeBus();
    const a = makePeer(bus, 'p_a');
    const b = makePeer(bus, 'p_b');
    enter(a);
    enter(b);
    tickAll([a, b], JOIN_GRACE_MS + 1000);
    let hits = 0;
    b.onHit = () => { hits += 1; };
    const ev = [{ k: 'hit', e: { shooterId: 'p_x', targetId: 'p_b', weaponId: 'awp', damage: 100, hitbox: 'head', killed: true } }];
    (b as any).onCombatBatch({ host: 'p_x', ev });
    expect(hits).toBe(0);
    (b as any).onCombatBatch({ host: 'p_a', ev });
    expect(hits).toBe(1);
    a.disconnect();
    b.disconnect();
  });

  it('a lone host sends about 1 message per second, playing or paused', () => {
    const bus = new FakeBus();
    const a = makePeer(bus, 'p_a');
    enter(a);
    tickAll([a], 1000);
    expect(hosting(a)).toBe(true);
    bus.byEvent.clear();
    tickAll([a], 10_000);
    const playing = (bus.byEvent.get('st') ?? 0) / 10;
    bus.byEvent.clear();
    vi.advanceTimersByTime(10_000);
    const paused = (bus.byEvent.get('st') ?? 0) / 10;
    expect(playing).toBeLessThanOrEqual(1.2);
    expect(paused).toBeLessThanOrEqual(1.2);
    a.disconnect();
  });

  it(`turns away players past ${MAX_ROOM_PLAYERS} and keeps the room under the cap`, () => {
    const bus = new FakeBus();
    const ids = ['p_a', 'p_b', 'p_c', 'p_d', 'p_e', 'p_f', 'p_g', 'p_h'];
    const peers: SupabaseMultiplayer[] = [];
    const full: string[] = [];
    for (const id of ids) {
      const p = makePeer(bus, id);
      p.onRoomFull = () => full.push(id);
      enter(p);
      peers.push(p);
      vi.advanceTimersByTime(50);
    }
    expect(full.sort()).toEqual(['p_g', 'p_h']);
    tickAll(peers, JOIN_GRACE_MS + 1000);
    bus.events = 0;
    tickAll(peers, 5000);
    expect(bus.events / 5).toBeLessThan(SUPABASE_FREE_EVENTS_PER_SEC);
    for (const p of peers) p.disconnect();
  });
});
