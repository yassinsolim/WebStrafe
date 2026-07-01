// Combat netcode E2E: two real WS clients against a running server. One shoots
// the other; verifies hit, health drop, death, and respawn broadcasts.
// Requires the dev server running (npm run dev) or `tsx server/index.ts`.
import WebSocket from 'ws';

const URL = 'ws://localhost:8787/ws';
const MAP = 'combat_e2e_map';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const st = { id: null, events: [], healthOf: {}, deaths: [], respawns: [] };
    const to = setTimeout(() => reject(new Error(`${name}: timeout`)), 8000);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'join', mapId: MAP, name, model: 'terrorist' })));
    ws.on('message', (buf) => {
      const m = JSON.parse(buf.toString());
      if (m.type === 'joined') { st.id = m.id; clearTimeout(to); resolve({ ws, st }); }
      if (m.type === 'hit') st.events.push(m);
      if (m.type === 'health') st.healthOf[m.playerId] = { health: m.health, alive: m.alive };
      if (m.type === 'death') st.deaths.push(m);
      if (m.type === 'respawn') st.respawns.push(m);
    });
    ws.on('error', reject);
  });
}

async function main() {
  const shooter = await connect('SHOOTER');
  const target = await connect('TARGET');

  // Position both: shooter at origin, target 8u down -Z, same map.
  const place = (c, pos) => c.ws.send(JSON.stringify({ type: 'state', position: pos, velocity: [0, 0, 0], yaw: 0, pitch: 0 }));
  for (let i = 0; i < 5; i++) { place(shooter, [0, 0, 0]); place(target, [0, 0, -8]); await sleep(40); }

  // Equip AWP (one-shot) and fire straight at the target.
  shooter.ws.send(JSON.stringify({ type: 'equip', weaponId: 'awp' }));
  await sleep(100);
  shooter.ws.send(JSON.stringify({ type: 'fire', origin: [0, 1.6, 0], dir: [0, 0, -1] }));
  await sleep(300);

  const results = [];
  results.push(['hit broadcast received', shooter.st.events.some((e) => e.targetId === target.st.id)]);
  results.push(['target took lethal damage (death)', shooter.st.deaths.some((d) => d.victimId === target.st.id)]);
  results.push(['target health synced to 0/ dead', target.st.healthOf[target.st.id]?.alive === false]);

  // Wait for respawn (RESPAWN_DELAY_MS = 3000).
  await sleep(3300);
  results.push(['target respawned', shooter.st.respawns.some((r) => r.playerId === target.st.id)]);
  results.push(['target health restored', (target.st.healthOf[target.st.id]?.health ?? 0) === 100]);

  // Miss test: aim away, no new death.
  const deathsBefore = shooter.st.deaths.length;
  for (let i = 0; i < 3; i++) { place(shooter, [0, 0, 0]); place(target, [0, 0, -8]); await sleep(40); }
  shooter.ws.send(JSON.stringify({ type: 'fire', origin: [0, 1.6, 0], dir: [1, 0, 0] }));
  await sleep(300);
  results.push(['shot aimed away does not kill', shooter.st.deaths.length === deathsBefore]);

  let ok = true;
  for (const [label, pass] of results) { console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}`); if (!pass) ok = false; }
  shooter.ws.close(); target.ws.close();
  console.log(ok ? '\nCOMBAT NETCODE E2E: ALL PASS' : '\nCOMBAT NETCODE E2E: FAILURES');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
