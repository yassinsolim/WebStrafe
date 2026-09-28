import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll } from 'vitest';
import WebSocket from 'ws';

// shared by the websocket server tests: spawns the real server on a random
// port (bots off, short spawn protection) and drives it with raw clients.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PORT = 20000 + Math.floor(Math.random() * 9000);
export const SPAWN_PROTECTION_MS = 300;

export type Message = Record<string, unknown> & { type: string };

export class TestClient {
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

  stand(position: [number, number, number], yaw: number, duck = 0): void {
    this.send({ type: 'state', t: Date.now(), position, velocity: [0, 0, 0], yaw, pitch: 0, ...(duck > 0 ? { duck } : {}) });
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

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

/** starts the real server for the calling test file */
export function useWsServer(): void {
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
}
