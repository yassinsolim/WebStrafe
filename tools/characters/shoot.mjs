// dev screenshots of the character pages through headed chromium on the real gpu.
//   node tools/characters/shoot.mjs <base url> <out dir> <path>=<file.png> [...]
// env: PLAYWRIGHT_MODULE, CHROME, WIDTH, HEIGHT, STORAGE (json of localStorage entries set before load)
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [base, outDir, ...jobs] = process.argv.slice(2);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  headless: false,
  executablePath: process.env.CHROME || undefined,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({
  viewport: { width: Number(process.env.WIDTH ?? 1920), height: Number(process.env.HEIGHT ?? 1080) },
  deviceScaleFactor: 1,
});
if (process.env.STORAGE) {
  await page.addInitScript((entries) => {
    try {
      for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
    } catch {
      // about:blank has no storage
    }
  }, JSON.parse(process.env.STORAGE));
}
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') console.log(`[${msg.type()}] ${msg.text().slice(0, 400)}`);
});
page.on('pageerror', (err) => console.log(`[pageerror] ${err.message.slice(0, 400)}`));
let failed = 0;
for (const job of jobs) {
  const eq = job.lastIndexOf('=');
  const path = job.slice(0, eq);
  const file = job.slice(eq + 1);
  try {
    await page.goto(base + path, { timeout: 60000 });
    if (path.includes('#wait=')) {
      // pages without a ready flag (the menu): give them time, optionally click something first
      await page.waitForTimeout(Number(path.split('#wait=')[1].split('&')[0]));
      const click = path.includes('&click=') ? decodeURIComponent(path.split('&click=')[1]) : null;
      if (click) {
        for (const selector of click.split('|')) {
          await page.click(selector, { timeout: 10000 });
          await page.waitForTimeout(Number(process.env.CLICK_WAIT_MS ?? 1500));
        }
      }
    } else {
      await page.waitForFunction(() => window.__shotReady === true, null, { timeout: Number(process.env.TIMEOUT ?? 60000) });
    }
    await page.waitForTimeout(Number(process.env.SETTLE_MS ?? 200));
    await page.screenshot({ path: join(outDir, file) });
    const info = await page.evaluate(() => window.__shotInfo ?? null);
    console.log(`ok ${file}${info ? ` ${JSON.stringify(info)}` : ''}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL ${file}: ${String(err.message).slice(0, 300)}`);
  }
}
await browser.close();
process.exit(failed ? 1 : 0);
