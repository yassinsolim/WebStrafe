import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [base, output] = process.argv.slice(2);
if (!base) throw new Error('usage: node tools/qa/menu-design-check.mjs <local-dev-url> [output-directory]');
if (output) mkdirSync(output, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME || undefined,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--mute-audio', ...(process.env.LOCAL_IP ? [`--host-resolver-rules=MAP localhost ${process.env.LOCAL_IP}`] : [])],
});
const report = { layouts: [], canvases: [], workflows: [], errors: [], failedAssets: [] };

async function screenshot(page, name) {
  if (output) await page.screenshot({ path: path.join(output, `${name}.png`) });
}

async function canvasPixels(page, selector) {
  return page.locator(selector).evaluate(canvas => new Promise(resolve => {
    const deadline = performance.now() + 1500;
    const read = () => {
      const sample = document.createElement('canvas');
      sample.width = 160;
      sample.height = Math.max(1, Math.round(160 * canvas.height / canvas.width));
      const context = sample.getContext('2d', { willReadFrequently: true });
      context.drawImage(canvas, 0, 0, sample.width, sample.height);
      const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
      let opaque = 0;
      let lit = 0;
      let hash = 2166136261;
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index + 3] > 24) opaque += 1;
        if (pixels[index + 3] > 24 && Math.max(pixels[index], pixels[index + 1], pixels[index + 2]) > 50) lit += 1;
        hash = Math.imul(hash ^ pixels[index], 16777619);
        hash = Math.imul(hash ^ pixels[index + 1], 16777619);
        hash = Math.imul(hash ^ pixels[index + 2], 16777619);
      }
      if (lit === 0 && performance.now() < deadline) {
        requestAnimationFrame(read);
        return;
      }
      resolve({ width: canvas.clientWidth, height: canvas.clientHeight, opaque, lit, hash: hash >>> 0 });
    };
    requestAnimationFrame(read);
  }));
}

async function readyCanvas(page, selector, label) {
  await page.waitForFunction(async selector => {
    const canvas = document.querySelector(selector);
    if (!canvas || canvas.width < 1 || canvas.height < 1) return false;
    return new Promise(resolve => requestAnimationFrame(() => {
      const sample = document.createElement('canvas');
      sample.width = sample.height = 64;
      const context = sample.getContext('2d', { willReadFrequently: true });
      context.drawImage(canvas, 0, 0, 64, 64);
      const pixels = context.getImageData(0, 0, 64, 64).data;
      let lit = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index + 3] > 24 && Math.max(pixels[index], pixels[index + 1], pixels[index + 2]) > 50) lit += 1;
      }
      resolve(lit > 20);
    }));
  }, selector, { timeout: 30000 });
  const pixels = await canvasPixels(page, selector);
  assert.ok(pixels.lit > 50, `${label}: blank canvas ${JSON.stringify(pixels)}`);
  report.canvases.push({ label, ...pixels });
  return pixels;
}

async function checkLayout(page, label) {
  const layout = await page.evaluate(() => {
    const menu = document.querySelector('.main-menu');
    const active = menu.querySelector('.menu-section.is-active');
    const play = menu.querySelector('.menu-play-btn').getBoundingClientRect();
    const leaves = [...active.querySelectorAll('button, input, select, h2, h3, .menu-map-name, .knife-card-name')];
    const overflowing = leaves.filter(element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility === 'visible' && rect.width > 0 && rect.height > 0
        && (rect.left < -1 || rect.right > innerWidth + 1)
        && !element.closest('.set-nav, .menu-nav');
    }).map(element => ({ class: element.className, text: element.textContent?.slice(0, 50) }));
    return {
      width: innerWidth, height: innerHeight, tab: menu.dataset.tab,
      shellHeight: menu.querySelector('.menu-shell').getBoundingClientRect().height,
      playBottom: play.bottom, panelWidth: active.clientWidth, panelScrollWidth: active.scrollWidth,
      overflowing,
    };
  });
  assert.ok(layout.shellHeight <= layout.height + 1, `${label}: shell exceeds viewport`);
  assert.ok(layout.playBottom <= layout.height + 1, `${label}: Play is off-screen`);
  assert.ok(layout.panelScrollWidth <= layout.panelWidth + 1, `${label}: panel overflows`);
  assert.deepEqual(layout.overflowing, [], `${label}: controls outside viewport`);
  report.layouts.push({ label, ...layout });
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await context.route(/supabase\.(co|in)/, route => route.abort());
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400 && /\/(maps|characters|viewmodels|knives)\//.test(new URL(response.url()).pathname)) {
      report.failedAssets.push({ url: response.url(), status: response.status() });
    }
  });
  await page.goto(base, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('.menu-map-card');
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole('textbox', { name: 'Player name', exact: true }).fill('LongOperatorName123456789');
  await page.getByRole('textbox', { name: 'Player name', exact: true }).press('Enter');

  for (const [width, height] of [[1440, 900], [2560, 1440], [768, 1024], [390, 844], [320, 740]]) {
    await page.setViewportSize({ width, height });
    await page.getByRole('tab', { name: 'Play', exact: true }).click();
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await checkLayout(page, `lobby-${width}`);
    await readyCanvas(page, '.character-preview-canvas', `operator-${width}`);
    await screenshot(page, `lobby-${width}`);
    for (const tab of ['Loadout', 'Character', 'Leaderboard', 'Credits', 'Settings']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await checkLayout(page, `${tab.toLowerCase()}-${width}`);
    }
    for (const section of ['Game', 'Video', 'Audio', 'Crosshair', 'HUD', 'Controls']) {
      await page.getByRole('tab', { name: section, exact: true }).click();
      const dimensions = await page.locator('.set-page.is-active').evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth }));
      assert.ok(dimensions.scroll <= dimensions.width + 1, `${section} overflows at ${width}px`);
    }
    await page.getByRole('tab', { name: 'Character', exact: true }).click();
    await page.getByRole('button', { name: 'Customize operator', exact: true }).click();
    await readyCanvas(page, '.cz-canvas', `customizer-${width}`);
    const geometry = await page.locator('.cz-screen').evaluate(element => ({
      width: element.scrollWidth,
      bottom: element.querySelector('.cz-btn-primary').getBoundingClientRect().bottom,
    }));
    assert.ok(geometry.width <= width + 1 && geometry.bottom <= height + 1, `Customizer overflows at ${width}px`);
    await screenshot(page, `customizer-${width}`);
    await page.locator('.cz-actions').getByRole('button', { name: 'Cancel', exact: true }).click();
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('tab', { name: 'Play', exact: true }).click();
  await page.evaluate(() => window.__menuClock(0));
  const idle = await canvasPixels(page, '.character-preview-canvas');
  await page.evaluate(() => window.__menuClock(5.2));
  const moving = await canvasPixels(page, '.character-preview-canvas');
  assert.notEqual(idle.hash, moving.hash, 'Operator animation is static');
  report.workflows.push('operator animation');

  for (const [filter, expected] of [['Surf', 'surf_'], ['Bhop', 'bhop_'], ['Combat', 'aim_']]) {
    await page.getByRole('button', { name: filter, exact: true }).click();
    assert.ok((await page.locator('.menu-map-card.is-selected').getAttribute('data-map-id')).startsWith(expected));
  }
  report.workflows.push('map mode filters');

  const mapCases = await page.evaluate(async () => {
    const { PlayPanel } = await import('/src/ui/menu/PlayPanel.ts');
    const manifest = await fetch('/maps/manifest.json').then(response => response.json());
    const maps = Array.isArray(manifest) ? manifest : manifest.maps;
    const host = document.createElement('section');
    const selected = [];
    const played = [];
    const panel = new PlayPanel(host, { onSelect: id => selected.push(id), onPlay: id => played.push(id) });
    panel.setMaps(maps, maps[0].id);
    const second = host.querySelectorAll('.menu-map-card')[1];
    second.click();
    const connectedAfterClick = host.contains(second);
    second.dispatchEvent(new MouseEvent('dblclick'));
    [...host.querySelectorAll('.menu-map-filter')].find(button => button.textContent === 'Bhop').click();
    panel.setMaps(maps, maps.find(map => map.id.startsWith('aim_')).id);
    const externalSelectionVisible = !!host.querySelector('.menu-map-card.is-selected');
    panel.setMaps(maps, 'missing');
    const missingSelectionRecovered = panel.getSelected()?.id === maps[0].id;
    panel.setMaps([{ ...maps[0], thumbnailPath: undefined }], maps[0].id);
    const missingThumbnailFallback = !!host.querySelector('.menu-map-thumb svg');
    panel.setMaps(maps, maps[0].id);
    host.querySelector('.menu-map-thumb img').dispatchEvent(new Event('error'));
    const failedThumbnailFallback = !!host.querySelector('.menu-map-thumb svg');
    panel.setMaps([], 'missing');
    return { selected, played, connectedAfterClick, externalSelectionVisible, missingSelectionRecovered, missingThumbnailFallback, failedThumbnailFallback, empty: host.querySelector('.menu-map-detail').textContent };
  });
  assert.ok(mapCases.connectedAfterClick && mapCases.externalSelectionVisible);
  assert.ok(mapCases.missingSelectionRecovered && mapCases.missingThumbnailFallback && mapCases.failedThumbnailFallback);
  assert.equal(mapCases.played.length, 1);
  assert.equal(mapCases.empty, 'No maps available');
  report.workflows.push('double-click node retention, external map updates, empty maps, thumbnail fallbacks');

  await page.getByRole('tab', { name: 'Loadout', exact: true }).click();
  await readyCanvas(page, '.finish-inspect canvas', 'knife-preview');
  await page.locator('.finish-swatch[data-finish="case_hardened"]').click();
  await page.getByRole('spinbutton', { name: 'Pattern seed', exact: true }).fill('12');
  await page.getByRole('spinbutton', { name: 'Pattern seed', exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Randomize pattern', exact: true }).click();
  assert.ok(Number(await page.getByRole('spinbutton', { name: 'Pattern seed', exact: true }).inputValue()) >= 0);
  const knife = page.locator('.menu-knife-card').filter({ hasText: 'Butterfly' });
  await knife.click();
  assert.equal(await knife.getAttribute('aria-pressed'), 'true');
  await page.locator('.menu-section[data-tab="loadout"]').evaluate(element => { element.scrollTop = 0; });
  await readyCanvas(page, '.finish-inspect canvas', 'butterfly-preview');
  await screenshot(page, 'loadout');
  report.workflows.push('knife, finish, and pattern selection');

  await page.getByRole('tab', { name: 'Character', exact: true }).click();
  await page.getByRole('button', { name: 'Customize operator', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('[data-body="sentinel"]').click();
  await readyCanvas(page, '.cz-canvas', 'sentinel');
  const before = await canvasPixels(page, '.cz-canvas');
  const canvasBox = await page.locator('.cz-canvas').boundingBox();
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width / 2 + 100, canvasBox.y + canvasBox.height / 2, { steps: 8 });
  await page.mouse.up();
  assert.notEqual((await canvasPixels(page, '.cz-canvas')).hash, before.hash, 'Character orbit did not respond');
  await dialog.getByRole('textbox', { name: 'Tag', exact: true }).fill('UIQA');
  await dialog.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.notEqual(await dialog.getByRole('textbox', { name: 'Tag', exact: true }).inputValue(), 'UIQA');
  await dialog.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.equal(await dialog.getByRole('textbox', { name: 'Tag', exact: true }).inputValue(), 'UIQA');
  await dialog.locator('.cz-actions').getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Customize operator', exact: true }).click();
  assert.equal(await dialog.getByRole('textbox', { name: 'Tag', exact: true }).inputValue(), 'UIQA');
  await dialog.getByRole('textbox', { name: 'Tag', exact: true }).fill('CANCEL');
  await dialog.locator('.cz-actions').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Customize operator', exact: true }).click();
  assert.equal(await dialog.getByRole('textbox', { name: 'Tag', exact: true }).inputValue(), 'UIQA');
  await page.keyboard.press('Escape');
  report.workflows.push('character orbit, undo/redo, save, and cancel');

  await page.getByRole('tab', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Combat', exact: true }).click();
  await page.locator('.menu-map-card[data-map-id="aim_ochrecut"]').dblclick();
  await page.locator('.main-menu').waitFor({ state: 'hidden', timeout: 60000 });
  await page.locator('.loading-overlay').waitFor({ state: 'hidden', timeout: 60000 });
  await readyCanvas(page, '#app > canvas', 'game-world');
  await screenshot(page, 'game');
  await page.keyboard.press('Escape');
  await page.locator('.main-menu').waitFor({ state: 'visible' });
  assert.equal((await page.locator('.menu-play-label').textContent())?.trim(), 'Resume');
  await page.locator('.menu-play-btn').click();
  await page.locator('.main-menu').waitFor({ state: 'hidden' });
  report.workflows.push('real map double-click, play, pause, and resume');

  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedAssets, []);
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (output) writeFileSync(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}