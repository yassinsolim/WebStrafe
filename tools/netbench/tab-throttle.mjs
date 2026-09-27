// measures what a browser does to the supabase host loop (setInterval at 60 Hz)
// once its tab is in the background. launches its own headless chromium via cdp.
//
//   CHROME_PATH=/path/to/chrome node tools/netbench/tab-throttle.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const chrome = process.env.CHROME_PATH;
if (!chrome) {
  console.error('set CHROME_PATH');
  process.exit(2);
}
const port = 9300 + Math.floor(Math.random() * 400);
const profile = mkdtempSync(path.join(tmpdir(), 'ws-throttle-'));
const proc = spawn(chrome, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function json(url, init) {
  for (let i = 0; i < 50; i += 1) {
    try {
      const r = await fetch(url, init);
      if (r.ok) return r.json();
    } catch {
      // chrome not up yet
    }
    await sleep(200);
  }
  throw new Error(`no response from ${url}`);
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  const ready = new Promise((r) => ws.addEventListener('open', r));
  return {
    ready,
    send: (method, params = {}) => new Promise((resolve) => {
      id += 1;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    }),
    close: () => ws.close(),
  };
}

// same shape as the old SupabaseMultiplayer host timer: setInterval(tick, 17)
const page = `data:text/html,<script>
  window.ticks = []; window.dts = []; let last = performance.now();
  setInterval(() => { const n = performance.now(); window.ticks.push(n); window.dts.push(n - last); last = n; }, 17);
</script>host loop`;

async function main() {
  await json(`http://127.0.0.1:${port}/json/version`);
  const hostTab = await json(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(page)}`, { method: 'PUT' });
  const host = connect(hostTab.webSocketDebuggerUrl);
  await host.ready;
  await host.send('Page.bringToFront');
  await sleep(1500);

  const read = async (expr) => (await host.send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.result.value;
  const window = async (label, ms) => {
    await read('window.ticks.length = 0, window.dts.length = 0, 0');
    await sleep(ms);
    const dts = await read('window.dts.slice()');
    const vis = await read('document.visibilityState');
    const sorted = [...dts].sort((a, b) => a - b);
    const p = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? null;
    return {
      label,
      visibility: vis,
      ticksPerSec: +(dts.length / (ms / 1000)).toFixed(1),
      gapP50Ms: p(0.5) && +p(0.5).toFixed(1),
      gapMaxMs: sorted.length ? +sorted.at(-1).toFixed(1) : null,
    };
  };

  const results = [];
  results.push(await window('foreground', 5000));
  // open and focus another tab, the host tab becomes hidden
  const other = await json(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
  await fetch(`http://127.0.0.1:${port}/json/activate/${other.id}`);
  await sleep(1000);
  results.push(await window('background', 10000));
  console.log(JSON.stringify(results, null, 2));
  host.close();
  proc.kill('SIGTERM');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  proc.kill('SIGTERM');
  process.exit(1);
});
