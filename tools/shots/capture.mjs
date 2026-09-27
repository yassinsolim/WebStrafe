// headless screenshots of dev pages through chromium with software gl.
// chromium on this mac can't reach 127.0.0.1, so point it at the lan ip or a
// public preview url.
//   node tools/shots/capture.mjs <base url> <out dir> <path>=<name.png> [...]
// env: PLAYWRIGHT_MODULE (path to playwright's index.mjs), CHROME (executable)
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [base, outDir, ...jobs] = process.argv.slice(2);
if (!base || !outDir || jobs.length === 0) {
  console.error('usage: node tools/shots/capture.mjs <base url> <out dir> <path>=<file.png> ...');
  process.exit(1);
}
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: Number(process.env.WIDTH ?? 1600), height: Number(process.env.HEIGHT ?? 900) } });
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') {
    const text = msg.text();
    // screenshot runs have no multiplayer server
    if (process.env.QUIET_WS && text.includes('WebSocket')) return;
    if (!text.includes('GPU stall') && !text.includes('GL Driver')) console.log(`[${msg.type()}] ${text.slice(0, 300)}`);
  }
});
page.on('pageerror', (err) => console.log(`[pageerror] ${err.message.slice(0, 300)}`));
let failed = 0;
for (const job of jobs) {
  const eq = job.lastIndexOf('=');
  const path = job.slice(0, eq);
  const file = job.slice(eq + 1);
  try {
    await page.goto(base + path, { timeout: 60000 });
    if (path.includes('#wait=')) {
      // pages without a ready flag (the menu): just give them time
      await page.waitForTimeout(Number(path.split('#wait=')[1]));
    } else {
      await page.waitForFunction(() => document.title === 'ready' || window.__shotReady === true, null, { timeout: 90000 });
    }
    await page.waitForTimeout(Number(process.env.SETTLE_MS ?? 150));
    await page.screenshot({ path: join(outDir, file) });
    const info = await page.evaluate(() => window.__shotInfo ?? null);
    if (info) console.log(`info ${file} ${JSON.stringify(info)}`);
    console.log(`ok ${file}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL ${file}: ${String(err.message).slice(0, 200)}`);
  }
}
await browser.close();
process.exit(failed ? 1 : 0);
