// Bots E2E: connects one real WS client to the surf map and verifies the
// server-side bots (ENABLE_BOTS=true) appear in snapshots, actually move on real
// geometry (positions change), and stay within sane bounds (never noclip away).
// Run the server with: PORT=8790 ENABLE_BOTS=true BOTS_PER_MAP=2 tsx server/index.ts
import WebSocket from 'ws';

const PORT = process.env.PORT ?? '8790';
const URL = `ws://localhost:${PORT}/ws`;
const MAP = 'surf_skyworld_x'; // real surf map with collision.glb
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const st = { id: null, snapshots: [], healthOf: {}, deaths: [], shots: [] };
    const to = setTimeout(() => reject(new Error(`${name}: timeout`)), 8000);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'join', mapId: MAP, name, model: 'terrorist' })));
    ws.on('message', (buf) => {
      const m = JSON.parse(buf.toString());
      if (m.type === 'joined') { st.id = m.id; clearTimeout(to); resolve({ ws, st }); }
      if (m.type === 'snapshot') st.snapshots.push(m);
      if (m.type === 'health') st.healthOf[m.playerId] = { health: m.health, alive: m.alive };
      if (m.type === 'death') st.deaths.push(m);
      if (m.type === 'shot') st.shots.push(m);
    });
    ws.on('error', reject);
  });
}

const botRows = (snap) => snap.players.filter((p) => p.id.startsWith('bot:'));
const finite = (p) => p.every((n) => Number.isFinite(n) && Math.abs(n) < 100000);

async function main() {
  const human = await connect('HUMAN');

  // Sit at a fixed spot so bots have someone to chase.
  const place = () => human.ws.send(JSON.stringify({ type: 'state', position: [0, 50, 0], velocity: [0, 0, 0], yaw: 0, pitch: 0 }));
  for (let i = 0; i < 4; i++) { place(); await sleep(50); }

  // Give the server time to load the 61MB collision and spawn bots.
  await sleep(2500);
  human.st.snapshots.length = 0; // drop pre-bot snapshots
  for (let i = 0; i < 40; i++) { place(); await sleep(50); } // ~2s of snapshots

  const snaps = human.st.snapshots.filter((s) => botRows(s).length > 0);
  const results = [];

  const first = snaps[0];
  const last = snaps[snaps.length - 1];
  results.push(['bots present in snapshots', snaps.length > 0]);
  results.push(['expected bot count (2)', first ? botRows(first).length === 2 : false]);

  // All bot positions finite & bounded (no noclip to infinity).
  const allBounded = snaps.every((s) => botRows(s).every((b) => finite(b.position)));
  results.push(['bot positions finite & bounded (no noclip)', allBounded]);

  // At least one bot moved a meaningful amount between first and last snapshot.
  let maxMove = 0;
  if (first && last) {
    for (const b0 of botRows(first)) {
      const b1 = botRows(last).find((b) => b.id === b0.id);
      if (b1) {
        const d = Math.hypot(b1.position[0] - b0.position[0], b1.position[1] - b0.position[1], b1.position[2] - b0.position[2]);
        maxMove = Math.max(maxMove, d);
      }
    }
  }
  results.push([`bots move over time (max move ${maxMove.toFixed(2)})`, maxMove > 0.5]);

  // Bots have health and are alive.
  results.push(['bots have health/alive', first ? botRows(first).every((b) => b.health > 0 && b.alive) : false]);

  // --- Combat: stand next to a bot and verify it shoots the human. ---
  const someBot = last ? botRows(last)[0] : null;
  if (someBot) {
    // Plant the human a short distance from the bot so it has a clear shot.
    const hp = [someBot.position[0], someBot.position[1] + 1, someBot.position[2] + 40];
    const stand = () => human.ws.send(JSON.stringify({ type: 'state', position: hp, velocity: [0, 0, 0], yaw: 0, pitch: 0 }));
    for (let i = 0; i < 90; i++) { stand(); await sleep(50); } // ~4.5s under fire

    const myHealth = human.st.healthOf[human.st.id];
    const tookDamage = (myHealth && myHealth.health < 100) || human.st.deaths.some((d) => d.victimId === human.st.id);
    results.push(['bot damaged the human (offense works)', tookDamage]);

    // Bots broadcast visible gun shots (tracers) with a gun weapon id.
    const botShots = human.st.shots.filter((s) => s.playerId.startsWith('bot:'));
    results.push([`bots broadcast gun shots (${botShots.length})`, botShots.length > 0 && botShots.every((s) => s.weaponId !== 'knife')]);
  } else {
    results.push(['bot damaged the human (offense works)', false]);
    results.push(['bots broadcast gun shots', false]);
  }

  let ok = true;
  for (const [label, pass] of results) { console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}`); if (!pass) ok = false; }
  human.ws.close();
  console.log(ok ? '\nBOTS E2E: ALL PASS' : '\nBOTS E2E: FAILURES');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
