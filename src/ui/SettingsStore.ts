export type CrosshairStyle = 'classic' | 'dot' | 'circle-dot';

export const CROSSHAIR_STYLES: readonly CrosshairStyle[] = ['classic', 'dot', 'circle-dot'];

export interface CrosshairSettings {
  style: CrosshairStyle;
  /** arm length in css px (0 hides the arms of the classic style) */
  size: number;
  /** distance from the centre to where each arm starts, css px */
  gap: number;
  /** line thickness in css px */
  thickness: number;
  /** #rrggbb */
  color: string;
  outline: boolean;
  /** widen the gap with the weapon's current inaccuracy */
  dynamicSpread: boolean;
}

export interface GameSettings {
  mouseSensitivity: number;
  /** scoped sensitivity multiplier, like zoom_sensitivity_ratio in cs */
  zoomSensitivityRatio: number;
  /** vertical camera fov in degrees (three.js convention) */
  worldFov: number;
  viewmodelFov: number;
  viewmodelScale: number;
  /** fraction of the screen's pixel ratio the game renders at */
  renderScale: number;
  /** lower the resolution automatically when frames drop under 55 fps */
  adaptiveResolution: boolean;
  masterVolume: number;
  effectsVolume: number;
  uiVolume: number;
  crosshair: CrosshairSettings;
  /** master switch for the in-game hud */
  showHud: boolean;
  showSpeedometer: boolean;
  showStrafeStats: boolean;
  showNetGraph: boolean;
  /** raw movement debug readout, also toggled with F3 */
  showMovementDebug: boolean;
  autoBhop: boolean;
}

export const SETTINGS_VERSION = 3;
export const SETTINGS_STORAGE_KEY = 'webstrafe-settings-v3';
const V2_STORAGE_KEY = 'webstrafe-settings-v2';
const V1_STORAGE_KEY = 'webstrafe-settings-v1';

interface RangeLimit {
  min: number;
  max: number;
  step: number;
}

/** one source of truth for validation and the settings sliders */
export const SETTING_LIMITS = {
  mouseSensitivity: { min: 0.02, max: 4, step: 0.01 },
  zoomSensitivityRatio: { min: 0.1, max: 3, step: 0.05 },
  worldFov: { min: 70, max: 130, step: 1 },
  viewmodelFov: { min: 45, max: 110, step: 1 },
  viewmodelScale: { min: 0.25, max: 3, step: 0.05 },
  renderScale: { min: 0.5, max: 1, step: 0.05 },
  masterVolume: { min: 0, max: 1, step: 0.01 },
  effectsVolume: { min: 0, max: 1, step: 0.01 },
  uiVolume: { min: 0, max: 1, step: 0.01 },
  crosshairSize: { min: 0, max: 20, step: 0.5 },
  crosshairGap: { min: -4, max: 20, step: 0.5 },
  crosshairThickness: { min: 0.5, max: 6, step: 0.5 },
} as const satisfies Record<string, RangeLimit>;

export const defaultCrosshair: CrosshairSettings = {
  style: 'classic',
  size: 5,
  gap: 2,
  thickness: 1.5,
  color: '#4dff94',
  outline: true,
  dynamicSpread: true,
};

export const defaultSettings: GameSettings = {
  mouseSensitivity: 1,
  zoomSensitivityRatio: 1,
  worldFov: 100,
  viewmodelFov: 68,
  viewmodelScale: 1,
  renderScale: 1,
  adaptiveResolution: true,
  masterVolume: 0.8,
  effectsVolume: 1,
  uiVolume: 0.7,
  crosshair: { ...defaultCrosshair },
  showHud: true,
  showSpeedometer: true,
  showStrafeStats: true,
  showNetGraph: false,
  showMovementDebug: false,
  autoBhop: true,
};

export function cloneSettings(settings: GameSettings): GameSettings {
  return { ...settings, crosshair: { ...settings.crosshair } };
}

/**
 * Turns anything (parsed json, a partial object, garbage) into a complete,
 * in-range settings object. Missing or invalid fields fall back to `base`.
 */
export function validateSettings(raw: unknown, base: GameSettings = defaultSettings): GameSettings {
  const src = isRecord(raw) ? raw : {};
  const limits = SETTING_LIMITS;
  return {
    mouseSensitivity: clampNumber(src.mouseSensitivity, limits.mouseSensitivity, base.mouseSensitivity),
    zoomSensitivityRatio: clampNumber(src.zoomSensitivityRatio, limits.zoomSensitivityRatio, base.zoomSensitivityRatio),
    worldFov: clampNumber(src.worldFov, limits.worldFov, base.worldFov),
    viewmodelFov: clampNumber(src.viewmodelFov, limits.viewmodelFov, base.viewmodelFov),
    viewmodelScale: clampNumber(src.viewmodelScale, limits.viewmodelScale, base.viewmodelScale),
    renderScale: clampNumber(src.renderScale, limits.renderScale, base.renderScale),
    adaptiveResolution: readBoolean(src.adaptiveResolution, base.adaptiveResolution),
    masterVolume: clampNumber(src.masterVolume, limits.masterVolume, base.masterVolume),
    effectsVolume: clampNumber(src.effectsVolume, limits.effectsVolume, base.effectsVolume),
    uiVolume: clampNumber(src.uiVolume, limits.uiVolume, base.uiVolume),
    crosshair: validateCrosshair(src.crosshair, base.crosshair),
    showHud: readBoolean(src.showHud, base.showHud),
    showSpeedometer: readBoolean(src.showSpeedometer, base.showSpeedometer),
    showStrafeStats: readBoolean(src.showStrafeStats, base.showStrafeStats),
    showNetGraph: readBoolean(src.showNetGraph, base.showNetGraph),
    showMovementDebug: readBoolean(src.showMovementDebug, base.showMovementDebug),
    autoBhop: readBoolean(src.autoBhop, base.autoBhop),
  };
}

export function validateCrosshair(raw: unknown, base: CrosshairSettings = defaultCrosshair): CrosshairSettings {
  const src = isRecord(raw) ? raw : {};
  const limits = SETTING_LIMITS;
  return {
    style: isCrosshairStyle(src.style) ? src.style : base.style,
    size: clampNumber(src.size, limits.crosshairSize, base.size),
    gap: clampNumber(src.gap, limits.crosshairGap, base.gap),
    thickness: clampNumber(src.thickness, limits.crosshairThickness, base.thickness),
    color: normalizeHexColor(src.color) ?? base.color,
    outline: readBoolean(src.outline, base.outline),
    dynamicSpread: readBoolean(src.dynamicSpread, base.dynamicSpread),
  };
}

/**
 * Upgrades an older stored payload.
 * v1: auto-bhop is forced on (it used to default off).
 * v1/v2: `showHud` used to mean the raw movement debug readout, which was on
 * for everyone. The new hud replaces it, so the debug overlay starts off and
 * the master hud switch starts on.
 */
export function migrateSettings(raw: unknown, fromVersion: number): GameSettings {
  const settings = validateSettings(raw);
  if (fromVersion >= SETTINGS_VERSION) {
    return settings;
  }
  settings.showHud = true;
  settings.showMovementDebug = false;
  if (fromVersion <= 1) {
    settings.autoBhop = true;
  }
  return settings;
}

type SettingsStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function loadSettings(storage: SettingsStorage | null = defaultStorage()): GameSettings {
  if (!storage) {
    return cloneSettings(defaultSettings);
  }
  try {
    const current = storage.getItem(SETTINGS_STORAGE_KEY);
    if (current !== null) {
      const parsed = JSON.parse(current) as unknown;
      const version = isRecord(parsed) && typeof parsed.version === 'number' ? parsed.version : SETTINGS_VERSION;
      return migrateSettings(parsed, version);
    }
    const v2 = storage.getItem(V2_STORAGE_KEY);
    const v1 = v2 === null ? storage.getItem(V1_STORAGE_KEY) : null;
    const legacy = v2 ?? v1;
    if (legacy === null) {
      return cloneSettings(defaultSettings);
    }
    const migrated = migrateSettings(JSON.parse(legacy) as unknown, v2 !== null ? 2 : 1);
    saveSettings(migrated, storage);
    return migrated;
  } catch (error) {
    console.warn('[Settings] Stored preferences could not be loaded; using defaults.', error);
    return cloneSettings(defaultSettings);
  }
}

export function saveSettings(settings: GameSettings, storage: SettingsStorage | null = defaultStorage()): boolean {
  if (!storage) {
    return false;
  }
  try {
    storage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ version: SETTINGS_VERSION, ...validateSettings(settings) }),
    );
    return true;
  } catch (error) {
    console.warn('[Settings] Preferences could not be saved.', error);
    return false;
  }
}

export function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(trimmed)) {
    return trimmed;
  }
  if (/^#[0-9a-f]{3}$/.test(trimmed)) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
  }
  return null;
}

function isCrosshairStyle(value: unknown): value is CrosshairStyle {
  return typeof value === 'string' && (CROSSHAIR_STYLES as readonly string[]).includes(value);
}

function clampNumber(value: unknown, limit: RangeLimit, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(limit.min, Math.min(limit.max, value));
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function defaultStorage(): SettingsStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
