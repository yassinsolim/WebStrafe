import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { KNIVES } from '../../src/combat/knives.ts';

const [base, output, candidateRoot] = process.argv.slice(2);
if (!base || !output) throw new Error('usage: node tools/qa/knife-reference-check.mjs <local-url> <temporary-output-directory> [candidate-url-directory]');
mkdirSync(output, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME || undefined,
  args: ['--use-angle=metal', '--enable-gpu', ...(process.env.LOCAL_IP ? [`--host-resolver-rules=MAP localhost ${process.env.LOCAL_IP}`] : [])],
});

try {
  const page = await browser.newPage({ viewport: { width: 900, height: 506 } });
  const report = [];
  const tiles = [];
  const sourcePath = path.join(output, 'sources.json');
  const previous = existsSync(sourcePath) ? JSON.parse(readFileSync(sourcePath, 'utf8')) : [];
  for (const [index, knife] of KNIVES.entries()) {
    const marketName = `\u2605 ${knife.name}`;
    const source = `https://steamcommunity.com/market/listings/730/${encodeURIComponent(marketName)}`;
    const referencePath = path.join(output, `${knife.id}-reference.png`);
    let imageUrl = previous.find(entry => entry.id === knife.id)?.imageUrl;
    let reference;
    if (imageUrl && existsSync(referencePath)) reference = readFileSync(referencePath);
    else {
      const response = await fetch(source);
      assert.ok(response.ok, `${knife.id}: reference page HTTP ${response.status}`);
      imageUrl = await page.evaluate(html => new DOMParser().parseFromString(html, 'text/html')
        .querySelector('meta[property="og:image"]')?.getAttribute('content'), await response.text());
      assert.ok(imageUrl, `${knife.id}: missing reference image`);
      const imageResponse = await fetch(imageUrl);
      assert.ok(imageResponse.ok, `${knife.id}: reference image HTTP ${imageResponse.status}`);
      reference = Buffer.from(await imageResponse.arrayBuffer());
      writeFileSync(referencePath, reference);
    }
    for (const suffix of ['', '_lod1']) {
      const backup = path.join(output, `${knife.id}-before${suffix}.glb`);
      if (!existsSync(backup)) copyFileSync(`public/knives/${knife.id}${suffix}.glb`, backup);
    }
    const model = candidateRoot ? `&model=${encodeURIComponent(`${candidateRoot}/${knife.id}.glb`)}` : '';
    await page.goto(`${base}/tools/knife-model-preview.html?knife=${knife.id}&view=34&width=900${model}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__shotReady);
    const ours = await page.screenshot({ path: path.join(output, `${knife.id}-${candidateRoot ? 'rework' : 'before'}.png`) });
    const column = index % 3;
    const row = Math.floor(index / 3);
    const left = column * 560;
    const top = row * 330;
    const label = Buffer.from(`<svg width="560" height="38"><rect width="560" height="38" fill="#161b18"/><text x="12" y="25" fill="#f0f0ea" font-family="sans-serif" font-size="18">${knife.name}: CS2 / WebStrafe</text></svg>`);
    tiles.push({ input: label, left, top });
    tiles.push({ input: await sharp(reference).resize(280, 280, { fit: 'contain', background: '#262b33' }).png().toBuffer(), left, top: top + 38 });
    tiles.push({ input: await sharp(ours).resize(280, 280, { fit: 'contain', background: '#262b33' }).png().toBuffer(), left: left + 280, top: top + 38 });
    report.push({ id: knife.id, source, imageUrl });
    console.log(`captured ${knife.id}`);
  }
  await sharp({ create: { width: 1680, height: 1320, channels: 3, background: '#262b33' } })
    .composite(tiles).png().toFile(path.join(output, candidateRoot ? 'rework-reference-sheet.png' : 'reference-sheet.png'));
  writeFileSync(path.join(output, 'sources.json'), `${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser.close();
}