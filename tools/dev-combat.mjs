import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { asError, parseProtocolMessage } from './combat-runtime-lib.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const VITE_ENTRY = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const WATCHDOG_INTERVAL_MS = 1_000;
const WATCHDOG_TIMEOUT_MS = 2_000;
const children = new Map();
let watchdog = null;
let watchdogSocket = null;
let removeSocketMonitor = null;
let shuttingDown = false;
let healthCheckRunning = false;
let healthChecks = 0;
let shutdownPromise = null;

function logStream(name, stream, method) {
  createInterface({ input: stream }).on('line', (line) => {
    method(`[${name}] ${line}`);
  });
}

function failRuntime(context, error) {
  if (shuttingDown) return shutdownPromise ?? Promise.resolve();
  const failure = asError(error, context);
  console.error(`[combat-dev] FATAL ${context}: ${failure.message}`);
  return shutdown(1);
}

function start(name, args, extraEnv = {}) {
  if (shuttingDown) {
    throw new Error(`Refusing to start ${name} while combat runtime is shutting down`);
  }
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  children.set(name, child);
  console.log(`[combat-dev] ${name} pid=${child.pid}`);
  logStream(name, child.stdout, console.log);
  logStream(name, child.stderr, console.error);
  child.once('error', (error) => {
    void failRuntime(`${name} process error`, error);
  });
  child.once('exit', (code, signal) => {
    console.error(
      `[combat-dev] ${name} exited code=${code ?? 'null'} signal=${signal ?? 'none'}`,
    );
    if (!shuttingDown) {
      void failRuntime(
        `${name} process exited`,
        new Error(`code=${code ?? 'null'} signal=${signal ?? 'none'}`),
      );
    }
  });
  return child;
}

async function expectHttp(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(WATCHDOG_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
}

async function waitForHttp(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = new Error(`${url} was not checked`);
  while (Date.now() < deadline) {
    try {
      await expectHttp(url);
      return;
    } catch (error) {
      lastError = asError(error);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError.message}`);
}

function attachSocketMonitor(socket, url) {
  const onError = (error) => {
    void failRuntime('WebSocket proxy connection failed', error);
  };
  const onClose = (code, reason) => {
    if (!shuttingDown) {
      void failRuntime(
        'WebSocket proxy connection closed',
        new Error(`${url} code=${code} reason=${reason.toString()}`),
      );
    }
  };
  socket.on('error', onError);
  socket.on('close', onClose);
  return () => {
    socket.off('error', onError);
    socket.off('close', onClose);
  };
}

function openWatchdogSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let settled = false;
    let joinSent = false;
    const cleanup = () => {
      clearTimeout(timeout);
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
        removeSocketMonitor = attachSocketMonitor(socket, url);
        resolve(socket);
      }
    };
    const onMessage = (raw) => {
      try {
        const payload = parseProtocolMessage(raw, `${url} readiness`);
        if (payload.type === 'welcome' && !joinSent) {
          joinSent = true;
          socket.send(JSON.stringify({
            type: 'join',
            mapId: 'training_straight',
            name: 'Supervisor Watchdog',
            model: 'counterterrorist',
          }), (error) => {
            if (error) finish(error);
          });
          return;
        }
        if (payload.type === 'joined') {
          finish();
          return;
        }
        if (payload.type === 'error') {
          finish(new Error(`${url} rejected watchdog: ${String(payload.message ?? 'error')}`));
          return;
        }
        finish(new Error(`${url} expected welcome/joined, received ${payload.type}`));
      } catch (error) {
        finish(error);
      }
    };
    const onClose = (code, reason) => {
      finish(new Error(`${url} closed before welcome: ${code} ${reason.toString()}`));
    };
    const onError = (error) => finish(error);
    const timeout = setTimeout(() => {
      finish(new Error(`Timed out opening ${url}`));
    }, 5_000);
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
      () => finish(new Error('Timed out waiting for WebSocket proxy pong')),
      WATCHDOG_TIMEOUT_MS,
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

async function sendApplicationProbe(socket) {
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(asError(error));
      else resolve();
    };
    const timeout = setTimeout(
      () => finish(new Error('Timed out sending WebSocket application probe')),
      WATCHDOG_TIMEOUT_MS,
    );
    try {
      socket.send(JSON.stringify({
        type: 'state',
        position: [0, 0, 0],
        velocity: [0, 0, 0],
        yaw: 0,
        pitch: 0,
      }), (error) => finish(error));
    } catch (error) {
      finish(error);
    }
  });
}

async function closeManagedSocket(socket) {
  if (socket.readyState === WebSocket.CLOSED) return;
  if (socket.readyState !== WebSocket.OPEN) {
    socket.terminate();
    return;
  }
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.off('close', finish);
      socket.off('error', onError);
      resolve();
    };
    const onError = () => {
      socket.terminate();
      finish();
    };
    const timeout = setTimeout(() => {
      socket.terminate();
      finish();
    }, 1_000);
    socket.once('close', finish);
    socket.once('error', onError);
    try {
      socket.close(1000, 'combat runtime shutdown');
    } catch {
      socket.terminate();
      finish();
    }
  });
}

async function terminateChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill('SIGTERM');
  } catch {
    return;
  }
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_500)),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    try {
      child.kill('SIGKILL');
    } catch {
      // The child exited between the state check and kill.
    }
  }
}

async function shutdown(exitCode) {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  shutdownPromise = (async () => {
    if (watchdog) {
      clearInterval(watchdog);
      watchdog = null;
    }
    if (removeSocketMonitor) {
      removeSocketMonitor();
      removeSocketMonitor = null;
    }
    if (watchdogSocket) {
      await closeManagedSocket(watchdogSocket);
      watchdogSocket = null;
    }
    await Promise.all([...children.values()].map(terminateChild));
    console.log(`[combat-dev] shutdown complete exitCode=${exitCode}`);
    process.exit(exitCode);
  })();
  return shutdownPromise;
}

async function main() {
  console.log(`[combat-dev] supervisor pid=${process.pid}`);
  start(
    'backend',
    ['--import', 'tsx', 'server/index.ts'],
    {
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: '8787',
      ENABLE_BOTS: 'true',
      BOTS_PER_MAP: '1',
    },
  );
  await waitForHttp('http://127.0.0.1:8787/api/leaderboard');
  console.log('[combat-dev] backend ready http://127.0.0.1:8787');

  start(
    'vite',
    [VITE_ENTRY, '--host', '127.0.0.1', '--port', '5174', '--strictPort'],
    { VITE_ENABLE_COMBAT: 'true' },
  );
  await Promise.all([
    waitForHttp('http://127.0.0.1:5174/'),
    waitForHttp('http://127.0.0.1:5174/api/leaderboard'),
  ]);
  watchdogSocket = await openWatchdogSocket('ws://127.0.0.1:5174/ws');
  console.log(
    `[combat-dev] READY supervisor=${process.pid} backend=${children.get('backend').pid}`
      + ` vite=${children.get('vite').pid} watchdog=http+ws/1000ms`,
  );

  watchdog = setInterval(async () => {
    if (healthCheckRunning || shuttingDown) return;
    healthCheckRunning = true;
    try {
      if (!watchdogSocket || watchdogSocket.readyState !== WebSocket.OPEN) {
        throw new Error(
          `WebSocket proxy is not open (state=${watchdogSocket?.readyState ?? 'missing'})`,
        );
      }
      await Promise.all([
        expectHttp('http://127.0.0.1:8787/api/leaderboard'),
        expectHttp('http://127.0.0.1:5174/'),
        expectHttp('http://127.0.0.1:5174/api/leaderboard'),
        expectPong(watchdogSocket),
        sendApplicationProbe(watchdogSocket),
      ]);
      healthChecks += 1;
      if (healthChecks % 30 === 0) {
        console.log(`[combat-dev] watchdog healthy checks=${healthChecks}`);
      }
    } catch (error) {
      await failRuntime('watchdog probe failed', error);
    } finally {
      healthCheckRunning = false;
    }
  }, WATCHDOG_INTERVAL_MS);
}

process.once('SIGINT', () => void shutdown(0));
process.once('SIGTERM', () => void shutdown(0));
main().catch((error) => void failRuntime('startup failed', error));
