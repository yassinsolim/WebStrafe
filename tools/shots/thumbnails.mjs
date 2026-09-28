// menu and loading screen thumbnails from the game itself (dev or preview build):
//   node tools/shots/thumbnails.mjs <base url> [mapId ...]
// renders each map on the real gpu at 1920x1080 with ?shot=<id>&vm=0 (no gun,
// no arms), hides every dom overlay, and writes public/maps/<id>/thumbnail.webp
// (480x270, at most 60 KB). views live in VIEWS below so the shots are repeatable.
// env: PLAYWRIGHT_MODULE, CHROME, QUALITY (default high), RAW_DIR to keep the full frames
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sharp = createRequire(path.join(root, 'package.json'))('sharp');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');

// the "thumb" cameras from each tools/blender/maps/build_<id>.py, as metres
// relative to the spawn eye and heading: [right, up, forward]. ochre cut's is
// absolute in three.js axes (blender x, z, -y).
export const VIEWS = {
  surf_prismline: { eye: [-58, 30.4, -32], target: [2, -19.6, 58] },
  surf_lumen: { eye: [-60, 28.4, -30], target: [2, -17.6, 68] },
  surf_cascade: { eye: [-30, 24, -34], target: [2, -17.6, 60] },
  surf_vanta: { eye: [-50, 30, -40], target: [2, -13.6, 38] },
  bhop_emberdrift: { eye: [-22, 16, -26], target: [0, -8, 40] },
  aim_ochrecut: { absolute: true, eye: [0, 26, 66], target: [0, 0, -4] },
};

/** yaw/pitch (degrees) that point the game camera from eye at target */
function aim(eye, target) {
  const d = target.map((v, i) => v - eye[i]);
  const len = Math.hypot(...d);
  const [dx, dy, dz] = d.map((v) => v / len);
  return { yaw: (Math.atan2(-dx, -dz) * 180) / Math.PI, pitch: (Math.asin(dy) * 180) / Math.PI };
}

const [base, ...only] = process.argv.slice(2);
if (!base) {
  console.error('usage: node tools/shots/thumbnails.mjs <base url> [mapId ...]');
  process.exit(1);
}
const ids = only.length ? only : Object.keys(VIEWS);
const quality = process.env.QUALITY ?? 'high';
const browser = await chromium.launch({
  headless: false,
  executablePath: process.env.CHROME || undefined,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
let failed = 0;
for (const id of ids) {
  const view = VIEWS[id];
  const q = new URLSearchParams({ shot: id, vm: '0', hud: '0', adaptive: '0', quality });
  try {
    let eye = view?.eye;
    let target = view?.target;
    if (view && !view.absolute) {
      // spawn eye and heading first, then place the camera relative to them
      await page.goto(`${base}/?${q}`, { timeout: 60000 });
      await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 120000 });
      const spawn = await page.evaluate(() => {
        const cam = window.__webstrafe.camera;
        const dir = cam.getWorldDirection(cam.position.clone());
        return { p: cam.position.toArray(), f: [dir.x, 0, dir.z] };
      });
      const fl = Math.hypot(spawn.f[0], spawn.f[2]);
      const f = [spawn.f[0] / fl, 0, spawn.f[2] / fl];
      const r = [-f[2], 0, f[0]];
      const at = ([x, y, z]) => spawn.p.map((v, i) => v + r[i] * x + (i === 1 ? y : 0) + f[i] * z);
      eye = at(view.eye);
      target = at(view.target);
    }
    if (eye && target) {
      const { yaw, pitch } = aim(eye, target);
      q.set('cam', eye.map((v) => v.toFixed(2)).join(','));
      q.set('yaw', yaw.toFixed(2));
      q.set('pitch', pitch.toFixed(2));
    }
    await page.goto(`${base}/?${q}`, { timeout: 60000 });
    await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 120000 });
    // only the canvas: no crosshair, speedometer, timer or status text
    await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      const keep = new Set();
      for (let el = canvas; el; el = el.parentElement) keep.add(el);
      for (const el of document.body.querySelectorAll('*')) {
        if (!keep.has(el) && !el.contains(canvas)) el.style.setProperty('visibility', 'hidden', 'important');
      }
    });
    await page.waitForTimeout(800);
    const png = await page.screenshot();
    if (process.env.RAW_DIR) {
      mkdirSync(process.env.RAW_DIR, { recursive: true });
      await sharp(png).toFile(path.join(process.env.RAW_DIR, `${id}.png`));
    }
    const out = path.join(root, 'public', 'maps', id, 'thumbnail.webp');
    let webpQuality = 82;
    let bytes = 0;
    do {
      const info = await sharp(png).resize(480, 270, { kernel: 'lanczos3' }).webp({ quality: webpQuality, effort: 6 }).toFile(out);
      bytes = info.size;
      webpQuality -= 6;
    } while (bytes > 60 * 1024 && webpQuality > 30);
    console.log(`ok ${id} ${(bytes / 1024).toFixed(1)} KB`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL ${id}: ${String(err.message).slice(0, 200)}`);
  }
}
await browser.close();
process.exit(failed ? 1 : 0);
