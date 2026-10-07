import { describe, expect, it } from 'vitest';
import { QUALITY_PRESETS, applyOverrides, autoFallbackQuality, detectQuality, resolveQuality } from '../quality';
import { defaultGraphics } from '../../ui/SettingsStore';

describe('quality presets', () => {
  it('starts desktop auto on balanced without assuming a gpu name guarantees headroom', () => {
    for (const gpu of [
      'ANGLE (Apple, ANGLE Metal Renderer: Apple M5, Unspecified Version)',
      'ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)',
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (AMD, AMD Radeon RX 7800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
    ]) {
      expect(detectQuality(gpu), gpu).toBe('medium');
      expect(resolveQuality('auto', gpu)).toMatchObject({ msaa: 0, ao: false, maxPixelRatio: 1.25 });
    }
  });

  it('auto starts every other real gpu on balanced', () => {
    for (const gpu of [
      'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)',
      'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)',
      'ANGLE (NVIDIA, NVIDIA GeForce GTX 970 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (AMD, AMD Radeon(TM) RX Vega 11 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (Intel, Intel(R) Arc(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'something new',
      '',
    ]) {
      expect(detectQuality(gpu), gpu).toBe('medium');
    }
  });

  it('puts software gl, phone gpus and old intel graphics on low', () => {
    for (const gpu of [
      'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)',
      'Mali-G78',
      'Adreno (TM) 740',
      'Apple GPU',
      'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    ]) {
      expect(detectQuality(gpu), gpu).toBe('low');
    }
  });

  it('keeps high and ultra available as explicit choices', () => {
    expect(resolveQuality('high', 'Mali-G78').level).toBe('high');
    expect(resolveQuality('ultra', 'Mali-G78').level).toBe('ultra');
    expect(resolveQuality('auto', 'Apple M5').level).toBe('medium');
    expect(resolveQuality('high', 'Apple M5')).toMatchObject({ msaa: 4, ao: true, maxPixelRatio: 2 });
  });

  it('reduces auto effects after two resolution drops, including balanced to low', () => {
    expect(autoFallbackQuality('high', 1)).toBeNull();
    expect(autoFallbackQuality('medium', 0.85)).toBeNull();
    expect(autoFallbackQuality('high', 0.7)).toBe('medium');
    expect(autoFallbackQuality('medium', 0.7)).toBe('low');
    expect(autoFallbackQuality('low', 0.5)).toBeNull();
  });

  it('every cost only grows from low to ultra', () => {
    const { low, medium, high, ultra } = QUALITY_PRESETS;
    const keys = ['msaa', 'shadowMapSize', 'maxPixelRatio', 'effectDensity', 'bloomLevels', 'maxDecals', 'normalMapSize', 'anisotropy'] as const;
    for (const key of keys) {
      expect(low[key], key).toBeLessThanOrEqual(medium[key]);
      expect(medium[key], key).toBeLessThanOrEqual(high[key]);
      expect(high[key], key).toBeLessThanOrEqual(ultra[key]);
    }
    expect(low.ao || medium.ao).toBe(false);
    expect(high.ao && ultra.ao).toBe(true);
    // no msaa means the composite has to antialias
    for (const preset of [low, medium, high, ultra]) expect(preset.msaa > 0 || preset.fxaa).toBe(true);
  });

  it('keeps the preset object itself when nothing is overridden', () => {
    expect(applyOverrides(QUALITY_PRESETS.high, { ...defaultGraphics })).toBe(QUALITY_PRESETS.high);
    expect(applyOverrides(QUALITY_PRESETS.high, undefined)).toBe(QUALITY_PRESETS.high);
  });

  it('puts the player picks on top of the preset', () => {
    const custom = applyOverrides(QUALITY_PRESETS.medium, {
      ...defaultGraphics,
      antiAliasing: 'msaa4',
      shadows: 'high',
      ambientOcclusion: 'on',
      textureFiltering: '16',
    });
    expect(custom).toMatchObject({ level: 'medium', msaa: 4, fxaa: false, shadowMapSize: 4096, ao: true, anisotropy: 16 });
    const lean = applyOverrides(QUALITY_PRESETS.ultra, { ...defaultGraphics, antiAliasing: 'fxaa', shadows: 'off', bloom: 'off' });
    expect(lean).toMatchObject({ msaa: 0, fxaa: true, shadowMapSize: 0, bloom: false });
    // bloom on over a preset without a bloom chain gets one
    expect(applyOverrides(QUALITY_PRESETS.low, { bloom: 'on' }).bloomLevels).toBeGreaterThan(0);
  });
});
