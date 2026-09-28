import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  COSMETICS_DEBOUNCE_MS,
  COSMETICS_MIN_INTERVAL_MS,
  HOST_STALE_MS,
  IDLE_DISCONNECT_MS,
  JOIN_GRACE_MS,
  MAX_PENDING_FIRES,
  SUPABASE_PROTOCOL,
  SupabaseMultiplayer,
} from '../SupabaseMultiplayer';
import type { MultiplayerSnapshot } from '../types';
import { CollisionWorld } from '../../world/CollisionWorld';
import { MAX_ROOM_PLAYERS, SUPABASE_FREE_EVENTS_PER_SEC } from '../../netcode/RateBudget';
import { RESPAWN_DELAY_MS } from '../../combat/CombatState';
import { getWeapon } from '../../combat/weapons';

// in-memory stand-in for supabase realtime: broadcast (self: false) + presence,
// with a counter that bills events the way supabase does (sent + each delivery)
class FakeBus {
  readonly topics = new Map<string, Set<FakeChannel>>();
  events = 0;
  readonly byEvent = new Map<string, number>();
  /** presence track calls per client */
  readonly tracks = new Map<string, number>();

  join(ch: FakeChannel): void {
    const set = this.topics.get(ch.topic) ?? new Set();
    set.add(ch);
    this.topics.set(ch.topic, set);
  }

  leave(ch: FakeChannel): void {
    const had = this.topics.get(ch.topic)?.delete(ch) ?? false;
    // presence tells everyone left that this client went
    if (had && ch.presence) {
      for (const other of this.topics.get(ch.topic) ?? []) {
        this.events += 1;
        this.bill(other.key);
      }
      this.byEvent.set('presence', (this.byEvent.get('presence') ?? 0) + (this.topics.get(ch.topic)?.size ?? 0));
    }
    this.syncPresence(ch.topic);
  }

  /** billed messages per client: what it sends plus what is delivered to it */
  readonly perClient = new Map<string, number>();
  bill(key: string, n = 1): void {
    this.perClient.set(key, (this.perClient.get(key) ?? 0) + n);
  }

  syncPresence(topic: string): void {
    for (const ch of this.topics.get(topic) ?? []) ch.emit('presence', 'sync', {});
  }

  readonly sent: Array<{ from: string; event: string; payload: any; at: number }> = [];

  broadcast(from: FakeChannel, event: string, payload: unknown): void {
    this.sent.push({ from: from.key, event, payload, at: Date.now() });
    this.events += 1;
    this.bill(from.key);
    this.byEvent.set(event, (this.byEvent.get(event) ?? 0) + 1);
    for (const ch of this.topics.get(from.topic) ?? []) {
      if (ch === from) continue;
      this.events += 1;
      this.bill(ch.key);
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
    // billed like a broadcast: the track, then a presence diff to every peer
    const peers = this.bus.topics.get(this.topic)?.size ?? 1;
    this.bus.events += peers;
    for (const ch of this.bus.topics.get(this.topic) ?? []) this.bus.bill(ch.key);
    this.bus.byEvent.set('presence', (this.bus.byEvent.get('presence') ?? 0) + peers);
    this.bus.tracks.set(this.key, (this.bus.tracks.get(this.key) ?? 0) + 1);
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

function makePeer(bus: FakeBus, id: string, visible = () => true, idleDisconnectMs?: number): SupabaseMultiplayer {
  return new SupabaseMultiplayer(fakeClient(bus), config, { sessionId: id, isVisible: visible, idleDisconnectMs });
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

describe('SupabaseMultiplayer (p6 protocol)', () => {
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
    // the stab rides the guest's next state, the result rides the host's
    vi.advanceTimersByTime(120);

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

  it('fires and combat results ride on state messages, not their own broadcasts', () => {
    const bus = new FakeBus();
    const host = makePeer(bus, 'p_a');
    const guest = makePeer(bus, 'p_b');
    enter(host);
    enter(guest);
    tickAll([host, guest], JOIN_GRACE_MS + 1000);
    expect(host.isHosting()).toBe(true);
    guest.sendEquip('deagle');
    tickAll([host, guest], 300);
    const since = Date.now();
    guest.sendFire([0, 1.6, 0], [1, 0, 0], { targets: {} });
    tickAll([host, guest], 300);
    expect(bus.byEvent.get('fire') ?? 0).toBe(0);
    expect(bus.byEvent.get('cb') ?? 0).toBe(0);
    const carried = statesFrom(bus, 'p_b', since).filter((st) => Array.isArray(st.f));
    expect(carried).toHaveLength(1);
    expect(carried[0].f[0].dir).toEqual([1, 0, 0]);
    // the host resolved it and the shot came back on the host's state
    expect(statesFrom(bus, 'p_a', since).some((st) => Array.isArray(st.ev) && st.ev.some((e: any) => e.k === 'shot'))).toBe(true);
    host.disconnect();
    guest.disconnect();
  });

  it('a carried fire replaces a scheduled send instead of adding one', () => {
    const run = (fireEveryMs: number | null) => {
      const bus = new FakeBus();
      const peers = ['p_a', 'p_b', 'p_c', 'p_d', 'p_e', 'p_f'].map((id) => makePeer(bus, id));
      for (const p of peers) enter(p);
      tickAll(peers, JOIN_GRACE_MS + 1000);
      const since = Date.now();
      let next = since;
      const step = 1000 / 128;
      for (let t = 0; t < 6000; t += step) {
        vi.advanceTimersByTime(step);
        const now = Date.now();
        for (const [i, p] of peers.entries()) {
          p.sendState({ position: [i, 0, now / 1000], velocity: [0, 0, 1], yaw: 0, pitch: 0, t: now });
        }
        if (fireEveryMs !== null && now >= next) {
          peers[1].sendFire([0, 1.6, 0], [1, 0, 0], { targets: {} });
          next += fireEveryMs;
        }
      }
      const out = statesFrom(bus, 'p_b', since).length;
      for (const p of peers) p.disconnect();
      return out;
    };
    const quiet = run(null);
    const firing = run(1500);
    // 4 fires in 6 s at 1.8 Hz: each one moves a send earlier, it doesn't add a full one
    expect(firing - quiet).toBeLessThanOrEqual(2);
  });

  it.each([
    // [shots per second across the room, events/s ceiling]
    [0, 70],
    [2, 76],
    [4, 88],
  ])('a full room with bots at %i shots/s stays under %i events/s', (shotsPerSec, ceiling) => {
    const bus = new FakeBus();
    const peers = ['p_a', 'p_b', 'p_c', 'p_d', 'p_e', 'p_f'].map((id) => makePeer(bus, id));
    for (const p of peers) {
      enter(p);
      p.sendEquip('deagle');
    }
    tickAll(peers, JOIN_GRACE_MS + 1000);
    bus.events = 0;
    const step = 1000 / 128;
    let next = Date.now();
    let shooter = 0;
    for (let t = 0; t < 10_000; t += step) {
      vi.advanceTimersByTime(step);
      const now = Date.now();
      for (const [i, p] of peers.entries()) {
        p.sendState({ position: [i, 0, now / 1000], velocity: [0, 0, 1], yaw: 0, pitch: 0, t: now });
      }
      if (shotsPerSec > 0 && now >= next) {
        peers[shooter % peers.length].sendFire([0, 1.6, 0], [1, 0, 0], { targets: {} });
        shooter += 1;
        next += 1000 / shotsPerSec;
      }
    }
    expect(bus.events / 10).toBeLessThan(ceiling);
    expect(bus.byEvent.get('fire') ?? 0).toBe(0);
    expect(bus.byEvent.get('cb') ?? 0).toBe(0);
    for (const p of peers) p.disconnect();
  });

  it('joins p6 channels, so p5 hosts (old hit capsules) never share a room with it', () => {
    const bus = new FakeBus();
    const peer = makePeer(bus, 'p_a');
    enter(peer);
    expect(SUPABASE_PROTOCOL).toBe('p6');
    expect([...bus.topics.keys()]).toEqual(['test_room_p6_map1']);
    peer.disconnect();
  });

  it("the host sizes a guest's hit capsule from the crouch in its state", () => {
    const bus = new FakeBus();
    const host = makePeer(bus, 'p_a');
    const guest = makePeer(bus, 'p_b');
    enter(host);
    enter(guest);
    tickAll([host, guest], JOIN_GRACE_MS + 500);
    expect(hosting(host)).toBe(true);
    const guestOnHost = () => arenaOf(host).players.get('p_b');
    expect(guestOnHost().duck).toBe(0);
    for (let i = 0; i < 40; i += 1) {
      vi.advanceTimersByTime(1000 / 128);
      guest.sendState({ position: [1, 0, 0], velocity: [0, 0, 0], yaw: 0, pitch: 0, t: Date.now(), duck: 1 });
    }
    tickAll([host], 600);
    expect(guestOnHost().duck).toBe(1);
    expect(guestOnHost().eyeHeight).toBeCloseTo(46 * 0.0254, 4);
    expect(statesFrom(bus, 'p_b').some((st) => st.k === 1)).toBe(true);
    host.disconnect();
    guest.disconnect();
  });

  describe('idle tabs leave the channel', () => {
    const HOUR = 3_600_000;
    // peers listen for visibilitychange on the document; visibility itself comes from each peer's isVisible
    beforeEach(() => {
      (globalThis as any).document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    });
    const knife = (seed: number) => ({ knife: { id: 'flip' as const, finish: 'fade', wear: 0.02, seed } });

    /** runs the clock, sending states at `hz` from the peers that are playing */
    function run(ms: number, playing: SupabaseMultiplayer[], hz = 32): void {
      const step = 1000 / hz;
      for (let t = 0; t < ms; t += step) {
        vi.advanceTimersByTime(step);
        const now = Date.now();
        for (const [i, p] of playing.entries()) {
          p.sendState({ position: [i, 0, now / 1000], velocity: [0, 0, 1], yaw: 0, pitch: 0, t: now });
        }
      }
    }

    /** billed messages per hour for `id`, over an hour after `settle` */
    function perHour(bus: FakeBus, id: string, playing: SupabaseMultiplayer[], settle = 0): number {
      if (settle) run(settle, playing);
      const before = bus.perClient.get(id) ?? 0;
      run(HOUR, playing);
      return (bus.perClient.get(id) ?? 0) - before;
    }

    const rates: Record<string, number> = {};
    afterAll(() => {
      // eslint-disable-next-line no-console
      console.log('[idle] billed messages per hour', JSON.stringify(rates));
    });

    it('a tab left on the menu: ~3600 messages an hour before, none after the first minute', () => {
      for (const [label, idleMs] of [['before', Infinity], ['after', undefined]] as const) {
        const bus = new FakeBus();
        const menu = makePeer(bus, 'p_menu', () => true, idleMs);
        menu.join('map1', 'Player', 'terrorist'); // the game joins at start, on the menu
        const first = perHour(bus, 'p_menu', []);
        const second = perHour(bus, 'p_menu', []);
        rates[`menu tab alone, ${label}, first hour`] = first;
        rates[`menu tab alone, ${label}, later hours`] = second;
        if (label === 'before') expect(second).toBeGreaterThan(3000);
        else {
          expect(menu.isParked()).toBe(true);
          expect(first).toBeLessThan(100);
          expect(second).toBe(0);
        }
        menu.disconnect();
      }
    }, 30_000);

    it('a hidden tab in a map next to a player: tens of thousands an hour before, none after', () => {
      for (const [label, idleMs] of [['before', Infinity], ['after', undefined]] as const) {
        const bus = new FakeBus();
        let hidden = false;
        const player = makePeer(bus, 'p_play', () => true, idleMs);
        const tab = makePeer(bus, 'p_tab', () => !hidden, idleMs);
        enter(player);
        enter(tab);
        run(JOIN_GRACE_MS + 1000, [player, tab]);
        hidden = true;
        document.dispatchEvent(new Event('visibilitychange'));
        const hiddenHour = perHour(bus, 'p_tab', [player]);
        const alone = new FakeBus();
        const solo = makePeer(alone, 'p_solo', () => false, idleMs);
        enter(solo);
        const hiddenAlone = perHour(alone, 'p_solo', [], 5000);
        rates[`hidden tab next to a player, ${label}`] = hiddenHour;
        rates[`hidden tab alone in a map, ${label}`] = hiddenAlone;
        if (label === 'before') {
          expect(hiddenHour).toBeGreaterThan(20_000);
          expect(hiddenAlone).toBeGreaterThan(3000);
        } else {
          expect(tab.isParked()).toBe(true);
          expect(solo.isParked()).toBe(true);
          expect(hiddenHour).toBeLessThan(2000);
          expect(hiddenAlone).toBeLessThan(100);
        }
        for (const p of [player, tab, solo]) p.disconnect();
      }
    }, 30_000);

    it('rejoins on return as a fresh joiner: presence, cosmetics and an unchanged host', () => {
      const bus = new FakeBus();
      let hidden = false;
      const host = makePeer(bus, 'p_a');
      const tab = makePeer(bus, 'p_b', () => !hidden);
      tab.setCosmetics(knife(1));
      enter(host);
      enter(tab);
      run(JOIN_GRACE_MS + 1000, [host, tab]);
      expect(hosting(host)).toBe(true);
      expect((host as any).remotes.get('p_b')?.cosmetics?.knife?.seed).toBe(1);

      hidden = true;
      document.dispatchEvent(new Event('visibilitychange'));
      run(IDLE_DISCONNECT_MS + 2000, [host]);
      expect(tab.isParked()).toBe(true);
      expect((host as any).remotes.has('p_b')).toBe(false);
      expect([...bus.topics.values()].every((set) => ![...set].some((ch) => ch.key === 'p_b'))).toBe(true);

      // picks a new finish while away, then comes back
      tab.setCosmetics(knife(2));
      run(20_000, [host]);
      hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
      expect(tab.isParked()).toBe(false);
      run(JOIN_GRACE_MS + 1000, [host, tab]);
      expect((host as any).remotes.get('p_b')?.cosmetics?.knife?.seed).toBe(2);
      expect((tab as any).remotes.has('p_a')).toBe(true);
      // the host keeps the room; the returning tab doesn't take it back
      expect(hosting(host)).toBe(true);
      expect(hosting(tab)).toBe(false);
      host.disconnect();
      tab.disconnect();
    }, 30_000);

    it('a hidden host hands the room off before it leaves', () => {
      const bus = new FakeBus();
      let hidden = false;
      const host = makePeer(bus, 'p_a', () => !hidden);
      const other = makePeer(bus, 'p_b');
      enter(host);
      run(JOIN_GRACE_MS + 1000, [host]);
      enter(other);
      run(JOIN_GRACE_MS + 1000, [host, other]);
      expect(hosting(host)).toBe(true);

      hidden = true;
      document.dispatchEvent(new Event('visibilitychange'));
      run(5000, [other]);
      expect(hosting(other)).toBe(true);
      expect(hosting(host)).toBe(false);
      run(IDLE_DISCONNECT_MS, [other]);
      expect(host.isParked()).toBe(true);
      expect(hosting(other)).toBe(true);
      host.disconnect();
      other.disconnect();
    }, 30_000);

    it('a parked menu tab rejoins when it enters a map', () => {
      const bus = new FakeBus();
      const tab = makePeer(bus, 'p_menu');
      tab.join('map1', 'Player', 'terrorist');
      run(IDLE_DISCONNECT_MS + 1000, []);
      expect(tab.isParked()).toBe(true);
      // picking another map on a visible menu means the player is back: it rejoins
      tab.join('map2', 'Player', 'terrorist');
      expect(tab.isParked()).toBe(false);
      run(IDLE_DISCONNECT_MS + 1000, []);
      expect(tab.isParked()).toBe(true);
      tab.setRoomContext(ctx());
      tab.setCombatReady(true);
      expect(tab.isParked()).toBe(false);
      expect([...bus.topics.keys()]).toContain('test_room_p6_map2');
      run(IDLE_DISCONNECT_MS + 5000, [tab]);
      expect(tab.isParked()).toBe(false);
      tab.disconnect();
    }, 30_000);
  });

  describe('cosmetics', () => {
    const knife = (seed: number) => ({ knife: { id: 'karambit' as const, finish: 'doppler_ruby', wear: 0.01, seed } });
    const remoteSeed = (p: SupabaseMultiplayer, id: string) => (p as any).remotes.get(id)?.cosmetics?.knife?.seed;

    it('rides the join and collapses a burst of changes into one spaced out presence track', () => {
      const bus = new FakeBus();
      const a = makePeer(bus, 'p_a');
      const b = makePeer(bus, 'p_b');
      a.setCosmetics(knife(1));
      enter(a);
      enter(b);
      tickAll([a, b], 200);
      expect(remoteSeed(b, 'p_a')).toBe(1);
      const joinTracks = bus.tracks.get('p_a') ?? 0;
      // scrubbing the seed slider: 30 changes in 3 s
      for (let i = 0; i < 30; i += 1) {
        a.setCosmetics(knife(100 + i));
        tickAll([a, b], 100);
      }
      tickAll([a, b], COSMETICS_DEBOUNCE_MS + 200);
      // the join track counts, so nothing yet: tracks stay 10 s apart
      expect((bus.tracks.get('p_a') ?? 0) - joinTracks).toBe(0);
      tickAll([a, b], COSMETICS_MIN_INTERVAL_MS);
      expect((bus.tracks.get('p_a') ?? 0) - joinTracks).toBe(1);
      expect(remoteSeed(b, 'p_a')).toBe(129);
      // the next change waits for the minimum interval
      a.setCosmetics(knife(7));
      tickAll([a, b], COSMETICS_DEBOUNCE_MS + 200);
      expect(remoteSeed(b, 'p_a')).toBe(129);
      tickAll([a, b], COSMETICS_MIN_INTERVAL_MS);
      expect(remoteSeed(b, 'p_a')).toBe(7);
      expect((bus.tracks.get('p_a') ?? 0) - joinTracks).toBe(2);
      // picking the same thing again sends nothing
      a.setCosmetics(knife(7));
      tickAll([a, b], COSMETICS_MIN_INTERVAL_MS + COSMETICS_DEBOUNCE_MS);
      expect((bus.tracks.get('p_a') ?? 0) - joinTracks).toBe(2);
      a.disconnect();
      b.disconnect();
    });

    it('a full room changing cosmetics constantly at 4 shots/s stays inside the room budget from #46', () => {
      const bus = new FakeBus();
      const peers = ['p_a', 'p_b', 'p_c', 'p_d', 'p_e', 'p_f'].map((id) => makePeer(bus, id));
      for (const p of peers) {
        enter(p);
        p.sendEquip('deagle');
      }
      tickAll(peers, JOIN_GRACE_MS + 1000);
      bus.events = 0;
      bus.byEvent.clear();
      bus.tracks.clear();
      const step = 1000 / 128;
      let nextShot = Date.now();
      let nextPick = Date.now();
      let shooter = 0;
      let seed = 0;
      const secs = 30;
      for (let t = 0; t < secs * 1000; t += step) {
        vi.advanceTimersByTime(step);
        const now = Date.now();
        for (const [i, p] of peers.entries()) {
          p.sendState({ position: [i, 0, now / 1000], velocity: [0, 0, 1], yaw: 0, pitch: 0, t: now });
        }
        if (now >= nextShot) {
          peers[shooter % peers.length].sendFire([0, 1.6, 0], [1, 0, 0], { targets: {} });
          shooter += 1;
          nextShot += 250;
        }
        // every player picks something new 5 times a second, the worst case
        if (now >= nextPick) {
          seed += 1;
          for (const p of peers) p.setCosmetics(knife(seed % 1000));
          nextPick += 200;
        }
      }
      // at most one track per player per interval, never with the state traffic
      for (const id of ['p_a', 'p_b', 'p_c', 'p_d', 'p_e', 'p_f']) {
        expect(bus.tracks.get(id) ?? 0).toBeLessThanOrEqual(Math.ceil((secs * 1000) / COSMETICS_MIN_INTERVAL_MS));
      }
      const presencePerSec = (bus.byEvent.get('presence') ?? 0) / secs;
      expect(presencePerSec).toBeLessThanOrEqual((6 * 6 * 1000) / COSMETICS_MIN_INTERVAL_MS);
      // same ceiling as the full room at 4 shots/s without cosmetics
      expect(bus.events / secs).toBeLessThan(88);
      for (const p of peers) p.disconnect();
    });
  });

  describe('ammo on the host', () => {
    const shotsFrom = (bus: FakeBus, host: string, shooter: string, since: number) =>
      statesFrom(bus, host, since).flatMap((st) => (Array.isArray(st.ev) ? st.ev : []))
        .filter((e: any) => e.k === 'shot' && e.e.playerId === shooter);
    const deagleMs = getWeapon('deagle').fireIntervalMs;
    const fire = (p: SupabaseMultiplayer, ammo?: number) =>
      p.sendFire([0, 1.6, 0], [1, 0, 0], { targets: {}, ...(ammo === undefined ? {} : { ammo }) });

    it('a host with a stale empty magazine takes the client count instead of eating the shot', () => {
      const bus = new FakeBus();
      const host = makePeer(bus, 'p_a');
      const guest = makePeer(bus, 'p_b');
      enter(host);
      enter(guest);
      tickAll([host, guest], JOIN_GRACE_MS + 1000);
      guest.sendEquip('deagle');
      tickAll([host, guest], 300);
      // the host's copy of the guest's deagle ran dry (a reload it never saw finish)
      const magazine = getWeapon('deagle').magazine;
      const weapon = arenaOf(host).players.get('p_b').weapon;
      for (let i = 0; i < magazine; i += 1) weapon.tryFire(-1e9 + i * 1e6);
      expect(arenaOf(host).getAmmo('p_b')).toBe(0);
      const since = Date.now();
      fire(guest, magazine);
      tickAll([host, guest], deagleMs + 200);
      expect(shotsFrom(bus, 'p_a', 'p_b', since)).toHaveLength(1);
      expect(arenaOf(host).ammoCorrections).toBe(1);
      expect(arenaOf(host).getAmmo('p_b')).toBe(magazine - 1);
      host.disconnect();
      guest.disconnect();
    });

    it('keeps guns firing across a host handoff mid-magazine', () => {
      const bus = new FakeBus();
      const a = makePeer(bus, 'p_a');
      const b = makePeer(bus, 'p_b');
      const c = makePeer(bus, 'p_c');
      for (const p of [a, b, c]) enter(p);
      tickAll([a, b, c], JOIN_GRACE_MS + 1000);
      expect(hosting(a)).toBe(true);
      c.sendEquip('deagle');
      tickAll([a, b, c], 300);
      const magazine = getWeapon('deagle').magazine;
      let ammo = magazine;
      const since = Date.now();
      for (let i = 0; i < 3; i += 1) { fire(c, ammo); ammo -= 1; tickAll([a, b, c], deagleMs + 50); }
      a.disconnect();
      tickAll([b, c], 1500);
      const newHost = [b, c].find(hosting)!;
      expect(newHost).toBe(b);
      for (let i = 0; i < 3; i += 1) { fire(c, ammo); ammo -= 1; tickAll([b, c], deagleMs + 50); }
      expect(shotsFrom(bus, 'p_a', 'p_c', since)).toHaveLength(3);
      expect(shotsFrom(bus, 'p_b', 'p_c', since)).toHaveLength(3);
      b.disconnect();
      c.disconnect();
    });
  });

  it('a player turned away by a full room does not queue fires', () => {
    const bus = new FakeBus();
    const peers: SupabaseMultiplayer[] = [];
    let turnedAway: SupabaseMultiplayer | null = null;
    for (const id of ['p_a', 'p_b', 'p_c', 'p_d', 'p_e', 'p_f', 'p_g']) {
      const p = makePeer(bus, id);
      p.onRoomFull = () => { turnedAway = p; };
      enter(p);
      peers.push(p);
      vi.advanceTimersByTime(50);
    }
    expect(turnedAway).not.toBeNull();
    for (let i = 0; i < 200; i += 1) {
      turnedAway!.sendFire([0, 1.6, 0], [1, 0, 0], { targets: {}, ammo: 7 });
      vi.advanceTimersByTime(30);
    }
    expect((turnedAway as any).pendingFires.length).toBe(0);
    for (const p of peers) p.disconnect();
  });

  it(`caps fires waiting for a carrier at ${MAX_PENDING_FIRES}`, () => {
    const bus = new FakeBus();
    const p = makePeer(bus, 'p_a');
    // joined but never subscribed: nothing can carry the fires yet
    (p as any).subscribed = false;
    (p as any).channel = null;
    for (let i = 0; i < 100; i += 1) p.sendFire([0, 1.6, 0], [1, 0, 0], { targets: {} });
    expect((p as any).pendingFires.length).toBeLessThanOrEqual(MAX_PENDING_FIRES);
    p.disconnect();
  });
});
