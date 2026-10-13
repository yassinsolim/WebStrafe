import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { KNIVES } from '../../src/combat/knives.ts';

const [base, references, output, ...selected] = process.argv.slice(2);
if (!base || !references || !output) throw new Error('usage: node tools/qa/knife-photo-match.mjs <local-url> <reference-directory> <output-directory> [knife ...]');
const fitShapes = selected.includes('--fit-shape');
const selectedIds = selected.filter(value => value !== '--fit-shape');
mkdirSync(output, { recursive: true });
const width = 256;
const height = 192;
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME || undefined,
  args: ['--use-angle=metal', '--enable-gpu', ...(process.env.LOCAL_IP ? [`--host-resolver-rules=MAP localhost ${process.env.LOCAL_IP}`] : [])],
});
const reports = [];

try {
  const page = await browser.newPage({ viewport: { width: 768, height: 576 } });
  if (process.env.KNIFE_ASSET_DIR) {
    await page.route('**/knives/*.glb', route => route.fulfill({
      contentType: 'model/gltf-binary',
      body: readFileSync(path.join(process.env.KNIFE_ASSET_DIR, path.basename(new URL(route.request().url()).pathname))),
    }));
  }
  for (const knife of KNIVES.filter(entry => selectedIds.length === 0 || selectedIds.includes(entry.id))) {
    const source = path.join(references, `${knife.id}-reference.png`);
    const pixels = await sharp(source).ensureAlpha().resize(width, height, { fit: 'contain', background: '#00000000' }).raw().toBuffer();
    const mask = Array.from({ length: width * height }, (_, index) => pixels[index * 4 + 3] > 128 ? 1 : 0);
    if (knife.id === 'shadow_daggers') {
      const visited = new Uint8Array(mask.length);
      let largest = [];
      for (let index = 0; index < mask.length; index += 1) {
        if (!mask[index] || visited[index]) continue;
        const component = [index];
        visited[index] = 1;
        for (let cursor = 0; cursor < component.length; cursor += 1) {
          const current = component[cursor];
          for (const neighbor of [current - width, current + width, current % width ? current - 1 : -1, current % width < width - 1 ? current + 1 : -1]) {
            if (neighbor < 0 || neighbor >= mask.length || !mask[neighbor] || visited[neighbor]) continue;
            visited[neighbor] = 1;
            component.push(neighbor);
          }
        }
        if (component.length > largest.length) largest = component;
      }
      mask.fill(0);
      for (const index of largest) mask[index] = 1;
      for (let index = 0; index < mask.length; index += 1) if (!mask[index]) pixels[index * 4 + 3] = 0;
    }
    await page.goto(`${base}/tools/knife-model-preview.html?knife=${knife.id}&width=768`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__shotReady);
    const result = await page.evaluate(async ({ targetMask, width, height, fitShapes }) => {
      const THREE = await import('/node_modules/.vite/deps/three.js');
      const preview = window.__knifeModelPreview;
      const { renderer, scene, holder, knife } = preview;
      const center = new THREE.Box3().setFromObject(knife).getCenter(new THREE.Vector3());
      knife.position.sub(center);
      const camera = new THREE.OrthographicCamera(-0.25, 0.25, 0.1875, -0.1875, 0.01, 5);
      camera.position.set(0, 0, -1);
      camera.lookAt(0, 0, 0);
      const target = new THREE.WebGLRenderTarget(width, height, { depthBuffer: true });
      const flat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
      const rgba = new Uint8Array(width * height * 4);
      const axis = new THREE.Vector3(0, 0, 1);
      const tipSocket = knife.getObjectByName('socket_tip');
      const gripSocket = knife.getObjectByName('socket_grip');
      const tipPosition = new THREE.Vector3();
      const gripPosition = new THREE.Vector3();
      knife.updateWorldMatrix(true, true);
      const inverseKnife = knife.matrixWorld.clone().invert();
      const ringSocket = knife.getObjectByName('socket_ring');
      const ringPosition = ringSocket?.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverseKnife);
      const gripCenter = gripSocket.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverseKnife);
      const vertices = [];
      knife.traverse(mesh => {
        if (!mesh.isMesh) return;
        mesh.geometry = mesh.geometry.clone();
        const transform = inverseKnife.clone().multiply(mesh.matrixWorld);
        const original = [];
        for (let index = 0; index < mesh.geometry.attributes.position.count; index += 1) {
          original.push(new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, index).applyMatrix4(transform));
        }
        vertices.push({ mesh, original, inverse: transform.invert(), blade: /^knife_(blade|edge)/.test(mesh.material.name) });
      });
      const sockets = [tipSocket, gripSocket, ringSocket].filter(Boolean).map(socket => ({
        socket, original: socket.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverseKnife),
        inverse: inverseKnife.clone().multiply(socket.parent.matrixWorld).invert(),
      }));
      let shape = { bladeLength: 1, bladeHeight: 1, handleLength: 1, handleHeight: 1, handleBend: 0 };
      const deform = (point, values) => {
        const blend = THREE.MathUtils.smoothstep(point.x, -0.008, 0.008);
        return new THREE.Vector3(point.x * THREE.MathUtils.lerp(values.handleLength, values.bladeLength, blend),
          gripCenter.y + (point.y - gripCenter.y) * THREE.MathUtils.lerp(values.handleHeight, values.bladeHeight, blend)
          + (1 - blend) * values.handleBend * (point.x / 0.12) ** 2, point.z);
      };
      const applyShape = values => {
        const movedRing = ringPosition ? deform(ringPosition, values) : null;
        for (const entry of vertices) {
          const positions = entry.mesh.geometry.attributes.position;
          for (const [index, original] of entry.original.entries()) {
            const point = deform(original, values);
            if (ringPosition && !entry.blade) {
              const radius = Math.hypot(original.x - ringPosition.x, original.y - ringPosition.y);
              const weight = 1 - THREE.MathUtils.smoothstep(radius, 0.0165, 0.025);
              point.lerp(original.clone().sub(ringPosition).add(movedRing), weight);
            }
            point.applyMatrix4(entry.inverse);
            positions.setXYZ(index, point.x, point.y, point.z);
          }
          positions.needsUpdate = true;
          entry.mesh.geometry.computeBoundingBox();
          entry.mesh.geometry.computeBoundingSphere();
        }
        for (const entry of sockets) entry.socket.position.copy(deform(entry.original, values).applyMatrix4(entry.inverse));
        shape = { ...values };
      };
      scene.overrideMaterial = flat;
      renderer.setClearColor(0x000000, 1);

      const statistics = mask => {
        let count = 0;
        let sumX = 0;
        let sumY = 0;
        let sumXX = 0;
        let sumYY = 0;
        let sumXY = 0;
        let left = width;
        let right = 0;
        let top = height;
        let bottom = 0;
        for (let index = 0; index < mask.length; index += 1) {
          if (!mask[index]) continue;
          const horizontal = index % width + 0.5;
          const vertical = Math.floor(index / width) + 0.5;
          count += 1;
          sumX += horizontal;
          sumY += vertical;
          sumXX += horizontal * horizontal;
          sumYY += vertical * vertical;
          sumXY += horizontal * vertical;
          left = Math.min(left, horizontal);
          right = Math.max(right, horizontal);
          top = Math.min(top, vertical);
          bottom = Math.max(bottom, vertical);
        }
        if (!count) return null;
        const centerX = sumX / count;
        const centerY = sumY / count;
        return { count, centerX, centerY, left, right, top, bottom, angle: 0.5 * Math.atan2(2 * (sumXY / count - centerX * centerY), sumXX / count - centerX * centerX - sumYY / count + centerY * centerY) };
      };
      const reference = statistics(targetMask);
      const renderMask = () => {
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
        renderer.readRenderTargetPixels(target, 0, 0, width, height, rgba);
        const mask = new Uint8Array(width * height);
        for (let row = 0; row < height; row += 1) {
          for (let column = 0; column < width; column += 1) mask[row * width + column] = rgba[((height - 1 - row) * width + column) * 4] > 128 ? 1 : 0;
        }
        return mask;
      };
      const overlap = mask => {
        let intersection = 0;
        let union = 0;
        for (let index = 0; index < mask.length; index += 1) {
          if (mask[index] || targetMask[index]) union += 1;
          if (mask[index] && targetMask[index]) intersection += 1;
        }
        return union ? intersection / union : 0;
      };
      const fit = (pitch, yaw, flip) => {
        holder.position.set(0, 0, 0);
        holder.scale.setScalar(1);
        holder.rotation.set(pitch, yaw, 0);
        const initial = statistics(renderMask());
        if (!initial) return { score: 0, pitch, yaw, flip };
        const roll = reference.angle - initial.angle + flip;
        holder.rotateOnWorldAxis(axis, roll);
        const rotated = statistics(renderMask());
        const fitLimit = Math.min(
          (reference.centerX - 2) / (rotated.centerX - rotated.left),
          (width - 2 - reference.centerX) / (rotated.right - rotated.centerX),
          (reference.centerY - 2) / (rotated.centerY - rotated.top),
          (height - 2 - reference.centerY) / (rotated.bottom - rotated.centerY),
        );
        const scale = Math.min(Math.sqrt(reference.count / rotated.count), fitLimit);
        holder.scale.setScalar(scale);
        const centerX = width / 2 + (rotated.centerX - width / 2) * scale;
        const centerY = height / 2 + (rotated.centerY - height / 2) * scale;
        holder.position.set((centerX - reference.centerX) * 0.5 / width, (centerY - reference.centerY) * 0.375 / height, 0);
        const fittedBounds = new THREE.Box3().setFromObject(holder, true);
        const anchorX = (width / 2 - reference.centerX) * 0.5 / width;
        const anchorY = (height / 2 - reference.centerY) * 0.375 / height;
        const paddingX = 0.5 * 4 / width;
        const paddingY = 0.375 * 4 / height;
        const safeScale = Math.min(1,
          (0.25 - paddingX - anchorX) / (fittedBounds.max.x - anchorX),
          (anchorX + 0.25 - paddingX) / (anchorX - fittedBounds.min.x),
          (0.1875 - paddingY - anchorY) / (fittedBounds.max.y - anchorY),
          (anchorY + 0.1875 - paddingY) / (anchorY - fittedBounds.min.y));
        if (safeScale > 0 && safeScale < 1) {
          holder.scale.multiplyScalar(safeScale);
          holder.position.x = anchorX + (holder.position.x - anchorX) * safeScale;
          holder.position.y = anchorY + (holder.position.y - anchorY) * safeScale;
        }
        const mask = renderMask();
        tipSocket.getWorldPosition(tipPosition).project(camera);
        gripSocket.getWorldPosition(gripPosition).project(camera);
        if (tipPosition.x >= gripPosition.x) return { score: 0, pitch, yaw, flip };
        return { score: overlap(mask), pitch, yaw, flip, roll, scale: holder.scale.x, position: holder.position.toArray(), mask };
      };
      let best = { score: -1 };
      for (const face of [0, Math.PI]) {
        for (const pitch of [-0.6, -0.3, 0, 0.3, 0.6]) {
          for (const yawOffset of [-0.6, -0.3, 0, 0.3, 0.6]) {
            for (const flip of [0, Math.PI]) {
              const candidate = fit(pitch, face + yawOffset, flip);
              if (candidate.score > best.score) best = candidate;
            }
          }
        }
      }
      for (const step of [0.12, 0.05]) {
        const origin = best;
        for (const pitchDelta of [-step, 0, step]) {
          for (const yawDelta of [-step, 0, step]) {
            const candidate = fit(origin.pitch + pitchDelta, origin.yaw + yawDelta, origin.flip);
            if (candidate.score > best.score) best = candidate;
          }
        }
      }
      const baselineScore = best.score;
      if (fitShapes) {
        const limits = { bladeLength: [0.75, 1.3], bladeHeight: [0.75, 1.35], handleLength: [0.8, 1.15], handleHeight: [0.8, 1.45], handleBend: [-0.018, 0.018] };
        for (const step of [0.12, 0.06, 0.03]) {
          for (let pass = 0; pass < 2; pass += 1) {
            for (const name of Object.keys(limits)) {
              const origin = { ...shape };
              let accepted = origin;
              for (const direction of [-1, 1]) {
                const values = { ...origin, [name]: THREE.MathUtils.clamp(origin[name] + direction * step * (name === 'handleBend' ? 0.12 : 1), ...limits[name]) };
                applyShape(values);
                const candidate = fit(best.pitch, best.yaw, best.flip);
                if (candidate.score > best.score + 0.001) { best = candidate; accepted = values; }
              }
              applyShape(accepted);
            }
          }
        }
      }
      best = fit(best.pitch, best.yaw, best.flip);
      if (fitShapes) {
        for (const entry of vertices) {
          entry.mesh.geometry.computeVertexNormals();
          if (entry.mesh.geometry.index && entry.mesh.geometry.attributes.uv) entry.mesh.geometry.computeTangents();
        }
      }
      scene.overrideMaterial = null;
      renderer.setRenderTarget(null);
      renderer.setClearColor(0x262b33, 1);
      renderer.setSize(768, 576, false);
      renderer.render(scene, camera);
      target.dispose();
      flat.dispose();
      const { mask: finalMask, ...pose } = best;
      const framed = statistics(finalMask);
      return { ...pose, shape, baselineScore, mask: Array.from(finalMask), referenceArea: reference.count, matchedArea: framed.count,
        bounds: { left: framed.left, right: framed.right, top: framed.top, bottom: framed.bottom } };
    }, { targetMask: mask, width, height, fitShapes });
    assert.ok(result.score > 0.1, `${knife.id}: camera alignment failed`);
    assert.ok(result.bounds.left >= 1.5 && result.bounds.right <= width - 1.5 && result.bounds.top >= 1.5 && result.bounds.bottom <= height - 1.5, `${knife.id}: cropped comparison`);
    const renderPath = path.join(output, `${knife.id}-matched.png`);
    await page.screenshot({ path: renderPath });
    const overlay = Buffer.alloc(width * height * 4);
    for (let index = 0; index < mask.length; index += 1) {
      const referenceOnly = mask[index] && !result.mask[index];
      const modelOnly = result.mask[index] && !mask[index];
      const common = mask[index] && result.mask[index];
      overlay[index * 4] = common ? 220 : referenceOnly ? 239 : 38;
      overlay[index * 4 + 1] = common ? 224 : modelOnly ? 201 : referenceOnly ? 73 : 43;
      overlay[index * 4 + 2] = common ? 220 : modelOnly ? 193 : referenceOnly ? 62 : 51;
      overlay[index * 4 + 3] = 255;
    }
    const referenceImage = sharp(source).ensureAlpha().resize(512, 384, { fit: 'contain', background: '#00000000' });
    if (knife.id === 'shadow_daggers') {
      const matte = Buffer.alloc(width * height * 4, 255);
      for (let index = 0; index < mask.length; index += 1) matte[index * 4 + 3] = mask[index] * 255;
      referenceImage.composite([{ input: await sharp(matte, { raw: { width, height, channels: 4 } }).resize(512, 384, { kernel: 'nearest' }).png().toBuffer(), blend: 'dest-in' }]);
    }
    const referencePng = await referenceImage.png().toBuffer();
    writeFileSync(path.join(output, `${knife.id}-reference.png`), referencePng);
    const label = Buffer.from(`<svg width="1536" height="40"><rect width="1536" height="40" fill="#161b18"/><text x="12" y="28" fill="#eeeeea" font-family="sans-serif" font-size="20">${knife.name}: reference / aligned render / outline difference</text></svg>`);
    await sharp({ create: { width: 1536, height: 424, channels: 3, background: '#262b33' } }).composite([
      { input: label, left: 0, top: 0 },
      { input: await sharp(referencePng).flatten({ background: '#262b33' }).png().toBuffer(), left: 0, top: 40 },
      { input: await sharp(renderPath).resize(512, 384).png().toBuffer(), left: 512, top: 40 },
      { input: await sharp(overlay, { raw: { width, height, channels: 4 } }).resize(512, 384, { kernel: 'nearest' }).png().toBuffer(), left: 1024, top: 40 },
    ]).png().toFile(path.join(output, `${knife.id}-comparison.png`));
    const { mask: _mask, ...metrics } = result;
    reports.push({ id: knife.id, ...metrics, interpretation: 'single-view silhouette IoU after camera fitting; not a 3D or material fidelity score' });
    console.log(`${knife.id}: ${(result.score * 100).toFixed(1)}% single-view silhouette overlap`);
  }
  writeFileSync(path.join(output, 'report.json'), `${JSON.stringify(reports, null, 2)}\n`);
  const figures = reports.map(report => {
    const name = KNIVES.find(knife => knife.id === report.id).name;
    return `<figure><figcaption><strong>${name}</strong><span>${(report.score * 100).toFixed(1)}% outline overlap</span></figcaption><a href="${report.id}-comparison.png"><img src="${report.id}-comparison.png" width="1536" height="424" alt="${name}: reference, aligned render, and silhouette difference" loading="lazy"></a><p><a href="${report.id}-reference.png">Reference image</a><a href="${report.id}-matched.png">Full render</a></p></figure>`;
  }).join('\n');
  writeFileSync(path.join(output, 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Knife Photo Comparison</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@400;600;700&display=swap">
<style>body{margin:0;background:#20242b;color:#eee;font-family:'Barlow Semi Condensed',sans-serif;letter-spacing:0}main{max-width:1536px;margin:auto;padding:24px}h1{font-size:32px;margin:0 0 8px}p{font-size:17px;color:#b8beb9;margin:6px 0}.legend{display:flex;gap:24px;flex-wrap:wrap;padding:12px 0;border-bottom:1px solid #4a514b}.legend span::before{content:'';display:inline-block;width:12px;height:12px;background:var(--color);margin-right:8px}.photos{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,640px),1fr));gap:24px;margin-top:24px}figure{margin:0;min-width:0}figure p{display:flex;gap:20px}figcaption{display:flex;justify-content:space-between;gap:12px;font-size:20px;padding-bottom:6px}figcaption span{font-size:15px;color:#b8beb9}img{display:block;width:100%;height:auto}a{display:block;color:#89c9c1}a:focus-visible{outline:2px solid #89c9c1}@media(max-width:600px){main{padding:16px}figcaption{flex-wrap:wrap}}</style></head>
<body><main><h1>Knife Photo Comparison</h1><p>${reports.length} knives. One fitted reference view per knife.</p><p>These scores measure the visible outline only. Lighting, material accuracy, and hidden surfaces are not scored.</p><div class="legend"><span style="--color:#ef493e">Reference only</span><span style="--color:#26c9c1">Model only</span><span style="--color:#dce0dc">Overlap</span></div><section class="photos">${figures}</section></main></body></html>`);
} finally {
  await browser.close();
}