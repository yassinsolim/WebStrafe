// Host-bots E2E over Supabase: two clients join a room; the elected host runs
// the bot sim; the peer must SEE bots in its snapshot and get shot by them.
// Run: npx tsx tools/supabase-hostbots-test.ts
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { Vector3 } from 'three';
import { SupabaseMultiplayer } from '../src/network/SupabaseMultiplayer';
import type { SupabaseConfig } from '../src/network/supabaseConfig';
import { CollisionWorld } from '../src/world/CollisionWorld';
import { createMovementTestScene } from '../src/movement/MovementTestScene';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeWorld(): CollisionWorld {
  const { root } = createMovementTestScene();
  const world = new CollisionWorld();
  world.setCollisionFromRoot(root);
  return world;
}

async function main(): Promise<void> {
  const cfg = JSON.parse(
    await readFile(new URL('../public/config/webstrafe.config.json', import.meta.url), 'utf8'),
  ) as SupabaseConfig;

  const spawn = { position: new Vector3(0, 6, 4), yawDeg: 0 };
  const mk = () => new SupabaseMultiplayer(
    createClient(cfg.supabaseUrl, cfg.supabaseKey, { realtime: { params: { eventsPerSecond: 20 } } }),
    cfg,
  );

  const host = mk();
  const peer = mk();
  const room = 'hostbots_' + Math.floor(Math.random() * 1e6);

  let peerBots = 0;
  let peerHealthHit = false;
  let peerSawShot = false;
  peer.onSnapshot = (s) => { peerBots = Math.max(peerBots, s.players.filter((p) => p.id.startsWith('bot:')).length); };
  peer.onHealth = (e) => { if (e.playerId === peer.getLocalId() && e.health < 100) peerHealthHit = true; };
  peer.onShot = (e) => { if (e.playerId.startsWith('bot:')) peerSawShot = true; };

  for (const c of [host, peer]) {
    c.connect();
    c.setRoomContext({ collisionWorld: makeWorld(), spawn, botCount: 2 });
    c.join(room, c === host ? 'HostPlayer' : 'PeerPlayer', 'terrorist');
  }
  await sleep(2500);

  // Keep both humans planted near the bot spawn so bots engage the peer.
  for (let i = 0; i < 90; i++) {
    host.sendState({ position: [2, 6, 4], velocity: [0, 0, 0], yaw: 0, pitch: 0 });
    peer.sendState({ position: [0, 6, 40], velocity: [0, 0, 0], yaw: 0, pitch: 0 });
    await sleep(50);
  }

  const results: Array<[string, boolean]> = [];
  results.push(['peer sees bots in snapshot', peerBots >= 1]);
  results.push(['exactly 2 bots', peerBots === 2]);
  results.push(['peer took bot fire (health < 100)', peerHealthHit]);
  results.push(['peer saw a bot tracer (shot event)', peerSawShot]);

  let ok = true;
  for (const [label, pass] of results) { console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}`); if (!pass) ok = false; }
  host.disconnect();
  peer.disconnect();
  console.log(ok ? '\nHOST-BOTS E2E: ALL PASS' : '\nHOST-BOTS E2E: FAILURES');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('ERROR', e); process.exit(1); });
