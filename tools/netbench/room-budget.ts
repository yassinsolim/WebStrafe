/**
 * Measures what a full supabase room bills: every channel message each client
 * sends or receives (supabase counts both against the project's events/s cap).
 * N real SupabaseMultiplayer clients run in this process on a private lobby
 * prefix, all in a loaded map with bots, moving at 128 Hz and firing.
 *
 *   VITE_SUPABASE_URL=.. VITE_SUPABASE_KEY=.. npx tsx tools/netbench/room-budget.ts --players 6 --secs 20 [--churn]
 *
 * --churn: a 7th player joins mid-window (and gets turned away), then leaves.
 * keep sessions short, every run costs message quota.
 */
import { createClient } from '@supabase/supabase-js';
import { Vector3 } from 'three';
import { SupabaseMultiplayer } from '../../src/network/SupabaseMultiplayer';
import { CollisionWorld } from '../../src/world/CollisionWorld';

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_KEY;
if (!url || !key) {
  console.error('set VITE_SUPABASE_URL and VITE_SUPABASE_KEY');
  process.exit(2);
}
const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const players = Number(opt('players', '6'));
const secs = Number(opt('secs', '20'));
const warmup = Number(opt('warmup', '6'));
const churn = args.includes('--churn');
const fireEveryMs = Number(opt('fire-ms', '1500'));
const prefix = `webstrafe_qa_budget_${Math.random().toString(36).slice(2, 8)}`;

// channel events that bill; socket housekeeping doesn't
const HOUSEKEEPING = new Set(['phx_reply', 'heartbeat', 'phx_close', 'phx_error', 'access_token', 'system']);

const windows: Array<Map<string, number>> = [];
let current = new Map<string, number>();
const bump = (k: string) => current.set(k, (current.get(k) ?? 0) + 1);

function makeClient(id: string): { mp: SupabaseMultiplayer; close: () => void } {
  const client = createClient(url!, key!, { realtime: { params: { eventsPerSecond: 20 } } });
  const rt = client.realtime as unknown as {
    socketAdapter: {
      onMessage(cb: (m: { topic: string; event: string }) => void): void;
      socket: { push(m: { topic: string; event: string; payload?: { event?: string } }): void };
    };
  };
  rt.socketAdapter.onMessage((m) => {
    if (m.topic === 'phoenix' || HOUSEKEEPING.has(m.event)) return;
    bump(`in:${m.event}`);
  });
  // every channel push (broadcasts, presence track, joins) goes through the phoenix socket
  const socket = rt.socketAdapter.socket;
  const push = socket.push.bind(socket);
  socket.push = (m) => {
    if (m.topic !== 'phoenix' && !HOUSEKEEPING.has(m.event)) {
      bump(`out:${m.event === 'broadcast' ? `broadcast:${m.payload?.event ?? '?'}` : m.event}`);
    }
    push(m);
  };
  const mp = new SupabaseMultiplayer(client, {
    supabaseUrl: url!,
    supabaseKey: key!,
    leaderboardTable: 'unused',
    lobbyChannelPrefix: prefix,
  }, { sessionId: id });
  return { mp, close: () => mp.disconnect() };
}

const ctx = () => ({
  collisionWorld: new CollisionWorld(),
  spawn: { position: new Vector3(0, 0, 0), yawDeg: 0 },
  botCount: 1,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const ids = Array.from({ length: players }, (_, i) => `p_bud${String.fromCharCode(97 + i)}_${prefix.slice(-6)}`);
  const clients = ids.map((id) => ({ id, ...makeClient(id) }));
  let roomFull = 0;
  for (const c of clients) {
    c.mp.join('budget_map', c.id.slice(0, 8), 'terrorist');
    c.mp.setRoomContext(ctx());
    c.mp.setCombatReady(true);
    c.mp.sendEquip('deagle');
    c.mp.onRoomFull = () => { roomFull += 1; };
  }

  // 128 Hz sim ticks on a shared timer, everyone circling at 9 m/s
  let tickTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
    const now = Date.now();
    clients.forEach((c, i) => {
      const a = (now / 1000) * (9 / 10) + i;
      c.mp.sendState({
        position: [Math.cos(a) * 10, 0, Math.sin(a) * 10],
        velocity: [-Math.sin(a) * 9, 0, Math.cos(a) * 9],
        yaw: a,
        pitch: 0,
        t: now,
      });
    });
  }, 1000 / 128);
  const fireTimer = setInterval(() => {
    const shooter = clients[Math.floor(Math.random() * clients.length)];
    shooter.mp.sendFire([0, 1.6, 0], [1, 0, 0], { targets: {} });
  }, fireEveryMs / Math.max(1, players));

  await sleep(warmup * 1000);
  current = new Map();
  let extra: ReturnType<typeof makeClient> | null = null;
  const t0 = Date.now();
  while (Date.now() - t0 < secs * 1000) {
    await sleep(1000);
    windows.push(current);
    current = new Map();
    const elapsed = (Date.now() - t0) / 1000;
    if (churn && !extra && elapsed >= secs * 0.3) {
      extra = makeClient(`p_budz_${prefix.slice(-6)}`);
      extra.mp.onRoomFull = () => { roomFull += 1; };
      extra.mp.join('budget_map', 'late', 'terrorist');
      extra.mp.setRoomContext(ctx());
    }
    if (churn && extra && elapsed >= secs * 0.7) {
      extra.close();
    }
  }
  clearInterval(tickTimer);
  tickTimer = null;
  clearInterval(fireTimer);

  const totals = windows.map((w) => [...w.values()].reduce((a, b) => a + b, 0));
  const sorted = [...totals].sort((a, b) => a - b);
  const byKey = new Map<string, number>();
  for (const w of windows) for (const [k, v] of w) byKey.set(k, (byKey.get(k) ?? 0) + v);
  const hosts = clients.filter((c) => c.mp.isHosting()).map((c) => c.id.slice(0, 8));
  const result = {
    players,
    churn,
    secs: windows.length,
    hzPerClient: +clients[0].mp.getBroadcastHz().toFixed(2),
    eventsPerSec: {
      mean: +(totals.reduce((a, b) => a + b, 0) / Math.max(1, totals.length)).toFixed(1),
      p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0,
      max: sorted.at(-1) ?? 0,
    },
    perSecond: totals,
    byEventPerSec: Object.fromEntries([...byKey].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +(v / windows.length).toFixed(1)])),
    hosts,
    roomFullEvents: roomFull,
  };
  console.log(JSON.stringify(result, null, 1));
  for (const c of clients) c.close();
  await sleep(500);
  process.exit(0);
}

void main().catch((e) => { console.error(e); process.exit(1); });
