import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';

export const DEFAULT_COMBAT_BROWSER_TIMEOUT_MS = 180_000;
export const MIN_COMBAT_BROWSER_TIMEOUT_MS = 30_000;
export const MAX_COMBAT_BROWSER_TIMEOUT_MS = 600_000;

function parseInteger(raw, name, fallback, min, max) {
  const value = raw === undefined ? String(fallback) : raw;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new Error(`${name} must be a base-10 integer from ${min} to ${max}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be a safe integer from ${min} to ${max}`);
  }
  return parsed;
}

export function parseCombatBrowserOptions(env = process.env, now = new Date()) {
  const timeoutMs = parseInteger(
    env.COMBAT_BROWSER_TIMEOUT_MS,
    'COMBAT_BROWSER_TIMEOUT_MS',
    DEFAULT_COMBAT_BROWSER_TIMEOUT_MS,
    MIN_COMBAT_BROWSER_TIMEOUT_MS,
    MAX_COMBAT_BROWSER_TIMEOUT_MS,
  );
  if (
    env.COMBAT_BROWSER_HEADED !== undefined
    && env.COMBAT_BROWSER_HEADED !== '0'
    && env.COMBAT_BROWSER_HEADED !== '1'
  ) {
    throw new Error('COMBAT_BROWSER_HEADED must be 0 or 1');
  }
  const stamp = now.toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const outputDir = path.resolve(
    env.COMBAT_BROWSER_OUTPUT
      ?? path.join(os.tmpdir(), 'webstrafe-combat-browser', stamp),
  );
  return {
    timeoutMs,
    headed: env.COMBAT_BROWSER_HEADED === '1',
    outputDir,
    browserPath: env.CHROME_PATH,
  };
}

export function assessNativeShotCapture({
  attempts,
  authoritativeObservedAtMs,
  captureCompletedAtMs,
  maximumLatencyMs,
}) {
  const summarizedAttempts = attempts.map((attempt) => ({
    attemptNumber: attempt.attemptNumber,
    outcome: attempt.outcome,
    inputStartedAtMs: attempt.inputStartedAtMs,
    inputCompletedAtMs: attempt.inputCompletedAtMs,
    observationEndedAtMs: attempt.observationEndedAtMs,
    inputDurationMs: attempt.inputCompletedAtMs - attempt.inputStartedAtMs,
    observationWaitMs: attempt.observationEndedAtMs - attempt.inputCompletedAtMs,
    totalAttemptMs: attempt.observationEndedAtMs - attempt.inputStartedAtMs,
    failure: attempt.failure ?? null,
  }));
  const acceptedAttempts = summarizedAttempts.filter((attempt) => attempt.outcome === 'accepted');
  const acceptedAttempt = acceptedAttempts.length === 1 ? acceptedAttempts[0] : null;
  const failedAttempts = summarizedAttempts.filter((attempt) => attempt.outcome === 'failed');
  const firstAttempt = summarizedAttempts[0] ?? null;
  const immediateCaptureLatencyMs = captureCompletedAtMs - authoritativeObservedAtMs;

  let rejectionReason = null;
  if (summarizedAttempts.length !== 1 || failedAttempts.length !== 0) {
    rejectionReason = 'retry-not-admissible-first-attempt-only-provenance';
  } else if (!acceptedAttempt || summarizedAttempts.at(-1) !== acceptedAttempt) {
    rejectionReason = 'missing-final-accepted-observation-attempt';
  } else if (
    authoritativeObservedAtMs < acceptedAttempt.inputStartedAtMs
    || authoritativeObservedAtMs > acceptedAttempt.observationEndedAtMs
  ) {
    rejectionReason = 'authoritative-observation-outside-accepted-attempt';
  } else if (immediateCaptureLatencyMs < 0) {
    rejectionReason = 'capture-precedes-authoritative-observation';
  } else if (immediateCaptureLatencyMs > maximumLatencyMs) {
    rejectionReason = 'capture-exceeded-immediate-bound';
  }

  return {
    captureAccepted: rejectionReason === null,
    rejectionReason,
    authoritativeOrigin: 'accepted-local-shot-observation',
    provenancePolicy: 'first-attempt-only',
    authoritativeObservedAtMs,
    captureCompletedAtMs,
    immediateCaptureLatencyMs,
    maximumImmediateCaptureLatencyMs: maximumLatencyMs,
    sequenceElapsedMs: firstAttempt
      ? captureCompletedAtMs - firstAttempt.inputStartedAtMs
      : null,
    observationAttemptNumber: acceptedAttempt?.attemptNumber ?? null,
    attemptCount: summarizedAttempts.length,
    retryCount: failedAttempts.length,
    failedAttempts,
  };
}

export function parseCombatAmmo(ammoText) {
  if (typeof ammoText !== 'string') return null;
  const match = ammoText.match(/^(.+?)\s{2}(\d+)(?:\s+·\s+RELOADING)?$/);
  if (!match) return null;
  return {
    weaponText: match[1],
    ammo: Number(match[2]),
    reloading: ammoText.includes('RELOADING'),
  };
}

export function assessNativeFireReadiness({
  expectedTargetId,
  expectedUrl,
  expectedWeaponText,
  targetInfo,
  pageUrl,
  routeAcknowledged,
  priorButtonReleased,
  stabilizedFrameCount,
  cooldownWaitMs,
  requiredCooldownWaitMs,
  uiSamples,
}) {
  const samples = Array.isArray(uiSamples) ? uiSamples : [];
  const latest = samples.at(-1) ?? null;
  const parsedAmmo = parseCombatAmmo(latest?.ammo);
  let failureStage = null;
  let recoveryAction = null;

  if (
    targetInfo?.targetId !== expectedTargetId
    || targetInfo?.type !== 'page'
    || typeof targetInfo?.url !== 'string'
    || !targetInfo.url.startsWith(expectedUrl)
    || typeof pageUrl !== 'string'
    || !pageUrl.startsWith(expectedUrl)
  ) {
    failureStage = 'target-session';
  } else if (
    samples.length < 2
    || samples.some((sample) => sample.visibilityState !== 'visible')
  ) {
    failureStage = 'document-visibility';
  } else if (
    samples.some((sample) => !sample.documentFocused || sample.activeElementEditable)
  ) {
    failureStage = 'document-focus';
  } else if (
    samples.some((sample) => !sample.pointerLocked || sample.pointerTag !== 'CANVAS')
  ) {
    failureStage = 'pointer-lock';
    recoveryAction = 'normal-play-click';
  } else if (samples.some((sample) => sample.menuDisplay !== 'none')) {
    failureStage = 'menu-state';
    recoveryAction = 'normal-play-click';
  } else if (!routeAcknowledged) {
    failureStage = 'keyboard-routing';
    recoveryAction = 'ordinary-slot-transition';
  } else if (
    samples.some((sample) => Number(sample.health) <= 0 || sample.deathDisplay !== 'none')
  ) {
    failureStage = 'player-state';
  } else if (!parsedAmmo || parsedAmmo.weaponText !== expectedWeaponText) {
    failureStage = 'weapon-state';
    recoveryAction = 'ordinary-slot-transition';
  } else if (parsedAmmo.reloading) {
    failureStage = 'reload-state';
    recoveryAction = 'wait-for-visible-reload';
  } else if (parsedAmmo.ammo <= 0) {
    failureStage = 'ammo-empty';
    recoveryAction = 'ordinary-reload';
  } else if (cooldownWaitMs < requiredCooldownWaitMs) {
    failureStage = 'cooldown-wait';
  } else if (!priorButtonReleased) {
    failureStage = 'mouse-button-release';
  } else if (
    stabilizedFrameCount < 3
    || samples.some((sample) => sample.ammo !== latest.ammo)
  ) {
    failureStage = 'frame-stabilization';
  } else if (samples.some((sample) => sample.audio !== 'AUDIO READY')) {
    failureStage = 'audio-state';
  }

  return {
    ready: failureStage === null,
    failureStage,
    recoveryAction,
    ammo: parsedAmmo?.ammo ?? null,
    weaponText: parsedAmmo?.weaponText ?? null,
    reloading: parsedAmmo?.reloading ?? null,
    sampleCount: samples.length,
    stabilizedFrameCount,
    cooldownWaitMs,
    requiredCooldownWaitMs,
  };
}

export function classifyNativeShotFailure({
  readiness,
  ammoBefore,
  ammoAfter,
  localShotObserved,
  uiAfter,
}) {
  if (!readiness?.ready) {
    return `pre-input-readiness-${readiness?.failureStage ?? 'unknown'}`;
  }
  if (ammoBefore <= 0) return 'pre-input-ammo-empty';
  if (localShotObserved) return 'local-shot-observed';
  if (!uiAfter?.documentFocused) return 'document-focus-lost-after-readiness';
  if (!uiAfter?.pointerLocked || uiAfter?.menuDisplay !== 'none') {
    return 'pointer-lock-lost-after-readiness';
  }
  if (!Number.isFinite(ammoAfter)) {
    return 'post-input-ammo-state-unreadable';
  }
  if (ammoAfter !== ammoBefore) {
    return 'local-shot-observation-missing-after-ammo-consumption';
  }
  return 'native-attack-edge-not-consumed-after-ready-handshake';
}

export function findBrowserExecutable(explicitPath, platform = process.platform, env = process.env) {
  const candidates = [];
  if (explicitPath) candidates.push(explicitPath);
  if (env.CHROME_PATH && env.CHROME_PATH !== explicitPath) candidates.push(env.CHROME_PATH);
  if (platform === 'win32') {
    candidates.push(
      path.join(env.PROGRAMFILES ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(env['PROGRAMFILES(X86)'] ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(env.PROGRAMFILES ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(env['PROGRAMFILES(X86)'] ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    );
  } else if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    );
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge',
    );
  }
  const found = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!found) {
    throw new Error(
      'Chrome/Chromium was not found. Set CHROME_PATH to a CDP-capable browser executable.',
    );
  }
  return found;
}

export async function terminateManagedChild(child, graceMs = 2_500) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit').then(() => true);
  try {
    child.kill('SIGTERM');
  } catch {
    return;
  }
  let gracefulTimer;
  const graceful = await Promise.race([
    exited,
    new Promise((resolve) => {
      gracefulTimer = setTimeout(() => resolve(false), graceMs);
    }),
  ]);
  clearTimeout(gracefulTimer);
  if (graceful || child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill('SIGKILL');
  } catch {
    // It exited between the state check and escalation.
  }
  let escalationTimer;
  await Promise.race([
    exited,
    new Promise((resolve) => {
      escalationTimer = setTimeout(resolve, Math.max(100, graceMs));
    }),
  ]);
  clearTimeout(escalationTimer);
}

export function summarizeConsoleIssue(event) {
  if (event.method === 'Runtime.exceptionThrown') {
    const detail = event.params?.exceptionDetails;
    return {
      level: 'error',
      source: detail?.url ?? 'runtime',
      text: detail?.exception?.description ?? detail?.text ?? 'Uncaught browser exception',
    };
  }
  if (event.method === 'Runtime.consoleAPICalled') {
    const type = event.params?.type;
    if (type !== 'error' && type !== 'warning' && type !== 'assert') return null;
    return {
      level: type === 'warning' ? 'warning' : 'error',
      source: event.params?.stackTrace?.callFrames?.[0]?.url ?? 'console',
      text: (event.params?.args ?? [])
        .map((arg) => arg.value ?? arg.description ?? arg.type)
        .join(' '),
    };
  }
  if (event.method === 'Log.entryAdded') {
    const entry = event.params?.entry;
    if (entry?.level !== 'error' && entry?.level !== 'warning') return null;
    return {
      level: entry.level,
      source: entry.url ?? entry.source ?? 'log',
      text: entry.text ?? 'Browser log issue',
    };
  }
  return null;
}

function readPngPair(beforeBuffer, afterBuffer) {
  const before = PNG.sync.read(beforeBuffer);
  const after = PNG.sync.read(afterBuffer);
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error('Screenshot dimensions changed during verification');
  }
  return { before, after };
}

function boundedRegion(image, region) {
  const requested = region ?? { x: 0, y: 0, width: image.width, height: image.height };
  const x = Math.max(0, Math.floor(requested.x));
  const y = Math.max(0, Math.floor(requested.y));
  const right = Math.min(image.width, Math.ceil(requested.x + requested.width));
  const bottom = Math.min(image.height, Math.ceil(requested.y + requested.height));
  if (right <= x || bottom <= y) throw new Error('Image evidence region is empty');
  return { x, y, width: right - x, height: bottom - y };
}

function rgbDelta(before, after, index) {
  return Math.abs(before.data[index] - after.data[index])
    + Math.abs(before.data[index + 1] - after.data[index + 1])
    + Math.abs(before.data[index + 2] - after.data[index + 2]);
}

export function imageDifference(beforeBuffer, afterBuffer, region, threshold = 54) {
  const { before, after } = readPngPair(beforeBuffer, afterBuffer);
  const bounds = boundedRegion(before, region);
  let changedPixels = 0;
  let totalDelta = 0;
  let maxDelta = 0;
  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
      const index = (y * before.width + x) * 4;
      const delta = rgbDelta(before, after, index);
      totalDelta += delta;
      maxDelta = Math.max(maxDelta, delta);
      if (delta >= threshold) changedPixels += 1;
    }
  }
  const pixels = bounds.width * bounds.height;
  return {
    changedPixels,
    changedRatio: changedPixels / pixels,
    meanDelta: totalDelta / pixels,
    maxDelta,
  };
}

function matchesEffectColor(before, after, index, palette) {
  const br = before.data[index];
  const bg = before.data[index + 1];
  const bb = before.data[index + 2];
  const r = after.data[index];
  const g = after.data[index + 1];
  const b = after.data[index + 2];
  const brightnessGain = r + g + b - br - bg - bb;
  if (brightnessGain < 42 || Math.max(r, g, b) < 155) return false;
  const warm = r - b >= 30 && r >= g - 8 && g - b >= 8;
  const cool = b >= r - 12 && g >= r - 22 && b >= 165;
  if (palette === 'warm') return warm;
  if (palette === 'cool') return cool;
  return warm || cool;
}

function summarizeComponent(pixels) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let sumX = 0;
  let sumY = 0;
  let maxBrightnessGain = 0;
  for (const pixel of pixels) {
    minX = Math.min(minX, pixel.x);
    minY = Math.min(minY, pixel.y);
    maxX = Math.max(maxX, pixel.x);
    maxY = Math.max(maxY, pixel.y);
    sumX += pixel.x;
    sumY += pixel.y;
    maxBrightnessGain = Math.max(maxBrightnessGain, pixel.brightnessGain);
  }
  const centerX = sumX / pixels.length;
  const centerY = sumY / pixels.length;
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const pixel of pixels) {
    const dx = pixel.x - centerX;
    const dy = pixel.y - centerY;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }
  xx /= pixels.length;
  xy /= pixels.length;
  yy /= pixels.length;
  const trace = xx + yy;
  const root = Math.sqrt(Math.max(0, (xx - yy) ** 2 + 4 * xy ** 2));
  const major = Math.max(0, (trace + root) / 2);
  const minor = Math.max(0, (trace - root) / 2);
  return {
    pixels: pixels.length,
    bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    centroid: { x: centerX, y: centerY },
    majorSpan: Math.sqrt(major) * 4,
    minorSpan: Math.sqrt(minor) * 4,
    elongation: (major + 0.25) / (minor + 0.25),
    maxBrightnessGain,
  };
}

export function analyzeEffectRegions(beforeBuffer, afterBuffer, options) {
  const { before, after } = readPngPair(beforeBuffer, afterBuffer);
  const bounds = boundedRegion(before, options.region);
  const palette = options.palette ?? 'warm-or-cool';
  const threshold = options.differenceThreshold ?? 45;
  const mask = new Uint8Array(bounds.width * bounds.height);
  const brightness = new Int16Array(mask.length);
  let matchedPixels = 0;
  let pointPixels = 0;
  let pointSectorMask = 0;
  const pointRadius = options.pointRadius ?? 48;
  const pointInnerRadius = options.pointInnerRadius ?? 6;
  for (let localY = 0; localY < bounds.height; localY += 1) {
    const y = bounds.y + localY;
    for (let localX = 0; localX < bounds.width; localX += 1) {
      const x = bounds.x + localX;
      const index = (y * before.width + x) * 4;
      if (rgbDelta(before, after, index) < threshold) continue;
      if (!matchesEffectColor(before, after, index, palette)) continue;
      const maskIndex = localY * bounds.width + localX;
      mask[maskIndex] = 1;
      brightness[maskIndex] = after.data[index] + after.data[index + 1] + after.data[index + 2]
        - before.data[index] - before.data[index + 1] - before.data[index + 2];
      matchedPixels += 1;
      if (options.point) {
        const pointX = x - options.point.x;
        const pointY = y - options.point.y;
        const pointDistance = Math.hypot(pointX, pointY);
        if (pointDistance <= pointRadius) {
          pointPixels += 1;
          if (pointDistance >= pointInnerRadius) {
            const angle = Math.atan2(pointY, pointX) + Math.PI;
            const sector = Math.min(7, Math.floor(angle / (Math.PI * 2) * 8));
            pointSectorMask |= 1 << sector;
          }
        }
      }
    }
  }

  const components = [];
  const queue = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] !== 1) continue;
    mask[start] = 2;
    queue.push(start);
    const pixels = [];
    while (queue.length > 0) {
      const current = queue.pop();
      const localX = current % bounds.width;
      const localY = Math.floor(current / bounds.width);
      pixels.push({
        x: bounds.x + localX,
        y: bounds.y + localY,
        brightnessGain: brightness[current],
      });
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nextX = localX + dx;
          const nextY = localY + dy;
          if (nextX < 0 || nextY < 0 || nextX >= bounds.width || nextY >= bounds.height) continue;
          const next = nextY * bounds.width + nextX;
          if (mask[next] !== 1) continue;
          mask[next] = 2;
          queue.push(next);
        }
      }
    }
    if (pixels.length >= 2) components.push(summarizeComponent(pixels));
  }
  components.sort((left, right) => right.pixels - left.pixels);
  let pointAngularSectors = 0;
  for (let bit = 0; bit < 8; bit += 1) {
    if ((pointSectorMask & (1 << bit)) !== 0) pointAngularSectors += 1;
  }
  return {
    region: bounds,
    palette,
    matchedPixels,
    pointPixels,
    pointAngularSectors,
    components: components.slice(0, 12),
  };
}


export function measureEffectTrajectory(samples, options = {}) {
  const minimumPixels = options.minimumPixels ?? 10;
  const maximumPixels = options.maximumPixels ?? 150;
  const minimumElongation = options.minimumElongation ?? 2.3;
  const minimumBrightnessGain = options.minimumBrightnessGain ?? 250;
  const qualifies = (component, relaxed = false) => (
    component.pixels >= (relaxed ? options.minimumSecondPixels ?? minimumPixels : minimumPixels)
    && component.pixels <= maximumPixels
    && component.majorSpan >= (relaxed ? options.minimumSecondMajorSpan ?? 4 : 4)
    && component.elongation >= (
      relaxed ? options.minimumSecondElongation ?? minimumElongation : minimumElongation
    )
    && component.maxBrightnessGain >= minimumBrightnessGain
    && component.bounds.width <= 30
    && component.bounds.height <= 30
  );

  let best = null;
  for (let sampleIndex = 0; sampleIndex < samples.length - 1; sampleIndex += 1) {
    const firstCandidates = samples[sampleIndex].evidence.components.filter(
      (component) => qualifies(component, sampleIndex > 0),
    );
    const secondCandidates = samples[sampleIndex + 1].evidence.components.filter(
      (component) => qualifies(component, true),
    );
    for (const first of firstCandidates) {
      const compatible = secondCandidates
        .map((second) => ({
          second,
          travelPixels: Math.hypot(
            second.centroid.x - first.centroid.x,
            second.centroid.y - first.centroid.y,
          ),
          sizeRatio: second.pixels / first.pixels,
        }))
        .filter((candidate) => (
          candidate.travelPixels <= 120
          && candidate.sizeRatio >= 0.04
          && candidate.sizeRatio <= 8
        ))
        .sort((left, right) => left.travelPixels - right.travelPixels);
      const match = compatible[0];
      if (!match) continue;
      const fromRadius = options.origin
        ? Math.hypot(first.centroid.x - options.origin.x, first.centroid.y - options.origin.y)
        : null;
      const toRadius = options.origin
        ? Math.hypot(
          match.second.centroid.x - options.origin.x,
          match.second.centroid.y - options.origin.y,
        )
        : null;
      const radialProgressPixels = fromRadius === null || toRadius === null
        ? null
        : toRadius - fromRadius;
      const score = radialProgressPixels ?? match.travelPixels;
      if (best && score <= best.score) continue;
      best = {
        score,
        fromSampleIndex: sampleIndex,
        toSampleIndex: sampleIndex + 1,
        fromOffsetMs: samples[sampleIndex].offsetMs,
        toOffsetMs: samples[sampleIndex + 1].offsetMs,
        from: first,
        to: match.second,
        travelPixels: match.travelPixels,
        fromRadius,
        toRadius,
        radialProgressPixels,
      };
    }
  }
  if (!best) return null;
  const { score: _score, ...trajectory } = best;
  return trajectory;
}

function neutralMask(image, bounds, options) {
  const mask = new Uint8Array(bounds.width * bounds.height);
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  const minLuma = options.minLuma ?? 105;
  const maxChroma = options.maxChroma ?? 48;
  for (let localY = 0; localY < bounds.height; localY += 1) {
    const y = bounds.y + localY;
    for (let localX = 0; localX < bounds.width; localX += 1) {
      const x = bounds.x + localX;
      const index = (y * image.width + x) * 4;
      const r = image.data[index];
      const g = image.data[index + 1];
      const b = image.data[index + 2];
      const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      if (luma < minLuma || chroma > maxChroma) continue;
      mask[localY * bounds.width + localX] = 1;
      count += 1;
      sumX += x;
      sumY += y;
    }
  }
  return {
    mask,
    count,
    centroid: count > 0 ? { x: sumX / count, y: sumY / count } : null,
  };
}

export function measureNeutralSilhouette(beforeBuffer, afterBuffer, options) {
  const { before, after } = readPngPair(beforeBuffer, afterBuffer);
  const bounds = boundedRegion(before, options.region);
  const first = neutralMask(before, bounds, options);
  const second = neutralMask(after, bounds, options);
  let intersection = 0;
  for (let index = 0; index < first.mask.length; index += 1) {
    if (first.mask[index] && second.mask[index]) intersection += 1;
  }
  const dice = first.count + second.count > 0
    ? 2 * intersection / (first.count + second.count)
    : 0;
  const dx = first.centroid && second.centroid ? second.centroid.x - first.centroid.x : Infinity;
  const dy = first.centroid && second.centroid ? second.centroid.y - first.centroid.y : Infinity;
  const distance = Math.hypot(dx, dy);
  return {
    region: bounds,
    beforePixels: first.count,
    afterPixels: second.count,
    beforeCentroid: first.centroid,
    afterCentroid: second.centroid,
    dx,
    dy,
    distance,
    dice,
    displacementScore: distance + (1 - dice) * 12,
  };
}

export function summarizeWebAudioEvents(events) {
  const createdNodes = new Map();
  const destroyedAt = new Map();
  const nodeTypes = {};
  const contextStates = [];
  let connections = 0;
  let disconnections = 0;
  for (const event of events) {
    if (event.kind === 'context-created' || event.kind === 'context-changed') {
      if (event.context?.contextState) contextStates.push(event.context.contextState);
    } else if (event.kind === 'node-created' && event.node?.nodeId) {
      createdNodes.set(event.node.nodeId, event);
      const rawType = event.node.nodeType ?? 'Unknown';
      const type = rawType.endsWith('Node') ? rawType.slice(0, -4) : rawType;
      nodeTypes[type] = (nodeTypes[type] ?? 0) + 1;
    } else if (event.kind === 'node-destroyed' && event.nodeId) {
      destroyedAt.set(event.nodeId, event.observedAtMs);
    } else if (event.kind === 'nodes-connected') {
      connections += 1;
    } else if (event.kind === 'nodes-disconnected') {
      disconnections += 1;
    }
  }
  const sourceTypes = new Set(['Oscillator', 'AudioBufferSource']);
  const sourceLifetimesMs = [];
  const sourceNodeIds = [];
  for (const [nodeId, event] of createdNodes) {
    const rawType = event.node.nodeType ?? 'Unknown';
    const type = rawType.endsWith('Node') ? rawType.slice(0, -4) : rawType;
    if (!sourceTypes.has(type)) continue;
    sourceNodeIds.push(nodeId);
    const destroyed = destroyedAt.get(nodeId);
    if (destroyed !== undefined) sourceLifetimesMs.push(destroyed - event.observedAtMs);
  }
  sourceLifetimesMs.sort((left, right) => left - right);
  return {
    nodeTypes,
    createdNodeIds: [...createdNodes.keys()],
    sourceNodeIds,
    sourceLifetimesMs,
    connections,
    disconnections,
    contextStates,
  };
}
