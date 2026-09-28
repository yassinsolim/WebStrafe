import { describe, expect, it } from 'vitest';
import { defaultCrosshair, validateCrosshair, type CrosshairSettings } from '../SettingsStore';
import {
  CROSSHAIR_COLORS,
  CROSSHAIR_PRESETS,
  crosshairEquals,
  decodeCrosshairCode,
  encodeCrosshairCode,
} from '../hud/crosshairPresets';

describe('crosshair presets', () => {
  it('are all valid settings with unique ids', () => {
    const ids = new Set(CROSSHAIR_PRESETS.map((preset) => preset.id));
    expect(ids.size).toBe(CROSSHAIR_PRESETS.length);
    for (const preset of CROSSHAIR_PRESETS) {
      expect(validateCrosshair(preset.settings)).toEqual(preset.settings);
    }
  });

  it('start with the default crosshair', () => {
    expect(crosshairEquals(CROSSHAIR_PRESETS[0].settings, defaultCrosshair)).toBe(true);
  });

  it('only offer proper hex colours', () => {
    for (const swatch of CROSSHAIR_COLORS) {
      expect(swatch.color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('crosshair share codes', () => {
  it('round trips every preset', () => {
    for (const preset of CROSSHAIR_PRESETS) {
      const code = encodeCrosshairCode(preset.settings);
      expect(code).toMatch(/^WS1(-[0-9A-F]{4}){4}$/);
      expect(decodeCrosshairCode(code)).toEqual(preset.settings);
    }
  });

  it('round trips edge values', () => {
    const extreme: CrosshairSettings = {
      style: 'circle-dot',
      size: 20,
      gap: -4,
      thickness: 6,
      color: '#0a0b0c',
      outline: false,
      outlineThickness: 3,
      dot: true,
      tStyle: true,
      alpha: 0.1,
      dynamicSpread: false,
    };
    expect(decodeCrosshairCode(encodeCrosshairCode(extreme))).toEqual(extreme);
    const smallest = { ...extreme, size: 0, gap: 20, thickness: 0.5, outlineThickness: 0.5, alpha: 1 };
    expect(decodeCrosshairCode(encodeCrosshairCode(smallest))).toEqual(smallest);
  });

  it('accepts lower case and loose spacing', () => {
    const code = encodeCrosshairCode(defaultCrosshair);
    expect(decodeCrosshairCode(`  ${code.toLowerCase().replace(/-/g, ' ')} `)).toEqual(defaultCrosshair);
  });

  it('rejects junk', () => {
    expect(decodeCrosshairCode('')).toBeNull();
    expect(decodeCrosshairCode('CSGO-abcde-fghij')).toBeNull();
    expect(decodeCrosshairCode('WS1-0000')).toBeNull();
    expect(decodeCrosshairCode('WS1-ZZZZ-ZZZZ-ZZZZ-ZZZZ')).toBeNull();
    // style index 9 does not exist
    expect(decodeCrosshairCode('WS1-90A0-C34D-FF94-B214')).toBeNull();
  });

  it('snaps off-step values to the nearest step', () => {
    const decoded = decodeCrosshairCode(encodeCrosshairCode({ ...defaultCrosshair, size: 5.3, alpha: 0.97 }));
    expect(decoded?.size).toBe(5.5);
    expect(decoded?.alpha).toBe(0.95);
  });
});
