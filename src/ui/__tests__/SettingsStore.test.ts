import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SETTINGS_STORAGE_KEY,
  SETTINGS_VERSION,
  cloneSettings,
  defaultSettings,
  loadSettings,
  migrateSettings,
  normalizeHexColor,
  saveSettings,
  validateSettings,
} from '../SettingsStore';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SettingsStore auto-bhop default', () => {
  it('enables auto-bhop for a fresh profile', () => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    expect(defaultSettings.autoBhop).toBe(true);
    expect(loadSettings().autoBhop).toBe(true);
  });

  it('migrates v1 settings to auto-bhop on while preserving other preferences', () => {
    const storage = new MemoryStorage();
    storage.setItem('webstrafe-settings-v1', JSON.stringify({
      mouseSensitivity: 1.75,
      autoBhop: false,
      showHud: false,
    }));
    vi.stubGlobal('localStorage', storage);

    expect(loadSettings()).toMatchObject({
      mouseSensitivity: 1.75,
      autoBhop: true,
      showHud: true,
      showMovementDebug: false,
    });
    expect(JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY) ?? '{}')).toMatchObject({
      version: SETTINGS_VERSION,
      mouseSensitivity: 1.75,
      autoBhop: true,
    });
  });

  it('preserves an explicit opt-out after migration', () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    saveSettings({ ...defaultSettings, autoBhop: false });
    expect(loadSettings().autoBhop).toBe(false);
  });
});

describe('SettingsStore v2 to v3 migration', () => {
  it('keeps look and fov preferences and fills new fields with defaults', () => {
    const storage = new MemoryStorage();
    storage.setItem('webstrafe-settings-v2', JSON.stringify({
      mouseSensitivity: 0.6,
      worldFov: 90,
      autoBhop: false,
      showHud: true,
      viewmodelFov: 60,
      viewmodelScale: 1.4,
    }));

    const loaded = loadSettings(storage);
    expect(loaded).toMatchObject({
      mouseSensitivity: 0.6,
      worldFov: 90,
      autoBhop: false,
      viewmodelFov: 60,
      viewmodelScale: 1.4,
      zoomSensitivityRatio: 1,
      masterVolume: defaultSettings.masterVolume,
      crosshair: defaultSettings.crosshair,
    });
    const stored = JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY) ?? '{}');
    expect(stored.version).toBe(3);
    expect(stored.worldFov).toBe(90);
  });

  it('turns the old always-on debug readout off', () => {
    const migrated = migrateSettings({ showHud: true }, 2);
    expect(migrated.showMovementDebug).toBe(false);
    expect(migrated.showHud).toBe(true);
  });

  it('prefers the v3 key over older keys', () => {
    const storage = new MemoryStorage();
    storage.setItem('webstrafe-settings-v2', JSON.stringify({ mouseSensitivity: 3 }));
    saveSettings({ ...defaultSettings, mouseSensitivity: 0.5 }, storage);
    expect(loadSettings(storage).mouseSensitivity).toBe(0.5);
  });

  it('keeps a v3 player choice for the debug overlay', () => {
    const storage = new MemoryStorage();
    saveSettings({ ...defaultSettings, showMovementDebug: true, showNetGraph: true }, storage);
    expect(loadSettings(storage)).toMatchObject({ showMovementDebug: true, showNetGraph: true });
  });
});

describe('SettingsStore validation', () => {
  it('returns complete defaults for garbage input', () => {
    for (const raw of [null, undefined, 42, 'x', [], [1, 2]]) {
      expect(validateSettings(raw)).toEqual(defaultSettings);
    }
  });

  it('clamps numbers into range and rejects non-finite values', () => {
    const settings = validateSettings({
      mouseSensitivity: 99,
      zoomSensitivityRatio: -1,
      worldFov: Number.NaN,
      masterVolume: 2,
      effectsVolume: '0.5',
      uiVolume: Number.POSITIVE_INFINITY,
    });
    expect(settings.mouseSensitivity).toBe(4);
    expect(settings.zoomSensitivityRatio).toBe(0.1);
    expect(settings.worldFov).toBe(defaultSettings.worldFov);
    expect(settings.masterVolume).toBe(1);
    expect(settings.effectsVolume).toBe(defaultSettings.effectsVolume);
    expect(settings.uiVolume).toBe(defaultSettings.uiVolume);
  });

  it('validates the nested crosshair and merges partial objects', () => {
    const settings = validateSettings({
      crosshair: { style: 'circle-dot', size: 100, color: '#ABC', gap: 'wide', outline: 0 },
    });
    expect(settings.crosshair).toEqual({
      ...defaultSettings.crosshair,
      style: 'circle-dot',
      size: 20,
      color: '#aabbcc',
    });
    expect(validateSettings({ crosshair: { style: 'star', color: 'red' } }).crosshair).toEqual(
      defaultSettings.crosshair,
    );
  });

  it('drops unknown fields', () => {
    const settings = validateSettings({ ...defaultSettings, hax: true }) as unknown as Record<string, unknown>;
    expect(settings.hax).toBeUndefined();
  });

  it('normalizes hex colours', () => {
    expect(normalizeHexColor(' #FFaa00 ')).toBe('#ffaa00');
    expect(normalizeHexColor('#0f8')).toBe('#00ff88');
    expect(normalizeHexColor('ff0000')).toBeNull();
    expect(normalizeHexColor('#12345')).toBeNull();
  });

  it('falls back to defaults on corrupted json and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const storage = new MemoryStorage();
    storage.setItem(SETTINGS_STORAGE_KEY, '{not json');
    expect(loadSettings(storage)).toEqual(defaultSettings);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('survives storage that throws', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(loadSettings(broken)).toEqual(defaultSettings);
    expect(saveSettings(defaultSettings, broken)).toBe(false);
  });

  it('clones deeply so the nested crosshair is never shared', () => {
    const copy = cloneSettings(defaultSettings);
    copy.crosshair.size = 12;
    expect(defaultSettings.crosshair.size).not.toBe(12);
  });
});
