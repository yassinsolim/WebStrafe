import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings, loadSettings, saveSettings } from '../SettingsStore';

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
      showHud: false,
    });
    expect(JSON.parse(storage.getItem('webstrafe-settings-v2') ?? '{}')).toMatchObject({
      mouseSensitivity: 1.75,
      autoBhop: true,
      showHud: false,
    });
  });

  it('preserves an explicit opt-out after migration', () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    saveSettings({ ...defaultSettings, autoBhop: false });
    expect(loadSettings().autoBhop).toBe(false);
  });
});
