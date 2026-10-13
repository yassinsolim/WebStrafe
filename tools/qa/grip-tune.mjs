// in-engine finger curl tuner for one knife. poses the live grip in the running
// game, searches the knuckle curl and the two outer joint curls of each digit
// and prints curls where the finger rests on the handle without sinking into it
// or touching the blade. paste the result into the knife's `engine` entry in
// src/viewmodel/knifeHandPoses.json, then rerun tools/qa/grip-check.mjs.
//   node tools/qa/grip-tune.mjs <base url> <knife> <digit,digit> [action] [t]
// env: PLAYWRIGHT_MODULE, CHROME (runs headed on the real gpu)
import { readFileSync } from 'node:fs';
import path from 'node:path';

const [base, knife, digitsArg, action = 'idle', tArg = '0'] = process.argv.slice(2);
if (!base || !knife || !digitsArg) {
  console.error('usage: node tools/qa/grip-tune.mjs <base url> <knife> <digit,digit> [action] [t]');
  process.exit(2);
}
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({
  headless: false,
  executablePath: process.env.CHROME || undefined,
  args: ['--use-angle=metal', ...(process.env.LOCAL_IP ? [`--host-resolver-rules=MAP localhost ${process.env.LOCAL_IP}`] : [])],
});
const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
if (process.env.KNIFE_ASSET_DIR) {
  await context.route('**/knives/*.glb', route => route.fulfill({
    contentType: 'model/gltf-binary',
    body: readFileSync(path.join(process.env.KNIFE_ASSET_DIR, path.basename(new URL(route.request().url()).pathname))),
  }));
}
const page = await context.newPage();
await page.goto(`${base}/?shot=aim_ochrecut&weapon=knife&knife=${knife}&hud=0`, { timeout: 90000 });
await page.waitForFunction(() => window.__viewmodel?.getKnifeObjects()[0]?.userData.source === 'glb', null, { timeout: 120000 });
await page.waitForFunction(() => window.__viewmodel?.getActiveItem() === 'knife' && window.__viewmodel.checkKnifeGrip() !== null, null, { timeout: 120000 });
const res = await page.evaluate(({ digits, action, times, basePose }) => {
  const vm = window.__viewmodel;
  vm.setPaused(true);
  const pose = vm.knife.grip.pose;
  for (const [digit, values] of Object.entries(basePose)) pose[digit].splice(0, 3, ...values);
  const start = JSON.parse(JSON.stringify(pose));
  const phases = action.split(',').map((name, index) => {
    const [clip, variant] = name.split(':');
    return [clip, times[index] ?? times[0], variant === 'rare' ? 1 : 0];
  });
  const measure = (digit, phase) => {
    vm.setInspectVariant(phase[2]);
    vm.seek(phase[0], phase[1]);
    return vm.checkKnifeGrip().digits.find((d) => d.digit === digit);
  };
  // same limits as grip-check.mjs, with a little margin
  const cost = (d, contact) => Math.max(0, 0.0068 - d.handleClearance) * 10 + Math.max(0, 0.0095 - d.bladeClearance) * 10
    + d.inside * 0.05 + (contact ? Math.max(0, d.tipToHandle - 0.012) + Math.max(0, 0.0095 - d.tipToHandle) : 0);
  const out = {};
  for (const digit of digits) {
    let best = null;
    for (let c0 = 0.5; c0 <= 1.6; c0 += 0.05) {
      for (let c12 = 0.7; c12 <= 2.6; c12 += 0.1) {
        pose[digit][0] = start[digit][0] * c0;
        pose[digit][1] = Math.min(110, start[digit][1] * c12);
        pose[digit][2] = Math.min(80, start[digit][2] * c12);
        const s = Math.max(...phases.map(phase => cost(measure(digit, phase), phase[0] === 'idle')));
        if (!best || s < best.s - 1e-7) best = { s, curls: pose[digit].map((v) => Math.round(v * 10) / 10) };
      }
    }
    pose[digit].splice(0, 3, ...best.curls);
    out[digit] = best;
  }
  const failures = [];
  for (const variant of [0, 1]) {
    vm.setInspectVariant(variant);
    for (const clip of ['idle', 'draw', 'inspect', 'slashA', 'slashB', 'stab', 'backstab']) {
      const duration = clip === 'idle' ? 0 : vm.knifeActionDuration(clip);
      for (let time = 0; time <= duration + 1e-6; time += 0.0333) {
        vm.seek(clip, time);
        for (const sample of vm.checkKnifeGrip().digits.filter(sample => digits.includes(sample.digit))) {
          if (sample.inside > 0 || sample.bladeClearance < 0.0075 || sample.handleClearance < 0.005
            || (clip === 'idle' && sample.tipToHandle > 0.016)) failures.push({ clip, time, variant, ...sample });
        }
      }
    }
  }
  vm.setInspectVariant(phases[0][2]);
  vm.seek(phases[0][0], phases[0][1]);
  return { out, start, digits: vm.checkKnifeGrip().digits, failures };
}, { digits: digitsArg.split(','), action, times: tArg.split(',').map(Number), basePose: JSON.parse(process.env.GRIP_BASE_POSE ?? '{}') });
await browser.close();

const mm = (m) => (m * 1000).toFixed(1);
for (const [digit, b] of Object.entries(res.out)) {
  console.log(`${knife} ${digit}: ${JSON.stringify(res.start[digit])} -> ${JSON.stringify(b.curls)} (cost ${b.s.toFixed(4)})`);
}
for (const d of res.digits) {
  console.log(`  ${d.digit.padEnd(6)} handle ${mm(d.handleClearance)} mm, blade ${mm(d.bladeClearance)} mm, tip ${mm(d.tipToHandle)} mm, inside ${d.inside}`);
}
console.log(`engine: ${JSON.stringify(Object.fromEntries(Object.entries(res.out).map(([k, b]) => [k, b.curls])))}`);
console.log(`motion sweep: ${res.failures.length} failures`);
if (res.failures.length) {
  console.log(JSON.stringify(res.failures.slice(0, 8), null, 2));
  process.exitCode = 1;
}
