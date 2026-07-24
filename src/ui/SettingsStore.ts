export interface GameSettings {
  mouseSensitivity: number;
  worldFov: number;
  autoBhop: boolean;
  showHud: boolean;
  viewmodelFov: number;
  viewmodelScale: number;
}

const STORAGE_KEY = 'webstrafe-settings-v2';
const LEGACY_STORAGE_KEY = 'webstrafe-settings-v1';

export const defaultSettings: GameSettings = {
  mouseSensitivity: 1,
  worldFov: 100,
  autoBhop: true,
  showHud: true,
  viewmodelFov: 68,
  viewmodelScale: 1,
};

export function loadSettings(): GameSettings {
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    const legacy = current === null ? localStorage.getItem(LEGACY_STORAGE_KEY) : null;
    const raw = current ?? legacy;
    if (!raw) {
      return { ...defaultSettings };
    }

    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    const settings = {
      mouseSensitivity: clamp(parsed.mouseSensitivity, 0.1, 4, defaultSettings.mouseSensitivity),
      worldFov: clamp(parsed.worldFov, 70, 130, defaultSettings.worldFov),
      autoBhop: legacy === null
        ? parsed.autoBhop ?? defaultSettings.autoBhop
        : true,
      showHud: parsed.showHud ?? defaultSettings.showHud,
      viewmodelFov: clamp(parsed.viewmodelFov, 45, 110, defaultSettings.viewmodelFov),
      viewmodelScale: clamp(parsed.viewmodelScale, 0.25, 3, defaultSettings.viewmodelScale),
    };
    if (legacy !== null) {
      saveSettings(settings);
    }
    return settings;
  } catch (error) {
    console.warn('[Settings] Stored preferences could not be loaded; using defaults.', error);
    return { ...defaultSettings };
  }
}

export function saveSettings(settings: GameSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}
