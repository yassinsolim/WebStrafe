export interface GameSettings {
  mouseSensitivity: number;
  worldFov: number;
  autoBhop: boolean;
  showHud: boolean;
  viewmodelFov: number;
  viewmodelScale: number;
}

const STORAGE_KEY = 'webstrafe-settings-v1';

export const defaultSettings: GameSettings = {
  mouseSensitivity: 1,
  worldFov: 100,
  autoBhop: false,
  showHud: true,
  viewmodelFov: 68,
  viewmodelScale: 1,
};

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...defaultSettings };
    }

    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    return {
      mouseSensitivity: clamp(parsed.mouseSensitivity, 0.1, 4, defaultSettings.mouseSensitivity),
      worldFov: clamp(parsed.worldFov, 70, 130, defaultSettings.worldFov),
      autoBhop: parsed.autoBhop ?? defaultSettings.autoBhop,
      showHud: parsed.showHud ?? defaultSettings.showHud,
      viewmodelFov: clamp(parsed.viewmodelFov, 45, 110, defaultSettings.viewmodelFov),
      viewmodelScale: clamp(parsed.viewmodelScale, 0.25, 3, defaultSettings.viewmodelScale),
    };
  } catch {
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
