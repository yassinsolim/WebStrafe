// surf + pvp smoke test: three real browser clients in one private room on a
// surf map, two opted into pvp and one peaceful.
//   PLAYWRIGHT_MODULE=... CHROME=... [BYPASS_FILE=~/.config/webstrafe/vercel-bypass.txt] \
//   [BOARDS_URL=http://127.0.0.1:54331 BOARDS_KEY=...] \
//     node tools/qa/surf-pvp-smoke.mjs https://<preview or local build> [mapId]
// checks: pvp flags reach everyone, peaceful players can't hit or be hit,
// pvp players can kill each other, the host's room kills reach every client,
// no bots on a surf map, a timed run with splits finishes and submits.
// prints a json report and exits 1 on failure.
import { readFileSync, writeFileSync } from 'node:fs';

const base = process.argv[2];
const map = process.argv[3] ?? 'surf_prismline';
const room = `s${Math.random().toString(36).slice(2, 9)}`;
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const headers = {};
if (process.env.BYPASS_FILE) {
  headers['x-vercel-protection-bypass'] = readFileSync(process.env.BYPASS_FILE, 'utf8').trim();
  headers['x-vercel-set-bypass-cookie'] = 'true';
}
const browser = await chromium.launch({
  headless: false,
  executablePath: process.env.CHROME || undefined,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { base: base.replace(/\?.*/, ''), map, room, checks: {}, errors: {} };
let failed = false;
const check = (name, ok, detail) => {
  report.checks[name] = { ok, detail };
  if (!ok) failed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail !== undefined ? JSON.stringify(detail) : ''}`);
};

const clients = [];
for (const name of ['A', 'B', 'C']) {
  const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const origin = new URL(base).origin;
  await context.route('**/*', (route) => {
    const req = route.request();
    if (new URL(req.url()).origin !== origin) return route.continue();
    return route.continue({ headers: { ...req.headers(), ...headers } });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text().slice(0, 240));
  });
  page.on('pageerror', (err) => errors.push(`pageerror ${err.message.slice(0, 240)}`));
  clients.push({ name, context, page, errors });
}
const qa = (c, fn, arg) => c.page.evaluate(([f, a]) => {
  // eslint-disable-next-line no-new-func
  return new Function('qa', 'arg', `return (${f})(qa, arg)`)(window.__qa, a);
}, [fn.toString(), arg]);
const state = (c) => qa(c, (q) => q.state());

async function shootAt(shooter, victimId, shots) {
  const results = [];
  for (let i = 0; i < shots; i += 1) {
    await qa(shooter, (q, id) => q.aimAt(id), victimId);
    await qa(shooter, (q) => q.fire());
    await sleep(750);
    results.push(await qa(shooter, (q) => q.killfeedLines()));
  }
  return results;
}

try {
  for (const c of clients) {
    await c.page.goto(`${base}/?shot=${map}&weapon=deagle&qa=1&room=${room}`, { timeout: 90000 });
    await c.page.waitForFunction(() => window.__qa && window.__qa.state().localId, null, { timeout: 90000 });
    await sleep(1500);
  }
  const [A, B, C] = clients;
  const ids = [];
  for (const c of clients) ids.push((await state(c)).localId);
  const [idA, idB, idC] = ids;
  const names = [];
  for (const c of clients) names.push((await state(c)).name);

  let seen = false;
  for (let i = 0; i < 40 && !seen; i += 1) {
    const counts = await Promise.all(clients.map(async (c) => (await state(c)).players.length));
    seen = counts.every((n) => n >= 2);
    if (!seen) await sleep(500);
  }
  check('join and see each other', seen, { ids });

  const s0 = (await state(A)).surf;
  check('surf map is timed, peaceful by default, toggleable', s0.timed && !s0.pvp && s0.pvpToggleable, { modes: s0.modes, pvp: s0.pvp });

  await qa(A, (q) => q.togglePvp());
  await qa(B, (q) => q.togglePvp());
  await sleep(2500);
  const rosterOnC = (await state(C)).surf.roster;
  const flag = (id) => rosterOnC.find((p) => p.id === id)?.pvp;
  check('pvp flags reach other clients', flag(idA) === true && flag(idB) === true, { rosterOnC });
  const rosterOnA = (await state(A)).surf.roster;
  check('the peaceful player shows as peaceful', rosterOnA.find((p) => p.id === idC)?.pvp === false, { rosterOnA });
  check('no host bots on a surf map', !rosterOnA.some((p) => p.id.startsWith('bot:')), {});
  const badgeA = await qa(A, (q) => q.pvpBadgeText());
  const badgeC = await qa(C, (q) => q.pvpBadgeText());
  check('pvp badge shows each player their mode', /pvp on/i.test(badgeA ?? '') && /peaceful/i.test(badgeC ?? ''), { badgeA, badgeC });

  // spawn protection has to run out before anything can land
  await sleep(2500);
  const zones = JSON.parse(await C.page.evaluate(async (m) => JSON.stringify((await (await fetch(`/maps/${m}/meta.json`)).json()).triggers), map));
  const start = zones.find((t) => t.type === 'start');
  const mid = [(start.min[0] + start.max[0]) / 2, start.min[1] + 0.55, (start.min[2] + start.max[2]) / 2];
  // both inside the start zone, 6 m apart on the same floor
  async function duel(shooter, victim, victimId) {
    await qa(victim, (q) => q.move(0, 0));
    await qa(victim, (q, p) => q.teleport(p[0] + 3, p[1], p[2], 90), mid);
    await qa(shooter, (q, p) => q.teleport(p[0] - 3, p[1], p[2], -90), mid);
    await sleep(1200);
    return qa(shooter, (q, id) => q.canSee(id), victimId);
  }

  // positive control first: pvp vs pvp must land, or the immunity checks mean nothing
  const sightAB = await duel(A, B, idB);
  await qa(A, (q, id) => q.aimAt(id), idB);
  await sleep(300);
  const platesPvp = await qa(A, (q) => q.nameplates());
  let killed = false;
  for (let i = 0; i < 10 && !killed; i += 1) {
    await shootAt(A, idB, 1);
    const b = await state(B);
    killed = !b.alive || b.health === 0;
    if (!killed && b.health < 100) report.bHealth = b.health;
  }
  check('pvp players can kill each other', sightAB && killed, { sightAB, bHealth: report.bHealth });
  await sleep(3500);

  const sightAC = await duel(A, C, idC);
  await qa(A, (q, id) => q.aimAt(id), idC);
  await sleep(300);
  const platesPeace = await qa(A, (q) => q.nameplates());
  check('nameplates show pvp state', platesPvp.some((t) => t.includes(names[1]) && /PVP/.test(t))
    && platesPeace.some((t) => t.includes(names[2]) && /PEACEFUL/.test(t)), { platesPvp, platesPeace });
  await shootAt(A, idC, 4);
  const cAfter = await state(C);
  check('a peaceful player takes no damage from a pvp player', sightAC && cAfter.health === 100 && cAfter.alive, { sightAC, health: cAfter.health, alive: cAfter.alive });

  await qa(C, (q) => q.equip('deagle'));
  const sightCA = await duel(C, A, idA);
  const aBefore = (await state(A)).health;
  await shootAt(C, idA, 4);
  const aAfter = await state(A);
  check('a peaceful player cannot damage a pvp player', sightCA && aAfter.health === aBefore && aAfter.alive, { sightCA, before: aBefore, health: aAfter.health });

  let scores = [];
  for (let i = 0; i < 12; i += 1) {
    scores = (await state(C)).surf.scores;
    if (scores.find((r) => r.id === idA)?.kills >= 1) break;
    await sleep(500);
  }
  check('room kills from the host reach every client', scores.find((r) => r.id === idA)?.kills >= 1 && scores.find((r) => r.id === idB)?.deaths >= 1, { scores });

  await C.page.keyboard.down('Tab');
  await sleep(300);
  const boardText = await qa(C, (q) => q.roomBoardText());
  await C.page.keyboard.up('Tab');
  check('hold tab shows the live room board', (boardText ?? '').includes(names[0]) && /Room kills/i.test(boardText ?? ''), { boardText });

  // timed run on the peaceful player: start zone, out, each checkpoint, finish
  const center = (t) => [(t.min[0] + t.max[0]) / 2, t.min[1] + 0.3, (t.min[2] + t.max[2]) / 2];
  const checkpoints = zones.filter((t) => t.type === 'checkpoint').sort((a, b) => a.stage - b.stage);
  const finish = zones.find((t) => t.type === 'finish');
  await qa(C, (q) => q.restartRun());
  await sleep(600);
  const ready = (await state(C)).surf.phase;
  const out = [center(start)[0], center(start)[1], start.min[2] - 0.8];
  await qa(C, (q, p) => q.teleport(p[0], p[1], p[2], 0), out);
  await sleep(250);
  const running = (await state(C)).surf.phase;
  // hold just outside the start zone long enough to beat stage 1's minimum honestly
  for (let i = 0; i < 10; i += 1) {
    await qa(C, (q, p) => q.teleport(p[0], p[1], p[2], 0), out);
    await sleep(300);
  }
  for (const cp of checkpoints) {
    await qa(C, (q, p) => q.teleport(p[0], p[1], p[2], 0), center(cp));
    await sleep(3200);
  }
  await qa(C, (q, p) => q.teleport(p[0], p[1], p[2], 0), center(finish));
  await sleep(800);
  const done = (await state(C)).surf;
  check('timed run: armed, runs, records a split per checkpoint and finishes ranked',
    ready === 'ready' && running === 'running' && done.phase === 'finished' && done.lastFinish?.ranked === true
      && done.splits.length === checkpoints.length,
    { ready, running, phase: done.phase, finish: done.lastFinish });
  const overlay = await C.page.evaluate(() => document.querySelector('.run-submit-status')?.textContent ?? '');
  check('finish overlay shows the time', /Finished in/.test(overlay), { overlay });

  const runName = `QA ${room.slice(1, 7)}`;
  const rankedBoards = (await state(C)).surf.boardsAvailable;
  if (!rankedBoards) {
    // without the migration the submit would go to the legacy table, which is
    // production's too. skip it so qa never lands on the real leaderboard.
    await C.page.click('.run-submit-button-secondary');
    await sleep(500);
    const hidden = await C.page.evaluate(() => getComputedStyle(document.querySelector('.run-submit-overlay')).display === 'none');
    check('without the migration the ranked boards stay off and skip closes the overlay', hidden, { boardsAvailable: rankedBoards });
    throw Object.assign(new Error('done'), { done: true });
  }
  await C.page.fill('.run-submit-input', runName);
  await C.page.click('.run-submit-button:not(.run-submit-button-secondary)');
  let submitStatus = '';
  for (let i = 0; i < 20; i += 1) {
    await sleep(400);
    submitStatus = await C.page.evaluate(() => document.querySelector('.run-submit-status')?.textContent ?? '');
    if (!/Submitting/.test(submitStatus)) break;
  }
  const boardsAvailable = (await state(C)).surf.boardsAvailable;
  check('run submits through the ranked path', boardsAvailable ? /Ranked #\d/.test(submitStatus) : submitStatus.length > 0, { submitStatus, boardsAvailable });

  if (process.env.BOARDS_URL && process.env.BOARDS_KEY) {
    const h = { apikey: process.env.BOARDS_KEY, Authorization: `Bearer ${process.env.BOARDS_KEY}` };
    const runs = await (await fetch(`${process.env.BOARDS_URL}/rest/v1/webstrafe_run_bests?map_id=eq.${map}&select=name,time_ms,stage_ms,has_ghost`, { headers: h })).json();
    check('the run is on the server board with stage times and a ghost',
      runs.some((r) => r.name === runName && r.stage_ms.length === checkpoints.length + 1 && r.has_ghost), { runs });
    let kills = [];
    for (let i = 0; i < 10; i += 1) {
      kills = await (await fetch(`${process.env.BOARDS_URL}/rest/v1/webstrafe_kills_daily?select=name,kills,deaths`, { headers: h })).json();
      if (kills.some((r) => r.name === names[0] && r.kills >= 1)) break;
      await sleep(1000);
    }
    check('the kill is on the daily kills board', kills.some((r) => r.name === names[0] && r.kills >= 1), { kills, killer: names[0] });
  }

} catch (err) {
  if (!err?.done) check('script ran to the end', false, String(err?.stack ?? err).slice(0, 600));
} finally {
  for (const c of clients) report.errors[c.name] = c.errors;
  // without the migration each client's first boards query 404s once, then the client stops asking
  const noisy = clients.flatMap((c) => c.errors).filter((e) => !/favicon|ERR_BLOCKED|net::ERR_ABORTED/.test(e)
    && !(report.checks['without the migration the ranked boards stay off and skip closes the overlay'] && /status of 404/.test(e)));
  check('no console errors', noisy.length === 0, noisy.slice(0, 5));
  writeFileSync(process.env.REPORT ?? '/tmp/surf-pvp-smoke.json', JSON.stringify(report, null, 2));
  await browser.close();
}
process.exit(failed ? 1 : 0);
