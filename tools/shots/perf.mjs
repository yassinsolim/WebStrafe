// real-gpu frame timing: headed chromium (metal through angle), 2560x1440 viewport.
//   node tools/shots/perf.mjs <base url> <out.json> <query>=<label> [...]
// each query is appended to "/?" and must contain shot=<map>&perf=<seconds>.
// env: PLAYWRIGHT_MODULE, CHROME, VSYNC=1 keeps the display frame cap,
//      BYPASS_FILE path to a vercel protection bypass secret (never logged)
import { readFileSync, writeFileSync } from 'node:fs';

const [base, out, ...jobs] = process.argv.slice(2);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
// SOFTWARE=1 runs headless swiftshader instead, a stand-in for a weak gpu
const software = !!process.env.SOFTWARE;
const args = software
  ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  : ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=metal'];
if (!process.env.VSYNC) args.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
const browser = await chromium.launch({ headless: software, executablePath: process.env.CHROME || undefined, args });
const headers = {};
if (process.env.BYPASS_FILE) {
  headers['x-vercel-protection-bypass'] = readFileSync(process.env.BYPASS_FILE, 'utf8').trim();
  headers['x-vercel-set-bypass-cookie'] = 'true';
}
const width = Number(process.env.WIDTH ?? 2560);
const height = Number(process.env.HEIGHT ?? 1440);
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, extraHTTPHeaders: headers });
const page = await context.newPage();
if (process.env.CPU_THROTTLE) {
  // slows the page's main thread like a weaker machine
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU_THROTTLE) });
}
const errors = [];
page.on('console', (msg) => {
  if (msg.type() !== 'error') return;
  const text = msg.text();
  if (process.env.QUIET_WS && (text.includes('WebSocket') || text.includes('500'))) return;
  errors.push(text.slice(0, 200));
});
page.on('pageerror', (err) => errors.push(`pageerror ${err.message.slice(0, 200)}`));

const gl = await (async () => {
  await page.goto('about:blank');
  return page.evaluate(() => {
    const c = document.createElement('canvas').getContext('webgl2');
    const ext = c?.getExtension('WEBGL_debug_renderer_info');
    return c ? c.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : c.RENDERER) : 'none';
  });
})();
console.log(`renderer: ${gl}`);

const results = [];
for (const job of jobs) {
  const eq = job.lastIndexOf('=');
  const query = job.slice(0, eq);
  const label = job.slice(eq + 1);
  try {
    await page.goto(`${base}/?${query}`, { timeout: 60000 });
    await page.waitForFunction(() => window.__perfResult, null, { timeout: 120000, polling: 250 });
    const r = await page.evaluate(() => window.__perfResult);
    results.push({ label, query, ...r });
    console.log(`${label.padEnd(28)} fps med ${String(r.fpsMedian).padStart(6)}  1% low ${String(r.fps1Low).padStart(6)}  frame ${r.frameMsMedian}/${r.frameMsP99} ms  cpu ${r.cpuMsMedian}/${r.cpuMsP99} ms  calls ${r.calls}  tris ${r.triangles}  ${r.canvas.join('x')}@${r.pixelRatio}  >16ms ${r.over16} >33ms ${r.over33} worst ${JSON.stringify(r.worst)}`);
  } catch (err) {
    results.push({ label, query, error: String(err.message).slice(0, 200) });
    console.log(`${label} FAIL ${String(err.message).slice(0, 160)}`);
  }
}
writeFileSync(out, JSON.stringify({ renderer: gl, vsync: !!process.env.VSYNC, viewport: [width, height], results, errors: [...new Set(errors)] }, null, 2));
if (errors.length) console.log(`console errors: ${[...new Set(errors)].length}`);
await browser.close();
