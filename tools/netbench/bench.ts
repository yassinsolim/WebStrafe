/**
 * reproducible multiplayer bench: 2 movers circling at 16 m/s plus 1 observer
 * that renders them with the real RemotePlayersRenderer and fires at where it
 * sees them. reports visual error, stutter, snapshot jitter, bandwidth and
 * hit rate under simulated latency/jitter/loss.
 *
 *   npx tsx tools/netbench/bench.ts                      # ws server, all link profiles
 *   npx tsx tools/netbench/bench.ts --only rtt60_jitter_loss --secs 30
 *   VITE_SUPABASE_URL=.. VITE_SUPABASE_KEY=.. npx tsx tools/netbench/bench.ts --transport supabase --skew 150
 *
 * the ws path spawns the real server/index.ts on a loopback port with bots off.
 * the supabase path uses an isolated `webstrafe_bench_*` channel, never a real lobby.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLatencyProxy, type LinkProfile } from './latencyProxy';
import type { WorkerConfig } from './client-worker';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

const PROFILES: Record<string, LinkProfile> = {
  lan: { delayMs: 0, jitterMs: 0, loss: 0, rtoMs: 0 },
  rtt60: { delayMs: 30, jitterMs: 0, loss: 0, rtoMs: 0 },
  rtt60_jitter_loss: { delayMs: 30, jitterMs: 15, loss: 0.02, rtoMs: 200 },
  rtt150_jitter_loss: { delayMs: 75, jitterMs: 20, loss: 0.01, rtoMs: 300 },
};

const args = process.argv.slice(2);
const opt = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const transport = opt('transport', 'ws') as 'ws' | 'supabase';
const secs = Number(opt('secs', '25'));
const skew = Number(opt('skew', '0'));
const only = opt('only', '');
const tag = opt('tag', 'run');

function runWorker(cfg: WorkerConfig): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const child = spawn('npx', ['tsx', path.join(HERE, 'client-worker.ts')], {
      cwd: ROOT,
      env: { ...process.env, BENCH_CFG: JSON.stringify(cfg), NODE_NO_WARNINGS: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout?.on('data', (d) => { out += d; });
    child.stderr?.on('data', (d) => { err += d; });
    child.on('exit', () => {
      const line = out.split('\n').find((l) => l.startsWith('RESULT '));
      resolve(line ? JSON.parse(line.slice(7)) : { label: cfg.label, error: err.slice(-800) || 'no result' });
    });
  });
}

async function waitForHealth(port: number): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not come up');
}

async function startServer(port: number): Promise<ChildProcess> {
  const child = spawn('npx', ['tsx', 'server/index.ts'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ENABLE_BOTS: 'false', NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr?.on('data', (d) => process.stderr.write(`[server] ${d}`));
  await waitForHealth(port);
  return child;
}

async function runScenario(name: string, base: Omit<WorkerConfig, 'role' | 'label' | 'sessionId' | 'phase' | 'clockSkewMs'>, skews: [number, number, number]) {
  const epochMs = Date.now();
  const common = { ...base, epochMs };
  const [a, b, o] = await Promise.all([
    runWorker({ ...common, role: 'mover', label: 'mover_a', sessionId: 'p_0000000a', phase: 0, clockSkewMs: skews[0], wsUrl: base.wsUrl && `${base.wsUrl}?label=mover_a` }),
    runWorker({ ...common, role: 'mover', label: 'mover_b', sessionId: 'p_0000000b', phase: Math.PI, clockSkewMs: skews[1], wsUrl: base.wsUrl && `${base.wsUrl}?label=mover_b` }),
    runWorker({ ...common, role: 'observer', label: 'observer', sessionId: 'p_zzzzzzzz', phase: 0, clockSkewMs: skews[2], wsUrl: base.wsUrl && `${base.wsUrl}?label=observer` }),
  ]);
  return { scenario: name, observer: o, movers: [a, b] };
}

async function main(): Promise<void> {
  const results: Array<Record<string, unknown>> = [];
  const durationMs = secs * 1000;
  const warmupMs = 5000;
  if (transport === 'ws') {
    const serverPort = 18787 + Math.floor(Math.random() * 1000);
    const server = await startServer(serverPort);
    try {
      for (const [name, profile] of Object.entries(PROFILES)) {
        if (only && !only.split(',').includes(name)) continue;
        const proxy = await startLatencyProxy(`ws://127.0.0.1:${serverPort}/ws`, profile, 7);
        const mapId = `bench_${name}`;
        const r = await runScenario(name, {
          transport: 'ws',
          wsUrl: `ws://127.0.0.1:${proxy.port}/`,
          mapId,
          durationMs,
          warmupMs,
          epochMs: 0,
        }, [0, 0, 0]);
        const obsLink = proxy.stats.get('observer');
        const moverLink = proxy.stats.get('mover_a');
        const totalSecs = durationMs / 1000;
        results.push({
          ...r,
          profile,
          bandwidth: {
            observerDownKBps: obsLink ? +(obsLink.downBytes / 1024 / totalSecs).toFixed(2) : null,
            observerDownMsgsPerSec: obsLink ? +(obsLink.downMessages / totalSecs).toFixed(1) : null,
            moverUpKBps: moverLink ? +(moverLink.upBytes / 1024 / totalSecs).toFixed(2) : null,
            moverUpMsgsPerSec: moverLink ? +(moverLink.upMessages / totalSecs).toFixed(1) : null,
            avgDownMsgBytes: obsLink ? Math.round(obsLink.downBytes / Math.max(1, obsLink.downMessages)) : null,
          },
        });
        await proxy.close();
        console.error(`[bench] ${name} done`);
      }
    } finally {
      server.kill('SIGTERM');
    }
  } else {
    const url = process.env.VITE_SUPABASE_URL;
    const key = process.env.VITE_SUPABASE_KEY;
    if (!url || !key) throw new Error('set VITE_SUPABASE_URL and VITE_SUPABASE_KEY');
    const prefix = `webstrafe_bench_${Math.random().toString(36).slice(2, 8)}`;
    // mover_a has the lowest id so it is the elected host; the observer is a remote shooter
    const r = await runScenario(`supabase_skew${skew}`, {
      transport: 'supabase',
      supabase: { url, key, prefix },
      mapId: 'bench_arena',
      durationMs,
      warmupMs,
      epochMs: 0,
    }, [0, 0, skew]);
    results.push({ ...r, prefix });
  }

  const outDir = path.join(HERE, 'results');
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `${tag}-${transport}.json`);
  await writeFile(file, `${JSON.stringify(results, null, 2)}\n`);

  console.log(`\n| scenario | vis err p50/p95 (m) | speed err p95 | frozen/jump % | snap gap p99 (ms) | hit rate | down KB/s |`);
  console.log(`|---|---|---|---|---|---|---|`);
  for (const r of results) {
    const o = r.observer as Record<string, any>;
    if (o.error) {
      console.log(`| ${r.scenario} | error: ${o.error} |`);
      continue;
    }
    const bw = (r.bandwidth as Record<string, any> | undefined)?.observerDownKBps ?? '-';
    console.log(`| ${r.scenario} | ${o.presentation.errorP50m} / ${o.presentation.errorP95m} | ${o.presentation.speedErrP95} | ${o.presentation.frozenPct} / ${o.presentation.jumpPct} | ${o.snapshots.gapP99} | ${o.combat.hits}/${o.combat.shotsAccepted} (${o.combat.hitRatePct}%) | ${bw} |`);
  }
  console.log(`\nwrote ${path.relative(ROOT, file)}`);
  process.exit(0);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
