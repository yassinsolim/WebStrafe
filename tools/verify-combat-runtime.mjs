import WebSocket from 'ws';
import {
  asError,
  parseCombatVerifyDuration,
  parseProtocolMessage,
} from './combat-runtime-lib.mjs';

const PROBE_INTERVAL_MS = 1_000;
const PROBE_TIMEOUT_MS = 2_000;

function monitorSocket(socket) {
  let failure = null;
  let closing = false;
  const rememberFailure = (error) => {
    if (!failure && !closing) failure = asError(error, 'WebSocket failed');
  };
  const onError = (error) => rememberFailure(error);
  const onClose = (code, reason) => {
    if (!closing) {
      rememberFailure(
        new Error(`WebSocket closed unexpectedly: ${code} ${reason.toString()}`),
      );
    }
  };
  socket.on('error', onError);
  socket.on('close', onClose);
  return {
    assertHealthy() {
      if (failure) throw failure;
      if (!closing && socket.readyState !== WebSocket.OPEN) {
        throw new Error(`WebSocket state changed to ${socket.readyState}`);
      }
    },
    markClosing() {
      closing = true;
    },
    dispose() {
      socket.off('error', onError);
      socket.off('close', onClose);
    },
  };
}

function openSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off('open', onOpen);
      socket.off('message', onMessage);
      socket.off('close', onClose);
      socket.off('error', onError);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        socket.terminate();
        reject(asError(error));
      } else {
        resolve({ socket, monitor: monitorSocket(socket) });
      }
    };
    const onOpen = () => {
      try {
        socket.send(JSON.stringify({
          type: 'join',
          mapId: 'training_straight',
          name: 'Runtime Probe',
          model: 'counterterrorist',
        }), (error) => {
          if (error) finish(error);
        });
      } catch (error) {
        finish(error);
      }
    };
    const onMessage = (raw) => {
      try {
        const payload = parseProtocolMessage(raw, `${url} readiness`);
        if (payload.type === 'error') {
          finish(new Error(`${url} rejected probe: ${String(payload.message ?? 'error')}`));
        } else if (payload.type === 'joined') {
          finish();
        }
      } catch (error) {
        finish(error);
      }
    };
    const onClose = (code, reason) => {
      finish(new Error(`${url} closed before join: ${code} ${reason.toString()}`));
    };
    const onError = (error) => finish(error);
    const timeout = setTimeout(
      () => finish(new Error(`Timed out opening and joining ${url}`)),
      5_000,
    );
    socket.once('open', onOpen);
    socket.on('message', onMessage);
    socket.once('close', onClose);
    socket.once('error', onError);
  });
}

function expectPong(socket) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.off('pong', onPong);
      socket.off('close', onClose);
      socket.off('error', onError);
      if (error) reject(asError(error));
      else resolve();
    };
    const onPong = () => finish();
    const onClose = (code, reason) => {
      finish(new Error(`WebSocket closed before pong: ${code} ${reason.toString()}`));
    };
    const onError = (error) => finish(error);
    const timeout = setTimeout(
      () => finish(new Error('Timed out waiting for WebSocket pong')),
      PROBE_TIMEOUT_MS,
    );
    socket.once('pong', onPong);
    socket.once('close', onClose);
    socket.once('error', onError);
    try {
      socket.ping();
    } catch (error) {
      finish(error);
    }
  });
}

async function closeSocket(managed) {
  const { socket, monitor } = managed;
  monitor.markClosing();
  if (socket.readyState === WebSocket.CLOSED) {
    monitor.dispose();
    return;
  }
  if (socket.readyState !== WebSocket.OPEN) {
    socket.terminate();
    monitor.dispose();
    return;
  }
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.off('close', finish);
      resolve();
    };
    const timeout = setTimeout(() => {
      socket.terminate();
      finish();
    }, 1_000);
    socket.once('close', finish);
    try {
      socket.close(1000, 'verification complete');
    } catch {
      socket.terminate();
      finish();
    }
  });
  monitor.dispose();
}

async function expectHttp(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
}

async function verify(durationMs) {
  const startedAt = Date.now();
  let managed = null;
  try {
    managed = await openSocket('ws://127.0.0.1:5174/ws');
    let httpChecks = 0;
    let wsPings = 0;
    while (Date.now() - startedAt < durationMs) {
      managed.monitor.assertHealthy();
      await expectHttp('http://127.0.0.1:5174/api/leaderboard');
      httpChecks += 1;
      await expectPong(managed.socket);
      managed.monitor.assertHealthy();
      managed.socket.send(JSON.stringify({
        type: 'state',
        position: [0, 0, 0],
        velocity: [0, 0, 0],
        yaw: 0,
        pitch: 0,
      }));
      wsPings += 1;
      await new Promise((resolve) => setTimeout(resolve, PROBE_INTERVAL_MS));
    }

    managed.monitor.assertHealthy();
    await expectHttp('http://127.0.0.1:5174/api/leaderboard');
    httpChecks += 1;
    await expectPong(managed.socket);
    wsPings += 1;
    console.log(
      `[combat-runtime] PASS durationMs=${Date.now() - startedAt}`
        + ` httpChecks=${httpChecks} wsPings=${wsPings}`,
    );
  } finally {
    if (managed) await closeSocket(managed);
  }
}

async function main() {
  const durationMs = parseCombatVerifyDuration(process.env.COMBAT_VERIFY_MS);
  await verify(durationMs);
}

main().catch((error) => {
  console.error('[combat-runtime] FAIL', asError(error).message);
  process.exitCode = 1;
});
