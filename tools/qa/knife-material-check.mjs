import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { KNIVES } from '../../src/combat/knives.ts';

const [base, baseline, output, ...only] = process.argv.slice(2);
if (!base || !baseline || !output) throw new Error('usage: node tools/qa/knife-material-check.mjs <local-url> <baseline-glb-directory> <output-directory> [knife ...]');
mkdirSync(output, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME || undefined,
  args: ['--use-angle=metal', '--enable-gpu', ...(process.env.LOCAL_IP ? [`--host-resolver-rules=MAP localhost ${process.env.LOCAL_IP}`] : [])],
});
const report = [];
const errors = [];

try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', error => errors.push(error.message));
  let before = false;
  await page.route('**/knives/*.glb', route => {
    const directory = before ? baseline : process.env.KNIFE_ASSET_DIR;
    return directory ? route.fulfill({
      contentType: 'model/gltf-binary',
      body: readFileSync(path.join(directory, path.basename(new URL(route.request().url()).pathname))),
    }) : route.continue();
  });

  for (const knife of KNIVES.filter(knife => only.length === 0 || only.includes(knife.id))) {
    const tiles = [];
    const counts = [];
    for (const [row, view] of ['34', 'blade', 'handle'].entries()) {
      let camera;
      for (const column of [0, 1]) {
        before = column === 0;
        await page.goto(`${base}/tools/knife-model-preview.html?knife=${knife.id}&width=960&view=${view}`, { waitUntil: 'networkidle' });
        await page.waitForFunction(() => window.__shotReady);
        if (camera) {
          await page.evaluate(saved => {
            const preview = window.__knifeModelPreview;
            preview.camera.position.fromArray(saved.position);
            preview.camera.quaternion.fromArray(saved.quaternion);
            preview.renderer.render(preview.scene, preview.camera);
          }, camera);
        } else {
          camera = await page.evaluate(() => ({
            position: window.__knifeModelPreview.camera.position.toArray(),
            quaternion: window.__knifeModelPreview.camera.quaternion.toArray(),
          }));
        }
        const rendered = await page.evaluate(() => {
          const { renderer } = window.__knifeModelPreview;
          const sample = document.createElement('canvas');
          sample.width = 160;
          sample.height = 90;
          const context = sample.getContext('2d');
          context.drawImage(renderer.domElement, 0, 0, 160, 90);
          const pixels = context.getImageData(0, 0, 160, 90).data;
          let foreground = 0;
          for (let index = 0; index < pixels.length; index += 4) {
            if (Math.max(Math.abs(pixels[index] - 38), Math.abs(pixels[index + 1] - 43), Math.abs(pixels[index + 2] - 51)) > 15) foreground += 1;
          }
          return { triangles: renderer.info.render.triangles, calls: renderer.info.render.calls, foreground };
        });
        assert.ok(rendered.foreground > 200, `${knife.id} ${view}: blank render`);
        counts.push({ view, phase: before ? 'before' : 'after', ...rendered });
        const image = await page.screenshot({ path: path.join(output, `${knife.id}-${view}-${before ? 'before' : 'after'}.png`) });
        tiles.push({ input: image, left: column * 960, top: row * 580 + 40 });
        const label = `${knife.name}: ${before ? 'before' : 'updated materials'} / ${view}`;
        tiles.push({ input: Buffer.from(`<svg width="960" height="40"><rect width="960" height="40" fill="#161b18"/><text x="15" y="28" fill="#eee" font-family="sans-serif" font-size="20">${label}</text></svg>`), left: column * 960, top: row * 580 });
      }
      assert.equal(counts.at(-1).triangles, counts.at(-2).triangles, `${knife.id}: material pass changed geometry`);
      assert.equal(counts.at(-1).calls, counts.at(-2).calls, `${knife.id}: material pass added draw calls`);
    }
    await sharp({ create: { width: 1920, height: 1740, channels: 3, background: '#262b33' } })
      .composite(tiles).png().toFile(path.join(output, `${knife.id}-material-ab.png`));
    report.push({ id: knife.id, counts });
    console.log(`${knife.id}: three locked-camera views, unchanged geometry and draw calls`);
  }
  assert.deepEqual(errors, []);
  writeFileSync(path.join(output, 'report.json'), `${JSON.stringify({ report, errors }, null, 2)}\n`);
  writeFileSync(path.join(output, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Knife Material Review</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@400;600&display=swap"><style>body{margin:0;background:#20242b;color:#eee;font-family:'Barlow Semi Condensed',sans-serif;letter-spacing:0}main{max-width:1600px;margin:auto;padding:24px}h1{font-size:30px}figure{margin:24px 0;border-top:1px solid #454d45;padding-top:16px}figcaption{font-size:24px;margin-bottom:8px}img{display:block;width:100%;height:auto}p{color:#adb5ac;font-size:18px}a{color:#89c9c1}@media(max-width:600px){main{padding:12px}}</style></head><body><main><h1>Knife Material Review</h1><p>Identical geometry, camera, lighting and exposure. Before on the left; updated materials on the right.</p>${report.map(entry => `<figure><figcaption>${KNIVES.find(knife => knife.id === entry.id).name}</figcaption><a href="${entry.id}-material-ab.png"><img src="${entry.id}-material-ab.png" width="1920" height="1740" loading="lazy" alt="${entry.id} material before and after"></a></figure>`).join('')}</main></body></html>`);
} finally {
  await browser.close();
}