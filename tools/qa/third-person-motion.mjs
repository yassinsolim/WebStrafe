// third person motion check: dev characters walk, run, strafe, jump, look up and
// down and swing, captured as a contact sheet (and a video with --video)
//   node tools/qa/third-person-motion.mjs <base url> <output dir> [--video]
// env: PLAYWRIGHT_MODULE, CHROME, LOCAL_IP
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const [base, output] = args;
if (!base || !output) throw new Error('usage: node tools/qa/third-person-motion.mjs <base url> <output dir> [--video]');
const video = args.includes('--video');
mkdirSync(output, { recursive: true });

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME || undefined,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', ...(process.env.LOCAL_IP ? [`--host-resolver-rules=MAP localhost ${process.env.LOCAL_IP}`] : [])],
});
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
await context.route(/supabase\.(co|in)/, (route) => route.abort());
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

// three characters side on to the camera, 5 m out in the open left of the spawn's crate
await page.goto(`${base}/?shot=aim_ochrecut&hud=0&quality=high&weapon=knife&chars=3&chardist=5&charspace=1.05`, { timeout: 120000 });
await page.waitForFunction(() => window.__shotReady === true && window.__webstrafe?.remotePlayers, null, { timeout: 180000 });
await page.waitForFunction(() => [...window.__webstrafe.remotePlayers.actors.values()].every((a) => a.character), null, { timeout: 120000 });
const crop = await page.evaluate(() => {
  window.__viewmodel?.setHidden(true);
  const camera = window.__webstrafe.camera;
  const actors = [...window.__webstrafe.remotePlayers.actors.values()];
  const right = camera.position.clone().setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
  for (const actor of actors) actor.targetPosition.addScaledVector(right, -4.3);
  // a box round where they stand, with room to stride and jump
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const actor of actors) {
    for (const [side, up] of [[-1.1, -0.1], [1.1, -0.1], [-1.1, 2.6], [1.1, 2.6]]) {
      const p = actor.targetPosition.clone().addScaledVector(right, side);
      p.y += up;
      p.project(camera);
      box.x0 = Math.min(box.x0, (p.x + 1) / 2 * innerWidth);
      box.x1 = Math.max(box.x1, (p.x + 1) / 2 * innerWidth);
      box.y0 = Math.min(box.y0, (1 - p.y) / 2 * innerHeight);
      box.y1 = Math.max(box.y1, (1 - p.y) / 2 * innerHeight);
    }
  }
  const x = Math.max(0, Math.round(box.x0));
  const y = Math.max(0, Math.round(box.y0));
  return { x, y, width: Math.min(innerWidth - x, Math.round(box.x1 - box.x0)), height: Math.min(innerHeight - y, Math.round(box.y1 - box.y0)) };
});

// runs in the page: drives every actor along a scripted path in real time
await page.addScriptTag({ content: String.raw`
window.__drive = (plan) => {
  const players = window.__webstrafe.remotePlayers;
  const actors = [...players.actors.values()];
  // every scene starts from where the characters first stood
  window.__driveHome ??= actors.map((a) => [a.targetPosition.clone(), a.targetYaw]);
  const start = window.__driveHome.map(([p]) => p);
  const baseYaw = window.__driveHome.map(([, y]) => y);
  for (const [i, actor] of actors.entries()) {
    actor.targetPosition.copy(start[i]);
    actor.displayPosition.copy(start[i]);
    actor.lastShown.copy(start[i]);
  }
  const t0 = performance.now();
  const fired = new Set();
  return new Promise((resolve) => {
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      for (const [i, actor] of actors.entries()) {
        const p = plan.at(t, i);
        // side on: the actor turns a quarter left of facing the camera and moves along its own facing
        const yaw = baseYaw[i] + Math.PI / 2 + (p.turn ?? 0);
        actor.targetYaw = yaw;
        actor.displayPitch = p.pitch ?? 0;
        const along = p.forward ?? 0;
        const left = p.left ?? 0;
        actor.targetPosition.set(
          start[i].x - Math.sin(yaw) * along - Math.cos(yaw) * left,
          start[i].y + (p.up ?? 0),
          start[i].z - Math.cos(yaw) * along + Math.sin(yaw) * left,
        );
        for (const [at, kind] of p.attacks ?? []) {
          const key = i + ':' + at;
          if (t >= at && !fired.has(key)) { fired.add(key); players.triggerAttack(actor.id, kind); }
        }
      }
      if (t < plan.duration) requestAnimationFrame(tick); else resolve();
    };
    requestAnimationFrame(tick);
  });
};
` });

// each scene's actors are [standing or slow, walking, running] where speed matters
const scenes = [
  ['walk-run', 3.2, `(t, i) => ({ forward: [0, 2.2, 6.2][i] * (((t * 0.5) % 1) * 2 - 1) * 0.8 })`],
  ['strafe', 3.2, `(t, i) => ({ left: [0, 2.2, 5.5][i] * (((t * 0.5) % 1) * 2 - 1) * 0.8 })`],
  ['jump', 2.4, `(t, i) => { const u = (t * 1.1 + i * 0.25) % 1.3; const h = u < 0.95 ? 5.4 * u - 0.5 * 11.4 * u * u : 0; return { up: Math.max(0, h) }; }`],
  ['aim', 3.0, `(t, i) => ({ pitch: Math.sin(t * 2.1 + i) * 1.0 })`],
  ['attack', 2.4, `(t, i) => ({ attacks: [[0.2, 'primary'], [0.65, 'primary'], [1.2, 'secondary']].map(([a, k]) => [a + i * 0.1, k]) })`],
];

const frames = [];
for (const [name, duration, at] of scenes) {
  if (video) {
    const dir = path.join(output, `${name}-frames`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const drive = page.evaluate(([d, src]) => window.__drive({ duration: d, at: eval(src) }), [duration, at]);
    for (let i = 0; i < Math.round(duration * 30); i += 1) {
      await page.screenshot({ path: path.join(dir, `${String(i).padStart(4, '0')}.png`), clip: crop });
    }
    await drive;
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', path.join(dir, '%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', path.join(output, `${name}.mp4`)]);
    rmSync(dir, { recursive: true, force: true });
  } else {
    const started = Date.now();
    const drive = page.evaluate(([d, src]) => window.__drive({ duration: d, at: eval(src) }), [duration, at]);
    for (const [n, k] of [0.3, 0.55, 0.8].entries()) {
      await page.waitForTimeout(Math.max(0, started + k * duration * 1000 - Date.now()));
      await page.screenshot({ path: path.join(output, `${name}-${n}.png`), clip: crop });
      frames.push(`${name}-${n}`);
    }
    await drive;
  }
}
await browser.close();
if (!video && frames.length) {
  // one contact sheet: a row per scene
  const inputs = frames.flatMap((f) => ['-i', path.join(output, `${f}.png`)]);
  const rows = scenes.length;
  const filter = `${scenes.map((_, r) => `[${r * 3}:v][${r * 3 + 1}:v][${r * 3 + 2}:v]hstack=inputs=3,scale=1500:-1[r${r}]`).join(';')};${scenes.map((_, r) => `[r${r}]`).join('')}vstack=inputs=${rows}`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filter, path.join(output, 'sheet.png')]);
}
console.log(JSON.stringify({ frames: frames.length, errors }, null, 1));
