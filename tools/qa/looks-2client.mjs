// two real browser clients (plus a legacy client with no look) in one room:
// checks each client renders the other's custom look, that a look change
// mid-session reaches the other client without a rejoin, and that a client
// that sends no look shows the team default. takes a screenshot per client.
//   PLAYWRIGHT_MODULE=... CHROME=... node tools/qa/looks-2client.mjs http://<lan ip>:<port> [out dir] [mapId]
// the base url must serve a build with dev tools (?shot=&qa=1) and its /ws
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import WebSocket from 'ws';

const base = process.argv[2];
const out = process.argv[3] ?? '.artifacts/looks-2client';
const map = process.argv[4] ?? 'aim_ochrecut';
mkdirSync(out, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({
  headless: !process.env.HEADED,
  executablePath: process.env.CHROME || undefined,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist'],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { base, map, checks: {} };
const check = (name, ok, detail) => {
  report.checks[name] = { ok, detail };
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` ${JSON.stringify(detail)}` : ''}`);
};

const LOOK_A = '1.an.an.an.an.an.4a4f57.c9a43c.2b2e33.x.cr.1.IRON';
const LOOK_B = '1.qu.qu.qu.qu.qu.9e2231.141518.c9a43c.g.wg.1.EMBR';
const LOOK_B2 = '1.ve.ve.ve.ve.ve.e4ddcf.8a949f.9e2231.s.sr.0.SNOW';

async function open(name, look) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message.slice(0, 200)));
  await page.goto(`${base}/?shot=${map}&weapon=knife&qa=1&hud=0&look=${look}`, { timeout: 90000 });
  await page.waitForFunction(() => window.__qa && window.__qa.state().localId, null, { timeout: 90000 });
  return { name, page, errors };
}
const qa = (c, fn, arg) => c.page.evaluate(([f, a]) => new Function('qa', 'arg', `return (${f})(qa, arg)`)(window.__qa, a), [fn.toString(), arg]);
const state = (c) => qa(c, (q) => q.state());

async function waitFor(c, pred, label, ms = 20000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < ms) {
    last = await state(c);
    if (pred(last)) return last;
    await sleep(250);
  }
  throw new Error(`timed out: ${label} ${JSON.stringify(last?.players ?? null)}`);
}

let legacy = null;
try {
  const A = await open('A', LOOK_A);
  await sleep(1000);
  const B = await open('B', LOOK_B);
  const idA = (await state(A)).localId;
  const idB = (await state(B)).localId;

  // stand them 3 m apart facing each other
  const feet = (await state(A)).feet;
  await qa(A, (q, p) => q.teleport(p[0], p[1], p[2], 0), feet);
  await qa(B, (q, p) => q.teleport(p[0], p[1], p[2] - 3, 180), feet);

  let sa = await waitFor(A, (s) => s.players.some((p) => p.id === idB && p.look), 'A sees B');
  let sb = await waitFor(B, (s) => s.players.some((p) => p.id === idA && p.look), 'B sees A');
  check('A renders B in B\'s own look', sa.players.find((p) => p.id === idB).look === LOOK_B, { shown: sa.players.find((p) => p.id === idB).look });
  check('B renders A in A\'s own look', sb.players.find((p) => p.id === idA).look === LOOK_A, { shown: sb.players.find((p) => p.id === idA).look });

  // let both settle where they were put, then look at each other
  await sleep(1500);
  await qa(A, (q, id) => q.aimAt(id), idB);
  await qa(B, (q, id) => q.aimAt(id), idA);
  await sleep(600);
  await qa(A, (q, id) => q.aimAt(id), idB);
  await qa(B, (q, id) => q.aimAt(id), idA);
  const pa = await state(A);
  const pb = await state(B);
  report.positions = { A: pa.feet, B: pb.feet, AseesB: pa.players.find((p) => p.id === idB)?.pos, BseesA: pb.players.find((p) => p.id === idA)?.pos };
  console.log('positions', JSON.stringify(report.positions));
  await sleep(800);
  await A.page.screenshot({ path: join(out, 'client_a_sees_b.png') });
  await B.page.screenshot({ path: join(out, 'client_b_sees_a.png') });

  // B changes its look mid-session (a cosmetics message, no rejoin)
  await qa(B, (q, w) => q.setLook(w), LOOK_B2);
  sa = await waitFor(A, (s) => s.players.find((p) => p.id === idB)?.look === LOOK_B2, 'A sees B change');
  check('a look change reaches the other client without a rejoin', true, { shown: sa.players.find((p) => p.id === idB).look });
  await sleep(800);
  await A.page.screenshot({ path: join(out, 'client_a_sees_b_changed.png') });

  // a legacy client that sends no look at all
  legacy = new WebSocket(`${base.replace(/^http/, 'ws')}/ws`, { headers: { Origin: base } });
  await new Promise((resolve, reject) => { legacy.once('open', resolve); legacy.once('error', reject); });
  let legacyId = null;
  legacy.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === 'welcome') legacyId = m.id;
  });
  legacy.send(JSON.stringify({ type: 'join', mapId: map, name: 'Legacy', model: 'counterterrorist' }));
  const pump = setInterval(() => {
    legacy.send(JSON.stringify({ type: 'state', t: Date.now(), position: [feet[0] + 1.5, feet[1], feet[2] - 3], velocity: [0, 0, 0], yaw: 3.14, pitch: 0 }));
  }, 50);
  sa = await waitFor(A, (s) => s.players.some((p) => p.id === legacyId && p.look), 'A sees legacy');
  clearInterval(pump);
  const legacyLook = sa.players.find((p) => p.id === legacyId).look;
  check('a client that sends no look shows the team default', legacyLook === '1.st.st.st.st.st.26334a.8a949f.2f5fa8.s.cv.1.', { shown: legacyLook });

  check('no page errors', A.errors.length + B.errors.length === 0, { A: A.errors, B: B.errors });
} catch (err) {
  check('run', false, String(err.message).slice(0, 300));
} finally {
  legacy?.close();
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
const failed = Object.values(report.checks).filter((c) => !c.ok).length;
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
