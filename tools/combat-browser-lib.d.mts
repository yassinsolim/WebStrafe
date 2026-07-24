export const DEFAULT_COMBAT_BROWSER_TIMEOUT_MS: number;
export const MIN_COMBAT_BROWSER_TIMEOUT_MS: number;
export const MAX_COMBAT_BROWSER_TIMEOUT_MS: number;

export interface CombatBrowserOptions {
  timeoutMs: number;
  headed: boolean;
  outputDir: string;
  browserPath?: string;
}

export function parseCombatBrowserOptions(
  env?: NodeJS.ProcessEnv,
  now?: Date,
): CombatBrowserOptions;

export interface NativeShotAttemptTiming {
  attemptNumber: number;
  outcome: 'accepted' | 'failed';
  inputStartedAtMs: number;
  inputCompletedAtMs: number;
  observationEndedAtMs: number;
  failure?: string | null;
}
export interface NativeShotCaptureAssessment {
  captureAccepted: boolean;
  rejectionReason: string | null;
  authoritativeOrigin: 'accepted-local-shot-observation';
  authoritativeObservedAtMs: number;
  captureCompletedAtMs: number;
  immediateCaptureLatencyMs: number;
  maximumImmediateCaptureLatencyMs: number;
  sequenceElapsedMs: number | null;
  observationAttemptNumber: number | null;
  attemptCount: number;
  retryCount: number;
  failedAttempts: Array<NativeShotAttemptTiming & {
    inputDurationMs: number;
    observationWaitMs: number;
    totalAttemptMs: number;
    failure: string | null;
  }>;
}
export function assessNativeShotCapture(input: {
  attempts: NativeShotAttemptTiming[];
  authoritativeObservedAtMs: number;
  captureCompletedAtMs: number;
  maximumLatencyMs: number;
}): NativeShotCaptureAssessment;
export interface NativeFireUiSample {
  ammo: string | null;
  health: string | null;
  audio: string | null;
  pointerLocked: boolean;
  pointerTag: string | null;
  menuDisplay: string | null;
  deathDisplay: string | null;
  documentFocused: boolean;
  visibilityState: string;
  activeElementEditable: boolean;
}
export interface NativeFireReadinessAssessment {
  ready: boolean;
  failureStage: string | null;
  recoveryAction: string | null;
  ammo: number | null;
  weaponText: string | null;
  reloading: boolean | null;
  sampleCount: number;
  stabilizedFrameCount: number;
  cooldownWaitMs: number;
  requiredCooldownWaitMs: number;
}
export function parseCombatAmmo(ammoText: unknown): {
  weaponText: string;
  ammo: number;
  reloading: boolean;
} | null;
export function assessNativeFireReadiness(input: {
  expectedTargetId: string;
  expectedUrl: string;
  expectedWeaponText: string;
  targetInfo: { targetId?: string; type?: string; url?: string } | null;
  pageUrl: string | null;
  routeAcknowledged: boolean;
  priorButtonReleased: boolean;
  stabilizedFrameCount: number;
  cooldownWaitMs: number;
  requiredCooldownWaitMs: number;
  uiSamples: NativeFireUiSample[];
}): NativeFireReadinessAssessment;
export function classifyNativeShotFailure(input: {
  readiness: NativeFireReadinessAssessment | null;
  ammoBefore: number;
  ammoAfter: number | null;
  localShotObserved: boolean;
  uiAfter: NativeFireUiSample;
}): string;
export function findBrowserExecutable(
  explicitPath?: string,
  platform?: NodeJS.Platform,
  env?: NodeJS.ProcessEnv,
): string;
export interface ManagedChild {
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  kill(signal: NodeJS.Signals): unknown;
  once(event: 'exit', listener: () => void): unknown;
}
export function terminateManagedChild(
  child: ManagedChild,
  graceMs?: number,
): Promise<void>;
export function summarizeConsoleIssue(event: {
  method: string;
  params?: Record<string, unknown>;
}): { level: string; source: string; text: string } | null;

export interface ImageRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageDifference {
  changedPixels: number;
  changedRatio: number;
  meanDelta: number;
  maxDelta: number;
}

export function imageDifference(
  before: Buffer,
  after: Buffer,
  region?: ImageRegion,
  threshold?: number,
): ImageDifference;

export type EffectPalette = 'warm' | 'cool' | 'warm-or-cool';
export interface EffectComponent {
  pixels: number;
  bounds: ImageRegion;
  centroid: { x: number; y: number };
  majorSpan: number;
  minorSpan: number;
  elongation: number;
  maxBrightnessGain: number;
}
export interface EffectEvidence {
  region: ImageRegion;
  palette: EffectPalette;
  matchedPixels: number;
  pointPixels: number;
  pointAngularSectors: number;
  components: EffectComponent[];
}
export function analyzeEffectRegions(
  before: Buffer,
  after: Buffer,
  options: {
    region: ImageRegion;
    palette?: EffectPalette;
    differenceThreshold?: number;
    point?: { x: number; y: number };
    pointRadius?: number;
    pointInnerRadius?: number;
  },
): EffectEvidence;

export interface TimedEffectSample {
  offsetMs: number;
  evidence: EffectEvidence;
}
export interface EffectTrajectory {
  fromSampleIndex: number;
  toSampleIndex: number;
  fromOffsetMs: number;
  toOffsetMs: number;
  from: EffectComponent;
  to: EffectComponent;
  travelPixels: number;
  fromRadius: number | null;
  toRadius: number | null;
  radialProgressPixels: number | null;
}
export function measureEffectTrajectory(
  samples: TimedEffectSample[],
  options?: {
    minimumPixels?: number;
    maximumPixels?: number;
    minimumElongation?: number;
    minimumBrightnessGain?: number;
    minimumSecondPixels?: number;
    minimumSecondMajorSpan?: number;
    minimumSecondElongation?: number;
    origin?: { x: number; y: number };
  },
): EffectTrajectory | null;

export interface SilhouetteEvidence {
  region: ImageRegion;
  beforePixels: number;
  afterPixels: number;
  beforeCentroid: { x: number; y: number } | null;
  afterCentroid: { x: number; y: number } | null;
  dx: number;
  dy: number;
  distance: number;
  dice: number;
  displacementScore: number;
}
export function measureNeutralSilhouette(
  before: Buffer,
  after: Buffer,
  options: { region: ImageRegion; minLuma?: number; maxChroma?: number },
): SilhouetteEvidence;

export interface WebAudioGraphSummary {
  nodeTypes: Record<string, number>;
  createdNodeIds: string[];
  sourceNodeIds: string[];
  sourceLifetimesMs: number[];
  connections: number;
  disconnections: number;
  contextStates: string[];
}
export function summarizeWebAudioEvents(events: Array<Record<string, unknown>>): WebAudioGraphSummary;
