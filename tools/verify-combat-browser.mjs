import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { asError } from './combat-runtime-lib.mjs';
import {
  analyzeEffectRegions,
  assessNativeFireReadiness,
  assessNativeShotCapture,
  classifyNativeShotFailure,
  findBrowserExecutable,
  imageDifference,
  measureEffectTrajectory,
  measureNeutralSilhouette,
  parseCombatAmmo,
  parseCombatBrowserOptions,
  summarizeConsoleIssue,
  summarizeWebAudioEvents,
  terminateManagedChild,
} from './combat-browser-lib.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const VITE_ENTRY = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const APP_URL = 'http://127.0.0.1:5174/';
const CDP_PORT = 9223;
const VIEWPORT = { width: 1600, height: 900, deviceScaleFactor: 1 };
const SHOT_EFFECT_REGION = { x: 650, y: 300, width: 300, height: 300 };
const BOT_EFFECT_REGION = { x: 520, y: 330, width: 560, height: 290 };
const KNIFE_VIEWMODEL_REGION = { x: 640, y: 430, width: 960, height: 470 };
const KNIFE_HAND_REGION = { x: 620, y: 650, width: 980, height: 250 };
const WEAPON_UI = {
  knife: {
    key: ['Digit3', '3', 51],
    text: 'Knife',
    silhouetteRegion: KNIFE_VIEWMODEL_REGION,
  },
  deagle: {
    key: ['Digit2', '2', 50],
    text: 'Desert Eagle',
    magazine: 7,
    recoverMs: 700,
    fireReadyMs: 300,
    muzzleLifetimeMs: 190,
    tracerLifetimeMs: 620,
    immediateCaptureMaxMs: 170,
    palette: 'warm',
    silhouetteRegion: { x: 700, y: 565, width: 520, height: 325 },
    shotSample: {
      path: '/audio/deagle_shot.mp3',
      volume: 0.52,
      poolSize: 4,
    },
    reloadSample: {
      path: '/audio/deagle_reload.mp3',
      activeCueVolume: 0.72,
      activeCueStartSec: 0.5,
      probeDelayMs: 700,
      poolSize: 4,
    },
  },
  awp: {
    key: ['Digit1', '1', 49],
    text: 'AWP',
    magazine: 10,
    recoverMs: 950,
    fireReadyMs: 1_600,
    muzzleLifetimeMs: 220,
    tracerLifetimeMs: 760,
    immediateCaptureMaxMs: 200,
    palette: 'warm-or-cool',
    silhouetteRegion: { x: 850, y: 700, width: 570, height: 190 },
    actionSilhouetteRegion: { x: 850, y: 430, width: 730, height: 460 },
    shotSample: {
      path: '/audio/awp_shot.mp3',
      volume: 0.62,
      poolSize: 2,
    },
    reloadSample: {
      path: '/audio/awp_reload.mp3',
      activeCueVolume: 0.68,
      activeCueStartSec: 0.55,
      probeDelayMs: 850,
      poolSize: 4,
    },
  },
};
const FIREARM_ASSET_CONTRACTS = {
  deagle: {
    relativePath: 'public/viewmodels/deagle/deagle.glb',
    gameplayDurationSec: 3.33,
    minimumChannels: 450,
    minimumJoints: 150,
    maximumBytes: 16 * 1024 * 1024,
    requiredNames: [],
    requiredAnimatedNodes: ['DEF-hand.L', 'DEF-hand.R', 'Magazine', 'Magazine_2'],
    forbiddenNames: ['cloth'],
  },
  awp: {
    relativePath: 'public/viewmodels/awp/awp.glb',
    gameplayDurationSec: 3.45,
    minimumChannels: 220,
    minimumJoints: 70,
    maximumBytes: 3 * 1024 * 1024,
    requiredNames: ['BlackGlovesSkin'],
    requiredAnimatedNodes: ['UpperArm.L', 'UpperArm.R', 'Magazine'],
    forbiddenNames: [],
  },
};
const AUTHORED_WATCH_ASSET_CONTRACT = {
  relativePath: 'public/viewmodels/shared/deagle-watch.glb',
  maximumBytes: 1024 * 1024,
  requiredMaterials: ['Watch', 'Watch_Emission'],
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readGlbDocument(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  const bytes = await fs.readFile(absolutePath);
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67) {
    throw new Error(`${relativePath} is not a valid binary glTF`);
  }
  if (bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) {
    throw new Error(`${relativePath} has an invalid GLB header`);
  }

  let json = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkLength = bytes.readUInt32LE(offset);
    const chunkType = bytes.readUInt32LE(offset + 4);
    const chunkEnd = offset + 8 + chunkLength;
    if (chunkEnd > bytes.length) {
      throw new Error(`${relativePath} contains a truncated GLB chunk`);
    }
    if (chunkType === 0x4e4f534a) {
      json = JSON.parse(
        bytes.subarray(offset + 8, chunkEnd).toString('utf8').replace(/\0+$/, ''),
      );
      break;
    }
    offset = chunkEnd;
  }
  if (!json) {
    throw new Error(`${relativePath} does not contain a JSON chunk`);
  }
  return { bytes, json };
}

async function inspectFirearmAsset(contract) {
  const { bytes, json } = await readGlbDocument(contract.relativePath);
  const animation = json.animations?.[0];
  const channels = animation?.channels ?? [];
  const animatedNodes = new Set(channels.map((channel) => (
    json.nodes?.[channel.target?.node]?.name ?? ''
  )));
  const durationSec = Math.max(0, ...(animation?.samplers ?? []).map((sampler) => (
    json.accessors?.[sampler.input]?.max?.[0] ?? 0
  )));
  const allNames = [
    ...(json.nodes ?? []).map((node) => node.name ?? ''),
    ...(json.materials ?? []).map((material) => material.name ?? ''),
  ];

  return {
    relativePath: contract.relativePath,
    bytes: bytes.length,
    animationCount: json.animations?.length ?? 0,
    animationName: animation?.name ?? null,
    animationDurationSec: durationSec,
    animationChannels: channels.length,
    skinJointCounts: (json.skins ?? []).map((skin) => skin.joints?.length ?? 0),
    requiredNames: Object.fromEntries(
      contract.requiredNames.map((name) => [name, allNames.includes(name)]),
    ),
    requiredAnimatedNodes: Object.fromEntries(
      contract.requiredAnimatedNodes.map((name) => [name, animatedNodes.has(name)]),
    ),
    forbiddenNames: contract.forbiddenNames.filter((token) => (
      allNames.some((name) => name.toLowerCase().includes(token))
    )),
  };
}

async function inspectAuthoredWatchAsset(contract) {
  const { bytes, json } = await readGlbDocument(contract.relativePath);
  const primitives = (json.meshes ?? []).flatMap((mesh) => mesh.primitives ?? []);
  const materialNames = new Set((json.materials ?? []).map((material) => material.name ?? ''));
  const skinAttributes = primitives.flatMap((primitive) => (
    Object.keys(primitive.attributes ?? {}).filter((name) => (
      name.startsWith('JOINTS_') || name.startsWith('WEIGHTS_')
    ))
  ));
  return {
    relativePath: contract.relativePath,
    bytes: bytes.length,
    nodeNames: (json.nodes ?? []).map((node) => node.name ?? ''),
    meshNames: (json.meshes ?? []).map((mesh) => mesh.name ?? ''),
    primitiveCount: primitives.length,
    materials: [...materialNames].sort(),
    animationCount: json.animations?.length ?? 0,
    skinCount: json.skins?.length ?? 0,
    skinAttributes,
  };
}

async function verifyFirearmAssets(results) {
  for (const [weaponId, contract] of Object.entries(FIREARM_ASSET_CONTRACTS)) {
    const evidence = await inspectFirearmAsset(contract);
    results.check(`assets.${weaponId}.authored-two-hand-reload-rig`, (
      evidence.bytes <= contract.maximumBytes
      && evidence.animationCount === 1
      && evidence.animationChannels >= contract.minimumChannels
      && Math.max(0, ...evidence.skinJointCounts) >= contract.minimumJoints
      && Math.abs(evidence.animationDurationSec - contract.gameplayDurationSec) <= 0.05
      && Object.values(evidence.requiredNames).every(Boolean)
      && Object.values(evidence.requiredAnimatedNodes).every(Boolean)
      && evidence.forbiddenNames.length === 0
    ), evidence);
  }
  const watch = await inspectAuthoredWatchAsset(AUTHORED_WATCH_ASSET_CONTRACT);
  results.check('assets.shared.authored-deagle-watch-static-contract', (
    watch.bytes <= AUTHORED_WATCH_ASSET_CONTRACT.maximumBytes
    && watch.nodeNames.length === 1
    && watch.nodeNames[0] === 'DeagleAuthoredWatch'
    && watch.meshNames.length === 1
    && watch.meshNames[0] === 'DeagleAuthoredWatch'
    && watch.primitiveCount === 2
    && AUTHORED_WATCH_ASSET_CONTRACT.requiredMaterials.every(
      (material) => watch.materials.includes(material),
    )
    && watch.animationCount === 0
    && watch.skinCount === 0
    && watch.skinAttributes.length === 0
  ), watch);
}

class VerificationFailure extends Error {
  constructor(id, details) {
    super(`Assertion failed: ${id}`);
    this.name = 'VerificationFailure';
    this.details = details;
  }
}

class Results {
  constructor(outputDir) {
    this.outputDir = outputDir;
    this.startedAt = new Date().toISOString();
    this.assertions = [];
    this.screenshots = [];
    this.readiness = [];
    this.status = 'running';
    this.error = null;
  }

  check(id, condition, details = {}) {
    const assertion = { id, pass: Boolean(condition), details };
    this.assertions.push(assertion);
    if (!condition) throw new VerificationFailure(id, details);
    return details;
  }

  async write() {
    await fs.mkdir(this.outputDir, { recursive: true });
    const payload = {
      schemaVersion: 3,
      status: this.status,
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      viewport: VIEWPORT,
      input: 'Chrome DevTools Protocol Input domain (native mouse/key/wheel)',
      audioObservation: 'Read-only CDP WebAudio/Media events, HTML audio state, and realtime data',
      appUrl: APP_URL,
      assertions: this.assertions,
      screenshots: this.screenshots,
      readiness: this.readiness,
      error: this.error,
    };
    await fs.writeFile(
      path.join(this.outputDir, 'results.json'),
      `${JSON.stringify(payload, null, 2)}\n`,
      'utf8',
    );
    return payload;
  }
}

class ProcessSupervisor {
  constructor() {
    this.children = new Map();
    this.stopping = false;
    this.unexpectedExit = null;
  }

  start(name, executable, args, extraEnv = {}) {
    const child = spawn(executable, args, {
      cwd: ROOT,
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const log = [];
    const remember = (source, chunk) => {
      const lines = chunk.toString().split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        log.push(`[${source}] ${line}`);
        if (log.length > 120) log.shift();
      }
    };
    child.stdout?.on('data', (chunk) => remember('stdout', chunk));
    child.stderr?.on('data', (chunk) => remember('stderr', chunk));
    child.once('error', (error) => {
      if (!this.stopping && !this.unexpectedExit) {
        this.unexpectedExit = new Error(`${name} process error: ${asError(error).message}`);
      }
    });
    child.once('exit', (code, signal) => {
      if (!this.stopping && !this.unexpectedExit) {
        this.unexpectedExit = new Error(
          `${name} exited unexpectedly code=${code ?? 'null'} signal=${signal ?? 'none'}`
            + `\n${log.join('\n')}`,
        );
      }
    });
    this.children.set(name, { child, log });
    return child;
  }

  assertHealthy() {
    if (this.unexpectedExit) throw this.unexpectedExit;
    for (const [name, managed] of this.children) {
      if (managed.child.exitCode !== null || managed.child.signalCode !== null) {
        throw new Error(`${name} is not running\n${managed.log.join('\n')}`);
      }
    }
  }

  logs() {
    return [...this.children.entries()]
      .flatMap(([name, managed]) => managed.log.map((line) => `[${name}] ${line}`))
      .slice(-180);
  }

  async stopAll() {
    this.stopping = true;
    const entries = [...this.children.values()].reverse();
    await Promise.all(entries.map(({ child }) => terminateManagedChild(child)));
    this.children.clear();
  }
}

class SyntheticGamePeer {
  constructor(socket) {
    this.socket = socket;
    this.messages = [];
    this.error = null;
    this.id = null;
    this.motion = null;
    this.motionTimer = null;
    this.lastPosition = [0, 0, 0];
    socket.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        if (message && typeof message.type === 'string') this.messages.push(message);
      } catch {
        // The game protocol is JSON-only; malformed data is surfaced by server closure.
      }
    });
    socket.on('error', (error) => {
      this.error = asError(error);
    });
  }

  static async connect(mapId) {
    const socket = new WebSocket('ws://127.0.0.1:8787/ws', {
      handshakeTimeout: 5_000,
      origin: APP_URL,
    });
    const peer = new SyntheticGamePeer(socket);
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    peer.send({
      type: 'join',
      mapId,
      name: 'Verifier Target',
      model: 'counterterrorist',
    });
    const joined = await peer.waitForMessage(
      (message) => message.type === 'joined',
      'synthetic peer join',
    );
    peer.id = joined.id;
    return peer;
  }

  send(payload) {
    if (this.socket.readyState !== WebSocket.OPEN) {
      throw this.error ?? new Error('Synthetic game peer is not open');
    }
    this.socket.send(JSON.stringify(payload));
  }

  async waitForMessage(predicate, description, timeoutMs = 5_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const match = this.messages.find(predicate);
      if (match) return match;
      if (this.error) throw this.error;
      await sleep(20);
    }
    throw new Error(`Timed out waiting for ${description}`);
  }

  setPose(position, velocity = [0, 0, 0], yaw = 0) {
    this.lastPosition = [...position];
    this.send({
      type: 'state',
      position,
      velocity,
      yaw,
      pitch: 0,
    });
  }

  startLinearMotion(origin, velocity, yaw) {
    this.stopMotion(false);
    this.motion = {
      origin: [...origin],
      velocity: [...velocity],
      yaw,
      startedAtMs: Date.now(),
    };
    const tick = () => {
      const position = this.positionAt(Date.now());
      this.setPose(position, velocity, yaw);
    };
    tick();
    this.motionTimer = setInterval(tick, 25);
    return this.motion;
  }

  positionAt(atMs) {
    if (!this.motion) return [...this.lastPosition];
    const elapsedSec = Math.max(0, atMs - this.motion.startedAtMs) / 1000;
    return this.motion.origin.map(
      (value, index) => value + this.motion.velocity[index] * elapsedSec,
    );
  }

  stopMotion(sendFinalState = true) {
    if (this.motionTimer) clearInterval(this.motionTimer);
    this.motionTimer = null;
    const finalPosition = this.motion ? this.positionAt(Date.now()) : this.lastPosition;
    const yaw = this.motion?.yaw ?? 0;
    this.motion = null;
    if (sendFinalState && this.socket.readyState === WebSocket.OPEN) {
      this.setPose(finalPosition, [0, 0, 0], yaw);
    }
  }

  async close() {
    this.stopMotion(false);
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.socket.terminate();
        resolve();
      }, 1_000);
      this.socket.once('close', () => {
        clearTimeout(timeout);
        resolve();
      });
      this.socket.close();
    });
  }
}

class CdpConnection {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    socket.on('message', (raw) => this.onMessage(raw));
    socket.on('close', () => {
      for (const { reject } of this.pending.values()) {
        reject(new Error('CDP socket closed'));
      }
      this.pending.clear();
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url, { handshakeTimeout: 5_000 });
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    return new CdpConnection(socket);
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }
    for (const listener of this.listeners) listener(message);
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params, sessionId }), (error) => {
        if (!error) return;
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.socket.terminate();
        resolve();
      }, 1_000);
      this.socket.once('close', () => {
        clearTimeout(timeout);
        resolve();
      });
      this.socket.close();
    });
  }
}

class NativeBrowser {
  constructor(cdp, targetId, sessionId, results) {
    this.cdp = cdp;
    this.targetId = targetId;
    this.sessionId = sessionId;
    this.results = results;
    this.cursor = { x: 800, y: 450 };
    this.fireJitter = 1;
    this.networkEvents = [];
    this.audioEvents = [];
    this.mediaEvents = [];
    this.inputEvents = [];
    this.audioContexts = new Map();
    this.consoleIssues = [];
    this.browserDiagnostics = [];
    this.latestSnapshot = null;
    this.localId = null;
    this.removeListener = cdp.onEvent((event) => this.handleEvent(event));
  }

  handleEvent(event) {
    if (event.sessionId !== this.sessionId) return;
    const issue = summarizeConsoleIssue(event);
    if (
      issue?.level === 'warning'
      && issue.text.startsWith('THREE.WebGLProgram: Program Info Log:')
    ) {
      this.browserDiagnostics.push({
        ...issue,
        classification: 'headless graphics-driver compiler warning',
      });
    } else if (issue) {
      this.consoleIssues.push(issue);
    }

    const webAudioKinds = {
      'WebAudio.contextCreated': 'context-created',
      'WebAudio.contextChanged': 'context-changed',
      'WebAudio.contextWillBeDestroyed': 'context-destroyed',
      'WebAudio.audioNodeCreated': 'node-created',
      'WebAudio.audioNodeWillBeDestroyed': 'node-destroyed',
      'WebAudio.audioParamCreated': 'param-created',
      'WebAudio.audioParamWillBeDestroyed': 'param-destroyed',
      'WebAudio.nodesConnected': 'nodes-connected',
      'WebAudio.nodesDisconnected': 'nodes-disconnected',
      'WebAudio.nodeParamConnected': 'node-param-connected',
      'WebAudio.nodeParamDisconnected': 'node-param-disconnected',
    };
    if (event.method.startsWith('Media.')) {
      this.mediaEvents.push({
        method: event.method,
        observedAtMs: Date.now(),
        ...event.params,
      });
    }

    const audioKind = webAudioKinds[event.method];
    if (audioKind) {
      const observed = { kind: audioKind, observedAtMs: Date.now(), ...event.params };
      this.audioEvents.push(observed);
      const context = event.params?.context;
      if (context?.contextId) this.audioContexts.set(context.contextId, context);
      if (audioKind === 'context-destroyed' && event.params?.contextId) {
        this.audioContexts.delete(event.params.contextId);
      }
    }

    if (
      event.method === 'Network.webSocketFrameReceived'
      || event.method === 'Network.webSocketFrameSent'
    ) {
      const payload = event.params?.response?.payloadData;
      if (typeof payload !== 'string' || payload.length === 0) return;
      try {
        const message = JSON.parse(payload);
        if (!message || typeof message.type !== 'string') return;
        const observed = {
          ...message,
          __direction: event.method.endsWith('Received') ? 'received' : 'sent',
          __observedAt: Date.now(),
        };
        this.networkEvents.push(observed);
        if (observed.type === 'joined' && observed.__direction === 'received') {
          this.localId = observed.id;
        }
        if (observed.type === 'snapshot' && observed.__direction === 'received') {
          this.latestSnapshot = observed;
        }
      } catch {
        // Vite HMR and websocket control frames are not game protocol JSON.
      }
    }
  }

  send(method, params = {}) {
    if (method.startsWith('Input.')) {
      this.inputEvents.push({ method, observedAtMs: Date.now(), ...params });
    }
    return this.cdp.send(method, params, this.sessionId);
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description
          ?? result.exceptionDetails.text
          ?? 'Runtime.evaluate failed',
      );
    }
    return result.result?.value;
  }

  async waitFor(description, probe, timeoutMs = 10_000, intervalMs = 50) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
      last = await probe();
      if (last) return last;
      await sleep(intervalMs);
    }
    throw new Error(`Timed out waiting for ${description}; last=${JSON.stringify(last)}`);
  }

  async waitForUi(predicate, description, timeoutMs = 10_000) {
    let observed = null;
    try {
      return await this.waitFor(description, async () => {
        observed = await this.ui();
        return predicate(observed) ? observed : null;
      }, timeoutMs);
    } catch (error) {
      throw new Error(`${asError(error).message}; ui=${JSON.stringify(observed)}`);
    }
  }

  async waitForNetwork(cursor, predicate, description, timeoutMs = 12_000) {
    return this.waitFor(description, () => {
      for (let i = cursor; i < this.networkEvents.length; i += 1) {
        const event = this.networkEvents[i];
        if (predicate(event)) return event;
      }
      return null;
    }, timeoutMs, 20);
  }

  async waitForFreshSnapshot(observedAt = 0, timeoutMs = 5_000) {
    return this.waitFor('fresh multiplayer snapshot', () => {
      const snapshot = this.latestSnapshot;
      return snapshot && snapshot.__observedAt > observedAt ? snapshot : null;
    }, timeoutMs, 25);
  }

  async ui() {
    return this.evaluate(`(() => {
      const marker = document.querySelector('.combat-hitmarker');
      const incoming = document.querySelector('.combat-incoming-cue');
      const menu = document.querySelector('.main-menu');
      const ammo = document.querySelector('.combat-ammo');
      const health = document.querySelector('.combat-health-text');
      const audio = document.querySelector('.combat-audio-status');
      const death = document.querySelector('.combat-death');
      const crosshair = document.querySelector('.crosshair');
      const active = document.activeElement;
      const activeElementEditable = Boolean(active && (
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)
        || active.isContentEditable
        || active.closest?.('[contenteditable="true"], [contenteditable=""]')
      ));
      return {
        pageUrl: location.href,
        viewport: [window.innerWidth, window.innerHeight, window.devicePixelRatio],
        scrollY: window.scrollY,
        documentFocused: document.hasFocus(),
        visibilityState: document.visibilityState,
        activeElementTag: active?.tagName ?? null,
        activeElementEditable,
        pointerLocked: Boolean(document.pointerLockElement),
        pointerTag: document.pointerLockElement?.tagName ?? null,
        menuDisplay: menu ? getComputedStyle(menu).display : null,
        ammo: ammo?.textContent ?? null,
        health: health?.textContent ?? null,
        audio: audio?.textContent ?? null,
        marker: marker ? {
          hidden: marker.hidden,
          className: marker.className,
          label: marker.getAttribute('aria-label'),
          text: marker.textContent,
          opacity: getComputedStyle(marker).opacity,
        } : null,
        incomingClass: incoming?.className ?? null,
        deathDisplay: death ? getComputedStyle(death).display : null,
        crosshair: crosshair ? {
          className: crosshair.className,
          transform: getComputedStyle(crosshair).transform,
          animations: crosshair.getAnimations().map((animation) => animation.playState),
        } : null,
      };
    })()`);
  }

  async activateTarget() {
    await this.cdp.send('Target.activateTarget', { targetId: this.targetId });
    await this.send('Page.bringToFront');
    const response = await this.cdp.send('Target.getTargetInfo', {
      targetId: this.targetId,
    });
    const pageUrl = await this.evaluate('location.href');
    return {
      targetInfo: response.targetInfo ?? null,
      pageUrl,
    };
  }

  async releaseMouseButton() {
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: this.cursor.x,
      y: this.cursor.y,
      button: 'left',
      buttons: 0,
      clickCount: 0,
      pointerType: 'mouse',
    });
    return {
      x: this.cursor.x,
      y: this.cursor.y,
      button: 'left',
      buttons: 0,
    };
  }

  async stabilizeAnimationFrames(frameCount = 3) {
    return this.evaluate(`new Promise((resolve) => {
      const frames = [];
      const next = (timestamp) => {
        frames.push(timestamp);
        if (frames.length >= ${frameCount}) {
          resolve({
            frameCount: frames.length,
            firstTimestamp: frames[0],
            lastTimestamp: frames[frames.length - 1],
          });
          return;
        }
        requestAnimationFrame(next);
      };
      requestAnimationFrame(next);
    })`);
  }

  async elementCenter(selector, includesText) {
    return this.evaluate(`(() => {
      const matches = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const element = ${includesText === undefined
        ? 'matches[0]'
        : `matches.find((candidate) => candidate.textContent?.includes(${JSON.stringify(includesText)}))`};
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (rect.width <= 0 || rect.height <= 0 || style.display === 'none') return null;
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        text: element.textContent,
      };
    })()`);
  }

  async nativeClick(selector, includesText) {
    const center = await this.waitFor(
      `${selector}${includesText ? ` containing ${includesText}` : ''}`,
      () => this.elementCenter(selector, includesText),
    );
    this.cursor = { x: center.x, y: center.y };
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: center.x,
      y: center.y,
      buttons: 0,
      pointerType: 'mouse',
    });
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: center.x,
      y: center.y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
      pointerType: 'mouse',
    });
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: center.x,
      y: center.y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
      pointerType: 'mouse',
    });
  }

  async keyDown(code, key, virtualKeyCode) {
    await this.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      code,
      key,
      windowsVirtualKeyCode: virtualKeyCode,
      nativeVirtualKeyCode: virtualKeyCode,
      autoRepeat: false,
      isKeypad: code.startsWith('Numpad'),
    });
  }

  async keyUp(code, key, virtualKeyCode) {
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      code,
      key,
      windowsVirtualKeyCode: virtualKeyCode,
      nativeVirtualKeyCode: virtualKeyCode,
      isKeypad: code.startsWith('Numpad'),
    });
  }

  async pressKey(code, key, virtualKeyCode, holdMs = 35) {
    await this.keyDown(code, key, virtualKeyCode);
    await sleep(holdMs);
    await this.keyUp(code, key, virtualKeyCode);
  }

  async holdKey(code, key, virtualKeyCode, holdMs) {
    await this.keyDown(code, key, virtualKeyCode);
    try {
      await sleep(holdMs);
    } finally {
      await this.keyUp(code, key, virtualKeyCode);
    }
  }

  async fire() {
    const wakeX = Math.max(1, Math.min(
      VIEWPORT.width - 2,
      this.cursor.x + this.fireJitter,
    ));
    this.fireJitter *= -1;
    // Chromium requires real pointer activity before some pointer-locked clicks.
    // Release at the wake point, then restore with buttons up so Chromium cannot
    // coalesce the compensating movement while a button is held.
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: wakeX,
      y: this.cursor.y,
      buttons: 0,
      pointerType: 'mouse',
    });
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: wakeX,
      y: this.cursor.y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
      pointerType: 'mouse',
    });
    await sleep(35);
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: wakeX,
      y: this.cursor.y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
      pointerType: 'mouse',
    });
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: this.cursor.x,
      y: this.cursor.y,
      buttons: 0,
      pointerType: 'mouse',
    });
  }


  async attackSecondary() {
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: this.cursor.x,
      y: this.cursor.y,
      button: 'right',
      buttons: 2,
      clickCount: 1,
      pointerType: 'mouse',
    });
    await sleep(35);
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: this.cursor.x,
      y: this.cursor.y,
      button: 'right',
      buttons: 0,
      clickCount: 1,
      pointerType: 'mouse',
    });
  }

  async fireOnceAndWaitForNetwork(cursor, predicate, description, readinessTrace = null) {
    const attempts = [];
    const inputStartedAtMs = Date.now();
    await this.fire();
    const inputCompletedAtMs = Date.now();
    try {
      const event = await this.waitForNetwork(cursor, predicate, description, 1_500);
      const observationEndedAtMs = Date.now();
      attempts.push({
        attemptNumber: 1,
        outcome: 'accepted',
        inputStartedAtMs,
        inputCompletedAtMs,
        observationEndedAtMs,
      });
      return {
        ...event,
        __nativeShotObservation: {
          provenancePolicy: 'first-attempt-only',
          authoritativeObservedAtMs: event.__observedAt,
          readinessId: readinessTrace?.id ?? null,
          attempts,
        },
      };
    } catch (error) {
      const failure = asError(error);
      const observationEndedAtMs = Date.now();
      attempts.push({
        attemptNumber: 1,
        outcome: 'failed',
        inputStartedAtMs,
        inputCompletedAtMs,
        observationEndedAtMs,
        failure: failure.message,
      });
      const ui = await this.ui();
      const ammoAfter = parseCombatAmmo(ui.ammo)?.ammo ?? null;
      const localShotObserved = this.networkEvents.slice(cursor).some((event) => (
        event.type === 'shot'
        && event.__direction === 'received'
        && event.playerId === this.localId
      ));
      const failureClassification = classifyNativeShotFailure({
        readiness: readinessTrace?.assessment ?? null,
        ammoBefore: readinessTrace?.assessment?.ammo ?? Number.NaN,
        ammoAfter,
        localShotObserved,
        uiAfter: ui,
      });
      const observation = {
        provenancePolicy: 'first-attempt-only',
        rejectionReason: 'retry-not-admissible-after-failed-native-input',
        failureClassification,
        readinessId: readinessTrace?.id ?? null,
        readinessStatus: readinessTrace?.status ?? null,
        readinessAssessment: readinessTrace?.assessment ?? null,
        ammo: ui.ammo,
        documentFocused: ui.documentFocused,
        visibilityState: ui.visibilityState,
        pointerLocked: ui.pointerLocked,
        menuDisplay: ui.menuDisplay,
        cursor: this.cursor,
        attempts,
        recentEvents: this.networkEvents.slice(cursor).slice(-8).map((event) => ({
          type: event.type,
          direction: event.__direction,
          weaponId: event.weaponId,
          playerId: event.playerId,
          shooterId: event.shooterId,
          result: event.result,
          observedAtMs: event.__observedAt,
        })),
      };
      throw new Error(
        `${failure.message}; retry-not-admissible: first-attempt-only native input failed`
        + `; restart the complete verifier from a fresh browser/session`
        + `; observation=${JSON.stringify(observation)}`,
      );
    }
  }

  async fireUnfiredInputAndWaitForNetwork(
    cursor,
    predicate,
    description,
    readinessTrace = null,
  ) {
    let eventCursor = cursor;
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const ammoBefore = (await this.ui()).ammo;
      try {
        return await this.fireOnceAndWaitForNetwork(
          eventCursor,
          predicate,
          description,
          readinessTrace,
        );
      } catch (error) {
        lastError = asError(error);
        const ui = await this.ui();
        if (ui.ammo !== ammoBefore || !ui.pointerLocked || attempt === 3) {
          throw lastError;
        }
        // The client sends `fire` only after local ammo is consumed. Unchanged
        // ammo proves there is no prior authoritative response that a fresh
        // cursor could later misattribute. This retry is for non-timing HUD
        // semantics only; surface timing always uses fireOnceAndWaitForNetwork.
        eventCursor = this.networkEvents.length;
      }
    }
    throw lastError ?? new Error(`Native mouse fire did not produce ${description}`);
  }

  async wheel(deltaY) {
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: this.cursor.x,
      y: this.cursor.y,
      deltaX: 0,
      deltaY,
      modifiers: 0,
      pointerType: 'mouse',
    });
  }

  async moveMouseRelative(deltaX, deltaY) {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(deltaX), Math.abs(deltaY)) / 180));
    const stepX = deltaX / steps;
    const stepY = deltaY / steps;
    for (let i = 0; i < steps; i += 1) {
      const x = Math.max(1, Math.min(VIEWPORT.width - 2, this.cursor.x + stepX));
      const y = Math.max(1, Math.min(VIEWPORT.height - 2, this.cursor.y + stepY));
      await this.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x,
        y,
        buttons: 0,
        pointerType: 'mouse',
      });
      this.cursor = { x, y };
      await sleep(20);
    }
  }

  currentPlayers() {
    const players = this.latestSnapshot?.players;
    if (!Array.isArray(players) || !this.localId) return null;
    const local = players.find((player) => player.id === this.localId);
    const bot = players.find((player) => String(player.id).startsWith('bot:') && player.alive);
    return local && bot ? { local, bot } : null;
  }

  async aimAtBot(height) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await this.waitFor('local and bot snapshot rows', () => this.currentPlayers());
      const { local, bot } = this.currentPlayers();
      const [lx, ly, lz] = local.position;
      const [bx, by, bz] = bot.position;
      const desiredYaw = Math.atan2(-(bx - lx), -(bz - lz));
      const desiredPitch = Math.atan2(by + height - (ly + 1.6), Math.hypot(bx - lx, bz - lz));
      const yawError = wrapAngle(desiredYaw - local.yaw);
      const pitchError = desiredPitch - local.pitch;
      if (Math.abs(yawError) < 0.006 && Math.abs(pitchError) < 0.006) {
        return { yawError, pitchError, target: [bx, by + height, bz] };
      }
      const before = this.latestSnapshot.__observedAt;
      await this.moveMouseRelative(-yawError / 0.0022, -pitchError / 0.0022);
      // A snapshot can already be in flight when CDP delivers the mouse event.
      // Wait through two 20 Hz server snapshots before closing the feedback loop
      // so the same correction is never applied twice.
      await sleep(120);
      await this.waitForFreshSnapshot(before);
    }
    const players = this.currentPlayers();
    throw new Error(`Could not aim at bot through native mouse movement: ${JSON.stringify(players)}`);
  }

  async aimAtWorld(point, correctionLeadMs = 0) {
    const attempts = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await this.waitFor('local snapshot row', () => {
        const players = this.latestSnapshot?.players;
        return Array.isArray(players) && players.some((player) => player.id === this.localId);
      });
      const local = this.latestSnapshot.players.find((player) => player.id === this.localId);
      const [lx, ly, lz] = local.position;
      const [tx, ty, tz] = point(local, 0);
      const desiredYaw = Math.atan2(-(tx - lx), -(tz - lz));
      const desiredPitch = Math.atan2(ty - (ly + 1.6), Math.hypot(tx - lx, tz - lz));
      const yawError = wrapAngle(desiredYaw - local.yaw);
      const pitchError = desiredPitch - local.pitch;
      attempts.push({
        current: [local.yaw, local.pitch],
        desired: [desiredYaw, desiredPitch],
        error: [yawError, pitchError],
        cursor: [this.cursor.x, this.cursor.y],
      });
      if (Math.abs(yawError) < 0.012 && Math.abs(pitchError) < 0.012) {
        return { yawError, pitchError, target: [tx, ty, tz] };
      }
      const [cx, cy, cz] = point(local, correctionLeadMs);
      const correctionYaw = Math.atan2(-(cx - lx), -(cz - lz));
      const correctionPitch = Math.atan2(cy - (ly + 1.6), Math.hypot(cx - lx, cz - lz));
      const correctionYawError = wrapAngle(correctionYaw - local.yaw);
      const correctionPitchError = correctionPitch - local.pitch;
      const before = this.latestSnapshot.__observedAt;
      await this.moveMouseRelative(
        -correctionYawError / 0.0022,
        -correctionPitchError / 0.0022,
      );
      await sleep(120);
      await this.waitForFreshSnapshot(before);
    }
    throw new Error(
      `Could not aim at world target through native mouse movement: ${JSON.stringify(attempts)}`,
    );
  }

  async screenshot(name, save = true) {
    const shot = await this.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    const buffer = Buffer.from(shot.data, 'base64');
    if (save) {
      await fs.mkdir(this.results.outputDir, { recursive: true });
      const file = `${name}.png`;
      await fs.writeFile(path.join(this.results.outputDir, file), buffer);
      if (!this.results.screenshots.includes(file)) {
        this.results.screenshots.push(file);
      }
    }
    return buffer;
  }


  async saveScreenshot(name, buffer) {
    await fs.mkdir(this.results.outputDir, { recursive: true });
    const file = `${name}.png`;
    await fs.writeFile(path.join(this.results.outputDir, file), buffer);
    if (!this.results.screenshots.includes(file)) this.results.screenshots.push(file);
  }

  async webAudioState() {
    const contexts = [];
    for (const context of this.audioContexts.values()) {
      const entry = { ...context, realtimeData: null };
      if (context.contextState === 'running') {
        const response = await this.send('WebAudio.getRealtimeData', {
          contextId: context.contextId,
        });
        entry.realtimeData = response.realtimeData;
      }
      contexts.push(entry);
    }
    return contexts;
  }


  async htmlAudioState() {
    const objectGroup = 'combat-html-audio-observation';
    const prototype = await this.send('Runtime.evaluate', {
      expression: 'HTMLAudioElement.prototype',
      objectGroup,
      returnByValue: false,
      silent: true,
    });
    const prototypeObjectId = prototype.result?.objectId;
    if (!prototypeObjectId) {
      throw new Error('CDP could not resolve HTMLAudioElement.prototype');
    }
    try {
      const objects = await this.send('Runtime.queryObjects', {
        prototypeObjectId,
        objectGroup,
      });
      const objectId = objects.objects?.objectId;
      if (!objectId) {
        throw new Error('CDP could not query live HTML audio elements');
      }
      const state = await this.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function () {
          return Array.from(this).map((audio) => ({
            src: audio.currentSrc || audio.src,
            paused: audio.paused,
            ended: audio.ended,
            currentTime: audio.currentTime,
            duration: audio.duration,
            volume: audio.volume,
            playbackRate: audio.playbackRate,
          }));
        }`,
        returnByValue: true,
        silent: true,
      });
      return Array.isArray(state.result?.value) ? state.result.value : [];
    } finally {
      await this.send('Runtime.releaseObjectGroup', { objectGroup });
    }
  }
}

function wrapAngle(angle) {
  let value = angle;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}

function positionDistance(a, b) {
  return Math.hypot(
    a.position[0] - b.position[0],
    a.position[1] - b.position[1],
    a.position[2] - b.position[2],
  );
}

function horizontalDirection(from, to) {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const length = Math.hypot(dx, dz);
  if (length <= 1e-6) throw new Error('Cannot resolve a horizontal direction from overlapping points');
  return [dx / length, 0, dz / length];
}

function addScaled(position, direction, distance) {
  return position.map((value, index) => value + direction[index] * distance);
}

function pointDistance(left, right) {
  return Math.hypot(
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2],
  );
}

function graphHasNodeCounts(summary, expected) {
  return Object.entries(expected).every(([nodeType, count]) => summary.nodeTypes[nodeType] === count);
}

function poseDifference(before, after) {
  if (!before || !after) return { position: Infinity, yaw: Infinity, pitch: Infinity };
  return {
    position: positionDistance(before, after),
    yaw: Math.abs(wrapAngle(after.yaw - before.yaw)),
    pitch: Math.abs(after.pitch - before.pitch),
  };
}

function hasElongatedEffect(evidence, minimumPixels = 18) {
  return evidence.components.some((component) => (
    component.pixels >= minimumPixels
    && component.majorSpan >= 10
    && component.elongation >= 2
  ));
}


function isCrosshairRenderingDelta(component) {
  const right = component.bounds.x + component.bounds.width;
  const bottom = component.bounds.y + component.bounds.height;
  return component.bounds.x >= 790
    && component.bounds.y >= 440
    && right <= 810
    && bottom <= 460
    && (component.bounds.width <= 8 || component.bounds.height <= 8);
}

function effectReturnedToBaseline(stable, immediate, cleaned, cleanedEffect) {
  return cleaned.meanDelta <= stable.meanDelta + 3
    && cleaned.meanDelta <= Math.max(0.1, immediate.meanDelta * 0.18)
    // A bounded one-count native click wake can shift high-contrast map edges
    // by one antialiased pixel without leaving any colored shot effect behind.
    && cleaned.changedPixels <= Math.max(12, immediate.changedPixels * 0.32)
    && !cleanedEffect.components.some((component) => (
      component.pixels >= 3 && !isCrosshairRenderingDelta(component)
    ));
}

async function waitForNetworkWithVisualBaseline(
  browser,
  cursor,
  predicate,
  description,
  timeoutMs,
) {
  const deadline = Date.now() + timeoutMs;
  const safeFrames = [];
  while (Date.now() < deadline) {
    const existing = browser.networkEvents.slice(cursor).find(predicate);
    if (existing) {
      if (safeFrames.length < 3) {
        throw new Error(`${description} arrived before three stable visual baseline frames`);
      }
      return {
        event: existing,
        controlBaseline: safeFrames.at(-3),
        baseline: safeFrames.at(-2),
      };
    }
    const frame = await browser.screenshot(`${description}-rolling-baseline`, false);
    const observed = browser.networkEvents.slice(cursor).find(predicate);
    if (observed) {
      if (safeFrames.length < 3) {
        throw new Error(`${description} arrived before three stable visual baseline frames`);
      }
      return {
        event: observed,
        controlBaseline: safeFrames.at(-3),
        baseline: safeFrames.at(-2),
      };
    }
    safeFrames.push(frame);
    if (safeFrames.length > 3) safeFrames.shift();
    await sleep(20);
  }
  throw new Error(`Timed out waiting for ${description} with a rolling visual baseline`);
}

function findBotMuzzleCue(evidence) {
  return evidence.components.find((component) => (
    component.pixels >= 24
    && component.pixels <= 150
    && component.bounds.width >= 8
    && component.bounds.height >= 3
    && component.centroid.x >= 740
    && component.centroid.x <= 790
    && component.centroid.y >= 430
    && component.centroid.y <= 465
    && component.elongation >= 3
    && component.maxBrightnessGain >= 400
  )) ?? null;
}

function followsWarningMissPath(trajectory) {
  if (!trajectory) return false;
  const deltaX = trajectory.to.centroid.x - trajectory.from.centroid.x;
  const deltaY = trajectory.to.centroid.y - trajectory.from.centroid.y;
  return trajectory.travelPixels >= 5
    && trajectory.radialProgressPixels >= 4
    && trajectory.toRadius >= 28
    && deltaX <= -5
    && Math.abs(deltaY) <= 12;
}

function followsIncomingHitPath(trajectory) {
  if (!trajectory) return false;
  const deltaX = trajectory.to.centroid.x - trajectory.from.centroid.x;
  const deltaY = trajectory.to.centroid.y - trajectory.from.centroid.y;
  return trajectory.travelPixels >= 15
    && trajectory.radialProgressPixels >= 15
    && trajectory.toRadius >= 28
    && deltaY >= 15
    && Math.abs(deltaX) <= 15
    && trajectory.to.centroid.y >= 480;
}

async function captureBotWorldCue(browser, baseline, controlBaseline, evidenceName) {
  const analysisOptions = {
    region: BOT_EFFECT_REGION,
    palette: 'warm',
    point: { x: 800, y: 450 },
    pointRadius: 72,
  };
  const controlEvidence = analyzeEffectRegions(controlBaseline, baseline, analysisOptions);
  const offsetsMs = [35, 120, 280, 500];
  const startedAt = Date.now();
  const samples = [];
  for (const offsetMs of offsetsMs) {
    const waitMs = startedAt + offsetMs - Date.now();
    if (waitMs > 0) await sleep(waitMs);
    const frame = await browser.screenshot(`${evidenceName}-${offsetMs}ms`, false);
    const evidence = analyzeEffectRegions(baseline, frame, analysisOptions);
    const elongated = hasElongatedEffect(evidence, 10);
    samples.push({
      offsetMs,
      frame,
      evidence,
      elongated,
      score: evidence.matchedPixels + evidence.pointPixels * 2 + (elongated ? 80 : 0),
    });
  }
  const best = [...samples].sort((left, right) => right.score - left.score)[0];
  const trajectory = measureEffectTrajectory(samples, {
    origin: { x: 800, y: 450 },
    maximumPixels: 250,
    minimumSecondPixels: 5,
    minimumSecondMajorSpan: 2.5,
    minimumSecondElongation: 1,
  });
  const muzzleCue = findBotMuzzleCue(samples[0].evidence);
  await browser.saveScreenshot(evidenceName, best.frame);
  return {
    best: {
      offsetMs: best.offsetMs,
      evidence: best.evidence,
      elongated: best.elongated,
    },
    controlEvidence,
    muzzleCue,
    trajectory,
    samples: samples.map((sample) => ({
      offsetMs: sample.offsetMs,
      evidence: sample.evidence,
      elongated: sample.elongated,
    })),
  };
}

async function assertPortFree(port) {
  const inUse = await new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(300);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
  if (inUse) throw new Error(`Required loopback port ${port} is already in use`);
}

async function waitForHttp(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = new Error('not attempted');
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      lastError = asError(error);
      await sleep(150);
    }
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError.message}`);
}

async function runOneShot(supervisor, name, args, timeoutMs) {
  const child = supervisor.start(name, process.execPath, args);
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`${name} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      child.once('exit', (code, signal) => {
        clearTimeout(timeout);
        if (code === 0) resolve();
        else reject(new Error(`${name} failed code=${code} signal=${signal ?? 'none'}`));
      });
    });
  } catch (error) {
    await terminateManagedChild(child);
    throw error;
  } finally {
    supervisor.children.delete(name);
    supervisor.unexpectedExit = null;
  }
}

async function launchRuntime(supervisor) {
  await Promise.all([assertPortFree(8787), assertPortFree(5174), assertPortFree(CDP_PORT)]);
  await runOneShot(
    supervisor,
    'assets',
    ['--import', 'tsx', 'tools/generate-sample-assets.ts'],
    30_000,
  );
  supervisor.start(
    'backend',
    process.execPath,
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
  supervisor.start(
    'vite',
    process.execPath,
    [VITE_ENTRY, '--host', '127.0.0.1', '--port', '5174', '--strictPort'],
    { VITE_ENABLE_COMBAT: 'true' },
  );
  await Promise.all([
    waitForHttp(APP_URL),
    waitForHttp('http://127.0.0.1:5174/api/leaderboard'),
  ]);
  supervisor.assertHealthy();
}

async function launchBrowser(supervisor, options, profileDir, results) {
  const browserExecutable = findBrowserExecutable(options.browserPath);
  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=Translate',
    '--window-size=1600,900',
    '--force-device-scale-factor=1',
  ];
  if (!options.headed) args.push('--headless=new');
  args.push('about:blank');
  supervisor.start('chrome', browserExecutable, args);
  const versionResponse = await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`);
  const version = await versionResponse.json();
  const cdp = await CdpConnection.connect(version.webSocketDebuggerUrl);
  const target = await cdp.send('Target.createTarget', {
    url: 'about:blank',
  });
  const attached = await cdp.send('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: true,
  });
  const browser = new NativeBrowser(cdp, target.targetId, attached.sessionId, results);
  await Promise.all([
    browser.send('Page.enable'),
    browser.send('Runtime.enable'),
    browser.send('Network.enable', { maxTotalBufferSize: 5_000_000 }),
    browser.send('Log.enable'),
    browser.send('Media.enable'),
    // The WebAudio domain only observes graph lifecycle and realtime context
    // state. It neither evaluates page code nor changes constructors/prototypes.
    browser.send('WebAudio.enable'),
  ]);
  await browser.send('Emulation.setDeviceMetricsOverride', {
    ...VIEWPORT,
    mobile: false,
    screenWidth: VIEWPORT.width,
    screenHeight: VIEWPORT.height,
    positionX: 0,
    positionY: 0,
    dontSetVisibleSize: false,
  });
  await cdp.send('Target.activateTarget', { targetId: target.targetId });
  await browser.send('Page.bringToFront');
  await browser.send('Page.navigate', { url: APP_URL });
  return { browser, cdp, targetId: target.targetId };
}

function localPlayer(browser) {
  const players = browser.latestSnapshot?.players;
  return Array.isArray(players)
    ? players.find((player) => player.id === browser.localId) ?? null
    : null;
}

async function equip(browser, weaponId) {
  const config = WEAPON_UI[weaponId];
  await browser.pressKey(...config.key);
  return browser.waitForUi(
    (ui) => ui.ammo?.startsWith(config.text),
    `${config.text} weapon HUD`,
  );
}

async function readinessStage(trace, id, operation) {
  const startedAtMs = Date.now();
  try {
    const details = await operation();
    trace.stages.push({
      id,
      status: 'pass',
      startedAtMs,
      completedAtMs: Date.now(),
      details,
    });
    return details;
  } catch (error) {
    const failure = asError(error);
    trace.status = 'fail';
    trace.failureStage = id;
    trace.stages.push({
      id,
      status: 'fail',
      startedAtMs,
      completedAtMs: Date.now(),
      error: failure.message,
    });
    throw new Error(
      `Native fire readiness failed at ${id}: ${failure.message}; readinessId=${trace.id}`,
    );
  }
}

async function prepareNativeFireReadiness(browser, results, weaponId, purpose) {
  const config = WEAPON_UI[weaponId];
  const trace = {
    id: `${purpose}-${results.readiness.length + 1}`,
    purpose,
    weaponId,
    status: 'preparing',
    failureStage: null,
    startedAtMs: Date.now(),
    completedAtMs: null,
    protocol: {
      targetActivation: 'Target.activateTarget + Page.bringToFront',
      pointerLockRecovery: 'ordinary visible Play click only',
      routingAcknowledgement: `${WEAPON_UI.knife.key[0]} HUD transition then ${config.key[0]} HUD transition`,
      ammoRecovery: 'ordinary R reload only when visible ammo is zero',
      gameplayInjection: false,
      retryTimedShot: false,
    },
    stages: [],
    assessment: null,
  };
  results.readiness.push(trace);

  try {
    await readinessStage(trace, 'target-activation', () => browser.activateTarget());
    await readinessStage(trace, 'focus-pointer-menu', async () => {
      const before = await browser.ui();
      let after = before;
      let reacquired = false;
      if (!before.pointerLocked || before.menuDisplay !== 'none') {
        after = await clickPlayUntilLocked(browser, 4_000, null);
        reacquired = true;
      }
      if (
        !after.documentFocused
        || after.visibilityState !== 'visible'
        || after.activeElementEditable
        || !after.pointerLocked
        || after.menuDisplay !== 'none'
      ) {
        throw new Error(`focus/menu state not ready: ${JSON.stringify(after)}`);
      }
      return { reacquired, before, after };
    });
    await readinessStage(trace, 'prior-mouse-release', () => browser.releaseMouseButton());

    const route = await readinessStage(trace, 'keyboard-routing', async () => {
      const inputStart = browser.inputEvents.length;
      const before = await browser.ui();
      await browser.pressKey(...WEAPON_UI.knife.key);
      const knife = await browser.waitForUi(
        (ui) => ui.ammo?.startsWith('Knife'),
        `${purpose} harmless knife routing acknowledgement`,
        1_500,
      );
      await browser.pressKey(...config.key);
      const weapon = await browser.waitForUi(
        (ui) => ui.ammo?.startsWith(config.text),
        `${purpose} firearm routing acknowledgement`,
        1_500,
      );
      return {
        acknowledged: true,
        before: before.ammo,
        knife: knife.ammo,
        weapon: weapon.ammo,
        inputEvents: browser.inputEvents.slice(inputStart).map((event) => ({
          method: event.method,
          type: event.type,
          code: event.code,
          key: event.key,
          observedAtMs: event.observedAtMs,
        })),
      };
    });
    const weaponEquippedAtMs = Date.now();

    const ammoRecovery = await readinessStage(trace, 'ammo-reload-state', async () => {
      let ui = await browser.ui();
      let parsed = parseCombatAmmo(ui.ammo);
      if (!parsed || parsed.weaponText !== config.text) {
        throw new Error(`unexpected weapon HUD: ${JSON.stringify(ui.ammo)}`);
      }
      let action = 'none';
      if (parsed.reloading) {
        action = 'wait-existing-visible-reload';
        ui = await browser.waitForUi(
          (candidate) => candidate.ammo === `${config.text}  ${config.magazine}`,
          `${purpose} existing reload completion`,
          5_500,
        );
        parsed = parseCombatAmmo(ui.ammo);
      }
      if (parsed?.ammo === 0) {
        action = 'wait-auto-reload';
        await browser.waitForUi(
          (candidate) => candidate.ammo?.includes('RELOADING'),
          `${purpose} zero-ammo auto-reload start`,
          1_000,
        );
        ui = await browser.waitForUi(
          (candidate) => candidate.ammo === `${config.text}  ${config.magazine}`,
          `${purpose} zero-ammo reload completion`,
          5_500,
        );
        parsed = parseCombatAmmo(ui.ammo);
      }
      if (!parsed || parsed.ammo <= 0 || parsed.reloading) {
        throw new Error(`firearm HUD did not recover: ${JSON.stringify(ui.ammo)}`);
      }
      return { action, finalAmmo: ui.ammo };
    });

    const cooldown = await readinessStage(trace, 'cooldown-equip-wait', async () => {
      const timerGuardMs = 25;
      const remainingMs = Math.max(
        0,
        config.fireReadyMs + timerGuardMs - (Date.now() - weaponEquippedAtMs),
      );
      if (remainingMs > 0) await sleep(remainingMs);
      return {
        weaponEquippedAtMs,
        requiredMs: config.fireReadyMs,
        timerGuardMs,
        waitedSinceEquipMs: Date.now() - weaponEquippedAtMs,
      };
    });

    const identity = await readinessStage(
      trace,
      'final-target-activation',
      () => browser.activateTarget(),
    );
    const released = await readinessStage(
      trace,
      'final-mouse-release',
      () => browser.releaseMouseButton(),
    );
    const frameStabilization = await readinessStage(
      trace,
      'frame-stabilization',
      () => browser.stabilizeAnimationFrames(3),
    );
    const uiSamples = await readinessStage(trace, 'ordinary-ui-stability', async () => {
      const first = await browser.ui();
      await sleep(40);
      const second = await browser.ui();
      return [first, second];
    });
    const assessment = assessNativeFireReadiness({
      expectedTargetId: browser.targetId,
      expectedUrl: APP_URL,
      expectedWeaponText: config.text,
      targetInfo: identity.targetInfo,
      pageUrl: identity.pageUrl,
      routeAcknowledged: route.acknowledged,
      priorButtonReleased: released.buttons === 0,
      stabilizedFrameCount: frameStabilization.frameCount,
      cooldownWaitMs: cooldown.waitedSinceEquipMs,
      requiredCooldownWaitMs: config.fireReadyMs,
      uiSamples,
    });
    trace.assessment = assessment;
    trace.protocolState = {
      identity,
      routeAcknowledged: route.acknowledged,
      priorButtonReleased: released.buttons === 0,
      stabilizedFrameCount: frameStabilization.frameCount,
      weaponEquippedAtMs,
      requiredCooldownWaitMs: config.fireReadyMs,
      uiSamples,
      ammoRecovery: ammoRecovery.action,
    };
    if (!assessment.ready) {
      await readinessStage(trace, `assessment-${assessment.failureStage}`, async () => {
        throw new Error(JSON.stringify(assessment));
      });
    }
    trace.status = 'ready';
    trace.completedAtMs = Date.now();
    return trace;
  } catch (error) {
    trace.completedAtMs = Date.now();
    if (trace.status !== 'fail') {
      trace.status = 'fail';
      trace.failureStage = trace.failureStage ?? 'unclassified-readiness';
    }
    throw error;
  }
}

async function confirmNativeFireReadiness(browser, trace) {
  const config = WEAPON_UI[trace.weaponId];
  const ui = await readinessStage(trace, 'post-baseline-ready-state', () => browser.ui());
  const state = trace.protocolState;
  const assessment = assessNativeFireReadiness({
    expectedTargetId: browser.targetId,
    expectedUrl: APP_URL,
    expectedWeaponText: config.text,
    targetInfo: state.identity.targetInfo,
    pageUrl: ui.pageUrl,
    routeAcknowledged: state.routeAcknowledged,
    priorButtonReleased: state.priorButtonReleased,
    stabilizedFrameCount: state.stabilizedFrameCount,
    cooldownWaitMs: Date.now() - state.weaponEquippedAtMs,
    requiredCooldownWaitMs: state.requiredCooldownWaitMs,
    uiSamples: [state.uiSamples.at(-1), ui],
  });
  trace.assessment = assessment;
  trace.completedAtMs = Date.now();
  if (!assessment.ready) {
    trace.status = 'fail';
    trace.failureStage = assessment.failureStage;
    throw new Error(
      `Native fire readiness changed after baseline at ${assessment.failureStage}`
      + `; readinessId=${trace.id}; assessment=${JSON.stringify(assessment)}`,
    );
  }
  trace.status = 'ready';
  return trace;
}

function mediaPlayEvents(events) {
  return events.flatMap((event) => (
    Array.isArray(event.events)
      ? event.events.filter((entry) => /play/i.test(String(entry?.value ?? '')))
      : []
  ));
}

async function equipKnifeFrom(browser, results, weaponId, evidenceName) {
  await equip(browser, weaponId);
  await sleep(460);
  await equip(browser, 'knife');
  const entering = await browser.screenshot(`${evidenceName}-entering`, false);
  await sleep(430);
  const settled = await browser.screenshot(evidenceName, true);
  const transition = measureNeutralSilhouette(entering, settled, {
    region: KNIFE_HAND_REGION,
    minLuma: 92,
    maxChroma: 62,
  });
  const ui = await browser.ui();
  results.check(`knife.equip-from-${weaponId}-settles-authored-rig`, (
    ui.ammo?.startsWith('Knife')
    && transition.beforePixels > 800
    && transition.afterPixels > 1_000
    && transition.dice > 0.2
    && transition.displacementScore > 1
  ), { ui: ui.ammo, transition });
  return settled;
}

async function verifyKnifeAttack(browser, results, kind, evidenceName) {
  await sleep(180);
  const baselineA = await browser.screenshot(`${evidenceName}-baseline-a`, false);
  await sleep(70);
  const baseline = await browser.screenshot(`${evidenceName}-baseline-b`, false);
  const networkCursor = browser.networkEvents.length;
  const audioCursor = browser.audioEvents.length;
  const mediaCursor = browser.mediaEvents.length;
  const inputCursor = browser.inputEvents.length;
  if (kind === 'primary') {
    await browser.fire();
  } else {
    await browser.attackSecondary();
  }
  const attack = await browser.waitForNetwork(
    networkCursor,
    (event) => event.type === 'attack'
      && event.__direction === 'sent'
      && event.kind === kind,
    `native knife ${kind} gameplay attack`,
    2_000,
  );
  await sleep(kind === 'primary' ? 105 : 155);
  const action = await browser.screenshot(evidenceName, true);
  const htmlAudioState = await browser.htmlAudioState();
  const activeKnifeAudio = htmlAudioState.filter((audio) => (
    /\/audio\/knife/i.test(String(audio.src))
    && Number(audio.volume) >= 0.28
    && Number(audio.volume) <= 0.34
    && Number(audio.playbackRate) >= 0.9
    && Number(audio.playbackRate) <= 0.94
    && !audio.paused
    && Number(audio.currentTime) > 0
  ));
  await sleep(kind === 'primary' ? 560 : 820);
  const recoveredA = await browser.screenshot(`${evidenceName}-recovered-a`, false);
  await sleep(70);
  const recovered = await browser.screenshot(`${evidenceName}-recovered`, false);
  const ui = await browser.ui();

  const idleControl = imageDifference(
    baselineA,
    baseline,
    KNIFE_VIEWMODEL_REGION,
    34,
  );
  const actionDifference = imageDifference(
    baseline,
    action,
    KNIFE_VIEWMODEL_REGION,
    34,
  );
  const recoveryControl = imageDifference(
    recoveredA,
    recovered,
    KNIFE_VIEWMODEL_REGION,
    34,
  );
  const recoveredFromIdle = imageDifference(
    baseline,
    recovered,
    KNIFE_VIEWMODEL_REGION,
    34,
  );
  const recoveredSilhouette = measureNeutralSilhouette(action, recovered, {
    region: KNIFE_HAND_REGION,
    minLuma: 92,
    maxChroma: 62,
  });
  const idleRecoverySilhouette = measureNeutralSilhouette(baseline, recovered, {
    region: KNIFE_HAND_REGION,
    minLuma: 92,
    maxChroma: 62,
  });
  const webAudio = summarizeWebAudioEvents(browser.audioEvents.slice(audioCursor));
  const mediaPlays = mediaPlayEvents(browser.mediaEvents.slice(mediaCursor));
  const nativeButtons = browser.inputEvents.slice(inputCursor).filter(
    (event) => event.method === 'Input.dispatchMouseEvent'
      && event.type === 'mousePressed',
  );

  results.check(`knife.${kind}.native-input-baked-action-and-audio`, (
    attack.kind === kind
    && nativeButtons.some((event) => event.button === (kind === 'primary' ? 'left' : 'right'))
    && activeKnifeAudio.length >= 1
    && actionDifference.changedPixels >= Math.max(
      600,
      idleControl.changedPixels * 1.15,
    )
    && actionDifference.meanDelta > idleControl.meanDelta + 0.2
  ), {
    attack,
    nativeButtons,
    mediaPlays,
    activeKnifeAudio,
    idleControl,
    actionDifference,
  });
  results.check(`knife.${kind}.smooth-recovery-to-visible-idle`, (
    recoveryControl.meanDelta < actionDifference.meanDelta * 0.35
    && recoveredFromIdle.meanDelta < actionDifference.meanDelta * 0.5
    && recoveredFromIdle.changedPixels < actionDifference.changedPixels * 0.5
    && idleRecoverySilhouette.dice > 0.22
    && idleRecoverySilhouette.distance < 35
    && idleRecoverySilhouette.afterPixels > idleRecoverySilhouette.beforePixels * 0.7
    && idleRecoverySilhouette.afterPixels < idleRecoverySilhouette.beforePixels * 1.3
    && recoveredSilhouette.afterPixels > 1_000
    && recoveredSilhouette.displacementScore > 1
  ), {
    recoveryControl,
    recoveredFromIdle,
    actionDifference,
    recoveredSilhouette,
    idleRecoverySilhouette,
  });
  results.check(`knife.${kind}.has-no-firearm-only-cues`, (
    ui.ammo?.startsWith('Knife')
    && !ui.ammo.includes('RELOADING')
    && !ui.crosshair?.className.includes('shot-deagle')
    && !ui.crosshair?.className.includes('shot-awp')
    && webAudio.createdNodeIds.length === 0
  ), { ui: { ammo: ui.ammo, crosshair: ui.crosshair }, webAudio });
  return recovered;
}

async function verifyKnifePresentation(browser, results) {
  await equip(browser, 'knife');
  await sleep(460);
  const idleA = await browser.screenshot('09-knife-idle-a', false);
  await sleep(80);
  const idle = await browser.screenshot('09-knife-idle', true);
  const idleControl = imageDifference(idleA, idle, KNIFE_VIEWMODEL_REGION, 34);
  const idleSilhouette = measureNeutralSilhouette(idleA, idle, {
    region: KNIFE_HAND_REGION,
    minLuma: 92,
    maxChroma: 62,
  });
  results.check('knife.idle.integrated-rig-visible-and-stable', (
    idleSilhouette.beforePixels > 1_000
    && idleSilhouette.afterPixels > 1_000
    && idleControl.meanDelta < 16
  ), { idleControl, idleSilhouette });

  const startSnapshot = await browser.waitForFreshSnapshot(0);
  const start = startSnapshot.players.find((player) => player.id === browser.localId);
  await browser.keyDown('KeyW', 'w', 87);
  await browser.keyDown('KeyD', 'd', 68);
  await sleep(260);
  const moving = await browser.screenshot('10-knife-movement', true);
  const movedSnapshot = await browser.waitForFreshSnapshot(startSnapshot.__observedAt);
  await browser.keyUp('KeyD', 'd', 68);
  await browser.keyUp('KeyW', 'w', 87);
  const moved = movedSnapshot.players.find((player) => player.id === browser.localId);
  const movement = measureNeutralSilhouette(idle, moving, {
    region: KNIFE_HAND_REGION,
    minLuma: 92,
    maxChroma: 62,
  });
  results.check('knife.move.native-strafe-and-agile-viewmodel-response', (
    positionDistance(start, moved) > 0.3
    && movement.beforePixels > 1_000
    && movement.afterPixels > 1_000
    && movement.displacementScore > 1.2
  ), { distance: positionDistance(start, moved), movement });
  await browser.keyDown('KeyS', 's', 83);
  await browser.keyDown('KeyA', 'a', 65);
  await sleep(260);
  await browser.keyUp('KeyA', 'a', 65);
  await browser.keyUp('KeyS', 's', 83);
  await sleep(280);

  const groundSnapshot = await browser.waitForFreshSnapshot(0);
  const groundedPlayer = groundSnapshot.players.find(
    (player) => player.id === browser.localId,
  );
  const ground = await browser.screenshot('knife-ground-before-jump', false);
  await browser.pressKey('Space', ' ', 32, 70);
  await sleep(100);
  const airborne = await browser.screenshot('knife-airborne', false);
  const airSnapshot = await browser.waitForFreshSnapshot(groundSnapshot.__observedAt);
  const airbornePlayer = airSnapshot.players.find(
    (player) => player.id === browser.localId,
  );
  await sleep(900);
  const landed = await browser.screenshot('knife-landed', false);
  const airDifference = imageDifference(ground, airborne, KNIFE_VIEWMODEL_REGION, 34);
  const landingSilhouette = measureNeutralSilhouette(airborne, landed, {
    region: KNIFE_HAND_REGION,
    minLuma: 92,
    maxChroma: 62,
  });
  results.check('knife.air.native-jump-and-bounded-landing-recovery', (
    airbornePlayer?.position[1] > groundedPlayer?.position[1] + 0.05
    && airDifference.changedPixels > 700
    && airDifference.meanDelta > 0.4
    && landingSilhouette.afterPixels > 1_000
    && landingSilhouette.displacementScore > 1
  ), {
    groundedY: groundedPlayer?.position[1] ?? null,
    airborneY: airbornePlayer?.position[1] ?? null,
    airDifference,
    landingSilhouette,
  });

  await equipKnifeFrom(browser, results, 'deagle', '11-knife-from-deagle');
  const referenceIdle = await equipKnifeFrom(
    browser,
    results,
    'awp',
    '12-knife-from-awp',
  );
  await verifyKnifeAttack(browser, results, 'primary', '13-knife-primary');
  await verifyKnifeAttack(browser, results, 'secondary', '14-knife-secondary');

  const reloadAudioCursor = browser.audioEvents.length;
  const reloadMediaCursor = browser.mediaEvents.length;
  await browser.pressKey('KeyR', 'r', 82);
  await sleep(160);
  const reloadUi = await browser.ui();
  const reloadHtmlAudio = await browser.htmlAudioState();
  const activeReloadKnifeAudio = reloadHtmlAudio.filter((audio) => (
    /\/audio\/knife/i.test(String(audio.src))
    && !audio.paused
    && Number(audio.currentTime) > 0
  ));
  const reloadAudio = summarizeWebAudioEvents(
    browser.audioEvents.slice(reloadAudioCursor),
  );
  const reloadMedia = mediaPlayEvents(browser.mediaEvents.slice(reloadMediaCursor));
  results.check('knife.reload-key-has-no-ammo-firearm-audio-or-reload-state', (
    reloadUi.ammo?.startsWith('Knife')
    && !reloadUi.ammo.includes('RELOADING')
    && reloadAudio.createdNodeIds.length === 0
    && reloadMedia.length === 0
    && activeReloadKnifeAudio.length === 0
  ), {
    ammo: reloadUi.ammo,
    reloadAudio,
    reloadMedia,
    activeReloadKnifeAudio,
  });

  for (const weaponId of ['deagle', 'awp', 'knife', 'deagle', 'knife']) {
    const config = WEAPON_UI[weaponId];
    await browser.pressKey(...config.key, 18);
    await browser.waitForUi(
      (ui) => ui.ammo?.startsWith(config.text),
      `rapid native ${weaponId} selection`,
      1_000,
    );
  }
  await browser.wheel(120);
  await browser.waitForUi(
    (ui) => ui.ammo?.startsWith('AWP'),
    'rapid knife wheel to AWP',
  );
  await browser.wheel(-120);
  await browser.waitForUi(
    (ui) => ui.ammo?.startsWith('Knife'),
    'rapid reverse wheel to knife',
  );
  await sleep(600);
  const rapidSettled = await browser.screenshot('15-knife-rapid-switch', true);
  const rapid = measureNeutralSilhouette(referenceIdle, rapidSettled, {
    region: KNIFE_HAND_REGION,
    minLuma: 92,
    maxChroma: 62,
  });
  results.check('knife.switch.rapid-keys-wheel-end-exclusive-and-deterministic', (
    rapid.beforePixels > 1_000
    && rapid.afterPixels > 1_000
    && rapid.dice > 0.3
    && rapid.distance < 5
    && rapid.afterPixels > rapid.beforePixels * 0.9
    && rapid.afterPixels < rapid.beforePixels * 1.1
  ), rapid);

  await browser.pressKey('Escape', 'Escape', 27);
  const menu = await browser.waitForUi(
    (ui) => !ui.pointerLocked && ui.menuDisplay !== 'none',
    'knife lifecycle menu exit',
    2_000,
  );
  const reentered = await clickPlayUntilLocked(browser, 4_000, 'Knife');
  await sleep(900);
  const reentry = await browser.screenshot('16-knife-menu-reentry', true);
  const reentrySilhouette = measureNeutralSilhouette(rapidSettled, reentry, {
    region: KNIFE_HAND_REGION,
    minLuma: 92,
    maxChroma: 62,
  });
  results.check('knife.lifecycle.escape-reentry-cleans-and-restores-only-knife', (
    !menu.pointerLocked
    && reentered.pointerLocked
    && reentered.ammo?.startsWith('Knife')
    && reentrySilhouette.afterPixels > 1_000
    && reentrySilhouette.dice > 0.15
    && reentrySilhouette.distance < 140
    && reentrySilhouette.afterPixels > reentrySilhouette.beforePixels * 0.7
    && reentrySilhouette.afterPixels < reentrySilhouette.beforePixels * 1.3
  ), { menu, reentered, reentrySilhouette });
}

async function verifyBackstabAndMovingAwp(browser, results) {
  const mapId = browser.latestSnapshot?.mapId;
  if (!mapId) throw new Error('Cannot create synthetic target without an active map');
  const sharedWatch = await browser.waitFor(
    'authored shared watch resource',
    async () => browser.evaluate(`(() => (
      performance.getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes('/viewmodels/shared/deagle-watch.glb'))
        ?? null
    ))()`),
    15_000,
  );
  results.check('viewmodels.authored-shared-watch-resource-loaded', true, {
    resource: sharedWatch,
  });
  const peer = await SyntheticGamePeer.connect(mapId);
  try {
    await equip(browser, 'knife');
    const initial = await browser.waitFor(
      'local player for synthetic backstab target',
      () => {
        const row = browser.latestSnapshot?.players?.find(
          (player) => player.id === browser.localId && player.alive,
        );
        return row ?? null;
      },
    );
    const forward = [-Math.sin(initial.yaw), 0, -Math.cos(initial.yaw)];
    const right = [-forward[2], 0, forward[0]];
    const nearTarget = addScaled(
      addScaled(initial.position, forward, 1.45),
      right,
      -0.45,
    );
    const frontFacingYaw = wrapAngle(initial.yaw + Math.PI);
    peer.setPose(nearTarget, [0, 0, 0], frontFacingYaw);
    await browser.waitFor('synthetic backstab target snapshot', () => {
      const row = browser.latestSnapshot?.players?.find((player) => player.id === peer.id);
      return row && Math.abs(wrapAngle(row.yaw - frontFacingYaw)) < 0.05 ? row : null;
    });
    await sleep(450);
    const baselineA = await browser.screenshot('17-knife-backstab-baseline-a', false);
    await sleep(80);
    const baseline = await browser.screenshot('17-knife-backstab-baseline', true);
    const idleControl = imageDifference(
      baselineA,
      baseline,
      { x: 850, y: 100, width: 750, height: 800 },
      28,
    );

    peer.setPose(nearTarget, [0, 0, 0], initial.yaw);
    await browser.waitFor('synthetic target facing away', () => {
      const row = browser.latestSnapshot?.players?.find((player) => player.id === peer.id);
      return row && Math.abs(wrapAngle(row.yaw - initial.yaw)) < 0.05 ? row : null;
    });
    await sleep(550);
    const ready = await browser.screenshot('17-knife-backstab-ready', true);

    peer.setPose(nearTarget, [0, 0, 0], frontFacingYaw);
    await browser.waitFor('synthetic target invalidating backstab', () => {
      const row = browser.latestSnapshot?.players?.find((player) => player.id === peer.id);
      return row && Math.abs(wrapAngle(row.yaw - frontFacingYaw)) < 0.05 ? row : null;
    });
    await sleep(700);
    const recovered = await browser.screenshot('17-knife-backstab-recovered', true);
    const activation = imageDifference(
      baseline,
      ready,
      { x: 850, y: 100, width: 750, height: 800 },
      28,
    );
    const recovery = imageDifference(
      baseline,
      recovered,
      { x: 850, y: 100, width: 750, height: 800 },
      28,
    );
    results.check('knife.backstab.network-target-raises-and-recovers-one-handed-stance', (
      activation.changedPixels > Math.max(4_000, idleControl.changedPixels * 2.5)
      && activation.meanDelta > Math.max(2, idleControl.meanDelta * 2.5)
      && recovery.changedPixels < activation.changedPixels * 0.65
      && recovery.meanDelta < activation.meanDelta * 0.45
    ), {
      targetId: peer.id,
      nearTarget,
      idleControl,
      activation,
      recovery,
    });

    const beforeReadiness = browser.currentPlayers();
    if (!beforeReadiness) throw new Error('Bot row unavailable before moving AWP target test');
    peer.setPose(addScaled(beforeReadiness.bot.position, right, -3), [0, 0, 0], initial.yaw);
    const readiness = await prepareNativeFireReadiness(
      browser,
      results,
      'awp',
      'moving-rendered-target',
    );
    await moveIntoLane(browser);
    const lanePlayers = await browser.waitFor(
      'local and bot rows in the open lane',
      () => browser.currentPlayers(),
    );
    const towardBot = horizontalDirection(lanePlayers.local.position, lanePlayers.bot.position);
    const lateral = [-towardBot[2], 0, towardBot[0]];
    const botDistance = pointDistance(lanePlayers.local.position, lanePlayers.bot.position);
    const targetDistance = Math.max(9, Math.min(14, botDistance - 3));
    const center = addScaled(lanePlayers.local.position, towardBot, targetDistance);
    const motionOrigin = addScaled(center, lateral, -2.5);
    const motionVelocity = lateral.map((value) => value * 5.5);
    peer.startLinearMotion(motionOrigin, motionVelocity, initial.yaw);
    const motionSnapshotCursor = browser.networkEvents.length;
    await sleep(260);
    await browser.waitFor('moving synthetic target snapshots', () => {
      const rows = browser.networkEvents
        .slice(motionSnapshotCursor)
        .filter((event) => event.type === 'snapshot' && event.__direction === 'received')
        .map((event) => event.players?.find((player) => player.id === peer.id))
        .filter(Boolean);
      return rows.length >= 3 && pointDistance(rows[0].position, rows.at(-1).position) > 0.7
        ? rows
        : null;
    });

    const presentationDelayMs = 71;
    const aim = await browser.aimAtWorld((_local, correctionLeadMs) => {
      const position = peer.positionAt(
        Date.now() - presentationDelayMs + correctionLeadMs,
      );
      return [position[0], position[1] + 1.18, position[2]];
    }, 130);
    await confirmNativeFireReadiness(browser, readiness);
    const fireCursor = browser.networkEvents.length;
    const shot = await browser.fireUnfiredInputAndWaitForNetwork(
      fireCursor,
      (event) =>
        event.type === 'shot'
        && event.__direction === 'received'
        && event.playerId === browser.localId,
      'native AWP shot against moving rendered target',
      readiness,
    );
    peer.stopMotion();
    await browser.screenshot('18-awp-moving-target-hit', true);
    const motionRows = browser.networkEvents
      .slice(motionSnapshotCursor, fireCursor)
      .filter((event) => event.type === 'snapshot' && event.__direction === 'received')
      .map((event) => event.players?.find((player) => player.id === peer.id))
      .filter(Boolean);
    const sentFire = browser.networkEvents
      .slice(fireCursor)
      .find((event) => event.type === 'fire' && event.__direction === 'sent');
    const observedRewindMs = sentFire
      ? sentFire.__observedAt - Number(sentFire.observedAtMs)
      : Number.NaN;
    const targetDisplacement = motionRows.length >= 2
      ? pointDistance(motionRows[0].position, motionRows.at(-1).position)
      : 0;
    results.check('awp.native-moving-rendered-target-hit-with-bounded-rewind', (
      shot.targetId === peer.id
      && (shot.result === 'hit' || shot.result === 'kill')
      && motionRows.length >= 3
      && targetDisplacement > 0.7
      && Number.isFinite(observedRewindMs)
      && observedRewindMs >= 50
      && observedRewindMs <= 180
    ), {
      targetId: peer.id,
      shot: {
        result: shot.result,
        targetId: shot.targetId,
        endpoint: shot.endpoint,
      },
      aim,
      motionOrigin,
      motionVelocity,
      motionSnapshots: motionRows.length,
      targetDisplacement,
      sentObservedAtMs: sentFire?.observedAtMs ?? null,
      sentFrameObservedAtMs: sentFire?.__observedAt ?? null,
      observedRewindMs,
    });
    await moveBehindCover(browser);
  } finally {
    await peer.close();
  }
}

async function verifyMovement(browser, results, weaponId) {
  const config = WEAPON_UI[weaponId];
  const startSnapshot = await browser.waitForFreshSnapshot(0);
  const start = startSnapshot.players.find((player) => player.id === browser.localId);
  const before = await browser.screenshot(`${weaponId}-move-before`, false);
  await browser.keyDown('KeyW', 'w', 87);
  await sleep(260);
  const moving = await browser.screenshot(`${weaponId}-moving`, false);
  const movedSnapshot = await browser.waitForFreshSnapshot(startSnapshot.__observedAt);
  await browser.keyUp('KeyW', 'w', 87);
  const moved = movedSnapshot.players.find((player) => player.id === browser.localId);
  await sleep(220);
  await browser.holdKey('KeyS', 's', 83, 260);
  await sleep(300);
  const silhouette = measureNeutralSilhouette(before, moving, {
    region: config.silhouetteRegion,
  });
  results.check(`${weaponId}.move.native-held-key-displacement`, positionDistance(start, moved) > 0.35, {
    distance: positionDistance(start, moved),
  });
  results.check(`${weaponId}.move.neutral-viewmodel-silhouette-shift`, (
    silhouette.beforePixels > 300
    && silhouette.afterPixels > 300
    && silhouette.displacementScore > (weaponId === 'deagle' ? 1 : 1.2)
  ), silhouette);
}

async function verifySurfaceShot(browser, results, weaponId, surface, saveEvidence) {
  const config = WEAPON_UI[weaponId];
  // Select normally before aiming. The complete target/focus/input-ready
  // handshake below re-acknowledges the slot without touching game objects.
  await equip(browser, weaponId);
  if (surface === 'wall') {
    await browser.aimAtWorld((local) => [local.position[0], local.position[1] + 1.6, 49.2]);
  } else {
    await browser.aimAtWorld((local) => [local.position[0], 0, local.position[2] - 1.4]);
  }
  await sleep(500);
  const readiness = await prepareNativeFireReadiness(
    browser,
    results,
    weaponId,
    `${weaponId}-${surface}`,
  );
  // Mouse aim and ordinary readiness recovery are complete before the stable
  // baseline pair. The post-baseline probe is read-only DOM state.
  const uiBefore = await browser.ui();
  const ammoBefore = Number(uiBefore.ammo?.match(/(\d+)/g)?.at(-1));
  const preSnapshot = await browser.waitForFreshSnapshot(0);
  const prePose = preSnapshot.players.find((player) => player.id === browser.localId);
  const baselineA = await browser.screenshot(`${weaponId}-${surface}-baseline-a`, false);
  await sleep(80);
  const baseline = await browser.screenshot(`${weaponId}-${surface}-baseline-b`, false);
  const stableWorld = imageDifference(baselineA, baseline, SHOT_EFFECT_REGION);
  const stableSilhouette = measureNeutralSilhouette(baselineA, baseline, {
    region: config.silhouetteRegion,
  });
  await confirmNativeFireReadiness(browser, readiness);

  const networkCursor = browser.networkEvents.length;
  const audioCursor = browser.audioEvents.length;
  const mediaCursor = browser.mediaEvents.length;
  const inputCursor = browser.inputEvents.length;
  const baselineCursor = { ...browser.cursor };
  const shot = await browser.fireOnceAndWaitForNetwork(
    networkCursor,
    (event) =>
      event.type === 'shot'
      && event.__direction === 'received'
      && event.playerId === browser.localId
      && event.weaponId === weaponId,
    `${weaponId} ${surface} authoritative shot`,
    readiness,
  );
  const authoritativeObservedAtMs = shot.__nativeShotObservation.authoritativeObservedAtMs;
  await sleep(18);
  const early = await browser.screenshot(
    `${saveEvidence ? (weaponId === 'deagle' ? '01' : '02') : 'temp'}-${weaponId}-${surface}`,
    saveEvidence,
  );
  const captureCompletedAtMs = Date.now();
  const nativeShotTiming = assessNativeShotCapture({
    attempts: shot.__nativeShotObservation.attempts,
    authoritativeObservedAtMs,
    captureCompletedAtMs,
    maximumLatencyMs: config.immediateCaptureMaxMs,
  });
  const shotHtmlAudio = await browser.htmlAudioState();
  const shotSamples = shotHtmlAudio.filter((audio) => (
    String(audio.src).endsWith(config.shotSample.path)
  ));
  const activeShotSample = shotSamples.find((audio) => (
    !audio.paused && !audio.ended && Number(audio.currentTime) > 0
  ));
  const shotMediaPlays = mediaPlayEvents(browser.mediaEvents.slice(mediaCursor));

  const impactRenderWaitMs = config.tracerLifetimeMs + 100;
  await sleep(impactRenderWaitMs);
  const lingering = await browser.screenshot(`${weaponId}-${surface}-impact-only`, false);
  const impactSampleAfterAcceptedShotMs = Date.now() - authoritativeObservedAtMs;

  const recoveryRenderWaitMs = Math.max(
    100,
    config.recoverMs - impactRenderWaitMs + 300,
  );
  await sleep(recoveryRenderWaitMs);
  const recoveredFrame = await browser.screenshot(`${weaponId}-${surface}-recovered`, false);
  const recoverySampleAfterAcceptedShotMs = Date.now() - authoritativeObservedAtMs;

  const cleanupWaitMs = weaponId === 'awp' ? 750 : 650;
  await sleep(cleanupWaitMs);
  const cleaned = await browser.screenshot(`${weaponId}-${surface}-cleaned`, false);
  const cleanupSampleAfterAcceptedShotMs = Date.now() - authoritativeObservedAtMs;
  const postSnapshot = await browser.waitForFreshSnapshot(preSnapshot.__observedAt);
  const postPose = postSnapshot.players.find((player) => player.id === browser.localId);
  const shotInputEvents = browser.inputEvents.slice(inputCursor);
  const uiAfter = await browser.ui();
  const ammoAfter = Number(uiAfter.ammo?.match(/(\d+)/g)?.at(-1));

  const audio = {
    ...summarizeWebAudioEvents(browser.audioEvents.slice(audioCursor)),
    sample: activeShotSample ?? null,
    poolSize: shotSamples.length,
    mediaPlays: shotMediaPlays.length,
  };
  const immediateDiff = imageDifference(baseline, early, SHOT_EFFECT_REGION);
  const cleanedDiff = imageDifference(baseline, cleaned, SHOT_EFFECT_REGION);
  const immediateEffect = analyzeEffectRegions(baseline, early, {
    region: SHOT_EFFECT_REGION,
    palette: config.palette,
    point: { x: 800, y: 450 },
    pointRadius: 55,
  });
  const lingeringEffect = analyzeEffectRegions(baseline, lingering, {
    region: SHOT_EFFECT_REGION,
    palette: config.palette,
    point: { x: 800, y: 450 },
    pointRadius: 55,
  });
  const cleanedEffect = analyzeEffectRegions(baseline, cleaned, {
    region: SHOT_EFFECT_REGION,
    palette: config.palette,
    point: { x: 800, y: 450 },
    pointRadius: 55,
  });
  const shotDisplacement = measureNeutralSilhouette(baseline, early, {
    region: config.actionSilhouetteRegion ?? config.silhouetteRegion,
  });
  const recovery = measureNeutralSilhouette(baseline, recoveredFrame, {
    region: config.silhouetteRegion,
  });
  const recoveredPoseDrift = poseDifference(prePose, postPose);
  const normal = shot.impactNormal;
  const expectedDirection = surface === 'ground'
    ? Array.isArray(normal) && normal[1] > 0.75
    : Array.isArray(normal) && Math.abs(normal[2]) > 0.7;

  results.check(`${weaponId}.${surface}.stable-pre-shot-world-and-viewmodel`, (
    stableWorld.changedPixels <= 45
    && stableWorld.meanDelta <= 0.25
    && stableSilhouette.beforePixels > 300
    && stableSilhouette.afterPixels > 300
    && stableSilhouette.distance <= 0.8
    && stableSilhouette.dice >= 0.975
  ), { world: stableWorld, silhouette: stableSilhouette });
  results.check(`${weaponId}.${surface}.native-fire-consumed-one-round`, ammoAfter === ammoBefore - 1, {
    ammoBefore,
    ammoAfter,
    shotResult: shot.result,
    attemptCount: nativeShotTiming.attemptCount,
    retryCount: nativeShotTiming.retryCount,
    failedAttempts: nativeShotTiming.failedAttempts,
    readinessId: readiness.id,
    readinessAssessment: readiness.assessment,
  });
  results.check(`${weaponId}.${surface}.authoritative-shot-resolved-surface-normal`, (
    Boolean(shot.endpoint) && expectedDirection
  ), {
    endpoint: shot.endpoint,
    impactNormal: shot.impactNormal,
    authoritativeOrigin: nativeShotTiming.authoritativeOrigin,
    authoritativeObservedAtMs,
  });
  results.check(`${weaponId}.${surface}.accepted-shot-bounded-immediate-colored-cue`, (
    nativeShotTiming.captureAccepted
    && config.immediateCaptureMaxMs < config.muzzleLifetimeMs
    && config.immediateCaptureMaxMs < config.tracerLifetimeMs
    && immediateEffect.matchedPixels >= 45
    && immediateEffect.components.some((component) => component.pixels >= 18)
  ), {
    nativeShotTiming,
    authoredEffectLifetimeMs: {
      muzzle: config.muzzleLifetimeMs,
      tracer: config.tracerLifetimeMs,
    },
    effect: immediateEffect,
    frameDifference: immediateDiff,
  });
  results.check(`${weaponId}.${surface}.accepted-shot-elongated-streak`, (
    hasElongatedEffect(immediateEffect, 18)
  ), immediateEffect);
  results.check(`${weaponId}.${surface}.post-tracer-resolved-impact-ring`, (
    lingeringEffect.pointPixels >= 18
    && lingeringEffect.pointAngularSectors >= 6
  ), {
    effect: lingeringEffect,
    tracerLifetimeMs: config.tracerLifetimeMs,
    impactRenderWaitMs,
    impactSampleAfterAcceptedShotMs,
  });
  results.check(`${weaponId}.${surface}.accepted-shot-recoil-recovers-to-baseline`, (
    shotDisplacement.beforePixels > 300
    && shotDisplacement.afterPixels > 300
    && shotDisplacement.distance >= 2
    && shotDisplacement.displacementScore > 4
    && recoverySampleAfterAcceptedShotMs >= config.recoverMs
    && recovery.distance <= 1.5
    && recovery.dice >= 0.95
    && recovery.displacementScore <= shotDisplacement.displacementScore * 0.45
  ), {
    immediateRecoil: shotDisplacement,
    recovered: recovery,
    authoredRecoveryMs: config.recoverMs,
    recoveryRenderWaitMs,
    recoverySampleAfterAcceptedShotMs,
  });
  results.check(`${weaponId}.${surface}.post-expiry-region-near-stable-baseline`, (
    effectReturnedToBaseline(stableWorld, immediateDiff, cleanedDiff, cleanedEffect)
  ), {
    stableBaseline: stableWorld,
    baselineToImmediate: immediateDiff,
    baselineToCleaned: cleanedDiff,
    cleanedEffect,
    cleanupWaitMs,
    cleanupSampleAfterAcceptedShotMs,
  });
  results.check(`${weaponId}.${surface}.read-only-cdp-shot-sample`, (
    activeShotSample
    && shotSamples.length === config.shotSample.poolSize
    && Math.abs(Number(activeShotSample.volume) - config.shotSample.volume) < 1e-6
    && Number(activeShotSample.playbackRate) === 1
    && audio.createdNodeIds.length === 0
  ), audio);
  results.check(`${weaponId}.${surface}.fixed-position-and-bounded-native-click-wake`, (
    recoveredPoseDrift.position <= 0.02
    && recoveredPoseDrift.yaw <= 0.0023
    && recoveredPoseDrift.pitch <= 0.001
    && nativeShotTiming.attemptCount === 1
    && nativeShotTiming.retryCount === 0
    && shotInputEvents.length === 4
    && shotInputEvents.every((event, index) => {
      const phase = index % 4;
      if (event.method !== 'Input.dispatchMouseEvent' || event.y !== baselineCursor.y) return false;
      if (phase === 0) {
        return event.type === 'mouseMoved'
          && Math.abs(event.x - baselineCursor.x) === 1;
      }
      if (phase === 1) {
        const wakeEvent = shotInputEvents[index - 1];
        return event.type === 'mousePressed' && event.x === wakeEvent.x;
      }
      if (phase === 2) {
        const wakeEvent = shotInputEvents[index - 1];
        return event.type === 'mouseReleased' && event.x === wakeEvent.x;
      }
      return event.type === 'mouseMoved' && event.x === baselineCursor.x;
    })
  ), {
    recoveredPoseDrift,
    baselineCursor,
    attemptCount: nativeShotTiming.attemptCount,
    retryCount: nativeShotTiming.retryCount,
    failedAttempts: nativeShotTiming.failedAttempts,
    readinessId: readiness.id,
    readinessAssessment: readiness.assessment,
    inputEvents: shotInputEvents.map((event) => ({
      method: event.method,
      type: event.type,
      x: event.x,
      y: event.y,
      observedAtMs: event.observedAtMs,
    })),
  });

  return {
    baseline,
    early,
    lingering,
    cleaned,
    shot,
    nativeShotTiming,
    shotDisplacement,
    recovery,
    recoveryRenderWaitMs,
    recoverySampleMs: recoverySampleAfterAcceptedShotMs,
    stableSilhouette,
    audio,
  };
}

async function verifyReload(browser, results, weaponId) {
  const config = WEAPON_UI[weaponId];
  await browser.stabilizeAnimationFrames(2);
  const baseline = await browser.screenshot(`${weaponId}-reload-baseline`, false);
  const audioCursor = browser.audioEvents.length;
  const mediaCursor = browser.mediaEvents.length;
  const reloadStartedAt = Date.now();
  await browser.pressKey('KeyR', 'r', 82);
  const reloading = await browser.waitForUi(
    (ui) => ui.ammo?.includes('RELOADING'),
    `${weaponId} reload start`,
  );
  await sleep(config.reloadSample.probeDelayMs);
  const reloadHtmlAudio = await browser.htmlAudioState();
  const reloadSamples = reloadHtmlAudio.filter((audio) => (
    String(audio.src).endsWith(config.reloadSample.path)
  ));
  const activeReloadSample = reloadSamples.find((audio) => (
    !audio.paused && !audio.ended && Number(audio.currentTime) > 0
  ));
  const reloadMediaPlays = mediaPlayEvents(browser.mediaEvents.slice(mediaCursor));
  const activeFrame = await browser.screenshot(`03-${weaponId}-reload`, true);
  const reloadMotion = measureNeutralSilhouette(baseline, activeFrame, {
    region: config.actionSilhouetteRegion ?? config.silhouetteRegion,
  });
  await sleep(800);
  const insertionFrame = await browser.screenshot(`04-${weaponId}-reload-insertion`, true);
  const insertionMotion = measureNeutralSilhouette(baseline, insertionFrame, {
    region: config.actionSilhouetteRegion ?? config.silhouetteRegion,
  });
  const phaseTravel = Math.hypot(
    insertionMotion.dx - reloadMotion.dx,
    insertionMotion.dy - reloadMotion.dy,
  );
  results.check(`${weaponId}.reload-hud-active`, reloading.ammo.includes('RELOADING'), {
    ammo: reloading.ammo,
  });
  results.check(`${weaponId}.reload-authored-hand-magazine-silhouette-motion`, (
    reloadMotion.beforePixels > 300
    && reloadMotion.afterPixels > 300
    && reloadMotion.displacementScore > 1.4
    && insertionMotion.beforePixels > 300
    && insertionMotion.afterPixels > 300
    && insertionMotion.displacementScore > 1.4
    && phaseTravel > 1
  ), {
    removal: reloadMotion,
    insertion: insertionMotion,
    phaseTravel,
  });
  const complete = await browser.waitForUi(
    (ui) => ui.ammo === `${config.text}  ${config.magazine}`,
    `${weaponId} reload completion`,
    5_500,
  );
  const actionDurationMs = Date.now() - reloadStartedAt;
  const audio = {
    ...summarizeWebAudioEvents(browser.audioEvents.slice(audioCursor)),
    sample: activeReloadSample ?? null,
    poolSize: reloadSamples.length,
    mediaPlays: reloadMediaPlays.length,
    actionDurationMs,
  };
  results.check(`${weaponId}.read-only-cdp-reload-cues`, (
    activeReloadSample
    && reloadSamples.length === config.reloadSample.poolSize
    && Number(activeReloadSample.currentTime) >= config.reloadSample.activeCueStartSec
    && Math.abs(
      Number(activeReloadSample.volume) - config.reloadSample.activeCueVolume
    ) < 1e-6
    && Number(activeReloadSample.playbackRate) === 1
    && audio.createdNodeIds.length === 0
  ), audio);
  results.check(`${weaponId}.reload-refilled-magazine`, complete.ammo.endsWith(String(config.magazine)), {
    ammo: complete.ammo,
  });
  await browser.stabilizeAnimationFrames(2);
  const recoveredFrame = await browser.screenshot(`${weaponId}-reload-recovered`, false);
  const reloadRecovery = measureNeutralSilhouette(baseline, recoveredFrame, {
    region: config.silhouetteRegion,
  });
  results.check(`${weaponId}.reload-recovers-neutral-silhouette`, (
    reloadRecovery.beforePixels > 300
    && reloadRecovery.afterPixels > 300
    && reloadRecovery.distance <= 1.5
    && reloadRecovery.dice >= 0.95
    && reloadRecovery.displacementScore < reloadMotion.displacementScore * 0.5
  ), { active: reloadMotion, recovered: reloadRecovery });
  return audio;
}

async function verifyWeaponMatrix(browser, results, weaponId) {
  const config = WEAPON_UI[weaponId];
  await equip(browser, weaponId);
  await sleep(320);
  const idle = await browser.screenshot(`${weaponId}-idle`, false);
  const idleSilhouette = measureNeutralSilhouette(idle, idle, {
    region: config.silhouetteRegion,
  });
  const selectedUi = await browser.ui();
  results.check(`${weaponId}.selected-and-neutral-viewmodel-present`, (
    selectedUi.ammo.startsWith(config.text)
    && idleSilhouette.beforePixels > 300
  ), { ammo: selectedUi.ammo, neutralPixels: idleSilhouette.beforePixels });

  await verifyMovement(browser, results, weaponId);
  const wall = await verifySurfaceShot(browser, results, weaponId, 'wall', weaponId === 'deagle');
  await browser.pressKey(...WEAPON_UI.knife.key);
  await browser.waitForUi((ui) => ui.ammo?.startsWith('Knife'), 'knife inter-shot reset');
  await equip(browser, weaponId);
  const ground = await verifySurfaceShot(browser, results, weaponId, 'ground', weaponId === 'awp');
  const immediate = wall.shotDisplacement;
  const recovered = wall.recovery;
  results.check(`${weaponId}.isolated-neutral-silhouette-shot-displacement`, (
    immediate.beforePixels > 300
    && immediate.afterPixels > 300
    && immediate.distance >= 0.65
    && immediate.displacementScore >= wall.stableSilhouette.displacementScore + 1
  ), {
    stable: wall.stableSilhouette,
    immediate,
  });
  results.check(`${weaponId}.neutral-silhouette-recovers-after-authored-render-wait`, (
    recovered.beforePixels > 300
    && recovered.afterPixels > 300
    && recovered.distance <= 1.25
    && recovered.dice >= 0.95
    && recovered.displacementScore <= immediate.displacementScore * 0.45
  ), {
    immediate,
    recovered,
    minimumAuthoredRecoveryMs: config.recoverMs,
    recoveryRenderWaitMs: wall.recoveryRenderWaitMs,
    hostObservationMs: wall.recoverySampleMs,
  });

  const reloadAudio = await verifyReload(browser, results, weaponId);
  await browser.pressKey(...WEAPON_UI.knife.key);
  const knife = await browser.waitForUi((ui) => ui.ammo?.startsWith('Knife'), 'knife switch');
  results.check(`${weaponId}.native-slot-switch-selects-knife`, knife.ammo.startsWith('Knife'), {
    ammo: knife.ammo,
  });
  await equip(browser, weaponId);
  return { shotDisplacement: immediate, reloadAudio };
}

async function moveBehindCover(browser) {
  await browser.holdKey('KeyA', 'a', 65, 370);
  await sleep(420);
}

async function moveIntoLane(browser) {
  await browser.holdKey('KeyD', 'd', 68, 370);
  await sleep(420);
}

async function verifySmoothPointerLook(browser, results) {
  await browser.moveMouseRelative(1, 0);
  await sleep(140);
  const initialSnapshot = await browser.waitForFreshSnapshot(0);
  let previous = initialSnapshot.players.find((player) => player.id === browser.localId);
  const initial = previous;
  const samples = [];

  for (const movementX of [48, 48, -96]) {
    const observedAt = browser.latestSnapshot.__observedAt;
    await browser.moveMouseRelative(movementX, 0);
    await sleep(140);
    const snapshot = await browser.waitForFreshSnapshot(observedAt);
    const current = snapshot.players.find((player) => player.id === browser.localId);
    const yawDelta = wrapAngle(current.yaw - previous.yaw);
    const expectedYawDelta = -movementX * 0.0022;
    samples.push({
      movementX,
      yawDelta,
      expectedYawDelta,
      yawError: Math.abs(wrapAngle(yawDelta - expectedYawDelta)),
      pitchDelta: current.pitch - previous.pitch,
    });
    previous = current;
  }

  const netDrift = poseDifference(initial, previous);
  results.check('input.pointer-lock-native-look-is-smooth-and-unsnapped', (
    samples.every((sample) => (
      sample.yawError <= 0.025
      && Math.abs(sample.pitchDelta) <= 0.01
      && Math.sign(sample.yawDelta) === Math.sign(sample.expectedYawDelta)
    ))
    && netDrift.position <= 0.02
    && netDrift.yaw <= 0.025
    && netDrift.pitch <= 0.01
  ), { samples, netDrift });
}

async function clickPlayUntilLocked(browser, firstAttemptMs = 6_000, expectedWeapon = 'Knife') {
  let entered = null;
  let entryError = null;
  for (let attempt = 0; attempt < 3 && !entered; attempt += 1) {
    await browser.nativeClick('.menu-play-btn');
    try {
      entered = await browser.waitForUi(
        (ui) =>
          ui.pointerLocked
          && ui.menuDisplay === 'none'
          && ui.audio === 'AUDIO READY'
          && (expectedWeapon === null
            ? typeof ui.ammo === 'string' && ui.ammo.length > 0
            : ui.ammo?.startsWith(expectedWeapon)),
        'pointer-locked combat range with running audio',
        attempt === 0 ? firstAttemptMs : 3_500,
      );
    } catch (error) {
      entryError = asError(error);
      const ui = await browser.ui();
      if (ui.pointerLocked) throw entryError;
    }
  }
  if (!entered) throw entryError ?? new Error('Could not enter the pointer-locked combat range');
  return entered;
}

async function verifyHitmarkers(browser, results) {
  await equip(browser, 'deagle');
  let readiness = await prepareNativeFireReadiness(
    browser,
    results,
    'deagle',
    'hitmarker-body',
  );
  await moveIntoLane(browser);
  await browser.aimAtBot(1.18);
  await sleep(500);
  await confirmNativeFireReadiness(browser, readiness);

  let cursor = browser.networkEvents.length;
  let audioCursor = browser.audioEvents.length;
  const body = await browser.fireUnfiredInputAndWaitForNetwork(
    cursor,
    (event) =>
      event.type === 'hit'
      && event.__direction === 'received'
      && event.shooterId === browser.localId,
    'native body hit',
    readiness,
  );
  const bodyUi = await browser.waitForUi(
    (ui) => ui.marker?.label === 'Body hit',
    'body hitmarker',
    1_000,
  );
  const bodyAudio = summarizeWebAudioEvents(browser.audioEvents.slice(audioCursor));
  results.check('hitmarker.body-ui-and-one-extra-confirm-oscillator-graph', (
    body.hitbox === 'body'
    && body.killed === false
    && bodyUi.marker.label === 'Body hit'
    && bodyAudio.nodeTypes.Oscillator === 3
  ), {
    hit: { hitbox: body.hitbox, killed: body.killed },
    marker: bodyUi.marker,
    readOnlyCdpAudio: bodyAudio,
  });

  await moveBehindCover(browser);
  await browser.pressKey(...WEAPON_UI.knife.key);
  await browser.waitForUi((ui) => ui.ammo?.startsWith('Knife'), 'knife reset after body hit');
  await equip(browser, 'deagle');
  readiness = await prepareNativeFireReadiness(
    browser,
    results,
    'deagle',
    'hitmarker-body-kill',
  );
  await moveIntoLane(browser);
  await browser.aimAtBot(1.18);
  await sleep(500);
  await confirmNativeFireReadiness(browser, readiness);
  cursor = browser.networkEvents.length;
  audioCursor = browser.audioEvents.length;
  const bodyKill = await browser.fireUnfiredInputAndWaitForNetwork(
    cursor,
    (event) =>
      event.type === 'hit'
      && event.__direction === 'received'
      && event.shooterId === browser.localId,
    'native body kill',
    readiness,
  );
  const killUi = await browser.waitForUi(
    (ui) => ui.marker?.label === 'Kill confirmed',
    'kill hitmarker',
    1_000,
  );
  const killAudio = summarizeWebAudioEvents(browser.audioEvents.slice(audioCursor));
  results.check('hitmarker.kill-ui-and-two-extra-confirm-oscillator-graph', (
    bodyKill.hitbox === 'body'
    && bodyKill.killed === true
    && killUi.marker.label === 'Kill confirmed'
    && killAudio.nodeTypes.Oscillator === 4
  ), {
    hit: { hitbox: bodyKill.hitbox, killed: bodyKill.killed },
    marker: killUi.marker,
    readOnlyCdpAudio: killAudio,
  });
  await moveBehindCover(browser);
  const respawnCursor = browser.networkEvents.length;
  const respawn = await browser.waitForNetwork(
    respawnCursor,
    (event) =>
      event.type === 'respawn'
      && event.__direction === 'received'
      && String(event.playerId).startsWith('bot:'),
    'bot respawn after body kill',
    5_000,
  );
  await sleep(3_650);
  await browser.pressKey(...WEAPON_UI.knife.key);
  await browser.waitForUi((ui) => ui.ammo?.startsWith('Knife'), 'knife reset before headshot');
  await equip(browser, 'deagle');
  readiness = await prepareNativeFireReadiness(
    browser,
    results,
    'deagle',
    'hitmarker-headshot',
  );
  await moveIntoLane(browser);
  await browser.aimAtBot(1.7);
  await sleep(500);
  await confirmNativeFireReadiness(browser, readiness);
  cursor = browser.networkEvents.length;
  audioCursor = browser.audioEvents.length;
  const head = await browser.fireUnfiredInputAndWaitForNetwork(
    cursor,
    (event) =>
      event.type === 'hit'
      && event.__direction === 'received'
      && event.shooterId === browser.localId,
    'native lethal headshot',
    readiness,
  );
  const headUi = await browser.waitForUi(
    (ui) => ui.marker?.label === 'Headshot',
    'headshot marker phase',
    1_000,
  );
  await browser.screenshot('04-headshot-marker', true);
  const headKillUi = await browser.waitForUi(
    (ui) => ui.marker?.label === 'Kill confirmed',
    'lethal headshot kill phase',
    1_000,
  );
  const headAudio = summarizeWebAudioEvents(browser.audioEvents.slice(audioCursor));
  results.check('hitmarker.lethal-headshot-phases-and-one-confirm-oscillator-graph', (
    head.hitbox === 'head'
    && head.killed === true
    && headUi.marker.label === 'Headshot'
    && headKillUi.marker.label === 'Kill confirmed'
    && headAudio.nodeTypes.Oscillator === 3
  ), {
    respawn: respawn.playerId,
    headshotMarker: headUi.marker,
    killMarker: headKillUi.marker,
    readOnlyCdpAudio: headAudio,
  });
  await browser.waitForUi(
    (ui) =>
      ui.marker?.hidden === true
      && ui.marker.label === null
      && ui.marker.text === ''
      && ui.marker.opacity === '0',
    'cleared hitmarker accessibility state',
    2_000,
  );
  const cleared = await browser.ui();
  results.check('hitmarker.expired-dom-state-cleared', (
    cleared.marker.hidden
    && !cleared.marker.label
    && cleared.marker.text === ''
    && cleared.marker.opacity === '0'
  ), {
    marker: cleared.marker,
  });
  await moveBehindCover(browser);
}

async function verifyBotEncounter(browser, results) {
  await browser.waitFor(
    'live bot snapshot before encounter',
    () => {
      const players = browser.currentPlayers();
      return players?.bot && Number(players.bot.health) > 0 ? players.bot : null;
    },
    5_000,
  );
  const blockedUiBefore = await browser.ui();
  const blockedCursor = browser.networkEvents.length;
  await sleep(3_800);
  const blockedShots = browser.networkEvents.slice(blockedCursor).filter(
    (event) =>
      event.type === 'shot'
      && event.__direction === 'received'
      && String(event.playerId).startsWith('bot:'),
  );
  const blockedUi = await browser.ui();
  results.check('bot.blocked-los-has-no-new-shot-or-damage', (
    blockedShots.length === 0 && blockedUi.health === blockedUiBefore.health
  ), {
    blockedDurationMs: 3_800,
    botShots: blockedShots.length,
    healthBefore: blockedUiBefore.health,
    healthAfter: blockedUi.health,
  });

  await equip(browser, 'knife');
  await sleep(430);
  await moveIntoLane(browser);
  await browser.aimAtBot(1.18);
  const aliveKnife = await browser.screenshot('knife-alive-before-death', false);
  let cursor = browser.networkEvents.length;
  const warningStage = await waitForNetworkWithVisualBaseline(
    browser,
    cursor,
    (event) =>
      event.type === 'shot'
      && event.__direction === 'received'
      && String(event.playerId).startsWith('bot:'),
    'bot warning shot after peek',
    8_000,
  );
  const warning = warningStage.event;
  const warningCue = await captureBotWorldCue(
    browser,
    warningStage.baseline,
    warningStage.controlBaseline,
    '05-bot-warning-miss',
  );
  results.check('bot.warning-miss-timed-muzzle-and-leftward-path', (
    warning.result === 'miss'
    && warningCue.best.evidence.matchedPixels >= Math.max(
      28,
      warningCue.controlEvidence.matchedPixels * 2 + 12,
    )
    && warningCue.best.evidence.pointPixels >= 12
    && warningCue.best.elongated
    && warningCue.muzzleCue !== null
    && followsWarningMissPath(warningCue.trajectory)
    && warningCue.best.evidence.components.some((component) => component.pixels >= 12)
  ), {
    result: warning.result,
    endpoint: warning.endpoint,
    ...warningCue,
  });

  cursor = browser.networkEvents.indexOf(warning) + 1;
  const nonfatalStage = await waitForNetworkWithVisualBaseline(
    browser,
    cursor,
    (event) =>
      event.type === 'shot'
      && event.__direction === 'received'
      && String(event.playerId).startsWith('bot:')
      && event.result === 'hit',
    'bot nonfatal body shot',
    8_000,
  );
  const nonfatal = nonfatalStage.event;
  const nonfatalUi = await browser.waitForUi(
    (ui) => ui.health === '37' && ui.incomingClass.includes('nonfatal'),
    'bot nonfatal player-facing cue',
    1_000,
  );
  const nonfatalCue = await captureBotWorldCue(
    browser,
    nonfatalStage.baseline,
    nonfatalStage.controlBaseline,
    '06-bot-nonfatal-hit',
  );
  results.check('bot.nonfatal-hit-timed-incoming-path-and-health', (
    nonfatal.result === 'hit'
    && nonfatalUi.health === '37'
    && nonfatalUi.incomingClass.includes('nonfatal')
    && nonfatalCue.best.evidence.matchedPixels >= Math.max(
      28,
      nonfatalCue.controlEvidence.matchedPixels * 2 + 12,
    )
    && nonfatalCue.best.evidence.pointPixels >= 12
    && nonfatalCue.best.elongated
    && followsIncomingHitPath(nonfatalCue.trajectory)
    && nonfatalCue.best.evidence.components.some((component) => component.pixels >= 12)
  ), {
    health: nonfatalUi.health,
    incomingClass: nonfatalUi.incomingClass,
    ...nonfatalCue,
  });

  cursor = browser.networkEvents.indexOf(nonfatal) + 1;
  const fatalStage = await waitForNetworkWithVisualBaseline(
    browser,
    cursor,
    (event) =>
      event.type === 'shot'
      && event.__direction === 'received'
      && String(event.playerId).startsWith('bot:')
      && event.result === 'kill',
    'bot fatal body shot',
    10_000,
  );
  const fatal = fatalStage.event;
  const fatalUi = await browser.waitForUi(
    (ui) => ui.health === '0' && ui.incomingClass.includes('fatal'),
    'bot fatal player-facing cue',
    1_000,
  );
  const fatalCue = await captureBotWorldCue(
    browser,
    fatalStage.baseline,
    fatalStage.controlBaseline,
    '07-bot-fatal-hit',
  );
  const deathUi = await browser.waitForUi(
    (ui) => ui.deathDisplay === 'block',
    'delayed death presentation',
    1_500,
  );
  const deadKnife = await browser.screenshot('17-knife-death-cleanup', true);
  const deathVisibility = measureNeutralSilhouette(aliveKnife, deadKnife, {
    region: KNIFE_HAND_REGION,
    minLuma: 92,
    maxChroma: 62,
  });
  results.check('knife.lifecycle.death-hides-knife-without-stale-firearm', (
    deathVisibility.beforePixels > 1_000
    && deathVisibility.afterPixels < deathVisibility.beforePixels * 0.55
  ), deathVisibility);
  results.check('bot.fatal-hit-timed-incoming-path-and-death', (
    fatal.result === 'kill'
    && fatalUi.health === '0'
    && fatalUi.incomingClass.includes('fatal')
    && deathUi.deathDisplay === 'block'
    && fatalCue.best.evidence.matchedPixels >= Math.max(
      28,
      fatalCue.controlEvidence.matchedPixels * 2 + 12,
    )
    && fatalCue.best.evidence.pointPixels >= 12
    && fatalCue.best.elongated
    && followsIncomingHitPath(fatalCue.trajectory)
    && fatalCue.best.evidence.components.some((component) => component.pixels >= 12)
  ), {
    health: fatalUi.health,
    incomingClass: fatalUi.incomingClass,
    deathDisplay: deathUi.deathDisplay,
    ...fatalCue,
  });
  const respawnUi = await browser.waitForUi(
    (ui) => ui.health === '100' && ui.ammo?.startsWith('Knife'),
    'player respawn with knife',
    5_000,
  );
  await sleep(430);
  const respawnKnife = await browser.screenshot('18-knife-respawn', true);
  const respawnVisibility = measureNeutralSilhouette(deadKnife, respawnKnife, {
    region: KNIFE_HAND_REGION,
    minLuma: 92,
    maxChroma: 62,
  });
  results.check('knife.lifecycle.respawn-restores-clean-knife-equip', (
    respawnUi.health === '100'
    && respawnUi.ammo?.startsWith('Knife')
    && respawnVisibility.afterPixels > deathVisibility.afterPixels * 2
    && respawnVisibility.afterPixels > 1_000
  ), { respawnUi, respawnVisibility });
}

async function verifyWheelAndMenu(browser, results, phase) {
  await equip(browser, 'awp');
  await browser.wheel(120);
  const forward = await browser.waitForUi(
    (ui) => ui.ammo?.startsWith('Desert Eagle'),
    'native wheel forward AWP-to-Deagle',
    1_000,
  );
  await browser.wheel(-120);
  const reverse = await browser.waitForUi(
    (ui) => ui.ammo?.startsWith('AWP'),
    'native wheel reverse Deagle-to-AWP',
    1_000,
  );
  results.check(`input.${phase}.wheel-forward-reverse-wrap`, forward.ammo.startsWith('Desert Eagle')
    && reverse.ammo.startsWith('AWP'), {
    forward: forward.ammo,
    reverse: reverse.ammo,
  });

  await browser.pressKey('Escape', 'Escape', 27);
  const menu = await browser.waitForUi(
    (ui) => !ui.pointerLocked && ui.menuDisplay !== 'none',
    'Escape menu',
    2_000,
  );
  results.check(`input.${phase}.escape-unlocks-and-shows-menu`, (
    !menu.pointerLocked && menu.menuDisplay !== 'none'
  ), {
    pointerLocked: menu.pointerLocked,
    menuDisplay: menu.menuDisplay,
  });
  const reentered = await clickPlayUntilLocked(browser, 4_000, null);
  await browser.screenshot('08-menu-reentry', true);
  results.check(`input.${phase}.menu-reentry-pointer-lock`, reentered.pointerLocked
    && reentered.menuDisplay === 'none', {
    menuDisplay: reentered.menuDisplay,
    pointerTag: reentered.pointerTag,
  });
}

async function runBrowserMatrix(browser, results, supervisor) {
  await browser.waitFor(
    'main menu',
    () => browser.elementCenter('.menu-play-btn'),
    20_000,
  );
  const menuLayout = await browser.evaluate(`(() => {
    const readRect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        right: rect.right,
        bottom: rect.bottom,
      };
    };
    return {
      viewport: [window.innerWidth, window.innerHeight, window.devicePixelRatio],
      documentScrollHeight: document.documentElement.scrollHeight,
      shell: readRect('.menu-shell'),
      stage: readRect('.menu-stage'),
      canvas: readRect('.character-preview-canvas'),
    };
  })()`);
  const fitsViewport = (rect) => rect
    && rect.x >= -0.5
    && rect.y >= -0.5
    && rect.right <= menuLayout.viewport[0] + 0.5
    && rect.bottom <= menuLayout.viewport[1] + 0.5;
  results.check('menu.character-stage-contained-in-desktop-viewport', (
    menuLayout.viewport[0] === 1600
    && menuLayout.viewport[1] === 900
    && menuLayout.viewport[2] === 1
    && fitsViewport(menuLayout.shell)
    && fitsViewport(menuLayout.stage)
    && fitsViewport(menuLayout.canvas)
    && menuLayout.stage.width >= 700
    && menuLayout.stage.height >= 700
    && Math.abs(menuLayout.canvas.width - menuLayout.stage.width) <= 1
    && Math.abs(menuLayout.canvas.height - menuLayout.stage.height) <= 1
    && menuLayout.documentScrollHeight <= menuLayout.viewport[1]
  ), menuLayout);
  const menuAssets = await browser.waitFor(
    'menu character and knife resources',
    async () => {
      const resources = await browser.evaluate(`(() => {
        const names = performance.getEntriesByType('resource').map((entry) => entry.name);
        return {
          player: names.find((name) => name.includes('/playermodels/terrorist.glb')) ?? null,
          knife: names.find((name) => name.includes('/viewmodels/knife/knife.glb')) ?? null,
        };
      })()`);
      return resources.player && resources.knife ? resources : null;
    },
    15_000,
  );
  results.check('menu.character-and-knife-assets-loaded-before-evidence', true, menuAssets);
  await sleep(350);
  await browser.stabilizeAnimationFrames(3);
  await browser.screenshot('00-menu-character-framing', true);
  const selected = await browser.evaluate(`(() => {
    const selected = document.querySelector('.menu-map-card.is-selected');
    return selected?.textContent ?? null;
  })()`);
  if (!selected?.includes('Movement Test Scene')) {
    await browser.nativeClick('.menu-map-card', 'Movement Test Scene');
  }
  const entered = await clickPlayUntilLocked(browser, 12_000);
  results.check('environment.desktop-dpr1-native-play-state', (
    entered.viewport[0] === 1600
    && entered.viewport[1] === 900
    && entered.viewport[2] === 1
    && entered.pointerLocked
    && entered.pointerTag === 'CANVAS'
    && entered.menuDisplay === 'none'
    && entered.scrollY === 0
  ), entered);
  await browser.waitFor('browser multiplayer identity', () => browser.localId);
  await browser.waitFor('live local and bot snapshot', () => browser.currentPlayers(), 15_000);
  supervisor.assertHealthy();

  await moveBehindCover(browser);
  await verifySmoothPointerLook(browser, results);
  await verifyKnifePresentation(browser, results);
  await verifyBackstabAndMovingAwp(browser, results);
  await moveBehindCover(browser);
  const blockedStart = browser.networkEvents.length;
  const deagleProfile = await verifyWeaponMatrix(browser, results, 'deagle');
  const awpProfile = await verifyWeaponMatrix(browser, results, 'awp');
  const shotResponseVectorDifference = Math.hypot(
    deagleProfile.shotDisplacement.dx - awpProfile.shotDisplacement.dx,
    deagleProfile.shotDisplacement.dy - awpProfile.shotDisplacement.dy,
  );
  results.check('weapons.isolated-shot-response-silhouette-profiles-differ', (
    shotResponseVectorDifference >= 0.8
    && Math.abs(
      deagleProfile.shotDisplacement.displacementScore
      - awpProfile.shotDisplacement.displacementScore
    ) >= 0.6
  ), {
    deagle: deagleProfile.shotDisplacement,
    awp: awpProfile.shotDisplacement,
    shotResponseVectorDifference,
  });
  const reloadSamplesDistinct = (
    deagleProfile.reloadAudio.sample?.src !== awpProfile.reloadAudio.sample?.src
    && deagleProfile.reloadAudio.poolSize === 4
    && awpProfile.reloadAudio.poolSize === 4
  );
  results.check('audio.read-only-cdp-reload-actions-have-distinct-samples-and-timing', (
    reloadSamplesDistinct
    && deagleProfile.reloadAudio.actionDurationMs >= 3_200
    && deagleProfile.reloadAudio.actionDurationMs <= 3_650
    && awpProfile.reloadAudio.actionDurationMs >= deagleProfile.reloadAudio.actionDurationMs + 40
    && awpProfile.reloadAudio.actionDurationMs <= 3_800
  ), {
    deagle: deagleProfile.reloadAudio,
    awp: awpProfile.reloadAudio,
    reloadSamplesDistinct,
  });

  const matrixBotShots = browser.networkEvents.slice(blockedStart).filter(
    (event) =>
      event.type === 'shot'
      && event.__direction === 'received'
      && String(event.playerId).startsWith('bot:'),
  );
  results.check('bot.cover-prevents-shots-through-firearm-matrix', matrixBotShots.length === 0, {
    botShots: matrixBotShots.length,
  });
  await verifyWheelAndMenu(browser, results, 'matrix');

  // Re-entry resets the ordinary range. Return to cover before the fresh reaction window expires.
  await moveBehindCover(browser);
  await verifyHitmarkers(browser, results);
  await verifyWheelAndMenu(browser, results, 'pre-bot');
  await moveBehindCover(browser);
  await verifyBotEncounter(browser, results);
  await verifyWheelAndMenu(browser, results, 'post-bot');

  const finalUi = await browser.ui();
  results.check('environment.final-scroll-zero-and-pointer-locked', (
    finalUi.scrollY === 0 && finalUi.pointerLocked
  ), {
    scrollY: finalUi.scrollY,
    pointerLocked: finalUi.pointerLocked,
  });
  const contexts = await browser.webAudioState();
  const runningContexts = contexts.filter((context) => context.contextState === 'running');
  const graph = summarizeWebAudioEvents(browser.audioEvents);
  results.check('audio.read-only-cdp-running-context-and-graph-activity', (
    runningContexts.length >= 1
    && runningContexts.every((context) => (
      Number.isFinite(context.realtimeData?.currentTime)
      && context.realtimeData.currentTime > 0
      && Number.isFinite(context.realtimeData?.renderCapacity)
    ))
    && graph.createdNodeIds.length >= 80
    && graph.connections >= 80
  ), {
    observation: 'CDP WebAudio events plus WebAudio.getRealtimeData; no page preload or API patching',
    contexts,
    graph,
  });
  results.check('console.application-has-no-actionable-issues', browser.consoleIssues.length === 0, {
    issues: browser.consoleIssues,
    browserDiagnostics: browser.browserDiagnostics,
  });
  supervisor.assertHealthy();
}

async function main() {
  const options = parseCombatBrowserOptions();
  const results = new Results(options.outputDir);
  const supervisor = new ProcessSupervisor();
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'webstrafe-chrome-profile-'));
  let cdp = null;
  let targetId = null;
  let browser = null;
  let timeout = null;
  let exitCode = 1;
  let interruptedSignal = null;
  const interrupt = (signal) => {
    if (interruptedSignal) return;
    interruptedSignal = signal;
    supervisor.unexpectedExit = new Error(
      `Combat browser verification interrupted by ${signal}`,
    );
    void cdp?.send('Browser.close').catch(() => {});
    void supervisor.stopAll();
  };
  const onSigInt = () => interrupt('SIGINT');
  const onSigTerm = () => interrupt('SIGTERM');
  process.once('SIGINT', onSigInt);
  process.once('SIGTERM', onSigTerm);
  try {
    timeout = setTimeout(() => {
      supervisor.unexpectedExit = new Error(
        `Combat browser verification exceeded ${options.timeoutMs}ms`,
      );
      void cdp?.send('Browser.close').catch(() => {});
    }, options.timeoutMs);
    await verifyFirearmAssets(results);
    await launchRuntime(supervisor);
    const launched = await launchBrowser(supervisor, options, profileDir, results);
    ({ cdp, targetId, browser } = launched);
    await runBrowserMatrix(browser, results, supervisor);
    results.status = 'pass';
    exitCode = 0;
  } catch (error) {
    const failure = asError(error);
    results.status = 'fail';
    results.error = {
      name: failure.name,
      message: failure.message,
      details: error instanceof VerificationFailure ? error.details : undefined,
      runtimeLogs: supervisor.logs(),
      consoleIssues: browser?.consoleIssues ?? [],
      browserDiagnostics: browser?.browserDiagnostics ?? [],
      recentAudioEvents: browser?.audioEvents.slice(-20) ?? [],
      readiness: results.readiness.at(-1) ?? null,
    };
  } finally {
    process.off('SIGINT', onSigInt);
    process.off('SIGTERM', onSigTerm);
    if (timeout) clearTimeout(timeout);
    browser?.removeListener();
    if (cdp && targetId) {
      await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
    }
    if (cdp) {
      await cdp.send('Browser.close').catch(() => {});
      await cdp.close().catch(() => {});
    }
    await supervisor.stopAll();
    await fs.rm(profileDir, { recursive: true, force: true }).catch(() => {});
    const payload = await results.write();
    const concise = {
      status: payload.status,
      assertions: payload.assertions.length,
      failed: payload.assertions.filter((assertion) => !assertion.pass).map((item) => item.id),
      screenshots: payload.screenshots,
      readiness: payload.readiness.map((item) => ({
        id: item.id,
        status: item.status,
        failureStage: item.failureStage,
        ammoRecovery: item.protocolState?.ammoRecovery ?? null,
      })),
      outputDir: options.outputDir,
      error: payload.error?.message ?? null,
      cleanup: 'owned backend, Vite, and Chrome stopped',
    };
    console.log(`[combat-browser] RESULT ${JSON.stringify(concise)}`);
  }
  process.exitCode = exitCode;
}

main().catch((error) => {
  console.error('[combat-browser] FATAL', asError(error).message);
  process.exitCode = 1;
});
