// fires the held gun through the ?qa=1 hooks and screenshots the shot in flight.
//   node tools/shots/fire-shot.mjs <base url> <out dir> <query>@<delay ms>=<name.png> [...]
// the query must hold shot=<map>&weapon=deagle|awp&qa=1. delay is the time from
// the fire call to the screenshot. env: PLAYWRIGHT_MODULE, CHROME, WIDTH, HEIGHT,
// GPU=1 for a headed window on the real gpu, FREEZE=1 to pause the effects clock
// at the delay (needs window.__qa.freezeEffects, newer builds only)
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [base, outDir, ...jobs] = process.argv.slice(2);
if (!base || !outDir || jobs.length === 0) {
  console.error('usage: node tools/shots/fire-shot.mjs <base url> <out dir> <query>@<ms>=<file.png> ...');
  process.exit(1);
}
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
mkdirSync(outDir, { recursive: true });
const gpu = !!process.env.GPU;
const browser = await chromium.launch({
  headless: !gpu,
  executablePath: process.env.CHROME || undefined,
  args: gpu
    ? ['--use-angle=metal', '--ignore-gpu-blocklist']
    : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({
  viewport: { width: Number(process.env.WIDTH ?? 1600), height: Number(process.env.HEIGHT ?? 900) },
  deviceScaleFactor: 1,
});
page.on('pageerror', (err) => console.log(`[pageerror] ${err.message.slice(0, 300)}`));
let failed = 0;
for (const job of jobs) {
  const eq = job.lastIndexOf('=');
  const file = job.slice(eq + 1);
  const spec = job.slice(0, eq);
  const at = spec.lastIndexOf('@');
  const query = spec.slice(0, at);
  const delayMs = Number(spec.slice(at + 1));
  try {
    await page.goto(`${base}/?${query}`, { timeout: 60000 });
    await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 90000 });
    // let the map and the draw animation settle
    await page.waitForTimeout(Number(process.env.SETTLE_MS ?? 2500));
    const freeze = !!process.env.FREEZE;
    await page.evaluate(({ delay, freeze }) => {
      window.__qa.fire();
      if (freeze && window.__qa.freezeEffects) window.__qa.freezeEffects(delay);
    }, { delay: delayMs, freeze });
    if (!freeze) await page.waitForTimeout(delayMs);
    else await page.waitForTimeout(250);
    await page.screenshot({ path: join(outDir, file) });
    if (freeze) await page.evaluate(() => window.__qa.freezeEffects?.(null));
    console.log(`ok ${file}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL ${file}: ${String(err.message).slice(0, 200)}`);
  }
}
await browser.close();
process.exit(failed ? 1 : 0);
