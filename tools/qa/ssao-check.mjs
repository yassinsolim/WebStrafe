import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [base, output] = process.argv.slice(2);
if (!base) throw new Error('usage: node tools/qa/ssao-check.mjs <local-dev-url> [output-directory]');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME || undefined,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', ...(process.env.LOCAL_IP ? [`--host-resolver-rules=MAP localhost ${process.env.LOCAL_IP}`] : [])],
});

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.route(/supabase\.(co|in)/, route => route.abort());
  const page = await context.newPage();
  await page.goto(base, { waitUntil: 'networkidle' });
  const results = await page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { RenderPipeline } = await import('/src/render/RenderPipeline.ts');
    const { QUALITY_PRESETS } = await import('/src/render/quality.ts');
    window.__menuPreview?.stop();
    const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
    renderer.autoClear = false;
    renderer.setSize(1280, 800);
    const pipeline = new RenderPipeline(renderer);
    pipeline.setPreset({ ...QUALITY_PRESETS.ultra, bloom: false });
    pipeline.setSize(1280, 800);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    const camera = new THREE.PerspectiveCamera(100, 1.6, 0.1, 6000);
    camera.position.set(0, 1.62, 0);
    camera.lookAt(0, 1.62, -10);
    document.body.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = 'position:fixed;inset:0;z-index:99999';
    const results = [];
    const measure = (mode, quality) => {
      pipeline.render(scene, camera, null, null);
      const target = pipeline.ssao.aoTarget;
      const pixels = new Uint8Array(target.width * target.height);
      renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, pixels);
      let dark = 0;
      let minimum = 255;
      let sum = 0;
      const bounds = { left: target.width, top: target.height, right: -1, bottom: -1 };
      for (const [index, value] of pixels.entries()) {
        if (value < 250) {
          dark += 1;
          bounds.left = Math.min(bounds.left, index % target.width);
          bounds.right = Math.max(bounds.right, index % target.width);
          bounds.top = Math.min(bounds.top, Math.floor(index / target.width));
          bounds.bottom = Math.max(bounds.bottom, Math.floor(index / target.width));
        }
        minimum = Math.min(minimum, value);
        sum += value;
      }
      results.push({ mode, quality, minimum, mean: sum / pixels.length, dark, total: pixels.length, bounds });
    };
    for (const quality of ['high', 'ultra']) {
      pipeline.setPreset({ ...QUALITY_PRESETS[quality], bloom: false });
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(0, 0, 0);
      measure('floor', quality);
      floor.rotation.x = 0;
      floor.position.set(0, 1.62, -3);
      measure('wall', quality);
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(0, 0, 0);
      const occluder = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      occluder.position.set(0, 0.5, -2);
      scene.add(occluder);
      measure('contact', quality);
      scene.remove(occluder);
      occluder.geometry.dispose();
      occluder.material.dispose();
    }
    pipeline.render(scene, camera, null, null);
    return results;
  });
  if (output) {
    mkdirSync(output, { recursive: true });
    writeFileSync(path.join(output, 'report.json'), `${JSON.stringify(results, null, 2)}\n`);
    await page.screenshot({ path: path.join(output, 'plane.png') });
  }
  console.log(JSON.stringify(results, null, 2));
  for (const result of results) {
    if (result.mode === 'contact') assert.ok(result.dark > 100 && result.minimum < 245, `${result.quality}: contact occlusion must remain visible`);
    else assert.ok(result.minimum >= 250, `${result.quality}: unoccluded ${result.mode} must not produce dark AO bands`);
  }
} finally {
  await browser.close();
}