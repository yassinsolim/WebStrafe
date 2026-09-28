// in-engine finger curl tuner for one knife. poses the live grip in the running
// game, searches the knuckle curl and the two outer joint curls of each digit
// and prints curls where the finger rests on the handle without sinking into it
// or touching the blade. paste the result into the knife's `engine` entry in
// src/viewmodel/knifeHandPoses.json, then rerun tools/qa/grip-check.mjs.
//   node tools/qa/grip-tune.mjs <base url> <knife> <digit,digit> [action] [t]
// env: PLAYWRIGHT_MODULE, CHROME (runs headed on the real gpu)
const [base, knife, digitsArg, action = 'idle', tArg = '0'] = process.argv.slice(2);
if (!base || !knife || !digitsArg) {
  console.error('usage: node tools/qa/grip-tune.mjs <base url> <knife> <digit,digit> [action] [t]');
  process.exit(2);
}
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({
  headless: false,
  executablePath: process.env.CHROME || undefined,
  args: ['--use-angle=metal'],
});
const page = await (await browser.newContext({ viewport: { width: 640, height: 360 } })).newPage();
await page.goto(`${base}/?shot=aim_ochrecut&weapon=knife&knife=${knife}&hud=0`, { timeout: 90000 });
await page.waitForFunction(() => window.__viewmodel?.getKnifeObjects()[0]?.userData.source === 'glb', null, { timeout: 120000 });
const res = await page.evaluate(({ digits, action, t }) => {
  const vm = window.__viewmodel;
  vm.setPaused(true);
  const pose = vm.knife.grip.pose;
  const start = JSON.parse(JSON.stringify(pose));
  const measure = (digit) => {
    vm.seek(action, t);
    return vm.checkKnifeGrip().digits.find((d) => d.digit === digit);
  };
  // same limits as grip-check.mjs, with a little margin
  const cost = (d) => Math.max(0, 0.0068 - d.handleClearance) * 10 + Math.max(0, 0.0095 - d.bladeClearance) * 10
    + d.inside * 0.05 + Math.max(0, d.tipToHandle - 0.012) + Math.max(0, 0.0095 - d.tipToHandle);
  const out = {};
  for (const digit of digits) {
    let best = null;
    for (let c0 = 0.5; c0 <= 1.6; c0 += 0.05) {
      for (let c12 = 0.7; c12 <= 2.6; c12 += 0.1) {
        pose[digit][0] = start[digit][0] * c0;
        pose[digit][1] = Math.min(110, start[digit][1] * c12);
        pose[digit][2] = Math.min(80, start[digit][2] * c12);
        const s = cost(measure(digit));
        if (!best || s < best.s - 1e-7) best = { s, curls: pose[digit].map((v) => Math.round(v * 10) / 10) };
      }
    }
    pose[digit].splice(0, 3, ...best.curls);
    out[digit] = best;
  }
  vm.seek(action, t);
  return { out, start, digits: vm.checkKnifeGrip().digits };
}, { digits: digitsArg.split(','), action, t: Number(tArg) });
await browser.close();

const mm = (m) => (m * 1000).toFixed(1);
for (const [digit, b] of Object.entries(res.out)) {
  console.log(`${digit}: ${JSON.stringify(res.start[digit])} -> ${JSON.stringify(b.curls)} (cost ${b.s.toFixed(4)})`);
}
for (const d of res.digits) {
  console.log(`  ${d.digit.padEnd(6)} handle ${mm(d.handleClearance)} mm, blade ${mm(d.bladeClearance)} mm, tip ${mm(d.tipToHandle)} mm, inside ${d.inside}`);
}
console.log(`engine: ${JSON.stringify(Object.fromEntries(Object.entries(res.out).map(([k, b]) => [k, b.curls])))}`);
