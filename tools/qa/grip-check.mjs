// in-engine knife grip regression check. runs the game's own ?gripcheck=1 dev
// route in chromium: every knife is posed through idle, draw, attack and inspect
// frames and the live finger bones are measured against the live knife meshes.
//   node tools/qa/grip-check.mjs <base url of a dev or preview build> [report.json]
// env: PLAYWRIGHT_MODULE, CHROME, GPU=1 (real gpu, headed), BYPASS_FILE (vercel previews),
//   STEP=0.0333 sweeps every clip frame by frame instead of the key frames
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
const step = process.env.STEP ? `&gripstep=${Number(process.env.STEP)}` : '';
await page.goto(`${base}/?shot=aim_ochrecut&weapon=knife&hud=0&gripcheck=1${step}`, { timeout: 90000 });
await page.waitForFunction(() => window.__gripReport, null, { timeout: 300000, polling: 500 });
const report = await page.evaluate(() => window.__gripReport);
await browser.close();

// limits, metres. a gloved finger's centreline sits ~9-11 mm from what it holds
const LIMITS = {
  bladeClearance: 0.0075, // closer and the finger cuts into the blade
  handleClearance: 0.005, // closer (with the hand closed) and the glove sinks into the handle
  handleClearanceOpen: 0.003, // hand open for a spin or toss: the knife may brush the glove, not pass through
  ringSeat: 0.0115, // index first phalanx within the ring's inner radius of its centre
  wrapTip: 0.016, // closed fingertips at idle rest on the handle
  wrapTipRing: 0.022,
  // the knife's grip socket (on the part the hand holds, a balisong's bite
  // handle) stays this close to where the hand's grip puts it
  attach: 0.005,
};
// the only moments a knife may leave the hand, each bounded and reported
const ALLOWANCES = {
  // the toss inspect: in the air above the hand
  toss: { when: (f) => f.tossY > 0.001, max: 0.2 },
  // the skeleton's hand travelling between its handle and its ring: bounded by
  // the distance between the two holds, and a finger stays on the knife once
  // the ring is on the finger
  ringMove: { when: (f) => f.ringHold > 0 && f.ringHold < 1, max: 0.1 },
};
const used = Object.fromEntries(Object.keys(ALLOWANCES).map((k) => [k, { frames: 0, maxMm: 0 }]));
let attachMax = 0;
const failures = [];
const fail = (f, why) => failures.push(`${f.knife}${f.side === 'l' ? ' (left)' : ''} ${f.action}@${f.t}: ${why}`);
for (const f of report) {
  if (f.source !== 'glb') fail(f, `knife model not loaded (${f.source})`);
  const closed = f.gripOpen < 0.3;
  for (const d of f.check.digits) {
    if (![d.tipToHandle, d.bladeClearance, d.handleClearance].every(Number.isFinite)) fail(f, `${d.digit} measured nothing (bad pose)`);
    if (d.inside > 0) fail(f, `${d.digit} has ${d.inside} samples inside the knife`);
    if (d.bladeClearance < LIMITS.bladeClearance) fail(f, `${d.digit} ${(d.bladeClearance * 1000).toFixed(1)} mm from the blade`);
    // an open hand only lets the knife turn past it, it must not pass through the glove
    const handleLimit = closed ? LIMITS.handleClearance : LIMITS.handleClearanceOpen;
    if (d.digit !== 'thumb' && d.handleClearance < handleLimit) {
      fail(f, `${d.digit} ${(d.handleClearance * 1000).toFixed(1)} mm into the handle`);
    }
  }
  const ringKnife = f.kind === 'reverse_ring' || f.ringHold > 0.5;
  if (ringKnife && f.check.indexToRing !== null && f.check.indexToRing > LIMITS.ringSeat) {
    fail(f, `index ${(f.check.indexToRing * 1000).toFixed(1)} mm from the ring centre (not through the ring)`);
  }
  if (f.attach) {
    const err = f.ringHold >= 1 && f.attach.ring !== null ? f.attach.ring
      : f.ringHold > 0 && f.attach.ring !== null ? Math.min(f.attach.grip, f.attach.ring)
        : f.attach.grip;
    if (!Number.isFinite(err)) fail(f, 'attachment measured nothing');
    const allowance = Object.entries(ALLOWANCES).find(([, a]) => a.when(f));
    if (err > LIMITS.attach) {
      if (!allowance) fail(f, `knife ${(err * 1000).toFixed(1)} mm off the hand's grip (detached)`);
      else {
        const [name, a] = allowance;
        used[name].frames += 1;
        used[name].maxMm = Math.max(used[name].maxMm, Math.round(err * 10000) / 10);
        if (err > a.max) fail(f, `knife ${(err * 1000).toFixed(1)} mm off the hand, past the ${name} allowance`);
        if (name === 'ringMove' && f.ringHold >= 0.5) {
          const contact = Math.min(...f.check.digits.map((d) => d.handleClearance));
          if (contact > 0.015) fail(f, `no finger on the knife while it moves to the ring (${(contact * 1000).toFixed(1)} mm)`);
        }
      }
    } else if (!allowance) {
      attachMax = Math.max(attachMax, err);
    }
  } else if (f.source === 'glb') {
    fail(f, 'no attachment measurement');
  }
    if (f.action === 'idle') {
    const limit = f.kind === 'reverse_ring' ? LIMITS.wrapTipRing : LIMITS.wrapTip;
    for (const d of f.check.digits) {
      if (!['middle', 'ring'].includes(d.digit) && !(d.digit === 'index' && f.kind !== 'reverse_ring')) continue;
      if (d.tipToHandle > limit) fail(f, `${d.digit} tip ${(d.tipToHandle * 1000).toFixed(1)} mm off the handle (floating)`);
    }
  }
}
if (out) writeFileSync(out, JSON.stringify({ limits: LIMITS, allowances: used, attachMaxMm: attachMax * 1000, frames: report.length, failures, report }, null, 2));
const knives = new Set(report.map((f) => f.knife)).size;
console.log(`grip check: ${report.length} frames over ${knives} knives, ${failures.length} failures`);
console.log(`attachment: held frames within ${(attachMax * 1000).toFixed(1)} mm; allowances used: ${Object.entries(used).map(([k, u]) => `${k} ${u.frames} frames (max ${u.maxMm} mm)`).join(', ')}`);
for (const line of failures.slice(0, 80)) console.log(`  ${line}`);
process.exit(failures.length ? 1 : 0);
