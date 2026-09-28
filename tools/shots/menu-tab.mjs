// menu screenshots: opens the game, clicks a main menu tab and optionally
// scrolls an element into view (same chromium setup as capture.mjs).
//   node tools/shots/menu-tab.mjs <url> <out.png> <tab label> [selector to scroll to]
// env: PLAYWRIGHT_MODULE, CHROME, GPU=1, WIDTH, HEIGHT, SETTLE_MS,
//      STORAGE='{"key":"value"}' (localStorage before the page loads), CLICK='sel1|sel2' (clicked in order),
//      SCROLL_BLOCK=start|center|end (align the selector instead of the minimal scroll)
const [url, out, tab, selector] = process.argv.slice(2);
if (!url || !out || !tab) {
  console.error('usage: node tools/shots/menu-tab.mjs <url> <out.png> <tab label> [selector]');
  process.exit(1);
}
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const gpu = !!process.env.GPU;
const browser = await chromium.launch({
  headless: !gpu,
  executablePath: process.env.CHROME || undefined,
  args: gpu
    ? ['--use-angle=metal', '--ignore-gpu-blocklist']
    : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({
  viewport: { width: Number(process.env.WIDTH ?? 1600), height: Number(process.env.HEIGHT ?? 900) },
  deviceScaleFactor: 1,
});
page.on('console', (msg) => {
  if (msg.type() === 'error' && !msg.text().includes('WebSocket')) console.log(`[error] ${msg.text().slice(0, 300)}`);
});
page.on('pageerror', (err) => console.log(`[pageerror] ${err.message.slice(0, 300)}`));
if (process.env.STORAGE) {
  await page.addInitScript((entries) => {
    for (const [key, value] of Object.entries(JSON.parse(entries))) localStorage.setItem(key, String(value));
  }, process.env.STORAGE);
}
await page.goto(url, { timeout: 60000 });
await page.waitForSelector('.menu-tab', { timeout: 90000 });
await page.locator('.menu-tab', { hasText: tab }).first().click();
for (const sel of (process.env.CLICK ?? '').split('|').filter(Boolean)) {
  await page.locator(sel).first().click();
  await page.waitForTimeout(200);
}
if (selector && process.env.SCROLL_BLOCK) {
  await page.locator(selector).first().evaluate((el, block) => el.scrollIntoView({ block }), process.env.SCROLL_BLOCK);
} else if (selector) {
  await page.locator(selector).first().scrollIntoViewIfNeeded();
}
await page.waitForTimeout(Number(process.env.SETTLE_MS ?? 2500));
await page.screenshot({ path: out });
console.log(`ok ${out}`);
await browser.close();
