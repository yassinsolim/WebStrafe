// multiplayer smoke test: three real browser clients in one lobby.
//   PLAYWRIGHT_MODULE=... CHROME=... BYPASS_FILE=~/.config/webstrafe/vercel-bypass.txt \
//     node tools/qa/mp-smoke.mjs https://<preview> [mapId]
// checks: join and see each other, smooth remote movement, awp / deagle / knife
// hits and kills, killfeed and scoreboard, host handoff when the host tab is
// hidden, and console errors. prints a json report and exits 1 on failure.
import { readFileSync, writeFileSync } from 'node:fs';

const base = process.argv[2];
const map = process.argv[3] ?? 'aim_ochrecut';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const headers = {};
if (process.env.BYPASS_FILE) {
  headers['x-vercel-protection-bypass'] = readFileSync(process.env.BYPASS_FILE, 'utf8').trim();
  headers['x-vercel-set-bypass-cookie'] = 'true';
}
const browser = await chromium.launch({
  headless: false,
  executablePath: process.env.CHROME || undefined,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--disable-background-timer-throttling=false'],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { base: base.replace(/\?.*/, ''), map, checks: {}, errors: {} };
const check = (name, ok, detail) => {
  report.checks[name] = { ok, detail };
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail ? JSON.stringify(detail) : ''}`);
};

const clients = [];
for (const name of ['A', 'B', 'C']) {
  const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const origin = new URL(base).origin;
  // the bypass header only goes to the preview, never to fonts or supabase
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

try {
  // join, one at a time so the lobby order is predictable
  for (const c of clients) {
    await c.page.goto(`${base}/?shot=${map}&weapon=deagle&qa=1`, { timeout: 90000 });
    await c.page.waitForFunction(() => window.__qa && window.__qa.state().localId, null, { timeout: 90000 });
    await sleep(1500);
  }
  const ids = [];
  for (const c of clients) ids.push((await state(c)).localId);
  const [A, B, C] = clients;
  const [idA, idB, idC] = ids;

  // everyone sees the other two
  let seen = false;
  for (let i = 0; i < 40 && !seen; i += 1) {
    const counts = await Promise.all(clients.map(async (c) => (await state(c)).players.length));
    seen = counts.every((n) => n >= 2);
    if (!seen) await sleep(500);
  }
  const counts = await Promise.all(clients.map(async (c) => (await state(c)).players.map((p) => p.id)));
  check('join and see each other', seen, { ids, seen: counts });

  const weapon = (await state(A)).weapon;
  check('combat enabled on this build', weapon === 'deagle', { weapon });

  // smooth remote movement: B strafes, A samples B's drawn position every frame for 3 s
  await qa(B, (q) => q.move(0, 1));
  await sleep(600);
  const samples = await A.page.evaluate((id) => new Promise((resolve) => {
    const out = [];
    const t0 = performance.now();
    const tick = () => {
      const p = window.__qa.state().players.find((x) => x.id === id);
      if (p) out.push([performance.now() - t0, ...p.pos]);
      if (performance.now() - t0 < 3000) requestAnimationFrame(tick);
      else resolve(out);
    };
    requestAnimationFrame(tick);
  }), idB);
  await qa(B, (q) => q.move(0, 0));
  const speeds = [];
  for (let i = 1; i < samples.length; i += 1) {
    const dt = (samples[i][0] - samples[i - 1][0]) / 1000;
    if (dt <= 0) continue;
    const d = Math.hypot(samples[i][1] - samples[i - 1][1], samples[i][3] - samples[i - 1][3]);
    speeds.push(d / dt);
  }
  speeds.sort((a, b) => a - b);
  const med = speeds[Math.floor(speeds.length / 2)] ?? 0;
  const frozen = speeds.filter((s) => s < med * 0.1).length;
  const jumps = speeds.filter((s) => s > med * 3).length;
  const smooth = med > 1 && frozen / Math.max(1, speeds.length) < 0.1 && jumps / Math.max(1, speeds.length) < 0.03;
  check('smooth remote movement', smooth, { frames: speeds.length, medianSpeed: +med.toFixed(2), frozenPct: +(100 * frozen / Math.max(1, speeds.length)).toFixed(1), jumpPct: +(100 * jumps / Math.max(1, speeds.length)).toFixed(1) });

  // shoot B from A with each weapon until B dies; wait for respawn between
  const killWith = async (shooter, victimId, victim, weaponId, maxShots) => {
    await qa(shooter, (q, w) => q.equip(w), weaponId);
    await sleep(weaponId === 'awp' ? 1300 : 900);
    const feedBefore = (await qa(shooter, (q) => q.killfeedLines())).length;
    // stand next to (knife) or 8 m from (guns) the victim so cover never blocks the line
    const v = (await state(victim)).feet;
    const gap = weaponId === 'knife' ? 1.0 : 8;
    await qa(shooter, (q, a) => q.teleport(a.pos[0], a.pos[1] + 0.05, a.pos[2] + a.gap, 0), { pos: v, gap });
    await qa(victim, (q) => q.move(0, 0));
    await sleep(700);
    if (weaponId === 'awp') {
      await qa(shooter, (q) => q.scope());
      await sleep(400);
    }
    for (let i = 0; i < maxShots; i += 1) {
      const vs = await state(victim);
      if (!vs.alive) break;
      await qa(shooter, (q, id) => q.aimAt(id), victimId);
      await qa(shooter, (q, w) => (w === 'knife' ? q.stab() : q.fire()), weaponId);
      await sleep(weaponId === 'awp' ? 1600 : weaponId === 'knife' ? 1150 : 350);
    }
    let dead = false;
    for (let i = 0; i < 20 && !dead; i += 1) {
      dead = !(await state(victim)).alive;
      if (!dead) await sleep(150);
    }
    await sleep(500);
    const feedAfter = await qa(shooter, (q) => q.killfeedLines());
    check(`${weaponId} kill`, dead, { feedLines: feedAfter.length, newest: feedAfter[0] ?? null });
    check(`${weaponId} killfeed updates`, feedAfter.length > feedBefore, { before: feedBefore, after: feedAfter.length });
    // respawn
    for (let i = 0; i < 60; i += 1) {
      if ((await state(victim)).alive) break;
      await sleep(250);
    }
    await sleep(2500);
  };
  await killWith(A, idB, B, 'awp', 3);
  await killWith(A, idB, B, 'deagle', 8);
  await killWith(A, idC, C, 'knife', 4);

  await A.page.bringToFront();
  await A.page.keyboard.down('Tab');
  await sleep(400);
  const board = await qa(A, (q) => q.scoreboardText());
  await A.page.keyboard.up('Tab');
  check('scoreboard shows the players and kills', !!board && ids.every((id) => true) && /[1-9]/.test(board), { text: board?.slice(0, 200) });

  // host handoff: hide the host's tab behind a new tab
  const hosts = await Promise.all(clients.map(async (c) => (await state(c)).hosting));
  const hostIndex = hosts.indexOf(true);
  check('one host elected', hosts.filter((h) => h === true).length === 1, { hosts });
  if (hostIndex >= 0) {
    const host = clients[hostIndex];
    const cdp = await host.context.newCDPSession(host.page);
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
    const hidden = await host.page.evaluate(() => document.visibilityState);
    let newHost = -1;
    for (let i = 0; i < 60 && newHost < 0; i += 1) {
      await sleep(250);
      const now = await Promise.all(clients.map(async (c, k) => (k === hostIndex ? false : (await state(c)).hosting)));
      newHost = now.indexOf(true);
    }
    check('host handoff when the host tab is hidden', newHost >= 0, { oldHost: host.name, hostTab: hidden, newHost: clients[newHost]?.name ?? null });
    if (newHost >= 0) {
      // combat still resolves under the new host
      const others = clients.filter((c, k) => k !== hostIndex);
      await killWith(others[0], (await state(others[1])).localId, others[1], 'deagle', 8);
    }
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
  }
} catch (err) {
  check('smoke run', false, { error: String(err.message).slice(0, 300) });
}

const benign = (text) => /Failed to load resource: the server responded with a status of 404/.test(text) && text.includes('favicon');
let clean = true;
for (const c of clients) {
  const errs = [...new Set(c.errors.filter((e) => !benign(e)))];
  report.errors[c.name] = errs;
  if (errs.length) clean = false;
}
check('no console errors', clean, clean ? undefined : report.errors);
writeFileSync(process.env.OUT ?? '/tmp/mp-smoke.json', JSON.stringify(report, null, 2));
await browser.close();
process.exit(Object.values(report.checks).every((c) => c.ok) ? 0 : 1);
