import crypto from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { Vector3 } from 'three';
import { REMOTE_SHOT_VISUAL_DISTANCE } from '../src/combat/ShotPresentation';
import { CombatArena } from '../src/combat/CombatArena';
import type { FireOutcome } from '../src/combat/CombatArena';
import { shouldResetCombatEntry } from '../src/combat/CombatEntryPolicy';
import type { WeaponId } from '../src/combat/weapons';
import { BotManager, type BotTarget } from './BotManager';

type PlayerModel = 'terrorist' | 'counterterrorist';
type AttackKind = 'primary' | 'secondary';

interface LeaderboardEntry {
  id: string;
  mapId: string;
  name: string;
  timeMs: number;
  model: PlayerModel;
  createdAt: string;
}

type LeaderboardStore = Record<string, LeaderboardEntry[]>;

interface ClientState {
  id: string;
  ws: WebSocket;
  ip: string;
  joined: boolean;
  /** True after the client has sent its first in-world movement state. */
  hasState: boolean;
  /** True only while the player has pointer-locked active gameplay. */
  combatReady: boolean;
  hasEnteredCombat: boolean;
  combatPausedAtMs: number | null;
  lastCombatAtMs: number;
  name: string;
  mapId: string;
  model: PlayerModel;
  position: [number, number, number];
  velocity: [number, number, number];
  yaw: number;
  pitch: number;
  lastMessageAt: number;
  stateMessageCount: number;
  stateWindowStart: number;
  attackMessageCount: number;
  attackWindowStart: number;
}

interface JsonObject {
  [key: string]: unknown;
}

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const DATA_DIR = process.env.WEBSTRAFE_DATA_DIR
  ? path.resolve(process.env.WEBSTRAFE_DATA_DIR)
  : path.join(ROOT_DIR, 'data');
const LEADERBOARD_FILE = path.join(DATA_DIR, 'leaderboard.json');

const PORT = Number.parseInt(process.env.PORT ?? '8787', 10);
const HOST = process.env.HOST ?? '0.0.0.0';
const DEV_MODE = process.env.NODE_ENV !== 'production';
const MAX_HTTP_BODY_BYTES = 4 * 1024;
const MAX_STATE_MESSAGES_PER_SECOND = 70;
const MAX_WEBSOCKET_MESSAGE_BYTES = 2 * 1024;
const SNAPSHOT_RATE_HZ = 20;
const BOT_TICK_HZ = 60;
const ENABLE_BOTS = process.env.ENABLE_BOTS === 'true';
const BOTS_PER_MAP = clampInt(process.env.BOTS_PER_MAP, 1, 0, 8);
const PLAYER_STALE_TIMEOUT_MS = 12000;
const MAP_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
const PLAYER_NAME_REGEX = /^[A-Za-z0-9 _\-.]{2,24}$/;

const allowedOriginSet = new Set(
  (process.env.WEBSTRAFE_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0),
);

let leaderboardStore: LeaderboardStore = {};

// Session tokens: issued by /api/session/start, consumed on leaderboard submission
interface SessionRecord {
  mapId: string;
  startedAt: number;
  used: boolean;
}
const activeSessions = new Map<string, SessionRecord>();
const SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
let persistQueue = Promise.resolve();

const requestRate = new Map<string, { count: number; resetAt: number }>();
const clients = new Map<WebSocket, ClientState>();
const arena = new CombatArena();
const botManager = new BotManager(arena, BOTS_PER_MAP);
let nextShotSequence = 1;

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

const VALID_WEAPON_IDS: readonly WeaponId[] = ['awp', 'deagle', 'knife'];

function parseWeaponId(value: unknown): WeaponId | null {
  return typeof value === 'string' && (VALID_WEAPON_IDS as readonly string[]).includes(value)
    ? (value as WeaponId)
    : null;
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const ip = getClientIp(req);

  try {
    if (requestUrl.pathname.startsWith('/api/')) {
      await handleApiRequest(req, res, requestUrl, ip);
      return;
    }

    if (DEV_MODE) {
      respondJson(res, 404, {
        error: 'Not found',
        detail: 'Vite should serve frontend routes during development.',
      });
      return;
    }

    await handleStaticRequest(res, requestUrl.pathname);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error);
    respondJson(res, 500, {
      error: 'Internal server error',
    });
  }
});

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: MAX_WEBSOCKET_MESSAGE_BYTES,
});

server.on('upgrade', (req, socket, head) => {
  const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (requestUrl.pathname !== '/ws') {
    socket.destroy();
    return;
  }

  if (!isOriginAllowed(req.headers.origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws, req) => {
  const client: ClientState = {
    id: crypto.randomUUID(),
    ws,
    ip: getClientIp(req),
    joined: false,
    hasState: false,
    combatReady: false,
    hasEnteredCombat: false,
    combatPausedAtMs: null,
    lastCombatAtMs: Date.now(),
    name: 'Player',
    mapId: '',
    model: 'terrorist',
    position: [0, 0, 0],
    velocity: [0, 0, 0],
    yaw: 0,
    pitch: 0,
    lastMessageAt: Date.now(),
    stateMessageCount: 0,
    stateWindowStart: Date.now(),
    attackMessageCount: 0,
    attackWindowStart: Date.now(),
  };

  clients.set(ws, client);
  sendWs(ws, {
    type: 'welcome',
    id: client.id,
    serverTimeMs: Date.now(),
  });

  const joinTimeout = setTimeout(() => {
    if (!client.joined) {
      ws.close(4000, 'join_required');
    }
  }, 10000);

  ws.on('message', (raw) => {
    client.lastMessageAt = Date.now();
    const text = typeof raw === 'string' ? raw : raw.toString('utf8');
    if (text.length > MAX_WEBSOCKET_MESSAGE_BYTES) {
      ws.close(1009, 'message_too_large');
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      ws.close(1003, 'invalid_json');
      return;
    }

    if (!isObject(payload) || typeof payload.type !== 'string') {
      return;
    }

    switch (payload.type) {
      case 'join': {
        const mapId = parseMapId(payload.mapId);
        const model = parseModel(payload.model);
        const name = parseName(payload.name);
        if (!mapId || !model || !name) {
          sendWs(ws, {
            type: 'error',
            reason: 'invalid_join_payload',
          });
          return;
        }

        client.joined = true;
        client.hasState = false;
        client.combatReady = false;
        client.hasEnteredCombat = false;
        client.combatPausedAtMs = Date.now();
        client.lastCombatAtMs = Date.now();
        client.mapId = mapId;
        client.name = name;
        client.model = model;
        clearTimeout(joinTimeout);

        sendWs(ws, {
          type: 'joined',
          id: client.id,
          mapId,
        });
        arena.addPlayer(client.id, mapId, 'knife');
        botManager.resetTargeting(mapId);
        break;
      }
      case 'combat-ready': {
        if (!client.joined || typeof payload.ready !== 'boolean') {
          return;
        }
        if (client.combatReady !== payload.ready) {
          const now = Date.now();
          client.combatReady = payload.ready;
          botManager.resetTargeting(client.mapId);
          if (client.combatReady) {
            const cleanEntry = shouldResetCombatEntry({
              alive: arena.isAlive(client.id),
              pausedAtMs: client.combatPausedAtMs,
              lastCombatAtMs: client.lastCombatAtMs,
              nowMs: now,
            });
            if (cleanEntry) {
              const respawn = arena.resetPlayer(client.id, now, client.position);
              broadcastToMap(client.mapId, {
                type: 'health',
                playerId: client.id,
                health: arena.getHealth(client.id) ?? 100,
                alive: true,
              });
              if (respawn) {
                broadcastToMap(client.mapId, { type: 'respawn', ...respawn });
              }
            } else if (!client.hasEnteredCombat) {
              arena.protectSpawn(client.id, now);
            }
            client.hasEnteredCombat = true;
            client.combatPausedAtMs = null;
          } else {
            client.combatPausedAtMs = now;
          }
        }
        break;
      }
      case 'state': {
        if (!client.joined) {
          return;
        }

        const now = Date.now();
        if (now - client.stateWindowStart >= 1000) {
          client.stateWindowStart = now;
          client.stateMessageCount = 0;
        }
        client.stateMessageCount += 1;
        if (client.stateMessageCount > MAX_STATE_MESSAGES_PER_SECOND) {
          ws.close(4008, 'state_rate_limit');
          return;
        }

        const position = parseVector3(payload.position, 200000);
        const velocity = parseVector3(payload.velocity, 5000);
        const yaw = parseNumber(payload.yaw, -Math.PI * 2, Math.PI * 2);
        const pitch = parseNumber(payload.pitch, -Math.PI, Math.PI);
        if (!position || !velocity || yaw === null || pitch === null) {
          return;
        }

        client.position = position;
        client.hasState = true;
        client.velocity = velocity;
        client.yaw = yaw;
        client.pitch = pitch;
        arena.setPosition(client.id, position, client.mapId, Date.now());
        break;
      }
      case 'attack': {
        if (!client.joined) {
          return;
        }

        const kind = parseAttackKind(payload.kind);
        if (!kind) {
          return;
        }

        const now = Date.now();
        if (now - client.attackWindowStart >= 1000) {
          client.attackWindowStart = now;
          client.attackMessageCount = 0;
        }
        client.attackMessageCount += 1;
        if (client.attackMessageCount > 24) {
          ws.close(4009, 'attack_rate_limit');
          return;
        }

        broadcastAttack(client.mapId, client.id, kind);
        break;
      }
      case 'fire': {
        if (!client.joined || !client.combatReady) {
          return;
        }
        const origin = parseVector3(payload.origin, 200000);
        const dir = parseVector3(payload.dir, 2);
        if (!origin || !dir) {
          return;
        }
        const now = Date.now();
        if (now - client.attackWindowStart >= 1000) {
          client.attackWindowStart = now;
          client.attackMessageCount = 0;
        }
        client.attackMessageCount += 1;
        if (client.attackMessageCount > 24) {
          ws.close(4009, 'attack_rate_limit');
          return;
        }
        const observedAtMs = parseNumber(payload.observedAtMs, 0, now + 1000) ?? undefined;
        const outcome = arena.handleFire(client.id, origin, dir, now, undefined, observedAtMs);
        if (outcome.fired) {
          client.lastCombatAtMs = now;
          broadcastShot(client.mapId, client.id, origin, dir, outcome);
        }
        broadcastFireOutcome(client.mapId, outcome);
        break;
      }
      case 'reload': {
        if (!client.joined) {
          return;
        }
        arena.reload(client.id, Date.now());
        break;
      }
      case 'equip': {
        if (!client.joined) {
          return;
        }
        const weaponId = parseWeaponId(payload.weaponId);
        if (weaponId) {
          arena.equip(client.id, weaponId);
        }
        break;
      }
      case 'ping': {
        sendWs(ws, { type: 'pong', t: Date.now() });
        break;
      }
      default:
        break;
    }
  });

  ws.on('close', () => {
    clearTimeout(joinTimeout);
    arena.removePlayer(client.id);
    if (client.mapId) botManager.resetTargeting(client.mapId);
    clients.delete(ws);
  });

  ws.on('error', () => {
    arena.removePlayer(client.id);
    if (client.mapId) botManager.resetTargeting(client.mapId);
    clients.delete(ws);
  });
});

setInterval(() => {
  const now = Date.now();

  const respawns = arena.tickRespawns(
    now,
    ENABLE_BOTS ? (id) => botManager.spawnFor(id) : undefined,
  );
  for (const ev of respawns) {
    let mapId: string | null = null;
    if (ENABLE_BOTS && botManager.isBot(ev.playerId)) {
      botManager.onRespawn(ev.playerId, ev.position);
      mapId = botManager.mapOf(ev.playerId);
    } else {
      mapId = [...clients.values()].find((c) => c.id === ev.playerId)?.mapId ?? null;
      if (mapId) {
        botManager.resetTargeting(mapId);
      }
    }
    if (mapId) {
      broadcastToMap(mapId, {
        type: 'respawn',
        playerId: ev.playerId,
        position: ev.position,
      });
      broadcastToMap(mapId, {
        type: 'health',
        playerId: ev.playerId,
        health: arena.getHealth(ev.playerId) ?? 100,
        alive: true,
      });
    }
  }

  const groupedByMap = new Map<string, Array<{
    id: string;
    name: string;
    model: PlayerModel;
    position: [number, number, number];
    velocity: [number, number, number];
    yaw: number;
    pitch: number;
    health: number;
    alive: boolean;
  }>>();

  for (const client of clients.values()) {
    if (client.ws.readyState !== WebSocket.OPEN) {
      continue;
    }
    if (!client.joined) {
      continue;
    }
    if (now - client.lastMessageAt > PLAYER_STALE_TIMEOUT_MS) {
      client.ws.close(4001, 'timed_out');
      continue;
    }

    const list = groupedByMap.get(client.mapId) ?? [];
    list.push({
      id: client.id,
      name: client.name,
      model: client.model,
      position: client.position,
      velocity: client.velocity,
      yaw: client.yaw,
      pitch: client.pitch,
      health: arena.getHealth(client.id) ?? 100,
      alive: arena.isAlive(client.id),
    });
    groupedByMap.set(client.mapId, list);
  }

  if (ENABLE_BOTS) {
    for (const [mapId, list] of groupedByMap) {
      for (const row of botManager.snapshotRows(mapId)) {
        list.push(row);
      }
    }
  }

  for (const client of clients.values()) {
    if (!client.joined || client.ws.readyState !== WebSocket.OPEN) {
      continue;
    }
    const players = groupedByMap.get(client.mapId) ?? [];
    sendWs(client.ws, {
      type: 'snapshot',
      mapId: client.mapId,
      players,
      serverTimeMs: now,
    });
  }
}, Math.round(1000 / SNAPSHOT_RATE_HZ));

if (ENABLE_BOTS) {
  const botDt = 1 / BOT_TICK_HZ;
  let sincePrune = 0;
  setInterval(() => {
    const mapsWithHumans = new Set<string>();
    const targetsByMap = new Map<string, BotTarget[]>();
    for (const client of clients.values()) {
      if (!client.joined || client.ws.readyState !== WebSocket.OPEN) {
        continue;
      }
      mapsWithHumans.add(client.mapId);
      botManager.requestMap(client.mapId);
      // Keep an empty candidate list while the player is loading/menu-bound or
      // spawn-protected. BotManager can then populate the shared staging pad for
      // snapshots without treating that player as an aim target.
      if (!targetsByMap.has(client.mapId)) {
        targetsByMap.set(client.mapId, []);
      }
      if (
        !client.hasState
        || !client.combatReady
        || arena.isSpawnProtected(client.id, Date.now())
      ) {
        // Menu/map-loading clients either still have the [0,0,0] sentinel or
        // explicitly left active pointer-locked play. Bots forget them until a
        // fresh combat-ready transition and spawn grace grant a new reaction window.
        continue;
      }
      const list = targetsByMap.get(client.mapId) ?? [];
      list.push({
        id: client.id,
        feet: new Vector3(client.position[0], client.position[1], client.position[2]),
        alive: arena.isAlive(client.id),
        viewYawRad: client.yaw,
        viewPitchRad: client.pitch,
      });
      targetsByMap.set(client.mapId, list);
    }

    botManager.tick(botDt, targetsByMap);

    // Bots fire through the authoritative arena, with the same broadcasts as
    // human fire. LOS is already checked server-side in collectFireEvents.
    const now = Date.now();
    for (const ev of botManager.collectFireEvents()) {
      const outcome = arena.handleFire(
        ev.id,
        ev.origin,
        ev.dir,
        now,
        ev.worldImpact?.distance,
      );
      if (outcome.fired) {
        botManager.onShotFired(ev.id);
        broadcastShot(ev.mapId, ev.id, ev.origin, ev.dir, outcome, ev.worldImpact);
      }
      broadcastFireOutcome(ev.mapId, outcome);
    }
    botManager.maintainAmmo(now);

    sincePrune += botDt;
    if (sincePrune >= 2) {
      sincePrune = 0;
      botManager.pruneEmptyMaps(mapsWithHumans);
    }
  }, Math.round(1000 / BOT_TICK_HZ));
}

async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ip: string,
): Promise<void> {
  if (req.method === 'GET' && url.pathname === '/api/health') {
    respondJson(res, 200, {
      ok: true,
      mode: DEV_MODE ? 'dev' : 'production',
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/leaderboard') {
    const mapId = parseMapId(url.searchParams.get('mapId')) ?? 'surf_skyworld_x';
    const entries = (leaderboardStore[mapId] ?? []).slice(0, 20);
    respondJson(res, 200, {
      mapId,
      entries,
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/session/start') {
    if (!isJsonContentType(req.headers['content-type'])) {
      respondJson(res, 415, { error: 'Content-Type must be application/json' });
      return;
    }
    let payload: unknown;
    try {
      payload = await readJsonBody(req, MAX_HTTP_BODY_BYTES);
    } catch {
      respondJson(res, 400, { error: 'Invalid JSON payload' });
      return;
    }
    if (!isObject(payload)) {
      respondJson(res, 400, { error: 'Invalid payload' });
      return;
    }
    const mapId = parseMapId(payload.mapId);
    if (!mapId) {
      respondJson(res, 400, { error: 'Invalid mapId' });
      return;
    }
    // Prune expired sessions
    const now = Date.now();
    for (const [token, session] of activeSessions.entries()) {
      if (now - session.startedAt > SESSION_TTL_MS) {
        activeSessions.delete(token);
      }
    }
    const sessionToken = crypto.randomUUID();
    activeSessions.set(sessionToken, { mapId, startedAt: now, used: false });
    respondJson(res, 200, { sessionToken });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/leaderboard') {
    if (!checkRateLimit(`lb:${ip}`, 20, 60_000)) {
      respondJson(res, 429, {
        error: 'Too many requests',
      });
      return;
    }

    if (!isJsonContentType(req.headers['content-type'])) {
      respondJson(res, 415, {
        error: 'Content-Type must be application/json',
      });
      return;
    }

    let payload: unknown;
    try {
      payload = await readJsonBody(req, MAX_HTTP_BODY_BYTES);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('Payload too large')) {
        respondJson(res, 413, { error: 'Payload too large' });
        return;
      }
      respondJson(res, 400, { error: 'Invalid JSON payload' });
      return;
    }
    if (!isObject(payload)) {
      respondJson(res, 400, { error: 'Invalid payload' });
      return;
    }

    const mapId = parseMapId(payload.mapId);
    const name = parseName(payload.name);
    const timeMs = parseInteger(payload.timeMs, 500, 3_600_000);
    const model = parseModel(payload.model);

    if (!mapId || !name || timeMs === null || !model) {
      respondJson(res, 400, {
        error: 'Invalid leaderboard payload',
      });
      return;
    }

    const sessionToken = typeof payload.sessionToken === 'string' ? payload.sessionToken.trim() : null;
    if (!sessionToken) {
      respondJson(res, 400, { error: 'sessionToken is required' });
      return;
    }
    const sessionRecord = activeSessions.get(sessionToken);
    if (!sessionRecord) {
      respondJson(res, 403, { error: 'Invalid or expired session token' });
      return;
    }
    if (sessionRecord.used) {
      respondJson(res, 403, { error: 'Session token already used' });
      return;
    }
    if (sessionRecord.mapId !== mapId) {
      respondJson(res, 403, { error: 'Session token mapId mismatch' });
      return;
    }
    // Mark session as used before committing the entry
    sessionRecord.used = true;

    const entry: LeaderboardEntry = {
      id: crypto.randomUUID(),
      mapId,
      name,
      timeMs,
      model,
      createdAt: new Date().toISOString(),
    };

    const list = leaderboardStore[mapId] ?? [];
    list.push(entry);
    list.sort((a, b) => a.timeMs - b.timeMs || a.createdAt.localeCompare(b.createdAt));
    leaderboardStore[mapId] = list.slice(0, 100);
    queueLeaderboardPersist();

    respondJson(res, 201, {
      ok: true,
      entry,
      entries: leaderboardStore[mapId].slice(0, 20),
    });
    return;
  }

  respondJson(res, 404, {
    error: 'API route not found',
  });
}

async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const asBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += asBuffer.length;
    if (size > maxBytes) {
      throw new Error('Payload too large');
    }
    chunks.push(asBuffer);
  }

  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (text.length === 0) {
    return {};
  }
  return JSON.parse(text);
}

function respondJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  addSecurityHeaders(res);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

async function handleStaticRequest(res: ServerResponse, pathname: string): Promise<void> {
  const normalizedPathname = pathname === '/' ? '/index.html' : pathname;
  const resolvedPath = path.resolve(DIST_DIR, `.${normalizedPathname}`);

  if (!resolvedPath.startsWith(DIST_DIR)) {
    respondJson(res, 403, {
      error: 'Forbidden',
    });
    return;
  }

  const indexPath = path.join(DIST_DIR, 'index.html');
  const candidate = await statSafe(resolvedPath);

  let filePath = resolvedPath;
  if (!candidate?.isFile()) {
    filePath = indexPath;
  }

  const stat = await statSafe(filePath);
  if (!stat?.isFile()) {
    respondJson(res, 404, {
      error: 'Build output not found. Run "npm run build" first.',
    });
    return;
  }

  addSecurityHeaders(res);
  res.statusCode = 200;
  res.setHeader('Content-Type', getContentType(path.extname(filePath)));
  createReadStream(filePath).pipe(res);
}

async function statSafe(filePath: string): Promise<import('node:fs').Stats | null> {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

function getContentType(extension: string): string {
  const ext = extension.toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.glb':
      return 'model/gltf-binary';
    case '.gltf':
      return 'model/gltf+json';
    default:
      return 'application/octet-stream';
  }
}

function addSecurityHeaders(res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  // Restrict sources: game uses Three.js (inline scripts/styles via Vite), WebGL, and audio.
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "connect-src 'self' ws: wss:",
      "worker-src blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
  // HSTS: only send over HTTPS connections (not during local dev on plain HTTP).
  if (!DEV_MODE) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

function checkRateLimit(key: string, maxCount: number, windowMs: number): boolean {
  const now = Date.now();
  const current = requestRate.get(key);
  if (!current || now >= current.resetAt) {
    requestRate.set(key, {
      count: 1,
      resetAt: now + windowMs,
    });
    return true;
  }

  if (current.count >= maxCount) {
    return false;
  }

  current.count += 1;
  requestRate.set(key, current);
  return true;
}

function isJsonContentType(contentType: string | string[] | undefined): boolean {
  if (!contentType) {
    return false;
  }
  const value = Array.isArray(contentType) ? contentType[0] : contentType;
  return value.toLowerCase().includes('application/json');
}

function parseMapId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  if (!MAP_ID_REGEX.test(normalized)) {
    return null;
  }
  return normalized;
}

function parseName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().replace(/\s+/g, ' ').slice(0, 24);
  if (!PLAYER_NAME_REGEX.test(normalized)) {
    return null;
  }
  return normalized;
}

function parseModel(value: unknown): PlayerModel | null {
  if (value === 'terrorist' || value === 'counterterrorist') {
    return value;
  }
  return null;
}

function parseAttackKind(value: unknown): AttackKind | null {
  if (value === 'primary' || value === 'secondary') {
    return value;
  }
  return null;
}

function parseInteger(value: unknown, min: number, max: number): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const rounded = Math.round(parsed);
  if (rounded < min || rounded > max) {
    return null;
  }
  return rounded;
}

function parseNumber(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  if (value < min || value > max) {
    return null;
  }
  return value;
}

function parseVector3(value: unknown, absLimit: number): [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) {
    return null;
  }

  const x = parseNumber(value[0], -absLimit, absLimit);
  const y = parseNumber(value[1], -absLimit, absLimit);
  const z = parseNumber(value[2], -absLimit, absLimit);
  if (x === null || y === null || z === null) {
    return null;
  }
  return [x, y, z];
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getClientIp(req: IncomingMessage): string {
  // In production, X-Forwarded-For should only be trusted when the server is behind a
  // known reverse proxy. Without an IP allowlist, any client can spoof this header and
  // bypass rate limiting. Only trust it when TRUST_PROXY=1 env var is set.
  if (process.env.TRUST_PROXY === '1') {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0].trim();
    }
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) {
    return true;
  }

  if (allowedOriginSet.has(origin)) {
    return true;
  }

  try {
    const url = new URL(origin);
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function broadcastToMap(mapId: string, payload: Record<string, unknown>): void {
  for (const client of clients.values()) {
    if (!client.joined || client.mapId !== mapId) {
      continue;
    }
    sendWs(client.ws, payload);
  }
}

function broadcastFireOutcome(mapId: string, outcome: FireOutcome): void {
  if (outcome.hit) {
    const now = Date.now();
    for (const client of clients.values()) {
      if (client.id === outcome.hit.targetId) {
        client.lastCombatAtMs = now;
        break;
      }
    }
    broadcastToMap(mapId, { type: 'hit', ...outcome.hit });
    const victim = outcome.hit.targetId;
    broadcastToMap(mapId, {
      type: 'health',
      playerId: victim,
      health: arena.getHealth(victim) ?? 0,
      alive: arena.isAlive(victim),
    });
  }
  if (outcome.death) {
    broadcastToMap(mapId, { type: 'death', ...outcome.death });
  }
}

/** Broadcasts a visible gunshot (tracer/muzzle) for a fired gun. Knives are skipped. */
function broadcastShot(
  mapId: string,
  playerId: string,
  origin: [number, number, number],
  dir: [number, number, number],
  outcome: FireOutcome,
  worldImpact?: {
    point: [number, number, number];
    normal: [number, number, number];
  },
): void {
  const weaponId = arena.getActiveWeapon(playerId);
  if (!weaponId || weaponId === 'knife') {
    return;
  }
  const direction = new Vector3(dir[0], dir[1], dir[2]);
  const payload: Record<string, unknown> = {
    type: 'shot',
    sequence: nextShotSequence++,
    result: outcome.death ? 'kill' : outcome.hit ? 'hit' : 'miss',
    playerId,
    targetId: outcome.hit?.targetId,
    origin,
    dir,
    weaponId,
  };
  if (
    outcome.impactDistance !== undefined
    && Number.isFinite(outcome.impactDistance)
    && direction.lengthSq() > 1e-8
  ) {
    direction.normalize();
    const endpoint = new Vector3(origin[0], origin[1], origin[2])
      .addScaledVector(direction, outcome.impactDistance);
    payload.endpoint = [endpoint.x, endpoint.y, endpoint.z];
    payload.impactNormal = [-direction.x, -direction.y, -direction.z];
  } else if (worldImpact) {
    payload.endpoint = worldImpact.point;
    payload.impactNormal = worldImpact.normal;
  } else if (direction.lengthSq() > 1e-8) {
    direction.normalize();
    const endpoint = new Vector3(origin[0], origin[1], origin[2])
      .addScaledVector(direction, REMOTE_SHOT_VISUAL_DISTANCE);
    payload.endpoint = [endpoint.x, endpoint.y, endpoint.z];
    payload.impactNormal = [-direction.x, -direction.y, -direction.z];
  }
  broadcastToMap(mapId, payload);
}

function broadcastAttack(mapId: string, playerId: string, kind: AttackKind): void {
  const payload = {
    type: 'attack',
    mapId,
    playerId,
    kind,
    serverTimeMs: Date.now(),
  } as const;

  for (const client of clients.values()) {
    if (!client.joined || client.mapId !== mapId) {
      continue;
    }
    sendWs(client.ws, payload);
  }
}

function sendWs(ws: WebSocket, payload: unknown): void {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }
  ws.send(JSON.stringify(payload));
}

async function loadLeaderboardStore(): Promise<void> {
  try {
    const raw = await fs.readFile(LEADERBOARD_FILE, 'utf8');
    const parsed = JSON.parse(raw) as LeaderboardStore;
    if (!isObject(parsed)) {
      leaderboardStore = {};
      return;
    }

    const nextStore: LeaderboardStore = {};
    for (const [mapId, rawEntries] of Object.entries(parsed)) {
      if (!Array.isArray(rawEntries) || !parseMapId(mapId)) {
        continue;
      }
      const entries: LeaderboardEntry[] = [];
      for (const item of rawEntries) {
        if (!isObject(item)) {
          continue;
        }
        const name = parseName(item.name);
        const timeMs = parseInteger(item.timeMs, 500, 3_600_000);
        const model = parseModel(item.model);
        if (!name || timeMs === null || !model) {
          continue;
        }

        entries.push({
          id: typeof item.id === 'string' ? item.id : crypto.randomUUID(),
          mapId,
          name,
          timeMs,
          model,
          createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
        });
      }

      entries.sort((a, b) => a.timeMs - b.timeMs || a.createdAt.localeCompare(b.createdAt));
      nextStore[mapId] = entries.slice(0, 100);
    }

    leaderboardStore = nextStore;
  } catch {
    leaderboardStore = {};
  }
}

function queueLeaderboardPersist(): void {
  persistQueue = persistQueue
    .then(async () => {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const data = `${JSON.stringify(leaderboardStore, null, 2)}\n`;
      await fs.writeFile(LEADERBOARD_FILE, data, 'utf8');
    })
    .catch((error) => {
      // eslint-disable-next-line no-console
      console.error('[Leaderboard] Persist error:', error);
    });
}

async function bootstrap(): Promise<void> {
  await loadLeaderboardStore();

  server.listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`[WebStrafe server] listening on http://${HOST}:${PORT}`);
    // eslint-disable-next-line no-console
    console.log(`[WebStrafe server] mode=${DEV_MODE ? 'dev' : 'production'}`);
  });
}

void bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
