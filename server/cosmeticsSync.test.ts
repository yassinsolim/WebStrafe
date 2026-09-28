import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { defaultLook, encodeLook } from '../src/characters/look';

// drives the real websocket server: looks ride on join, cosmetics and profile
// messages and never on the 30 hz snapshots. bots are off.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// its own range so it never collides with meleeFire.test.ts running in parallel
const PORT = 30000 + Math.floor(Math.random() * 9000);

const lookN = (i: number) => encodeLook({ ...defaultLook(), tag: `S${i}` });
const LOOK_A = lookN(1);
const LOOK_A2 = lookN(2);
/** every key a snapshot row had before looks existed */
const ROW_KEYS = ['alive', 'health', 'id', 'model', 'name', 'pitch', 'position', 't', 'velocity', 'yaw'];

type Message = Record<string, unknown> & { type: string };

class TestClient {
  readonly messages: Message[] = [];
  id = '';

  private constructor(private readonly ws: WebSocket) {
    ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as Message;
      if (message.type === 'welcome') this.id = String(message.id);
      this.messages.push(message);
    });
  }

  static async open(): Promise<TestClient> {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    const client = new TestClient(ws);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    await client.waitFor((m) => m.type === 'welcome');
    return client;
  }

  send(payload: Record<string, unknown>): void {
    this.ws.send(JSON.stringify(payload));
  }

  /** joins and waits for this join's own `joined` */
  async join(mapId: string, extra: Record<string, unknown> = {}): Promise<void> {
    const from = this.messages.length;
    this.send({ type: 'join', mapId, name: 'Tester', model: 'terrorist', ...extra });
    await this.waitFor((m) => m.type === 'joined' && m.mapId === mapId, from);
  }

  of(type: string): Message[] {
    return this.messages.filter((m) => m.type === type);
  }

  clear(): void {
    this.messages.length = 0;
  }

  waitFor(match: (message: Message) => boolean, from = 0, timeoutMs = 3000): Promise<Message> {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const poll = (): void => {
        const found = this.messages.slice(from).find(match);
        if (found) {
          resolve(found);
          return;
        }
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`timed out waiting for a message; got ${this.messages.map((m) => m.type).join(',')}`));
          return;
        }
        setTimeout(poll, 10);
      };
      poll();
    });
  }

  close(): void {
    this.ws.close();
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const rowsOf = (snapshot: Message) => snapshot.players as Array<Record<string, unknown>>;
const isDrop = (id: string) => (m: Message) => m.type === 'profile' && m.id === id && !('cosmetics' in m);

let server: ChildProcess | null = null;

async function waitForHealth(): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await sleep(100);
  }
  throw new Error('server did not start');
}

beforeAll(async () => {
  server = spawn(process.execPath, [path.join(ROOT, 'node_modules/tsx/dist/cli.mjs'), 'server/index.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      NODE_ENV: 'development',
      ENABLE_BOTS: 'false',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  await waitForHealth();
}, 30000);

afterAll(() => {
  server?.kill('SIGTERM');
});

describe('websocket server look sync', () => {
  it('sends a joiner the looks already on the map and passes look changes on', async () => {
    const a = await TestClient.open();
    const b = await TestClient.open();
    try {
      await a.join('looks_a', { cosmetics: LOOK_A });
      await b.join('looks_a');
      expect(await b.waitFor((m) => m.type === 'profiles')).toEqual({
        type: 'profiles',
        players: [{ id: a.id, cosmetics: LOOK_A }],
      });
      await sleep(150);
      // alone on the map a got nothing, and b has no look to tell it about
      expect(a.of('profiles')).toEqual([]);
      expect(a.of('profile')).toEqual([]);

      a.clear();
      a.send({ type: 'cosmetics', cosmetics: LOOK_A2 });
      expect(await b.waitFor((m) => m.type === 'profile')).toEqual({ type: 'profile', id: a.id, cosmetics: LOOK_A2 });
      await sleep(100);
      // no echo back to a, and no re-join that would reset its combat state
      expect(a.of('profile')).toEqual([]);
      expect(a.of('joined')).toEqual([]);

      const late = await TestClient.open();
      await late.join('looks_a');
      expect(await late.waitFor((m) => m.type === 'profiles')).toEqual({
        type: 'profiles',
        players: [{ id: a.id, cosmetics: LOOK_A2 }],
      });
      late.close();
    } finally {
      a.close();
      b.close();
    }
  }, 20000);

  it('never broadcasts an invalid look', async () => {
    const watcher = await TestClient.open();
    const a = await TestClient.open();
    const tooLong = `${LOOK_A}.${'A'.repeat(96)}`;
    const junk = [tooLong, 'has spaces', '<b>', 'still no good'];
    try {
      await watcher.join('looks_b');
      for (const cosmetics of [tooLong, 'has spaces', '<b>', 42, { wire: LOOK_A }, '']) {
        await a.join('looks_b', { cosmetics });
      }
      a.send({ type: 'cosmetics', cosmetics: 'still no good' });
      a.send({ type: 'cosmetics', cosmetics: LOOK_A });
      await watcher.waitFor((m) => m.type === 'profile');
      // junk counts as no look, so this drops a's look instead of passing the junk on
      a.send({ type: 'cosmetics', cosmetics: tooLong });
      await watcher.waitFor(isDrop(a.id));
      expect(watcher.of('profile')).toEqual([
        { type: 'profile', id: a.id, cosmetics: LOOK_A },
        { type: 'profile', id: a.id },
      ]);
      const seen = JSON.stringify(watcher.messages);
      for (const bad of junk) expect(seen).not.toContain(bad);

      const late = await TestClient.open();
      await late.join('looks_b');
      await sleep(100);
      expect(late.of('profiles')).toEqual([]);
      late.close();
    } finally {
      watcher.close();
      a.close();
    }
  }, 20000);

  it('never puts a look on snapshot rows', async () => {
    const a = await TestClient.open();
    const b = await TestClient.open();
    try {
      await a.join('looks_c', { cosmetics: LOOK_A });
      await b.join('looks_c', { cosmetics: LOOK_A2 });
      a.send({ type: 'state', t: Date.now(), position: [1, 0, 1], velocity: [0, 0, 0], yaw: 0, pitch: 0 });
      b.clear();
      await sleep(300);
      const snapshots = b.of('snapshot');
      expect(snapshots.length).toBeGreaterThan(3);
      for (const snapshot of snapshots) {
        expect(rowsOf(snapshot).map((row) => row.id).sort()).toEqual([a.id, b.id].sort());
        for (const row of rowsOf(snapshot)) expect(Object.keys(row).sort()).toEqual(ROW_KEYS);
      }
      const text = JSON.stringify(snapshots);
      expect(text).not.toContain(LOOK_A);
      expect(text).not.toContain(LOOK_A2);
    } finally {
      a.close();
      b.close();
    }
  }, 20000);

  it('keeps a legacy join without cosmetics working exactly as before', async () => {
    const legacy = await TestClient.open();
    const other = await TestClient.open();
    try {
      legacy.send({ type: 'join', mapId: 'looks_d', name: 'Legacy', model: 'counterterrorist' });
      expect(await legacy.waitFor((m) => m.type === 'joined')).toEqual({ type: 'joined', id: legacy.id, mapId: 'looks_d' });
      await other.join('looks_d');
      legacy.send({ type: 'combat-ready', ready: true });
      legacy.send({ type: 'state', t: Date.now(), position: [1, 2, 3], velocity: [0, 0, 0], yaw: 0.5, pitch: 0 });
      const snapshot = await other.waitFor(
        (m) => m.type === 'snapshot' && rowsOf(m).some((row) => row.id === legacy.id && (row.position as number[])[0] === 1),
      );
      const row = rowsOf(snapshot).find((r) => r.id === legacy.id)!;
      expect(row).toMatchObject({ name: 'Legacy', model: 'counterterrorist', position: [1, 2, 3], yaw: 0.5, health: 100, alive: true });
      expect(Object.keys(row).sort()).toEqual(ROW_KEYS);
      // a room without looks sees no profile traffic at all
      const all = [...legacy.messages, ...other.messages];
      expect(all.filter((m) => m.type === 'profile' || m.type === 'profiles')).toEqual([]);

      // unknown message types are still ignored and the socket stays up
      legacy.send({ type: 'some-future-message', cosmetics: LOOK_A });
      legacy.send({ type: 'ping' });
      await legacy.waitFor((m) => m.type === 'pong');

      // a player with a look joining later doesn't get in the way of the legacy one
      const styled = await TestClient.open();
      await styled.join('looks_d', { cosmetics: LOOK_A });
      legacy.clear();
      legacy.send({ type: 'state', t: Date.now(), position: [4, 2, 3], velocity: [0, 0, 0], yaw: 0.5, pitch: 0 });
      await legacy.waitFor(
        (m) => m.type === 'snapshot' && rowsOf(m).some((r) => r.id === legacy.id && (r.position as number[])[0] === 4),
      );
      styled.close();
    } finally {
      legacy.close();
      other.close();
    }
  }, 20000);

  it('drops look changes past 5 per 10 s without dropping the player', async () => {
    const a = await TestClient.open();
    const b = await TestClient.open();
    try {
      await a.join('looks_e');
      await b.join('looks_e');
      for (let i = 0; i < 8; i += 1) a.send({ type: 'cosmetics', cosmetics: lookN(10 + i) });
      await b.waitFor(() => b.of('profile').length >= 5);
      await sleep(150);
      expect(b.of('profile').map((m) => m.cosmetics)).toEqual([10, 11, 12, 13, 14].map(lookN));
      a.send({ type: 'ping' });
      await a.waitFor((m) => m.type === 'pong');
    } finally {
      a.close();
      b.close();
    }
  }, 20000);

  it('drops a look when the player moves to another map or leaves, and skips re-sending one nobody lost', async () => {
    const a = await TestClient.open();
    const b = await TestClient.open();
    try {
      await b.join('looks_f');
      await a.join('looks_f', { cosmetics: LOOK_A });
      await b.waitFor((m) => m.type === 'profile' && m.cosmetics === LOOK_A);

      await a.join('looks_f2', { cosmetics: LOOK_A });
      await b.waitFor(isDrop(a.id));

      b.clear();
      await a.join('looks_f', { cosmetics: LOOK_A });
      await b.waitFor((m) => m.type === 'profile' && m.cosmetics === LOOK_A);
      // a re-join on the same map with the same look is nothing new for b
      b.clear();
      await a.join('looks_f', { cosmetics: LOOK_A });
      await sleep(150);
      expect(b.of('profile')).toEqual([]);

      a.close();
      await b.waitFor(isDrop(a.id));
    } finally {
      a.close();
      b.close();
    }
  }, 20000);
});
