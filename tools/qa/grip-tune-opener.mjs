// fits each folder's thumb opener in the running game: the thumb pose that rests
// on the opener (thumb stud, flipper or button) while it presses, and the via
// pose it passes through on the way, so it goes round the handle and bolster
// instead of through them. every candidate is swept through the draw and
// inspect at 1/120 s; the one with the most room wins. paste the printed
// `opener` and `openerVia` into src/viewmodel/knifeHandPoses.json, then rerun
// tools/qa/grip-check.mjs.
//   node tools/qa/grip-tune-opener.mjs <base url> [knife,knife]
// env: PLAYWRIGHT_MODULE, CHROME (runs headed on the real gpu)
const [base, only] = process.argv.slice(2);
if (!base) {
  console.error('usage: node tools/qa/grip-tune-opener.mjs <base url> [knife,knife]');
  process.exit(2);
}
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({ headless: false, executablePath: process.env.CHROME || undefined, args: ['--use-angle=metal'] });
const page = await (await browser.newContext({ viewport: { width: 640, height: 360 } })).newPage();
await page.goto(`${base}/?shot=aim_ochrecut&weapon=knife&hud=0`, { timeout: 90000 });
await page.waitForFunction(() => window.__viewmodel?.getKnifeObjects()[0]?.userData.source === 'glb', null, { timeout: 120000 });
const results = await page.evaluate(async (only) => {
  const vm = window.__viewmodel;
  vm.setPaused(true);
  // resting on the opener: the thumb's centreline this far from the blade
  const REST = [0.0078, 0.0115];
  const BLADE_MIN = 0.0075;
  const targets = [];
  for (let a = -60; a <= 60; a += 10) for (let b = -40; b <= 80; b += 20) for (let c = -20; c <= 40; c += 20) targets.push([a, b, c]);
  const vias = [];
  for (let a = -60; a <= 30; a += 15) for (let b = -60; b <= 30; b += 15) for (const c of [-30, 0, 30]) vias.push([a, b, c]);
  const knives = only ? only.split(',') : ['flip', 'falchion', 'navaja', 'stiletto', 'talon', 'ursus', 'nomad'];
  const thumbAt = (action, t) => {
    vm.seek(action, t);
    return vm.checkKnifeGrip().digits.find((d) => d.digit === 'thumb');
  };
  const out = {};
  for (const knife of knives) {
    vm.setKnife(knife);
    for (let i = 0; i < 100 && vm.getKnifeObjects()[0]?.userData.source !== 'glb'; i++) await new Promise((r) => setTimeout(r, 50));
    const grip = vm.knife.grip;
    if (!grip.openerThumb) continue;
    const start = [...grip.openerThumb];
    const path = [];
    const press = [];
    for (const action of ['draw', 'inspect']) {
      const dur = vm.knifeActionDuration(action);
      for (let t = 0; t <= dur + 1e-6; t += 1 / 120) {
        vm.seek(action, t);
        const o = vm.debugChannel('thumbOpener');
        if (o > 0.999 && vm.debugChannel('knifeOpen') < 0.02) press.push([action, t]);
        else if (o > 0 && o < 1) path.push([action, t]);
      }
    }
    let best = null;
    for (const target of targets) {
      grip.openerThumb = target;
      grip.openerVia = undefined;
      const onIt = press.every(([a, t]) => {
        const th = thumbAt(a, t);
        return th.inside === 0 && th.bladeClearance >= REST[0] && th.bladeClearance <= REST[1];
      });
      if (!onIt) continue;
      for (const via of vias) {
        grip.openerVia = via;
        let margin = Infinity;
        for (const [a, t] of path) {
          const th = thumbAt(a, t);
          const m = th.inside > 0 ? -1 : th.bladeClearance - BLADE_MIN;
          if (m < margin) margin = m;
          if (best && margin <= best.margin) break;
        }
        if (!best || margin > best.margin) best = { target, via, margin };
      }
    }
    if (best) {
      grip.openerThumb = best.target;
      grip.openerVia = best.via;
    } else {
      grip.openerThumb = start;
    }
    out[knife] = best
      ? { opener: best.target, via: best.via, marginMm: +(best.margin * 1000).toFixed(1), path: path.length, press: press.length }
      : { none: true, path: path.length, press: press.length };
  }
  return out;
}, only ?? null);
await browser.close();
for (const [knife, r] of Object.entries(results)) {
  if (r.none) console.log(`${knife.padEnd(10)} no thumb pose rests on the opener (${r.press} press frames)`);
  else console.log(`${knife.padEnd(10)} "opener": ${JSON.stringify(r.opener)}, "openerVia": ${JSON.stringify(r.via)}  worst margin ${r.marginMm} mm over ${r.path} path frames`);
}
