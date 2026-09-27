import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

// drives the real websocket server: two clients join a map, stand next to each
// other and swing. bots are off and spawn protection is shortened for speed.

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

/** victim yaw facing the attacker (+z) or facing away from it (-z) */
const FACING = Math.PI;
const AWAY = 0;
const EYE: [number, number, number] = [0, 1.6, 0];
const AHEAD: [number, number, number] = [0, 0, -1];

async function duel(mapId: string, victimYaw: number) {
  const attacker = await TestClient.open();
  const victim = await TestClient.open();
  await attacker.enter(mapId, [0, 0, 0], 0);
  await victim.enter(mapId, [0, 0, -1.1], victimYaw);
  await sleep(50);
  return { attacker, victim };
}

describe('websocket server knife combat', () => {
  it('respects spawn protection, then stabs for 65 and backstabs for the kill', async () => {
    const { attacker, victim } = await duel('melee_ws_a', FACING);
    try {
      // still inside the shortened spawn protection: swing spends, nothing lands
      attacker.swing('secondary', EYE, AHEAD);
      await sleep(150);
      expect(attacker.messages.some((m) => m.type === 'hit')).toBe(false);

      // a missed stab locks the knife for 1.0 s
      await sleep(1000);
      attacker.clear();
      attacker.swing('secondary', EYE, AHEAD);
      const stab = await attacker.waitFor((m) => m.type === 'hit');
      expect(stab).toMatchObject({
        shooterId: attacker.id,
        targetId: victim.id,
        weaponId: 'knife',
        damage: 65,
        hitbox: 'body',
        melee: 'secondary',
        backstab: false,
        killed: false,
      });
      const shot = await attacker.waitFor((m) => m.type === 'shot');
      expect(shot).toMatchObject({ weaponId: 'knife', result: 'hit', targetId: victim.id });
      expect(Array.isArray(shot.endpoint)).toBe(true);
      await victim.waitFor((m) => m.type === 'health' && m.playerId === victim.id && m.health === 35);

      // the victim turns away; after the 1.1 s hit cooldown the backstab kills
      victim.stand([0, 0, -1.1], AWAY);
      await sleep(1150);
      attacker.clear();
      attacker.swing('secondary', EYE, AHEAD);
      const death = await attacker.waitFor((m) => m.type === 'death');
      expect(death).toEqual({
        type: 'death',
        victimId: victim.id,
        killerId: attacker.id,
        weaponId: 'knife',
        headshot: false,
      });
      const kill = attacker.messages.find((m) => m.type === 'hit');
      expect(kill).toMatchObject({ backstab: true, killed: true, damage: 35 });
    } finally {
      attacker.close();
      victim.close();
    }
  }, 20000);

  it('treats a knife fire without melee as a slash and drops malformed melee values', async () => {
    const { attacker, victim } = await duel('melee_ws_b', FACING);
    try {
      await sleep(SPAWN_PROTECTION_MS + 100);
      attacker.swing('overhead', EYE, AHEAD);
      await sleep(150);
      expect(attacker.messages.some((m) => m.type === 'hit')).toBe(false);

      attacker.swing(undefined, EYE, AHEAD);
      const slash = await attacker.waitFor((m) => m.type === 'hit');
      expect(slash).toMatchObject({ weaponId: 'knife', damage: 40, melee: 'primary', targetId: victim.id });
    } finally {
      attacker.close();
      victim.close();
    }
  }, 20000);

  it('blocks swings through map collision once the server has it', async () => {
    // movement_test_scene's impact panel spans z 40.6 to 41.4 at x 5.9 to 10.1
    const mapId = 'movement_test_scene';
    const attacker = await TestClient.open();
    const victim = await TestClient.open();
    try {
      const attackerFeet: [number, number, number] = [8, 0, 40.2];
      const eye: [number, number, number] = [8, 1.6, 40.2];
      const towardPlusZ: [number, number, number] = [0, 0, 1];
      await attacker.enter(mapId, attackerFeet, Math.PI);
      await victim.enter(mapId, [8, 0, 41.75], Math.PI);
      await sleep(SPAWN_PROTECTION_MS + 100);
      // first swing aims away; it makes the server load this map's collision
      attacker.swing('primary', eye, [1, 0, 0]);
      await sleep(600);
      attacker.clear();
      attacker.swing('primary', eye, towardPlusZ);
      await sleep(200);
      expect(attacker.messages.some((m) => m.type === 'hit')).toBe(false);

      // step out in front of the panel and a swing at the same range connects
      victim.stand([9.3, 0, 40.2], 0);
      await sleep(250);
      attacker.swing('primary', eye, [1, 0, 0]);
      const hit = await attacker.waitFor((m) => m.type === 'hit');
      expect(hit).toMatchObject({ weaponId: 'knife', targetId: victim.id });
    } finally {
      attacker.close();
      victim.close();
    }

    // control: the same spots on a map without collision are in reach
    const openAttacker = await TestClient.open();
    const openVictim = await TestClient.open();
    try {
      await openAttacker.enter('melee_ws_open', [8, 0, 40.2], Math.PI);
      await openVictim.enter('melee_ws_open', [8, 0, 41.75], Math.PI);
      await sleep(SPAWN_PROTECTION_MS + 100);
      openAttacker.swing('primary', [8, 1.6, 40.2], [0, 0, 1]);
      const through = await openAttacker.waitFor((m) => m.type === 'hit');
      expect(through).toMatchObject({ weaponId: 'knife', targetId: openVictim.id });
    } finally {
      openAttacker.close();
      openVictim.close();
    }
  }, 20000);
});
