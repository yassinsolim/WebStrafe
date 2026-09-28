/**
 * one bench client (mover or observer) running in its own process so it can have
 * its own skewed wall clock. uses the real transport classes and the real
 * RemotePlayersRenderer, headless.
 */
import { Vector3 } from 'three';

export interface WorkerConfig {
  role: 'mover' | 'observer' | 'idle';
  label: string;
  transport: 'ws' | 'supabase';
  wsUrl?: string;
  supabase?: { url: string; key: string; prefix: string };
  sessionId: string;
  mapId: string;
  /** added to Date.now() in this worker, models an unsynced pc clock */
  clockSkewMs: number;
  /** mover: phase on the circle in radians */
  phase: number;
  durationMs: number;
  warmupMs: number;
  /** epoch ms the scripted paths are anchored to, shared by all workers */
  epochMs: number;
}

export const ARENA = {
  center: new Vector3(0, 500, 0),
  radius: 12,
  speed: 16,
  eyeHeight: 1.6,
  chestHeight: 1.0,
};

const cfg = JSON.parse(process.env.BENCH_CFG ?? '{}') as WorkerConfig;
const emit = (m: unknown) => process.stdout.write(`RESULT ${JSON.stringify(m)}\n`);

// ---- environment shims (browser globals the client code expects) ----
const realNow = Date.now.bind(Date);
Date.now = () => realNow() + cfg.clockSkewMs;
const g = globalThis as Record<string, unknown>;
g.self ??= globalThis;
g.window ??= globalThis;
const store = new Map<string, string>([['webstrafe:session-id:v1', cfg.sessionId]]);
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const trueNow = (): number => performance.timeOrigin + performance.now();

export function truthAt(epochMs: number, tMs: number, phase: number): { pos: Vector3; vel: Vector3 } {
  const w = ARENA.speed / ARENA.radius;
  const a = ((tMs - epochMs) / 1000) * w + phase;
  const pos = new Vector3(
    ARENA.center.x + Math.cos(a) * ARENA.radius,
    ARENA.center.y,
    ARENA.center.z + Math.sin(a) * ARENA.radius,
  );
  const vel = new Vector3(-Math.sin(a) * ARENA.speed, 0, Math.cos(a) * ARENA.speed);
  return { pos, vel };
}

function pct(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function main(): Promise<void> {
  // optional modules only present after the netcode revamp
  const cadenceMod = await import('../../src/netcode/SendCadence').catch(() => null);
  const rendererMod = await import('../../src/multiplayer/RemotePlayersRenderer');
  const { RemotePlayersRenderer } = rendererMod;
  const legacyDelay = (rendererMod as Record<string, unknown>).REMOTE_PRESENTATION_DELAY_MS as number | undefined;

  type Transport = import('../../src/network/MultiplayerTransport').MultiplayerTransport;
  let transport: Transport;
  if (cfg.transport === 'ws') {
    const { MultiplayerClient } = await import('../../src/network/MultiplayerClient');
    transport = new MultiplayerClient(cfg.wsUrl);
  } else {
    const { createClient } = await import('@supabase/supabase-js');
    const { SupabaseMultiplayer } = await import('../../src/network/SupabaseMultiplayer');
    const s = cfg.supabase!;
    const client = createClient(s.url, s.key, { realtime: { params: { eventsPerSecond: 20 } } });
    transport = new SupabaseMultiplayer(client, {
      supabaseUrl: s.url,
      supabaseKey: s.key,
      leaderboardTable: 'unused',
      lobbyChannelPrefix: s.prefix,
    });
  }

  const renderer = new RemotePlayersRenderer();
  const moverPhase = new Map<string, number>();
  const snapshotArrivals: number[] = [];
  const serverTimes: number[] = [];
  let connected = false;
  let disconnects = 0;
  transport.onConnectedChange = (c) => {
    if (connected && !c) disconnects += 1;
    connected = c;
  };
  transport.onSnapshot = (snap) => {
    snapshotArrivals.push(trueNow());
    serverTimes.push(snap.serverTimeMs);
    for (const pl of snap.players) {
      if (pl.name.startsWith('mover')) moverPhase.set(pl.id, pl.name.endsWith('b') ? Math.PI : 0);
    }
    renderer.applySnapshot(snap.players, transport.getLocalId());
  };

  // combat bookkeeping, observer side
  const targetState = new Map<string, { alive: boolean; protectedUntil: number }>();
  const markProtected = (id: string) => {
    targetState.set(id, { alive: true, protectedUntil: trueNow() + 3800 });
  };
  transport.onHealth = (e) => {
    const cur = targetState.get(e.playerId) ?? { alive: true, protectedUntil: 0 };
    if (!e.alive) cur.alive = false;
    targetState.set(e.playerId, cur);
  };
  transport.onRespawn = (e) => markProtected(e.playerId);
  const shots = { accepted: 0, hit: 0, sent: 0 };
  const shotErrors: number[] = [];
  transport.onShot = (e) => {
    if (e.playerId !== transport.getLocalId()) return;
    shots.accepted += 1;
    if (e.result !== 'miss') shots.hit += 1;
  };

  if (cfg.transport === 'supabase') {
    const { CollisionWorld } = await import('../../src/world/CollisionWorld');
    transport.setRoomContext({
      collisionWorld: new CollisionWorld(),
      spawn: { position: ARENA.center.clone(), yawDeg: 0 },
      botCount: 0,
    });
  }
  transport.connect();
  transport.join(cfg.mapId, cfg.label, cfg.role === 'mover' ? 'terrorist' : 'counterterrorist');

  const start = trueNow();
  const end = start + cfg.durationMs;
  const measureFrom = start + cfg.warmupMs;
  let lastFrame = performance.now();
  let accumulator = 0;
  let sendAccumulator = 0;
  let simMs = trueNow();
  const TICK = 1 / 128;
  let readySent = false;
  let lastEquipAt = 0;

  // presentation metrics (observer)
  const errors: number[] = [];
  const speedErr: number[] = [];
  let frozenFrames = 0;
  let jumpFrames = 0;
  let measuredFrames = 0;
  const lastDisp = new Map<string, Vector3>();

  // firing (observer)
  let nextShotAt = measureFrom;
  let ammo = 7;
  let reloadUntil = 0;
  let targetCursor = 0;

  const stateFor = (tMs: number) => {
    if (cfg.role === 'mover') {
      const { pos, vel } = truthAt(cfg.epochMs, tMs, cfg.phase);
      return { position: [pos.x, pos.y, pos.z] as [number, number, number], velocity: [vel.x, vel.y, vel.z] as [number, number, number], yaw: 0, pitch: 0 };
    }
    return { position: [ARENA.center.x, ARENA.center.y, ARENA.center.z] as [number, number, number], velocity: [0, 0, 0] as [number, number, number], yaw: 0, pitch: 0 };
  };

  await new Promise<void>((resolve) => {
    const frame = () => {
      const nowPerf = performance.now();
      const frameDt = Math.min(0.1, (nowPerf - lastFrame) / 1000);
      lastFrame = nowPerf;
      const tNow = trueNow();
      if (connected && !readySent && transport.getLocalId()) {
        transport.setCombatReady(true);
        readySent = true;
      }
      if (cfg.role === 'observer' && connected && tNow - lastEquipAt > 2000) {
        transport.sendEquip('deagle');
        lastEquipAt = tNow;
      }

      // fixed 128 hz sim ticks with the game's send cadence rule
      accumulator += frameDt;
      while (accumulator >= TICK) {
        accumulator -= TICK;
        simMs += TICK * 1000;
        if (cfg.role === 'idle') continue;
        if (cadenceMod) {
          // new contract: every tick goes to the transport stamped with this
          // process's (skewed) wall clock, the transport picks what to send
          transport.sendState({ ...stateFor(simMs), t: simMs + cfg.clockSkewMs });
        } else {
          sendAccumulator += TICK;
          if (sendAccumulator >= 1 / 20) {
            sendAccumulator = 0;
            transport.sendState(stateFor(simMs));
          }
        }
      }

      renderer.update(frameDt);

      if (cfg.role === 'observer' && tNow >= measureFrom) {
        for (const [id, phase] of moverPhase) {
          const obj = renderer.root.getObjectByName(`RemotePlayer:${id}`);
          if (!obj) continue;
          const truth = truthAt(cfg.epochMs, tNow, phase);
          errors.push(obj.position.distanceTo(truth.pos));
          const prev = lastDisp.get(id);
          if (prev && frameDt > 0) {
            const shown = obj.position.distanceTo(prev) / frameDt;
            const ratio = shown / ARENA.speed;
            speedErr.push(Math.abs(ratio - 1));
            if (ratio < 0.1) frozenFrames += 1;
            if (ratio > 2.5) jumpFrames += 1;
            measuredFrames += 1;
          }
          lastDisp.set(id, obj.position.clone());
        }

        // shoot the displayed chest of whichever mover is alive and unprotected
        if (tNow >= nextShotAt && tNow >= reloadUntil && tNow < end - 1500) {
          const ids = [...moverPhase.keys()];
          for (let k = 0; k < ids.length; k += 1) {
            const id = ids[(targetCursor + k) % ids.length];
            const st = targetState.get(id) ?? { alive: true, protectedUntil: 0 };
            const obj = renderer.root.getObjectByName(`RemotePlayer:${id}`);
            if (!obj || !st.alive || st.protectedUntil > tNow) continue;
            const eye = ARENA.center.clone().add(new Vector3(0, ARENA.eyeHeight, 0));
            const aim = obj.position.clone().add(new Vector3(0, ARENA.chestHeight, 0));
            const dir = aim.sub(eye).normalize();
            const r = renderer as unknown as { getFireView?: () => unknown };
            const view = r.getFireView
              ? r.getFireView()
              : ((transport as unknown as { latestSnapshotServerTimeMs?: number }).latestSnapshotServerTimeMs ?? serverTimes.at(-1) ?? 0) - (legacyDelay ?? 71);
            (transport.sendFire as (o: [number, number, number], d: [number, number, number], v?: unknown) => void)(
              [eye.x, eye.y, eye.z],
              [dir.x, dir.y, dir.z],
              view,
            );
            const truth = truthAt(cfg.epochMs, tNow, moverPhase.get(id) ?? 0).pos;
            shotErrors.push(obj.position.distanceTo(truth));
            shots.sent += 1;
            ammo -= 1;
            targetCursor += 1;
            if (ammo <= 0) {
              transport.sendReload();
              reloadUntil = tNow + 3500;
              ammo = 7;
            }
            break;
          }
          nextShotAt = tNow + 260;
        }
      }

      if (tNow >= end) {
        resolve();
        return;
      }
      setTimeout(frame, 16);
    };
    frame();
  });

  // wait for in-flight shot results
  await new Promise((r) => setTimeout(r, 1200));

  const gaps: number[] = [];
  for (let i = 1; i < snapshotArrivals.length; i += 1) gaps.push(snapshotArrivals[i] - snapshotArrivals[i - 1]);
  const serverDeltas: number[] = [];
  for (let i = 1; i < serverTimes.length; i += 1) serverDeltas.push(serverTimes[i] - serverTimes[i - 1]);
  const measuredSecs = (end - measureFrom) / 1000;

  const result = {
    label: cfg.label,
    role: cfg.role,
    disconnects,
    snapshots: {
      hz: +(snapshotArrivals.length / (cfg.durationMs / 1000)).toFixed(1),
      gapP50: +pct(gaps, 50).toFixed(1),
      gapP99: +pct(gaps, 99).toFixed(1),
      gapMax: +Math.max(0, ...gaps).toFixed(1),
      serverDeltaP50: +pct(serverDeltas, 50).toFixed(1),
      serverDeltaP99: +pct(serverDeltas, 99).toFixed(1),
    },
    presentation: cfg.role === 'observer' ? {
      errorP50m: +pct(errors, 50).toFixed(3),
      errorP95m: +pct(errors, 95).toFixed(3),
      errorMaxm: +Math.max(0, ...errors).toFixed(3),
      speedErrP50: +pct(speedErr, 50).toFixed(3),
      speedErrP95: +pct(speedErr, 95).toFixed(3),
      frozenPct: +((100 * frozenFrames) / Math.max(1, measuredFrames)).toFixed(1),
      jumpPct: +((100 * jumpFrames) / Math.max(1, measuredFrames)).toFixed(1),
    } : undefined,
    combat: cfg.role === 'observer' ? {
      shotsSent: shots.sent,
      shotsAccepted: shots.accepted,
      hits: shots.hit,
      hitRatePct: +((100 * shots.hit) / Math.max(1, shots.accepted)).toFixed(1),
      aimVsTruthP50m: +pct(shotErrors, 50).toFixed(3),
    } : undefined,
    measuredSecs,
  };
  transport.disconnect();
  emit(result);
  setTimeout(() => process.exit(0), 200);
}

void main().catch((error) => {
  emit({ label: cfg.label, error: String(error?.stack ?? error) });
  setTimeout(() => process.exit(1), 100);
});
