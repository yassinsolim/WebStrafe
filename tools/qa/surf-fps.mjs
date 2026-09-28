// headed gpu fps on each map: spawn, then a view from each checkpoint and the
// finish, 4 s of requestAnimationFrame timing at each.
//   PLAYWRIGHT_MODULE=... CHROME=... [BYPASS_FILE=...] node tools/qa/surf-fps.mjs <base> map1 map2 ...
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const base = process.argv[2];
const maps = process.argv.slice(3);
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
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const origin = new URL(base).origin;
await context.route('**/*', (route) => {
  const req = route.request();
  if (new URL(req.url()).origin !== origin) return route.continue();
  return route.continue({ headers: { ...req.headers(), ...headers } });
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
const qa = (fn, arg) => page.evaluate(([f, a]) => new Function('qa', 'arg', `return (${f})(qa, arg)`)(window.__qa, a), [fn.toString(), arg]);
const measure = (ms) => page.evaluate((ms) => new Promise((resolve) => {
  const times = [];
  let last = performance.now();
  const end = last + ms;
  const step = (t) => {
    times.push(t - last);
    last = t;
    if (t < end) requestAnimationFrame(step);
    else {
      times.sort((a, b) => a - b);
      resolve({ fps: times.length / (ms / 1000), p95: times[Math.floor(times.length * 0.95)] });
    }
  };
  requestAnimationFrame(step);
}), ms);

const report = { base, viewport: '1600x900', maps: [] };
for (const map of maps) {
  await page.goto(`${base}/?shot=${map}&qa=1&room=fps${Math.random().toString(36).slice(2, 7)}`, { timeout: 90000 });
  await page.waitForFunction(() => window.__qa && window.__qa.state().localId !== undefined, null, { timeout: 90000 });
  await page.bringToFront();
  try { execFileSync('osascript', ['-e', 'tell application "Google Chrome for Testing" to activate']); } catch { /* not fatal */ }
  await sleep(3000);
  report.renderer ??= await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const d = gl?.getExtension('WEBGL_debug_renderer_info');
    return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : null;
  });
  const triggers = JSON.parse(await page.evaluate(async (m) => JSON.stringify((await (await fetch(`/maps/${m}/meta.json`)).json()).triggers ?? []), map));
  const views = [{ name: 'spawn', pos: null }];
  for (const t of triggers.filter((x) => x.type === 'checkpoint' || x.type === 'finish')) {
    views.push({ name: t.id, pos: [(t.min[0] + t.max[0]) / 2, t.min[1] + 0.3, (t.min[2] + t.max[2]) / 2] });
  }
  const samples = [];
  for (const v of views) {
    if (v.pos) await qa((q, p) => q.teleport(p[0], p[1], p[2], 0), v.pos);
    await sleep(700);
    const m = await measure(4000);
    samples.push({ view: v.name, fps: +m.fps.toFixed(1), p95FrameMs: +m.p95.toFixed(1) });
  }
  await page.screenshot({ path: `/tmp/surf-fps-${map}.png` });
  const fps = samples.map((s) => s.fps);
  report.maps.push({ map, minFps: Math.min(...fps), meanFps: +(fps.reduce((a, b) => a + b, 0) / fps.length).toFixed(1), samples });
  console.log(JSON.stringify(report.maps.at(-1)));
}
report.errors = errors;
writeFileSync(process.env.REPORT ?? '/tmp/surf-fps.json', JSON.stringify(report, null, 2));
await browser.close();
