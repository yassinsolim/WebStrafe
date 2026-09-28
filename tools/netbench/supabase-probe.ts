/**
 * Measures the Supabase Realtime broadcast path the live deploy uses.
 *
 *   VITE_SUPABASE_URL=... VITE_SUPABASE_KEY=... npx tsx tools/netbench/supabase-probe.ts <mode>
 *
 * modes:
 *   presence  count players currently in the live lobby channels (read only, no track)
 *   rate      one sender at --hz for --secs, one receiver; checks per-client throttling
 *   prod      replays the production traffic pattern (host: state 20 Hz + botstate 60 Hz,
 *             guest: state 20 Hz) on an isolated bench channel
 *
 * all bench traffic goes to `webstrafe_bench_<random>` so it never lands in a real lobby.
 * both clients run in this process, so one-way latency uses a single clock.
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_KEY;
if (!url || !key) {
  console.error('set VITE_SUPABASE_URL and VITE_SUPABASE_KEY');
  process.exit(2);
}

const args = process.argv.slice(2);
const mode = args[0] ?? 'prod';
const flag = (name: string, fallback: number): number => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const secs = flag('secs', 15);

const now = (): number => performance.timeOrigin + performance.now();

function makeClient(): SupabaseClient {
  // same options as src/network/createMultiplayer.ts
  return createClient(url!, key!, { realtime: { params: { eventsPerSecond: 20 } } });
}

interface Endpoint {
  name: string;
  client: SupabaseClient;
  channel: RealtimeChannel;
  received: Map<string, number[]>;
  latencies: number[];
  statusLog: string[];
  sendResults: Map<string, number>;
}

async function open(name: string, topic: string): Promise<Endpoint> {
  const client = makeClient();
  const channel = client.channel(topic, { config: { broadcast: { self: false } } });
  const ep: Endpoint = {
    name,
    client,
    channel,
    received: new Map(),
    latencies: [],
    statusLog: [],
    sendResults: new Map(),
  };
  channel.on('broadcast', { event: '*' }, (msg) => {
    const t = now();
    const list = ep.received.get(msg.event) ?? [];
    list.push(t);
    ep.received.set(msg.event, list);
    const sentAt = (msg.payload as { sentAt?: number }).sentAt;
    if (typeof sentAt === 'number') {
      ep.latencies.push(t - sentAt);
    }
  });
  channel.on('system', {}, (msg) => {
    ep.statusLog.push(`${((now() - t0) / 1000).toFixed(2)}s system ${JSON.stringify(msg).slice(0, 200)}`);
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name} subscribe timeout`)), 15000);
    channel.subscribe((status, err) => {
      ep.statusLog.push(`${((now() - t0) / 1000).toFixed(2)}s ${status}${err ? ` ${err.message}` : ''}`);
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  return ep;
}

const t0 = now();

function statePayload(id: string, t: number): Record<string, unknown> {
  // mirrors SupabaseMultiplayer's state broadcast: full float64 json, no timestamp in prod
  const x = Math.sin(t / 700) * 812.3456789012345;
  return {
    id,
    state: {
      position: [x, 132.40827349123, -419.1234567890123],
      velocity: [18.123456789012, -3.2176543210987, 7.9876543210123],
      yaw: 1.2345678901234567,
      pitch: -0.123456789012345,
    },
    sentAt: t,
  };
}

function botPayload(host: string, t: number): Record<string, unknown> {
  return {
    host,
    rows: [{
      id: 'bot:0',
      name: 'Ada (bot)',
      model: 'terrorist',
      position: [812.3456789012345, 132.40827349123, -419.1234567890123],
      velocity: [18.123456789012, -3.2176543210987, 7.9876543210123],
      yaw: 1.2345678901234567,
      pitch: -0.123456789012345,
      health: 100,
      alive: true,
    }],
    sentAt: t,
  };
}

function schedule(ep: Endpoint, event: string, hz: number, build: (t: number) => Record<string, unknown>): () => void {
  const timer = setInterval(() => {
    void ep.channel.send({ type: 'broadcast', event, payload: build(now()) }).then((r) => {
      ep.sendResults.set(`${event}:${r}`, (ep.sendResults.get(`${event}:${r}`) ?? 0) + 1);
    });
  }, Math.round(1000 / hz));
  return () => clearInterval(timer);
}

function pct(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function gaps(times: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < times.length; i += 1) out.push(times[i] - times[i - 1]);
  return out;
}

function report(ep: Endpoint, expected: Record<string, number>): Record<string, unknown> {
  const events: Record<string, unknown> = {};
  for (const [event, hz] of Object.entries(expected)) {
    const times = ep.received.get(event) ?? [];
    const g = gaps(times);
    events[event] = {
      expectedHz: hz,
      receivedHz: +(times.length / secs).toFixed(1),
      deliveredPct: +((100 * times.length) / (hz * secs)).toFixed(1),
      gapP50Ms: +pct(g, 50).toFixed(1),
      gapP99Ms: +pct(g, 99).toFixed(1),
      gapMaxMs: +Math.max(0, ...g).toFixed(1),
    };
  }
  return {
    endpoint: ep.name,
    events,
    oneWayMs: {
      p50: +pct(ep.latencies, 50).toFixed(1),
      p95: +pct(ep.latencies, 95).toFixed(1),
      p99: +pct(ep.latencies, 99).toFixed(1),
      max: +Math.max(0, ...ep.latencies).toFixed(1),
    },
    sendResults: Object.fromEntries(ep.sendResults),
    status: ep.statusLog,
  };
}

async function presenceMode(): Promise<void> {
  const maps = ['surf_skyworld_x', 'movement_test_scene', 'training_straight', 'training_switchback'];
  const client = makeClient();
  for (const map of maps) {
    const channel = client.channel(`webstrafe_room_v1_${map}`);
    await new Promise<void>((resolve) => {
      channel.on('presence', { event: 'sync' }, () => resolve());
      channel.subscribe();
      setTimeout(resolve, 5000);
    });
    const count = Object.keys(channel.presenceState()).length;
    console.log(JSON.stringify({ map, present: count }));
    await client.removeChannel(channel);
  }
  process.exit(0);
}

async function rateMode(): Promise<void> {
  const hz = flag('hz', 40);
  const topic = `webstrafe_bench_${Math.random().toString(36).slice(2, 8)}`;
  const sender = await open('sender', topic);
  const receiver = await open('receiver', topic);
  const stop = schedule(sender, 'state', hz, (t) => statePayload('s', t));
  await new Promise((r) => setTimeout(r, secs * 1000));
  stop();
  await new Promise((r) => setTimeout(r, 1500));
  console.log(JSON.stringify({ mode: 'rate', hz, secs, topic, receiver: report(receiver, { state: hz }), sender: report(sender, {}) }, null, 2));
  process.exit(0);
}

async function prodMode(): Promise<void> {
  const topic = `webstrafe_bench_${Math.random().toString(36).slice(2, 8)}`;
  const host = await open('host', topic);
  const guest = await open('guest', topic);
  const sample = JSON.stringify({ type: 'broadcast', event: 'state', payload: statePayload('p_abcdefgh1234', now()) });
  const botSample = JSON.stringify({ type: 'broadcast', event: 'botstate', payload: botPayload('p_abcdefgh1234', now()) });
  const stops = [
    schedule(host, 'state', 20, (t) => statePayload('host', t)),
    schedule(host, 'botstate', 60, (t) => botPayload('host', t)),
    schedule(guest, 'state', 20, (t) => statePayload('guest', t)),
  ];
  await new Promise((r) => setTimeout(r, secs * 1000));
  stops.forEach((s) => s());
  await new Promise((r) => setTimeout(r, 1500));
  console.log(JSON.stringify({
    mode: 'prod',
    secs,
    topic,
    payloadBytes: { state: sample.length, botstate: botSample.length },
    // an event is a message sent from or delivered to a client (supabase realtime limits doc)
    projectEventsPerSec: { sent: 20 + 60 + 20, delivered: 20 + 60 + 20, total: 200 },
    guest: report(guest, { state: 20, botstate: 60 }),
    host: report(host, { state: 20 }),
  }, null, 2));
  process.exit(0);
}

if (mode === 'presence') void presenceMode();
else if (mode === 'rate') void rateMode();
else void prodMode();
