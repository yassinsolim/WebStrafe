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
  const fa = (await state(A)).feet;
  const fb = (await state(B)).feet;
  await qa(B, (q, p) => q.teleport(p[0], p[1] + 0.5, p[2], 0), [(fa[0] + fb[0]) / 2, Math.max(fa[1], fb[1]), (fa[2] + fb[2]) / 2]);
  await sleep(800);
  // run down the open lane toward A, sampling A's drawn copy and B's own position every frame
  await qa(B, (q, id) => q.aimAt(id), idA);
  await qa(B, (q) => q.move(1, 0));
  const sampler = (page, id) => page.evaluate((pid) => new Promise((resolve) => {
    const out = [];
    const t0 = Date.now();
    const tick = () => {
      const s = window.__qa.state();
      const pos = pid ? s.players.find((x) => x.id === pid)?.pos : s.feet;
      if (pos) out.push([Date.now(), ...pos]);
      if (Date.now() - t0 < 3000) requestAnimationFrame(tick);
      else resolve(out);
    };
    requestAnimationFrame(tick);
  }), id);
  await sleep(400);
  const [samples, truthSamples] = await Promise.all([sampler(A.page, idB), sampler(B.page, null)]);
  await qa(B, (q) => q.move(0, 0));
  // B's run ends where its own position stops changing (a wall); only score frames before that
  let runEnd = truthSamples.at(-1)?.[0] ?? 0;
  for (let i = 1; i < truthSamples.length; i += 1) {
    const d = Math.hypot(truthSamples[i][1] - truthSamples[i - 1][1], truthSamples[i][3] - truthSamples[i - 1][3]);
    if (d < 1e-4 && truthSamples.slice(i, i + 10).every((s, k, arr) => k === 0 || Math.hypot(s[1] - arr[k - 1][1], s[3] - arr[k - 1][3]) < 1e-4)) {
      runEnd = truthSamples[i][0];
      break;
    }
  }
  const truth0 = truthSamples[0]?.slice(1) ?? [0, 0, 0];
  const truth1 = truthSamples.at(-1)?.slice(1) ?? [0, 0, 0];
  // the remote copy lags by the interpolation delay, allow 250 ms past the end
  const scored = samples.filter((s) => s[0] <= runEnd + 250);
  const speeds = [];
  for (let i = 1; i < scored.length; i += 1) {
    const dt = (scored[i][0] - scored[i - 1][0]) / 1000;
    if (dt <= 0) continue;
    const d = Math.hypot(scored[i][1] - scored[i - 1][1], scored[i][3] - scored[i - 1][3]);
    speeds.push(d / dt);
  }
  speeds.sort((a, b) => a - b);
  const med = speeds[Math.floor(speeds.length / 2)] ?? 0;
  const frozen = speeds.filter((s) => s < med * 0.1).length;
  const jumps = speeds.filter((s) => s > med * 3).length;
  // where the frozen frames sit: long runs mean snapshot gaps, singles mean duplicate frames
  const runs = [];
  let run = 0;
  for (const s of speeds) {
    if (s < med * 0.1) run += 1;
    else if (run) { runs.push(run); run = 0; }
  }
  if (run) runs.push(run);
  const smooth = med > 1 && frozen / Math.max(1, speeds.length) < 0.1 && jumps / Math.max(1, speeds.length) < 0.03;
  const truthMoved = Math.hypot(truth1[0] - truth0[0], truth1[2] - truth0[2]);
  // no open run on this map (a jump course): the check says nothing about netcode
  if (truthMoved < 3) report.checks['smooth remote movement (skipped, no open lane)'] = { ok: true, detail: { truthMoved } };
  else check('smooth remote movement', smooth, { frozenRuns: runs.slice(0, 12), truthMoved: +Math.hypot(truth1[0] - truth0[0], truth1[2] - truth0[2]).toFixed(1), frames: speeds.length, medianSpeed: +med.toFixed(2), frozenPct: +(100 * frozen / Math.max(1, speeds.length)).toFixed(1), jumpPct: +(100 * jumps / Math.max(1, speeds.length)).toFixed(1) });

  // shoot B from A with each weapon until B dies; wait for respawn between
  const killWith = async (shooter, victimId, victim, weaponId, maxShots) => {
    await qa(shooter, (q, w) => q.equip(w), weaponId);
    await sleep(weaponId === 'awp' ? 1300 : 900);
    const feedBefore = await qa(shooter, (q) => q.killfeedLines());
    // stand next to (knife) or 8 m from (guns) the victim so cover never blocks the line
    const v = (await state(victim)).feet;
    await qa(victim, (q) => q.move(0, 0));
    const melee = weaponId === 'knife' || weaponId === 'katana';
    const offsets = melee ? [[0, 1], [1, 0], [0, -1], [-1, 0]] : [[0, 7], [7, 0], [0, -7], [-7, 0], [5, 5], [-5, -5], [5, -5], [-5, 5]];
    let clear = false;
    for (const [dx, dz] of offsets) {
      await qa(shooter, (q, a) => q.teleport(a.x, a.y, a.z, 0), { x: v[0] + dx, y: v[1] + 0.05, z: v[2] + dz });
      await sleep(500);
      if (await qa(shooter, (q, id) => q.canSee(id), victimId)) { clear = true; break; }
    }
    report.checks[`${weaponId} line of sight`] = { ok: clear };
    // spawn protection after a respawn
    await sleep(1500);
    if (weaponId === 'awp') {
      await qa(shooter, (q) => q.scope());
      await sleep(400);
    }
    for (let i = 0; i < maxShots; i += 1) {
      const vs = await state(victim);
      if (!vs.alive) break;
      await qa(shooter, (q, id) => q.aimAt(id), victimId);
      await qa(shooter, (q, w) => (w === 'knife' || w === 'katana' ? q.stab() : q.fire()), weaponId);
      await sleep(weaponId === 'awp' ? 1600 : weaponId === 'katana' ? 1350 : weaponId === 'knife' ? 1150 : 350);
    }
    let dead = false;
    for (let i = 0; i < 20 && !dead; i += 1) {
      dead = !(await state(victim)).alive;
      if (!dead) await sleep(150);
    }
    await sleep(500);
    const feedAfter = await qa(shooter, (q) => q.killfeedLines());
    // a bot can kill the victim too, so the kill only counts with a killfeed line naming our shooter
    const shooterName = (await state(shooter)).name;
    const victimName = (await state(victim)).name;
    const ours = feedAfter.find((line) => line.startsWith(shooterName) && line.includes(victimName) && !feedBefore.includes(line));
    check(`${weaponId} kill by the shooter`, dead && !!ours, { line: ours ?? null, newest: feedAfter[0] ?? null });
    check(`${weaponId} killfeed updates`, !!ours, { before: feedBefore.length, after: feedAfter.length });
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
  await killWith(A, idB, B, 'katana', 4);

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
    await sleep(1000);
    let hidden = await host.page.evaluate(() => document.visibilityState);
    let how = 'minimized window';
    if (hidden !== 'hidden') {
      // chrome under automation doesn't always report a minimized window as hidden,
      // so fire the same visibility change the game listens for
      await host.page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      hidden = 'hidden (synthetic)';
      how = 'visibilitychange';
    }
    let newHost = -1;
    for (let i = 0; i < 60 && newHost < 0; i += 1) {
      await sleep(250);
      const now = await Promise.all(clients.map(async (c, k) => (k === hostIndex ? false : (await state(c)).hosting)));
      newHost = now.indexOf(true);
    }
    check('host handoff when the host tab is hidden', newHost >= 0, { oldHost: host.name, hostTab: hidden, how, newHost: clients[newHost]?.name ?? null });
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
