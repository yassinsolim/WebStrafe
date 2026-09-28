import { describe, expect, it } from 'vitest';
import { QUALITY_PRESETS, detectQuality, resolveQuality } from '../quality';

describe('quality presets', () => {
  it('auto starts every real gpu on balanced and never picks high', () => {
    const gpus = [
      'ANGLE (Apple, ANGLE Metal Renderer: Apple M5, Unspecified Version)',
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (AMD, AMD Radeon RX 7800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'something new',
      '',
    ];
    for (const gpu of gpus) expect(detectQuality(gpu), gpu).toBe('medium');
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

  it('an explicit setting wins over detection', () => {
    expect(resolveQuality('high', 'Mali-G78').level).toBe('high');
    expect(resolveQuality('auto', 'Apple M5').level).toBe('medium');
  });

  it('every cost only grows from low to high', () => {
    const { low, medium, high } = QUALITY_PRESETS;
    for (const key of ['msaa', 'shadowMapSize', 'maxPixelRatio', 'effectDensity', 'bloomLevels', 'maxDecals'] as const) {
      expect(low[key], key).toBeLessThanOrEqual(medium[key]);
      expect(medium[key], key).toBeLessThanOrEqual(high[key]);
    }
    expect(low.ao || medium.ao).toBe(false);
    expect(high.ao).toBe(true);
    // no msaa means the composite has to antialias
    for (const preset of [low, medium, high]) expect(preset.msaa > 0 || preset.fxaa).toBe(true);
  });
});
