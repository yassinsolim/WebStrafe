// first person animation audit: samples every knife and gun clip, plus real
// interrupted sequences (slash spam, cancels, repeat fire), and flags motion
// faults frame by frame: pops (one frame jumps), jolts (instant speed change),
// hitches (stop and go in the middle of a move), finger snaps and the free arm
// flickering in and out of view.
//   node tools/qa/animation-audit.mjs <base url> <output dir> [knife ...] [--clips-only] [--video] [--live]
// --live plays each clip in real time from its first frame instead of scrubbing
// to every sample (scrubbing skips anything that carries over between frames)
// env: PLAYWRIGHT_MODULE, CHROME, LOCAL_IP
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const [base, output] = args;
if (!base || !output) throw new Error('usage: node tools/qa/animation-audit.mjs <base url> <output dir> [knife ...] [--clips-only] [--video]');
const flags = new Set(args.filter((a) => a.startsWith('--')));
const KNIVES = ['karambit', 'butterfly', 'm9_bayonet', 'talon', 'skeleton', 'bayonet', 'flip', 'stiletto', 'huntsman', 'bowie', 'gut', 'shadow_daggers'];
const only = args.slice(2).filter((a) => !a.startsWith('--'));
const knives = only.length ? KNIVES.filter((k) => only.includes(k)) : KNIVES;
mkdirSync(output, { recursive: true });

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME || undefined,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', ...(process.env.LOCAL_IP ? [`--host-resolver-rules=MAP localhost ${process.env.LOCAL_IP}`] : [])],
});

// runs in the page: poses the rig through a scenario and records camera space samples
const SAMPLER = String.raw`
window.__animSample = (scenario) => {
  const vm = window.__viewmodel;
  const cam = window.__webstrafe.viewmodelCamera;
  const arms = vm.arms;
  const V = cam.position.constructor;
  const Q = cam.quaternion.constructor;
  const inv = cam.matrixWorldInverse;
  const p = new V();
  const q = new Q();
  const camQInv = new Q();
  const point = (obj, out, offset) => {
    if (offset) p.copy(offset); else p.set(0, 0, 0);
    obj.localToWorld(p);
    p.applyMatrix4(inv);
    out.push(p.x, p.y, p.z);
  };
  const axes = (obj, out) => {
    obj.getWorldQuaternion(q).premultiply(camQInv);
    p.set(1, 0, 0).applyQuaternion(q); out.push(p.x, p.y, p.z);
    p.set(0, 1, 0).applyQuaternion(q); out.push(p.x, p.y, p.z);
  };
  const fingerAngles = (side, out) => {
    const arm = arms.arms[side];
    for (const digit of ['index', 'middle', 'ring', 'pinky', 'thumb']) {
      for (let i = 0; i < 3; i += 1) {
        out.push(arm.digits[digit][i].quaternion.angleTo(arm.digitRest[digit][i]) * 57.29578);
      }
    }
  };
  const record = () => {
    vm.root.updateWorldMatrix(true, true);
    cam.updateMatrixWorld();
    cam.getWorldQuaternion(camQInv).invert();
    const s = [];
    for (const side of ['r', 'l']) {
      point(arms.getHandBone(side), s);
      axes(arms.getHandBone(side), s);
      point(arms.getForearmBone(side), s);
    }
    s.push(arms.isArmVisible('l') ? 1 : 0);
    const knives = vm.getActiveItem() === 'knife' ? vm.getKnifeObjects() : [];
    const item = knives[0] ?? vm.itemPivot;
    point(item, s);
    axes(item, s);
    const tipNode = item.getObjectByName?.('socket_tip') ?? item.getObjectByName?.('socket_muzzle');
    if (tipNode) point(tipNode, s); else point(item, s, new V(0.15, 0, 0));
    const twin = knives[1];
    if (twin) { const tip2 = twin.getObjectByName('socket_tip'); point(tip2 ?? twin, s); } else s.push(0, 0, 0);
    fingerAngles('r', s);
    fingerAngles('l', s);
    return s;
  };
  const dt = scenario.dt;
  const out = [];
  vm.setPaused(false);
  try {
    if (scenario.kind === 'clip') {
      if (scenario.variant !== undefined) vm.setInspectVariant(scenario.variant);
      if (scenario.live) {
        vm.seek(scenario.clip, 0);
        out.push(record());
        for (let t = dt; t <= scenario.duration + 1e-9; t += dt) {
          vm.update(dt);
          out.push(record());
        }
      } else {
        for (let t = 0; t <= scenario.duration + 1e-9; t += dt) {
          vm.seek(scenario.clip, t);
          out.push(record());
        }
        vm.seek(scenario.clip, scenario.duration);
      }
      // and the frame after it hands back to the idle
      vm.update(dt);
      out.push(record());
    } else {
      vm.seek('idle', 0);
      vm.update(dt);
      let next = 0;
      const steps = Math.round(scenario.duration / dt);
      for (let i = 0; i <= steps; i += 1) {
        const t = i * dt;
        while (next < scenario.actions.length && scenario.actions[next][0] <= t + 1e-9) {
          const [, action, arg] = scenario.actions[next];
          if (action === 'attack') vm.knifeAttack(arg);
          else if (action === 'inspect') { vm.setInspectVariant(arg ?? 0); vm.play('inspect'); }
          else if (action === 'cancel') vm.cancelInspect();
          else if (action === 'fire') vm.fire();
          else if (action === 'reload') vm.reload(arg);
          else if (action === 'equip') vm.equip(arg);
          next += 1;
        }
        out.push(record());
        vm.update(dt);
      }
    }
  } finally {
    vm.setPaused(true);
  }
  return out;
};
`;

// sample layout (see record())
const L = {
  wristR: 0, axR: 3, elbowR: 9, wristL: 12, axL: 15, elbowL: 21, visL: 24, item: 25, axItem: 28, tip: 34, tip2: 37, fingersR: 40, fingersL: 55,
};

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const vec = (s, at) => [s[at], s[at + 1], s[at + 2]];
const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.floor(sorted.length / 2)];
};

function angleBetween(a, b) {
  const d = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (len(a) * len(b) || 1);
  return Math.acos(Math.max(-1, Math.min(1, d)));
}

/** positions (m) of one tracked point, null where it isn't shown */
function series(samples, at, visibleAt = null) {
  return samples.map((s) => (visibleAt !== null && !s[visibleAt] ? null : vec(s, at)));
}

/** frame orientation change per step (rad), from two axes */
function rotationSteps(samples, at, visibleAt = null) {
  const out = [];
  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1];
    const b = samples[i];
    if (visibleAt !== null && (!a[visibleAt] || !b[visibleAt])) { out.push(null); continue; }
    out.push(Math.max(angleBetween(vec(a, at), vec(b, at)), angleBetween(vec(a, at + 3), vec(b, at + 3))));
  }
  return out;
}

/**
 * motion faults on one point's path sampled every dt:
 * pop = one step much bigger than both neighbours, jolt = a one-sample speed
 * change much bigger than the local norm (velocity breaks), hitch = the speed
 * dropping near zero between two fast phases going the same way
 */
function analysePath(points, dt, { popMin, joltMin, hitchMin }) {
  const events = [];
  const steps = [];
  for (let i = 1; i < points.length; i += 1) {
    steps.push(points[i] && points[i - 1] ? sub(points[i], points[i - 1]) : null);
  }
  const stepLen = steps.map((s) => (s ? len(s) : null));
  for (let i = 1; i < stepLen.length - 1; i += 1) {
    const [a, b, c] = [stepLen[i - 1], stepLen[i], stepLen[i + 1]];
    if (a === null || b === null || c === null) continue;
    if (b > popMin && b > 3 * Math.max(a, c, popMin / 6)) events.push({ type: 'pop', i: i + 1, size: b });
  }
  const dv = [];
  for (let i = 1; i < steps.length; i += 1) {
    dv.push(steps[i] && steps[i - 1] ? len(sub(steps[i], steps[i - 1])) / dt : null);
  }
  for (let i = 0; i < dv.length; i += 1) {
    if (dv[i] === null) continue;
    const near = [];
    for (let k = Math.max(0, i - 6); k <= Math.min(dv.length - 1, i + 6); k += 1) if (k !== i && dv[k] !== null) near.push(dv[k]);
    const norm = median(near);
    if (dv[i] > joltMin && dv[i] > 3 * norm) events.push({ type: 'jolt', i: i + 1, size: dv[i] });
  }
  const speed = stepLen.map((s) => (s === null ? null : s / dt));
  const w = Math.max(2, Math.round(0.15 / dt));
  for (let i = w; i < speed.length - w; i += 1) {
    const s = speed[i];
    if (s === null) continue;
    let isMin = true;
    for (let k = i - 2; k <= i + 2; k += 1) if (speed[k] !== null && speed[k] < s) isMin = false;
    if (!isMin) continue;
    let before = -1; let beforeAt = -1; let after = -1; let afterAt = -1;
    for (let k = i - w; k < i; k += 1) if (speed[k] !== null && speed[k] > before) { before = speed[k]; beforeAt = k; }
    for (let k = i + 1; k <= i + w; k += 1) if (speed[k] !== null && speed[k] > after) { after = speed[k]; afterAt = k; }
    if (Math.min(before, after) < hitchMin || s > 0.25 * Math.min(before, after)) continue;
    const cos = (() => {
      const u = steps[beforeAt];
      const v = steps[afterAt];
      if (!u || !v) return -1;
      return (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / ((len(u) * len(v)) || 1);
    })();
    if (cos > 0.3) events.push({ type: 'hitch', i, size: Math.min(before, after) - s });
  }
  const maxSpeed = Math.max(0, ...speed.filter((s) => s !== null));
  return { events, maxSpeed };
}

function analyseRotation(stepsRad, dt, joltMin) {
  const events = [];
  const w = stepsRad.map((s) => (s === null ? null : s / dt));
  for (let i = 1; i < w.length; i += 1) {
    if (w[i] === null || w[i - 1] === null) continue;
    const d = Math.abs(w[i] - w[i - 1]);
    const near = [];
    for (let k = Math.max(1, i - 6); k <= Math.min(w.length - 1, i + 6); k += 1) {
      if (k !== i && w[k] !== null && w[k - 1] !== null) near.push(Math.abs(w[k] - w[k - 1]));
    }
    if (d > joltMin && d > 3 * median(near)) events.push({ type: 'spin-jolt', i, size: d * 57.3 });
  }
  return events;
}

function analyse(samples, dt) {
  const report = { events: [], maxWristSpeed: 0 };
  const add = (name, list) => {
    for (const e of list) report.events.push({ ...e, on: name, t: Math.round(e.i * dt * 1000) / 1000 });
  };
  const wr = analysePath(series(samples, L.wristR), dt, { popMin: 0.006, joltMin: 1.2, hitchMin: 0.35 });
  report.maxWristSpeed = wr.maxSpeed;
  add('wristR', wr.events);
  add('wristL', analysePath(series(samples, L.wristL, L.visL), dt, { popMin: 0.006, joltMin: 1.2, hitchMin: 0.35 }).events);
  add('tip', analysePath(series(samples, L.tip), dt, { popMin: 0.01, joltMin: 2, hitchMin: 0.6 }).events);
  add('handR', analyseRotation(rotationSteps(samples, L.axR), dt, 6));
  add('item', analyseRotation(rotationSteps(samples, L.axItem), dt, 8));
  // fingers: a joint turning faster than 900 deg/s for a step is a snap
  for (const [name, at, vis] of [['fingersR', L.fingersR, null], ['fingersL', L.fingersL, L.visL]]) {
    for (let i = 1; i < samples.length; i += 1) {
      if (vis !== null && (!samples[i][vis] || !samples[i - 1][vis])) continue;
      let worst = 0;
      for (let k = 0; k < 15; k += 1) worst = Math.max(worst, Math.abs(samples[i][at + k] - samples[i - 1][at + k]) / dt);
      if (worst > 900) report.events.push({ type: 'finger-snap', on: name, t: Math.round(i * dt * 1000) / 1000, size: worst });
    }
  }
  // the free arm appearing for less than 0.1 s reads as a flicker
  let shownAt = null;
  for (let i = 0; i < samples.length; i += 1) {
    const shown = samples[i][L.visL] === 1;
    if (shown && shownAt === null) shownAt = i;
    if (!shown && shownAt !== null) {
      if ((i - shownAt) * dt < 0.1) report.events.push({ type: 'flicker', on: 'armL', t: Math.round(shownAt * dt * 1000) / 1000, size: (i - shownAt) * dt });
      shownAt = null;
    }
  }
  const count = (type) => report.events.filter((e) => e.type === type).length;
  report.summary = {
    pops: count('pop'), jolts: count('jolt') + count('spin-jolt'), hitches: count('hitch'), fingerSnaps: count('finger-snap'), flickers: count('flicker'),
  };
  report.events.sort((a, b) => b.size - a.size);
  // the biggest of each kind (finger snaps would crowd out everything else)
  const kept = new Map();
  report.events = report.events.filter((e) => {
    kept.set(e.type, (kept.get(e.type) ?? 0) + 1);
    return kept.get(e.type) <= 20;
  });
  return report;
}

const results = [];
const recordResult = (target, name, samples, dt) => {
  const r = analyse(samples, dt);
  results.push({ target, name, samples: samples.length, ...r });
  const s = r.summary;
  console.log(`${target.padEnd(14)} ${name.padEnd(22)} pops ${String(s.pops).padStart(3)} jolts ${String(s.jolts).padStart(3)} hitches ${String(s.hitches).padStart(3)} fingers ${String(s.fingerSnaps).padStart(3)} flickers ${s.flickers}`);
};

async function openShot(page, query, quality = 'low') {
  await page.goto(`${base}/?shot=aim_ochrecut&hud=0&quality=${quality}&${query}`, { timeout: 120000 });
  await page.waitForFunction(() => window.__shotReady === true && window.__viewmodel?.isLoaded(), null, { timeout: 180000 });
  await page.waitForFunction(() => window.__viewmodel.getActiveItem() !== 'knife' || window.__viewmodel.getKnifeObjects()[0]?.userData.source === 'glb', null, { timeout: 120000 });
  await page.addScriptTag({ content: SAMPLER });
}

const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
await context.route(/supabase\.(co|in)/, (route) => route.abort());
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const DT_CLIP = 1 / 240;
const DT_RUN = 1 / 120;

try {
  for (const knife of knives) {
    await openShot(page, `weapon=knife&knife=${knife}`);
    const durations = await page.evaluate(() => {
      const vm = window.__viewmodel;
      const out = {};
      for (const clip of ['draw', 'slashA', 'slashB', 'stab', 'backstab']) out[clip] = vm.knifeActionDuration(clip);
      vm.setInspectVariant(0); out.inspect0 = vm.knifeActionDuration('inspect');
      vm.setInspectVariant(1); out.inspect1 = vm.knifeActionDuration('inspect');
      vm.setInspectVariant(0);
      return out;
    });
    for (const [name, duration] of Object.entries(durations)) {
      const clip = name.startsWith('inspect') ? 'inspect' : name;
      const variant = name === 'inspect1' ? 1 : name === 'inspect0' ? 0 : undefined;
      if (name === 'inspect1' && durations.inspect1 === durations.inspect0 && knife === 'shadow_daggers') continue;
      const samples = await page.evaluate((s) => window.__animSample(s), { kind: 'clip', clip, duration, variant, dt: DT_CLIP, live: flags.has('--live') });
      recordResult(knife, name, samples, DT_CLIP);
    }
    if (flags.has('--clips-only')) continue;
    const sequences = {
      'slash-spam': { duration: 2.4, actions: [[0, 'attack', 'primary'], [0.4, 'attack', 'primary'], [0.8, 'attack', 'primary'], [1.2, 'attack', 'primary']] },
      'slash-into-stab': { duration: 2, actions: [[0, 'attack', 'primary'], [0.5, 'attack', 'secondary']] },
      'inspect-cancel': { duration: 2.4, actions: [[0, 'inspect', 0], [1.1, 'attack', 'primary']] },
      'draw-cancel': { duration: 1.8, actions: [[0, 'equip', 'knife'], [0.3, 'attack', 'primary']] },
    };
    for (const [name, sequence] of Object.entries(sequences)) {
      const samples = await page.evaluate((s) => window.__animSample(s), { kind: 'run', dt: DT_RUN, ...sequence });
      recordResult(knife, name, samples, DT_RUN);
    }
  }
  if (!only.length || only.includes('guns')) {
    for (const gun of ['deagle', 'awp']) {
      await openShot(page, `weapon=${gun}`);
      for (const clip of ['draw', 'fire', 'reload', 'inspect']) {
        const duration = await page.evaluate((c) => {
          const vm = window.__viewmodel;
          vm.seek(c, 0);
          return vm.clip?.duration ?? 0;
        }, clip);
        const samples = await page.evaluate((s) => window.__animSample(s), { kind: 'clip', clip, duration, dt: DT_CLIP, live: flags.has('--live') });
        recordResult(gun, clip, samples, DT_CLIP);
      }
      if (flags.has('--clips-only')) continue;
      const interval = gun === 'deagle' ? 0.27 : 1.5;
      const sequences = {
        'fire-repeat': { duration: interval * 4 + 0.6, actions: [0, 1, 2, 3].map((n) => [n * interval, 'fire']) },
        'inspect-cancel': { duration: 2.4, actions: [[0, 'inspect', 0], [1.2, 'fire']] },
      };
      for (const [name, sequence] of Object.entries(sequences)) {
        const samples = await page.evaluate((s) => window.__animSample(s), { kind: 'run', dt: DT_RUN, ...sequence });
        recordResult(gun, name, samples, DT_RUN);
      }
    }
  }

  if (flags.has('--video')) {
    const videos = [
      ['karambit-attacks', 'weapon=knife&knife=karambit', [[0, 'attack', 'primary'], [0.4, 'attack', 'primary'], [0.8, 'attack', 'primary'], [1.3, 'attack', 'secondary']], 2.6],
      ['m9-inspect', 'weapon=knife&knife=m9_bayonet', [[0, 'inspect', 0]], 4.4],
      ['butterfly-draw-inspect', 'weapon=knife&knife=butterfly', [[0, 'equip', 'knife'], [1.4, 'inspect', 0]], 6.2],
      ['bayonet-spam', 'weapon=knife&knife=bayonet', [[0, 'attack', 'primary'], [0.4, 'attack', 'primary'], [0.8, 'attack', 'secondary'], [1.9, 'attack', 'primary']], 3.2],
      ['deagle-fire-reload', 'weapon=deagle', [[0, 'equip', 'deagle'], [0.9, 'fire'], [1.17, 'fire'], [1.44, 'fire'], [1.9, 'reload', 3330]], 5.6],
      ['awp-fire', 'weapon=awp', [[0, 'equip', 'awp'], [1.4, 'fire']], 3.2],
      ['skeleton-draw-inspect', 'weapon=knife&knife=skeleton', [[0, 'equip', 'knife'], [1.2, 'inspect', 0]], 5.8],
    ];
    for (const [name, query, actions, duration] of videos) {
      await openShot(page, query, 'high');
      const frames = path.join(output, `${name}-frames`);
      rmSync(frames, { recursive: true, force: true });
      mkdirSync(frames, { recursive: true });
      const fps = 60;
      await page.evaluate(() => { window.__viewmodel.seek('idle', 0); });
      let next = 0;
      for (let i = 0; i <= Math.round(duration * fps); i += 1) {
        const t = i / fps;
        await page.evaluate(({ t, actions, next }) => {
          const vm = window.__viewmodel;
          let n = next;
          while (n < actions.length && actions[n][0] <= t + 1e-9) {
            const [, action, arg] = actions[n];
            if (action === 'attack') vm.knifeAttack(arg);
            else if (action === 'inspect') { vm.setInspectVariant(arg ?? 0); vm.play('inspect'); }
            else if (action === 'fire') vm.fire();
            else if (action === 'reload') vm.reload(arg);
            else if (action === 'equip') vm.equip(arg);
            n += 1;
          }
          vm.setPaused(false);
          if (t > 0) vm.update(1 / 60); else vm.update(0);
          vm.setPaused(true);
          return n;
        }, { t, actions, next }).then((n) => { next = n; });
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await page.screenshot({ path: path.join(frames, `${String(i).padStart(4, '0')}.png`) });
      }
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(frames, '%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', path.join(output, `${name}.mp4`)]);
      rmSync(frames, { recursive: true, force: true });
      console.log(`video ${name}.mp4`);
    }
  }
} finally {
  await browser.close();
}

const totals = { pops: 0, jolts: 0, hitches: 0, fingerSnaps: 0, flickers: 0 };
for (const r of results) for (const k of Object.keys(totals)) totals[k] += r.summary[k];
writeFileSync(path.join(output, 'report.json'), `${JSON.stringify({ totals, errors, results }, null, 2)}\n`);
console.log(`totals ${JSON.stringify(totals)} errors ${errors.length}`);
