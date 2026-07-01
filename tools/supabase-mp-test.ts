// Supabase multiplayer transport E2E: two SupabaseMultiplayer instances join the
// same room against the REAL project and must see each other's state + attacks.
// Run: npx tsx tools/supabase-mp-test.ts
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { SupabaseMultiplayer } from '../src/network/SupabaseMultiplayer';
import type { SupabaseConfig } from '../src/network/supabaseConfig';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const raw = JSON.parse(
    await readFile(new URL('../public/config/webstrafe.config.json', import.meta.url), 'utf8'),
  ) as SupabaseConfig;

  const mk = () => {
    const client = createClient(raw.supabaseUrl, raw.supabaseKey, {
      realtime: { params: { eventsPerSecond: 20 } },
    });
    return new SupabaseMultiplayer(client, raw);
  };

  const a = mk();
  const b = mk();
  let aSnap: string[] = [];
  let bSnap: string[] = [];
  let bGotAttack = false;

  a.onSnapshot = (s) => { aSnap = s.players.map((p) => p.name); };
  b.onSnapshot = (s) => { bSnap = s.players.map((p) => p.name); };
  b.onAttack = () => { bGotAttack = true; };

  a.connect();
  b.connect();
  a.join('custom', 'Alice', 'terrorist');
  b.join('custom', 'Bob', 'counterterrorist');
  await sleep(2500);

  a.sendState({ position: [1, 2, 3], velocity: [0, 0, 0], yaw: 0.1, pitch: 0 });
  b.sendState({ position: [4, 5, 6], velocity: [0, 0, 0], yaw: -0.2, pitch: 0 });
  await sleep(2000);

  a.sendAttack('primary');
  await sleep(1200);

  const results: Array<[string, boolean]> = [];
  results.push(['A sees Bob in snapshot', aSnap.includes('Bob')]);
  results.push(['B sees Alice in snapshot', bSnap.includes('Alice')]);
  results.push(['A sees itself (Alice)', aSnap.includes('Alice')]);
  results.push(['B received Alice\u2019s attack', bGotAttack]);

  let ok = true;
  for (const [label, pass] of results) {
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}`);
    if (!pass) ok = false;
  }
  a.disconnect();
  b.disconnect();
  console.log(ok ? '\nSUPABASE MP E2E: ALL PASS' : '\nSUPABASE MP E2E: FAILURES');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('ERROR', e); process.exit(1); });
