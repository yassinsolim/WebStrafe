import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';

const [base, output] = process.argv.slice(2);
if (!base) throw new Error('usage: node tools/qa/knife-audio-check.mjs <dev-url> [report.json]');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME || undefined,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});

try {
  const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
  await context.route(/supabase\.(co|in)/, route => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/?shot=aim_ochrecut&hud=0&weapon=knife&knife=karambit&clip=idle&t=0&adaptive=0`, { timeout: 120000 });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 120000 });
  const report = await page.evaluate(async () => {
    const { getAudioEngine } = await import('/src/audio/AudioEngine.ts');
    const { KnifeAudio } = await import('/src/audio/KnifeAudio.ts');
    const { GameApp } = await import('/src/app/GameApp.ts');
    const { getKnife } = await import('/src/combat/knives.ts');
    const { knifeAttackContactTime, knifeClip } = await import('/src/viewmodel/knifeClips.ts');
    const engine = getAudioEngine();
    await engine.resume();
    const audio = new KnifeAudio(engine);
    audio.preload();
    const manifest = await (await fetch('/audio/knife/sources.json')).json();
    await Promise.all(manifest.clips.map(clip => engine.loadSample(clip.file.slice('public'.length))));
    const missing = manifest.clips.filter(clip => !engine.getSample(clip.file.slice('public'.length))).map(clip => clip.file);
    const records = [];
    const fallbacks = [];
    const originalSample = engine.playSample.bind(engine);
    const originalPlay = engine.play.bind(engine);
    engine.playSample = (url, options) => {
      const handle = originalSample(url, options);
      const record = { url, options, loaded: !!handle, stops: [] };
      records.push(record);
      if (handle) {
        const stop = handle.stop.bind(handle);
        handle.stop = fade => { record.stops.push(fade); stop(fade); };
      }
      return handle;
    };
    engine.play = (name, options) => { fallbacks.push(name); return originalPlay(name, options); };
    const viewmodel = window.__viewmodel;
    const callbackHost = {
      viewmodel,
      knifeAudio: audio,
      multiplayer: { getLocalId: () => 'local' },
      knifeHitDelay() { return GameApp.prototype.knifeHitDelay.call(this); },
    };
    const eventOriginal = viewmodel.onEvent;
    viewmodel.onEvent = name => GameApp.prototype.playViewmodelEvent.call(callbackHost, name);
    const actions = [];
    const confirmations = [];
    try {
      for (const id of ['karambit', 'm9_bayonet', 'butterfly']) {
        viewmodel.setKnife(id);
        const def = getKnife(id);
        viewmodel.setPaused(false);
        viewmodel.equip('knife');
        const drawStart = records.length;
        for (let time = 0; time < knifeClip(def, 'draw').duration + 0.1; time += 1 / 60) viewmodel.update(1 / 60);
        actions.push({ id, action: 'draw', samples: records.slice(drawStart).map(record => record.url) });
        for (const action of ['slashA', 'slashB', 'stab', 'backstab']) {
          viewmodel.seek(action, 0);
          const kind = action.startsWith('slash') ? 'primary' : 'secondary';
          const contact = knifeAttackContactTime(def, action);
          const index = records.length;
          audio.play(kind, 1, undefined, undefined, contact);
          const sample = records[index];
          const built = manifest.clips.find(clip => `/${clip.file.slice('public/'.length)}` === sample.url);
          actions.push({ id, action, url: sample.url, contact, audiblePeak: sample.options.delay + built.peakAt / sample.options.playbackRate, loaded: sample.loaded });
        }
        viewmodel.seek('inspect', 0);
        const inspectStart = records.length;
        for (let time = 0; time < 1; time += 1 / 60) viewmodel.update(1 / 60);
        const inspectRecords = records.slice(inspectStart);
        viewmodel.knifeAttack('primary');
        audio.play(viewmodel.consumeStartedAttack(), 1, undefined, undefined, 0.1);
        actions.push({ id, action: 'interrupt-inspect', samples: inspectRecords.map(record => record.url), stopped: inspectRecords.every(record => record.stops.length > 0) });
        for (const elapsed of [0.02, 0.4]) {
          viewmodel.seek('stab', elapsed);
          const index = records.length;
          GameApp.prototype.handleHitFeedback.call(callbackHost, { weaponId: 'knife', damage: 30, shooterId: 'local', targetId: 'other' });
          confirmations.push({ id, elapsed, expectedDelay: Math.max(0, knifeAttackContactTime(def, 'stab') - elapsed), delay: records[index].options.delay });
        }
        audio.stopAll();
      }
    } finally {
      viewmodel.onEvent = eventOriginal;
      viewmodel.setPaused(true);
      audio.stopAll();
      engine.playSample = originalSample;
      engine.play = originalPlay;
    }
    return { missing, fallbacks, actions, confirmations, decoded: manifest.clips.length, sampleCalls: records.length };
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(report.missing, []);
  assert.deepEqual(report.fallbacks, []);
  for (const action of report.actions) {
    if ('audiblePeak' in action) assert.ok(Math.abs(action.contact - action.audiblePeak) < 0.012, `${action.id} ${action.action} peak timing`);
    if (action.action === 'interrupt-inspect') assert.ok(action.stopped, `${action.id} left inspect audio playing`);
    if (action.action === 'draw') assert.ok(action.samples.length > 0, `${action.id} draw was silent`);
  }
  for (const hit of report.confirmations) assert.ok(Math.abs(hit.delay - hit.expectedDelay) < 0.001, `${hit.id} confirmed hit timing`);
  if (output) writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ decoded: report.decoded, sampleCalls: report.sampleCalls, fallbacks: report.fallbacks.length, attackPeaks: report.actions.filter(action => 'audiblePeak' in action).length, confirmations: report.confirmations.length, pageErrors: errors.length }));
} finally {
  await browser.close();
}