/**
 * drives the real SurfBoards client (supabase-js) against a local postgrest +
 * postgres with the migrations applied. started by tools/surf/test-migrations.sh --e2e
 *
 *   BOARDS_URL=http://127.0.0.1:54330 BOARDS_JWT_SECRET=... npx tsx tools/surf/boards-e2e.ts
 */
import { createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { SurfBoards } from '../../src/surf/SurfBoards';
import { GhostRecorder, decodeGhost, encodeGhost } from '../../src/surf/ghost';

const url = process.env.BOARDS_URL ?? 'http://127.0.0.1:54330';
const secret = process.env.BOARDS_JWT_SECRET ?? '';

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function anonJwt(): string {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ role: 'anon', iss: 'webstrafe-e2e', exp: Math.floor(Date.now() / 1000) + 3600 }));
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

function boardsFor(ip: string): SurfBoards {
  // supabase-js talks to <url>/rest/v1, a bare postgrest serves at the root
  const client = createClient('http://supabase.local', anonJwt(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { 'x-forwarded-for': ip },
      fetch: (input, init) => fetch(String(input instanceof Request ? input.url : input).replace('http://supabase.local/rest/v1', url), init),
    },
  });
  return new SurfBoards(async () => client);
}

function check(cond: unknown, what: string): void {
  if (!cond) {
    console.error(`FAIL ${what}`);
    process.exit(1);
  }
  console.log(`ok   ${what}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const boards = boardsFor('198.51.100.20');

  const token = await boards.startRun('e2e_map');
  check(typeof token === 'string', 'start_run issues a token');

  const rec = new GhostRecorder();
  for (let i = 0; i < 128 * 3; i += 1) rec.sample(i * 0.1, 5, -i * 0.05, i / 200);
  const ghost = encodeGhost(rec.take());

  const early = await boards.submitRun({ token: (await boards.startRun('e2e_map'))!, name: 'Early Bird', model: 'terrorist', ticks: 128 * 8, splits: [128 * 4], pvp: false, ghost: null });
  check(early && !early.ok && early.reason === 'timer ran faster than real time', 'an 8 s claim right after the token is rejected');

  await sleep(1200);
  const res = await boards.submitRun({ token: token!, name: 'E2E Surfer', model: 'counterterrorist', ticks: 128 * 3, splits: [128 * 1], pvp: true, ghost });
  check(res?.ok === true && res.rank === 1 && res.personalBest === true, `a 3 s run submits and ranks first (${JSON.stringify(res)})`);

  const again = await boards.submitRun({ token: token!, name: 'E2E Surfer', model: 'counterterrorist', ticks: 128 * 3, splits: [128 * 1], pvp: true, ghost: null });
  check(again && !again.ok && again.reason === 'bad or used run token', 'the same token cannot submit twice');

  const board = await boards.fetchMapBoard('e2e_map');
  check(board.length === 1 && board[0].name === 'E2E Surfer' && board[0].timeMs === 3000 && board[0].pvp && board[0].hasGhost,
    `map board shows the run (${JSON.stringify(board)})`);
  check(board[0].stageMs.join(',') === '1000,2000', 'stage times are derived server side');

  const stage2 = await boards.fetchStageBoard('e2e_map', 2);
  check(stage2.length === 1 && stage2[0].timeMs === 2000, 'stage board has stage 2');

  const wr = await boards.fetchRecordGhost('e2e_map');
  const decoded = wr ? decodeGhost(wr.ghost) : null;
  check(decoded !== null && decoded.frames.length === rec.take().frames.length, 'record ghost round trips through the database');

  const sid = await boards.startSession('E2E Fragger', 'e2e_map');
  check(typeof sid === 'string', 'start_session issues an id');
  check(await boards.reportSession(sid!, 3, 1), 'first kill report is accepted');
  check(!(await boards.reportSession(sid!, 4, 1)), 'a report 0 s later is refused');
  const daily = await boards.fetchKills('daily');
  check(daily.some((r) => r.name === 'E2E Fragger' && r.kills === 3 && r.deaths === 1), `daily kills board (${JSON.stringify(daily)})`);
  const all = await boards.fetchKills('alltime');
  check(all.some((r) => r.name === 'E2E Fragger' && r.kills === 3), 'all time kills board');

  // one ip, 12 submits per 10 minutes
  const spam = boardsFor('198.51.100.99');
  let limited = false;
  for (let i = 0; i < 14 && !limited; i += 1) {
    const t = await spam.startRun('e2e_map');
    const r = await spam.submitRun({ token: t!, name: `Spam ${i}`, model: 'terrorist', ticks: 128 * 2, splits: [128], pvp: false, ghost: null });
    limited = r?.reason === 'rate limited';
  }
  check(limited, 'submits get rate limited per ip');
  check(spam.available && boards.available, 'the client still sees the boards as available');

  const missing = boardsFor('198.51.100.30');
  await missing.fetchKills('daily');
  check(missing.available, 'sanity: real views do not trip the missing check');
  console.log('boards e2e passed');
}

void main();
