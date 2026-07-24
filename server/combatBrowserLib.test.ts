import { EventEmitter } from 'node:events';
import path from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import {
  analyzeEffectRegions,
  assessNativeFireReadiness,
  assessNativeShotCapture,
  classifyNativeShotFailure,
  findBrowserExecutable,
  imageDifference,
  measureEffectTrajectory,
  measureNeutralSilhouette,
  parseCombatBrowserOptions,
  summarizeConsoleIssue,
  summarizeWebAudioEvents,
  terminateManagedChild,
} from '../tools/combat-browser-lib.mjs';

function makePng(width: number, height: number, paint?: (png: PNG) => void): Buffer {
  const png = new PNG({ width, height });
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = 18;
    png.data[index + 1] = 30;
    png.data[index + 2] = 44;
    png.data[index + 3] = 255;
  }
  paint?.(png);
  return PNG.sync.write(png);
}

function setPixel(png: PNG, x: number, y: number, color: readonly [number, number, number]): void {
  const index = (y * png.width + x) * 4;
  png.data[index] = color[0];
  png.data[index + 1] = color[1];
  png.data[index + 2] = color[2];
  png.data[index + 3] = 255;
}

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly kills: NodeJS.Signals[] = [];

  constructor(private readonly exitOnTerminate = false) {
    super();
  }

  kill(signal: NodeJS.Signals): boolean {
    this.kills.push(signal);
    if (signal === 'SIGTERM' && this.exitOnTerminate) {
      this.signalCode = signal;
      this.emit('exit', null, signal);
    }
    if (signal === 'SIGKILL') {
      this.signalCode = signal;
      this.emit('exit', null, signal);
    }
    return true;
  }
}

describe('combat browser harness support', () => {
  it('parses bounded, deterministic options', () => {
    const output = path.resolve('qa-output');
    expect(parseCombatBrowserOptions({
      COMBAT_BROWSER_TIMEOUT_MS: '45000',
      COMBAT_BROWSER_HEADED: '1',
      COMBAT_BROWSER_OUTPUT: output,
      CHROME_PATH: 'browser.exe',
    }, new Date('2026-07-19T12:00:00.000Z'))).toEqual({
      timeoutMs: 45000,
      headed: true,
      outputDir: output,
      browserPath: 'browser.exe',
    });
    expect(() => parseCombatBrowserOptions({ COMBAT_BROWSER_TIMEOUT_MS: 'forever' }))
      .toThrow(/base-10 integer/);
    expect(() => parseCombatBrowserOptions({ COMBAT_BROWSER_HEADED: 'yes' }))
      .toThrow(/must be 0 or 1/);
  });

  it('honors an explicit browser and rejects a missing one', () => {
    expect(findBrowserExecutable(import.meta.filename, process.platform, {}))
      .toBe(import.meta.filename);
    expect(() => findBrowserExecutable('definitely-missing', 'linux', {}))
      .toThrow(/CHROME_PATH/);
  });

  it('escalates a stuck owned child and observes its exit', async () => {
    const child = new FakeChild();
    await terminateManagedChild(child, 5);
    expect(child.kills).toEqual(['SIGTERM', 'SIGKILL']);
    expect(child.signalCode).toBe('SIGKILL');
  });

  it('accepts a graceful child exit without escalation', async () => {
    const child = new FakeChild(true);
    await terminateManagedChild(child, 1_000);
    expect(child.kills).toEqual(['SIGTERM']);
    expect(child.signalCode).toBe('SIGTERM');
  });

  it('normalizes only actionable console issues', () => {
    expect(summarizeConsoleIssue({
      method: 'Runtime.consoleAPICalled',
      params: { type: 'log', args: [{ value: 'ok' }] },
    })).toBeNull();
    expect(summarizeConsoleIssue({
      method: 'Runtime.consoleAPICalled',
      params: { type: 'error', args: [{ value: 'boom' }] },
    })).toMatchObject({ level: 'error', text: 'boom' });
  });
});


describe('native shot timing evidence', () => {
  it('uses the first accepted local-shot observation as the immediate origin', () => {
    const timing = assessNativeShotCapture({
      attempts: [{
        attemptNumber: 1,
        outcome: 'accepted',
        inputStartedAtMs: 1_000,
        inputCompletedAtMs: 1_035,
        observationEndedAtMs: 1_060,
      }],
      authoritativeObservedAtMs: 1_040,
      captureCompletedAtMs: 1_100,
      maximumLatencyMs: 170,
    });

    expect(timing).toMatchObject({
      captureAccepted: true,
      authoritativeOrigin: 'accepted-local-shot-observation',
      provenancePolicy: 'first-attempt-only',
      immediateCaptureLatencyMs: 60,
      sequenceElapsedMs: 100,
      observationAttemptNumber: 1,
      attemptCount: 1,
      retryCount: 0,
      failedAttempts: [],
    });
  });

  it('rejects a delayed failed-attempt response during a hypothetical retry', () => {
    const timing = assessNativeShotCapture({
      attempts: [{
        attemptNumber: 1,
        outcome: 'failed',
        inputStartedAtMs: 1_000,
        inputCompletedAtMs: 1_035,
        observationEndedAtMs: 2_535,
        failure: 'timed out',
      }, {
        attemptNumber: 2,
        outcome: 'accepted',
        inputStartedAtMs: 2_600,
        inputCompletedAtMs: 2_635,
        observationEndedAtMs: 2_680,
      }],
      authoritativeObservedAtMs: 2_640,
      captureCompletedAtMs: 2_690,
      maximumLatencyMs: 170,
    });

    expect(timing).toMatchObject({
      captureAccepted: false,
      rejectionReason: 'retry-not-admissible-first-attempt-only-provenance',
      provenancePolicy: 'first-attempt-only',
      immediateCaptureLatencyMs: 50,
      sequenceElapsedMs: 1_690,
      observationAttemptNumber: 2,
      attemptCount: 2,
      retryCount: 1,
      failedAttempts: [{
        attemptNumber: 1,
        observationWaitMs: 1_500,
        totalAttemptMs: 1_535,
        failure: 'timed out',
      }],
    });
  });

  it('rejects a capture completed after the authored immediate bound', () => {
    const timing = assessNativeShotCapture({
      attempts: [{
        attemptNumber: 1,
        outcome: 'accepted',
        inputStartedAtMs: 1_000,
        inputCompletedAtMs: 1_035,
        observationEndedAtMs: 1_060,
      }],
      authoritativeObservedAtMs: 1_040,
      captureCompletedAtMs: 1_211,
      maximumLatencyMs: 170,
    });

    expect(timing).toMatchObject({
      captureAccepted: false,
      rejectionReason: 'capture-exceeded-immediate-bound',
      immediateCaptureLatencyMs: 171,
    });
  });

  it('rejects an observation outside the sole native-input attempt', () => {
    const timing = assessNativeShotCapture({
      attempts: [{
        attemptNumber: 1,
        outcome: 'accepted',
        inputStartedAtMs: 2_600,
        inputCompletedAtMs: 2_635,
        observationEndedAtMs: 2_680,
      }],
      authoritativeObservedAtMs: 1_500,
      captureCompletedAtMs: 1_550,
      maximumLatencyMs: 170,
    });

    expect(timing).toMatchObject({
      captureAccepted: false,
      rejectionReason: 'authoritative-observation-outside-accepted-attempt',
      observationAttemptNumber: 1,
      retryCount: 0,
    });
  });
});

describe('native fire readiness evidence', () => {
  const readyUi = {
    ammo: 'AWP  10',
    health: '100',
    audio: 'AUDIO READY',
    pointerLocked: true,
    pointerTag: 'CANVAS',
    menuDisplay: 'none',
    deathDisplay: 'none',
    documentFocused: true,
    visibilityState: 'visible',
    activeElementEditable: false,
  };
  const readinessInput = {
    expectedTargetId: 'page-1',
    expectedUrl: 'http://127.0.0.1:5174/',
    expectedWeaponText: 'AWP',
    targetInfo: {
      targetId: 'page-1',
      type: 'page',
      url: 'http://127.0.0.1:5174/',
    },
    pageUrl: 'http://127.0.0.1:5174/',
    routeAcknowledged: true,
    priorButtonReleased: true,
    stabilizedFrameCount: 3,
    cooldownWaitMs: 1_600,
    requiredCooldownWaitMs: 1_600,
  };

  it('classifies empty ammo for ordinary reload and accepts the recovered HUD state', () => {
    const empty = assessNativeFireReadiness({
      ...readinessInput,
      uiSamples: [
        { ...readyUi, ammo: 'AWP  0' },
        { ...readyUi, ammo: 'AWP  0' },
      ],
    });
    expect(empty).toMatchObject({
      ready: false,
      failureStage: 'ammo-empty',
      recoveryAction: 'ordinary-reload',
    });

    const recovered = assessNativeFireReadiness({
      ...readinessInput,
      uiSamples: [readyUi, readyUi],
    });
    expect(recovered).toMatchObject({
      ready: true,
      failureStage: null,
      ammo: 10,
    });
  });

  it('retains a specific readiness stage and classifies a ready ignored click', () => {
    const unfocused = assessNativeFireReadiness({
      ...readinessInput,
      uiSamples: [
        { ...readyUi, documentFocused: false },
        { ...readyUi, documentFocused: false },
      ],
    });
    expect(unfocused.failureStage).toBe('document-focus');

    const ready = assessNativeFireReadiness({
      ...readinessInput,
      uiSamples: [readyUi, readyUi],
    });
    expect(classifyNativeShotFailure({
      readiness: ready,
      ammoBefore: 10,
      ammoAfter: 10,
      localShotObserved: false,
      uiAfter: readyUi,
    })).toBe('native-attack-edge-not-consumed-after-ready-handshake');
    expect(classifyNativeShotFailure({
      readiness: ready,
      ammoBefore: 10,
      ammoAfter: null,
      localShotObserved: false,
      uiAfter: readyUi,
    })).toBe('post-input-ammo-state-unreadable');
  });
});

describe('combat browser evidence analysis', () => {
  it('finds a bright connected shot streak and impact near the expected point', () => {
    const baseline = makePng(100, 80);
    const effect = makePng(100, 80, (png) => {
      for (let step = 0; step < 34; step += 1) {
        const x = 48 + step;
        const y = 39 + Math.floor(step / 3);
        setPixel(png, x, y, [255, 181, 82]);
        setPixel(png, x, y + 1, [244, 161, 64]);
      }
      for (let angle = 0; angle < 360; angle += 5) {
        const radians = angle * Math.PI / 180;
        setPixel(png, 48 + Math.round(Math.cos(radians) * 7), 39 + Math.round(Math.sin(radians) * 7), [255, 198, 104]);
      }
    });

    const evidence = analyzeEffectRegions(baseline, effect, {
      region: { x: 30, y: 20, width: 65, height: 50 },
      palette: 'warm',
      point: { x: 48, y: 39 },
      pointRadius: 10,
    });

    expect(evidence.matchedPixels).toBeGreaterThan(100);
    expect(evidence.pointPixels).toBeGreaterThan(25);
    expect(evidence.pointAngularSectors).toBeGreaterThanOrEqual(6);
    expect(evidence.components.some((component) => (
      component.pixels > 40 && component.majorSpan > 20 && component.elongation > 2
    ))).toBe(true);
  });

  it('requires a bright compact effect component to travel across timed frames', () => {
    const baseline = makePng(100, 80);
    const frameAt35 = makePng(100, 80, (png) => {
      for (let x = 20; x < 34; x += 1) {
        setPixel(png, x, 30, [255, 181, 82]);
        setPixel(png, x, 31, [244, 161, 64]);
      }
      for (let y = 50; y < 54; y += 1) {
        for (let x = 70; x < 80; x += 1) setPixel(png, x, y, [255, 181, 82]);
      }
    });
    const frameAt120 = makePng(100, 80, (png) => {
      for (let x = 40; x < 44; x += 1) {
        setPixel(png, x, 30, [255, 181, 82]);
        setPixel(png, x, 31, [244, 161, 64]);
        setPixel(png, x, 32, [236, 150, 58]);
      }
      for (let y = 50; y < 54; y += 1) {
        for (let x = 70; x < 80; x += 1) setPixel(png, x, y, [255, 181, 82]);
      }
    });
    const options = {
      region: { x: 0, y: 0, width: 100, height: 80 },
      palette: 'warm' as const,
    };
    const trajectory = measureEffectTrajectory([
      { offsetMs: 35, evidence: analyzeEffectRegions(baseline, frameAt35, options) },
      { offsetMs: 120, evidence: analyzeEffectRegions(baseline, frameAt120, options) },
    ], {
      origin: { x: 15, y: 30.5 },
      minimumSecondPixels: 5,
      minimumSecondMajorSpan: 2.5,
      minimumSecondElongation: 1.3,
    });

    expect(trajectory).not.toBeNull();
    expect(trajectory?.travelPixels).toBeGreaterThan(12);
    expect(trajectory?.radialProgressPixels).toBeGreaterThan(12);
  });

  it('distinguishes immediate effects from a stable post-expiry baseline', () => {
    const baseline = makePng(80, 60);
    const immediate = makePng(80, 60, (png) => {
      for (let x = 20; x < 55; x += 1) setPixel(png, x, 30, [255, 225, 170]);
    });
    const cleaned = makePng(80, 60);

    expect(imageDifference(baseline, immediate).changedPixels).toBe(35);
    expect(imageDifference(baseline, cleaned)).toMatchObject({ changedPixels: 0, meanDelta: 0 });
  });

  it('measures neutral viewmodel displacement without counting a colored flash', () => {
    const baseline = makePng(120, 100, (png) => {
      for (let y = 50; y < 85; y += 1) {
        for (let x = 45; x < 70; x += 1) setPixel(png, x, y, [190, 194, 198]);
      }
    });
    const recoil = makePng(120, 100, (png) => {
      for (let y = 46; y < 81; y += 1) {
        for (let x = 50; x < 75; x += 1) setPixel(png, x, y, [190, 194, 198]);
      }
      for (let x = 72; x < 100; x += 1) setPixel(png, x, 42, [255, 145, 45]);
    });

    const evidence = measureNeutralSilhouette(baseline, recoil, {
      region: { x: 30, y: 35, width: 80, height: 60 },
    });
    expect(evidence).toMatchObject({ dx: 5, dy: -4 });
    expect(evidence.distance).toBeCloseTo(Math.hypot(5, 4), 5);
    expect(evidence.displacementScore).toBeGreaterThan(evidence.distance);
  });

  it('summarizes read-only CDP WebAudio graph and source lifetimes', () => {
    const events = [
      { kind: 'context-created', observedAtMs: 10, context: { contextState: 'running' } },
      { kind: 'node-created', observedAtMs: 20, node: { nodeId: 'osc', nodeType: 'OscillatorNode' } },
      { kind: 'node-created', observedAtMs: 21, node: { nodeId: 'gain', nodeType: 'GainNode' } },
      { kind: 'nodes-connected', observedAtMs: 22, sourceId: 'osc', destinationId: 'gain' },
      { kind: 'node-destroyed', observedAtMs: 180, nodeId: 'osc' },
    ];

    expect(summarizeWebAudioEvents(events)).toEqual({
      nodeTypes: { Oscillator: 1, Gain: 1 },
      createdNodeIds: ['osc', 'gain'],
      sourceNodeIds: ['osc'],
      sourceLifetimesMs: [160],
      connections: 1,
      disconnections: 0,
      contextStates: ['running'],
    });
  });
});
