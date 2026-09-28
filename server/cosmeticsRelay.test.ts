import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { MultiplayerClient } from '../src/network/MultiplayerClient';
import type { MultiplayerSnapshot } from '../src/network/types';

// drives the real websocket server: cosmetics ride the join, changes go out as
// their own relayed message at 1 hz, and 30 hz snapshots never carry them.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 20000 + Math.floor(Math.random() * 9000);
const SPAWN_PROTECTION_MS = 300;

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

  async enter(mapId: string, position: [number, number, number], yaw: number, c?: Record<string, unknown>): Promise<void> {
    this.send({ type: 'join', mapId, name: 'Tester', model: 'terrorist', ...(c ? { c } : {}) });
    await this.waitFor((m) => m.type === 'joined');
    this.send({ type: 'combat-ready', ready: true });
    this.stand(position, yaw);
  }

  stand(position: [number, number, number], yaw: number): void {
    this.send({ type: 'state', t: Date.now(), position, velocity: [0, 0, 0], yaw, pitch: 0 });
  }

  swing(melee: string | undefined, origin: [number, number, number], dir: [number, number, number]): void {
    this.send({ type: 'fire', origin, dir, t: Date.now(), ...(melee === undefined ? {} : { melee }) });
  }

  clear(): void {
    this.messages.length = 0;
  }

  waitFor(match: (message: Message) => boolean, timeoutMs = 3000): Promise<Message> {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const poll = (): void => {
        const found = this.messages.find(match);
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
      SPAWN_PROTECTION_MS: String(SPAWN_PROTECTION_MS),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  await waitForHealth();
}, 30000);

afterAll(() => {
  server?.kill('SIGTERM');
});


const wire = (seed: number) => ({ k: 'karambit', f: 'doppler_ruby', w: 0.01, s: seed });
const cosmeticsMessages = (client: TestClient) => client.messages.filter((m) => m.type === 'cosmetics');

describe('websocket server cosmetics', () => {
  it('sends the roster on join, relays a burst of changes as one message, and keeps snapshots clean', async () => {
    const a = await TestClient.open();
    const b = await TestClient.open();
    try {
      await a.enter('cosm_ws_a', [0, 0, 0], 0, wire(1));
      await b.enter('cosm_ws_a', [2, 0, 0], 0);
      // b gets a's cosmetics once, in the roster that follows its join
      const roster = await b.waitFor((m) => m.type === 'cosmetics');
      expect(roster.players).toEqual([{ id: a.id, c: wire(1) }]);

      // a hears nothing back: b has no cosmetics and a's own change isn't echoed
      await sleep(1200);
      expect(cosmeticsMessages(a).filter((m) => (m.players as unknown[]).length > 0)).toEqual([]);

      // a floods 40 changes in 0.4 s
      b.clear();
      for (let i = 0; i < 40; i += 1) {
        a.send({ type: 'cosmetics', c: wire(100 + i) });
        await sleep(10);
      }
      await sleep(2300);
      const relays = cosmeticsMessages(b);
      expect(relays.length).toBeGreaterThanOrEqual(1);
      expect(relays.length).toBeLessThanOrEqual(2);
      expect(relays.at(-1)!.players).toEqual([{ id: a.id, c: wire(139) }]);

      // an idle room relays nothing, and snapshots never carry cosmetics
      b.clear();
      await sleep(1500);
      expect(cosmeticsMessages(b)).toEqual([]);
      const snapshots = b.messages.filter((m) => m.type === 'snapshot');
      expect(snapshots.length).toBeGreaterThan(20);
      for (const snap of snapshots) {
        for (const row of snap.players as Array<Record<string, unknown>>) expect(row).not.toHaveProperty('c');
      }

      // clearing is relayed as a row without c
      a.send({ type: 'cosmetics' });
      const cleared = await b.waitFor((m) => m.type === 'cosmetics', 2500);
      expect(cleared.players).toEqual([{ id: a.id }]);
    } finally {
      a.close();
      b.close();
    }
  }, 20000);

  it('the real client applies roster and relays to snapshot rows', async () => {
    const original = globalThis.WebSocket;
    const originalWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { WebSocket: unknown }).WebSocket = WebSocket;
    // the client schedules its heartbeat and reconnects on window
    (globalThis as { window?: unknown }).window = globalThis;
    const a = await TestClient.open();
    const client = new MultiplayerClient(`ws://127.0.0.1:${PORT}/ws`);
    let latest: MultiplayerSnapshot | null = null;
    client.onSnapshot = (snap) => {
      latest = snap;
    };
    try {
      await a.enter('cosm_ws_b', [0, 0, 0], 0, wire(5));
      client.setCosmetics({ knife: { id: 'flip', finish: 'fade', wear: 0.03, seed: 9 } });
      client.connect();
      client.join('cosm_ws_b', 'Observer', 'counterterrorist');
      const rowOf = () => (latest as MultiplayerSnapshot | null)?.players.find((p) => p.id === a.id);
      for (let i = 0; i < 100 && !rowOf()?.cosmetics; i += 1) await sleep(20);
      expect(rowOf()?.cosmetics).toEqual({ knife: { id: 'karambit', finish: 'doppler_ruby', wear: 0.01, seed: 5 } });

      // the client's own pick rode its join, so a hears it on the next relay
      const relay = await a.waitFor((m) => m.type === 'cosmetics' && (m.players as unknown[]).length > 0, 2500);
      expect(relay.players).toEqual([{ id: client.getLocalId(), c: { k: 'flip', f: 'fade', w: 0.03, s: 9 } }]);

      a.send({ type: 'cosmetics', c: wire(6) });
      for (let i = 0; i < 150 && rowOf()?.cosmetics?.knife?.seed !== 6; i += 1) await sleep(20);
      expect(rowOf()?.cosmetics?.knife?.seed).toBe(6);
    } finally {
      client.disconnect();
      a.close();
      (globalThis as { WebSocket: unknown }).WebSocket = original;
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  }, 20000);
});
