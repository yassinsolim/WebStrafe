// frame timing that works the same on any build with ?shot=: loads the shot,
// waits out shader compiles and warm up, then records rAF frame times.
//   node tools/shots/fps.mjs <base url> <out.json> <query>=<label> [...]
// env: PLAYWRIGHT_MODULE, CHROME, WIDTH, HEIGHT (default 2560x1440), SECONDS (6),
//      WARMUP_MS (3000), SOFTWARE=1 (headless swiftshader), CPU_THROTTLE=<rate>
// reports median fps, 1% low (mean fps of the slowest 1% of frames), p95 frame ms
import { writeFileSync } from 'node:fs';

const [base, out, ...jobs] = process.argv.slice(2);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const software = !!process.env.SOFTWARE;
const args = software
  ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  : ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=metal', '--disable-gpu-vsync', '--disable-frame-rate-limit'];
const browser = await chromium.launch({ headless: software, executablePath: process.env.CHROME || undefined, args });
const width = Number(process.env.WIDTH ?? 2560);
const height = Number(process.env.HEIGHT ?? 1440);
const seconds = Number(process.env.SECONDS ?? 6);
const warmup = Number(process.env.WARMUP_MS ?? 3000);
const results = [];
for (const job of jobs) {
  const eq = job.lastIndexOf('=');
  const query = job.slice(0, eq);
  const label = job.slice(eq + 1);
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  if (process.env.CPU_THROTTLE) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU_THROTTLE) });
  }
  try {
    await page.goto(`${base}/?${query}`, { timeout: 120000 });
    await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 600000, polling: 500 });
    await page.waitForTimeout(warmup);
    const r = await page.evaluate((ms) => new Promise((resolve) => {
      const times = [];
      let last = performance.now();
      const start = last;
      const tick = (now) => {
        times.push(now - last);
        last = now;
        if (now - start < ms) requestAnimationFrame(tick);
        else resolve(times);
      };
      requestAnimationFrame(tick);
    }), seconds * 1000);
    const info = await page.evaluate(() => ({ shot: window.__shotInfo ?? null, canvas: (() => { const c = document.querySelector('canvas'); return c ? [c.width, c.height] : null; })() }));
    const sorted = [...r].sort((a, b) => a - b);
    const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
    const slow = sorted.slice(Math.floor(sorted.length * 0.99));
    const slowMean = slow.reduce((a, b) => a + b, 0) / Math.max(1, slow.length);
    const row = {
      label,
      query,
      frames: sorted.length,
      fpsMedian: +(1000 / pick(0.5)).toFixed(1),
      fps1Low: +(1000 / slowMean).toFixed(1),
      frameMsP95: +pick(0.95).toFixed(2),
      calls: info.shot?.calls ?? null,
      triangles: info.shot?.triangles ?? null,
      canvas: info.canvas,
    };
    results.push(row);
    console.log(`${label.padEnd(26)} fps med ${String(row.fpsMedian).padStart(6)}  1% low ${String(row.fps1Low).padStart(6)}  p95 ${row.frameMsP95} ms  calls ${row.calls}  tris ${row.triangles}  ${row.canvas?.join('x')}  frames ${row.frames}`);
  } catch (err) {
    results.push({ label, query, error: String(err.message).slice(0, 200) });
    console.log(`${label} FAIL ${String(err.message).slice(0, 160)}`);
  }
  await context.close();
}
writeFileSync(out, JSON.stringify({ software, cpuThrottle: Number(process.env.CPU_THROTTLE ?? 1), viewport: [width, height], warmupMs: warmup, results }, null, 2));
await browser.close();
