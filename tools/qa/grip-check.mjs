// in-engine knife grip regression check. runs the game's own ?gripcheck=1 dev
// route in chromium: every knife is posed through idle, draw, attack and inspect
// frames and the live finger bones are measured against the live knife meshes.
//   node tools/qa/grip-check.mjs <base url of a dev or preview build> [report.json]
// env: PLAYWRIGHT_MODULE, CHROME, GPU=1 (real gpu, headed), BYPASS_FILE (vercel previews)
import { readFileSync, writeFileSync } from 'node:fs';

const [base, out] = process.argv.slice(2);
if (!base) {
  console.error('usage: node tools/qa/grip-check.mjs <base url> [report.json]');
  process.exit(2);
}
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const gpu = !!process.env.GPU;
const browser = await chromium.launch({
  headless: !gpu,
  executablePath: process.env.CHROME || undefined,
  args: gpu ? ['--use-angle=metal'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
if (process.env.BYPASS_FILE) {
  const secret = readFileSync(process.env.BYPASS_FILE, 'utf8').trim();
  const origin = new URL(base).origin;
  await context.route('**/*', (route) => {
    const req = route.request();
    if (new URL(req.url()).origin !== origin) return route.continue();
    return route.continue({ headers: { ...req.headers(), 'x-vercel-protection-bypass': secret } });
  });
}
const page = await context.newPage();
await page.goto(`${base}/?shot=aim_ochrecut&weapon=knife&hud=0&gripcheck=1`, { timeout: 90000 });
await page.waitForFunction(() => window.__gripReport, null, { timeout: 300000, polling: 500 });
const report = await page.evaluate(() => window.__gripReport);
await browser.close();

// limits, metres. a gloved finger's centreline sits ~9-11 mm from what it holds
const LIMITS = {
  bladeClearance: 0.0075, // closer and the finger cuts into the blade
  handleClearance: 0.005, // closer (with the hand closed) and the glove sinks into the handle
  ringSeat: 0.0115, // index first phalanx within the ring's inner radius of its centre
  wrapTip: 0.016, // closed fingertips at idle rest on the handle
  wrapTipRing: 0.022,
};
const failures = [];
const fail = (f, why) => failures.push(`${f.knife} ${f.action}@${f.t}: ${why}`);
for (const f of report) {
  if (f.source !== 'glb') fail(f, `knife model not loaded (${f.source})`);
  const closed = f.gripOpen < 0.3;
  for (const d of f.check.digits) {
    if (d.inside > 0 && closed) fail(f, `${d.digit} has ${d.inside} samples inside the knife`);
    if (d.bladeClearance < LIMITS.bladeClearance) fail(f, `${d.digit} ${(d.bladeClearance * 1000).toFixed(1)} mm from the blade`);
    if (closed && d.digit !== 'thumb' && d.handleClearance < LIMITS.handleClearance) {
      fail(f, `${d.digit} ${(d.handleClearance * 1000).toFixed(1)} mm into the handle`);
    }
  }
  const ringKnife = f.kind === 'reverse_ring' || f.ringHold > 0.5;
  if (ringKnife && f.check.indexToRing !== null && f.check.indexToRing > LIMITS.ringSeat) {
    fail(f, `index ${(f.check.indexToRing * 1000).toFixed(1)} mm from the ring centre (not through the ring)`);
  }
  if (f.action === 'idle') {
    const limit = f.kind === 'reverse_ring' ? LIMITS.wrapTipRing : LIMITS.wrapTip;
    for (const d of f.check.digits) {
      if (!['middle', 'ring'].includes(d.digit) && !(d.digit === 'index' && f.kind !== 'reverse_ring')) continue;
      if (d.tipToHandle > limit) fail(f, `${d.digit} tip ${(d.tipToHandle * 1000).toFixed(1)} mm off the handle (floating)`);
    }
  }
}
if (out) writeFileSync(out, JSON.stringify({ limits: LIMITS, frames: report.length, failures, report }, null, 2));
const knives = new Set(report.map((f) => f.knife)).size;
console.log(`grip check: ${report.length} frames over ${knives} knives, ${failures.length} failures`);
for (const line of failures.slice(0, 80)) console.log(`  ${line}`);
process.exit(failures.length ? 1 : 0);
