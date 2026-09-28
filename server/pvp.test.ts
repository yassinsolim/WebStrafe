import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

// pvp opt-in on the dedicated websocket server: a peaceful player can't be
// stabbed and can't stab, pvp players still can, and snapshots carry the flag.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 30000 + Math.floor(Math.random() * 9000);
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

  async enter(mapId: string, position: [number, number, number], yaw: number): Promise<void> {
    this.send({ type: 'join', mapId, name: 'Tester', model: 'terrorist' });
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

const EYE: [number, number, number] = [0, 1.6, 0];
const AHEAD: [number, number, number] = [0, 0, -1];

async function pair(mapId: string) {
  const attacker = await TestClient.open();
  const victim = await TestClient.open();
  await attacker.enter(mapId, [0, 0, 0], 0);
  await victim.enter(mapId, [0, 0, -1.1], Math.PI);
  await sleep(SPAWN_PROTECTION_MS + 150);
  return { attacker, victim };
}

describe('websocket server pvp opt-in', () => {
  it('a peaceful victim is immune, then takes the hit once it opts back in', async () => {
    const { attacker, victim } = await pair('pvp_ws_a');
    try {
      victim.send({ type: 'pvp', on: false });
      await sleep(80);
      attacker.clear();
      attacker.swing('secondary', EYE, AHEAD);
      await sleep(250);
      expect(attacker.messages.some((m) => m.type === 'hit')).toBe(false);

      const snap = await attacker.waitFor((m) => m.type === 'snapshot'
        && (m.players as Array<{ id: string; pvp?: boolean }>).some((p) => p.id === victim.id && p.pvp === false));
      expect(snap).toBeTruthy();

      victim.send({ type: 'pvp', on: true });
      await sleep(1100);
      attacker.clear();
      attacker.swing('secondary', EYE, AHEAD);
      const hit = await attacker.waitFor((m) => m.type === 'hit');
      expect(hit).toMatchObject({ targetId: victim.id, damage: 65 });
    } finally {
      attacker.close();
      victim.close();
    }
  }, 20000);

  it('sends the room scoreboard after a kill', async () => {
    const { attacker, victim } = await pair('pvp_ws_c');
    try {
      attacker.swing('secondary', EYE, AHEAD);
      await attacker.waitFor((m) => m.type === 'hit');
      await sleep(1150);
      attacker.swing('secondary', EYE, AHEAD);
      await attacker.waitFor((m) => m.type === 'death');
      const board = await victim.waitFor((m) => m.type === 'scoreboard'
        && (m.rows as Array<[string, number, number]>).some(([id, k]) => id === attacker.id && k === 1), 3500);
      expect(board.rows).toContainEqual([victim.id, 0, 1]);
    } finally {
      attacker.close();
      victim.close();
    }
  }, 20000);

  it('a peaceful attacker lands nothing', async () => {
    const { attacker, victim } = await pair('pvp_ws_b');
    try {
      attacker.send({ type: 'pvp', on: false });
      await sleep(80);
      attacker.clear();
      attacker.swing('secondary', EYE, AHEAD);
      await sleep(250);
      expect(attacker.messages.some((m) => m.type === 'hit')).toBe(false);
      expect(victim.messages.some((m) => m.type === 'health' && m.playerId === victim.id && (m.health as number) < 100)).toBe(false);
    } finally {
      attacker.close();
      victim.close();
    }
  }, 20000);
});
