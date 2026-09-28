import {
  BoxGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Texture,
} from 'three';
import { describe, expect, it } from 'vitest';
import {
  applyLightmaps,
  lightmapIndexForMesh,
  resolveEnvironment,
  resolveMapAssetPath,
} from '../MapEnvironment';

describe('MapEnvironment', () => {
  it('keeps the old lighting for maps without an environment', () => {
    const env = resolveEnvironment(undefined);
    expect(env.sky).toBeNull();
    expect(env.background.getHexString()).toBe(new Color('#9ab9d5').getHexString());
    expect(env.fogNear).toBe(140);
    expect(env.fogFar).toBe(1400);
    expect(env.hemiIntensity).toBeCloseTo(1.05);
    expect(env.sunIntensity).toBeCloseTo(1.35);
    expect(env.fillIntensity).toBeCloseTo(0.45);
    expect(env.lightmaps).toHaveLength(0);
  });

  it('resolves a full environment block and clamps bad values', () => {
    const env = resolveEnvironment({
      sky: { zenith: '#102040', horizon: '#ffaa66', clouds: { coverage: 3 } },
      sun: { direction: [0, 2, 0], color: '#ffeedd', intensity: 4 },
      hemi: { sky: '#aabbcc', ground: '#332211', intensity: 1.2 },
      fog: { color: '#ffaa66', near: 50, far: 10 },
      exposure: -1,
      lightmaps: [{ path: 'lightmap.webp' }, { path: '' }],
      lightMapIntensity: 7.5,
    });
    expect(env.sky).not.toBeNull();
    expect(env.sky!.clouds.coverage).toBe(1);
    expect(env.sunDirection.toArray()).toEqual([0, 1, 0]);
    expect(env.sunIntensity).toBe(4);
    expect(env.fogFar).toBeGreaterThan(env.fogNear);
    expect(env.exposure).toBeGreaterThan(0);
    expect(env.fillIntensity).toBe(0);
    expect(env.lightmaps).toEqual([{ path: 'lightmap.webp' }]);
    expect(env.lightMapIntensity).toBe(7.5);
  });

  it('turns indirectTint into gains that shift hue without changing brightness', () => {
    const plain = resolveEnvironment({ lightmapMode: 'indirect' });
    expect(plain.indirectTint.toArray()).toEqual([1, 1, 1]);
    const cool = resolveEnvironment({ lightmapMode: 'indirect', indirectTint: '#c4ccff' }).indirectTint;
    expect(0.2126 * cool.r + 0.7152 * cool.g + 0.0722 * cool.b).toBeCloseTo(1, 6);
    expect(cool.b).toBeGreaterThan(cool.r);
    expect(resolveEnvironment({ indirectTint: 'not a color' }).indirectTint.toArray()).toEqual([1, 1, 1]);
  });

  it('matches meshes to lightmaps by name, then the default', () => {
    const list = [{ path: 'a.webp' }, { path: 'far.webp', match: 'far_' }];
    expect(lightmapIndexForMesh('far_cliffs__rock', list)).toBe(1);
    expect(lightmapIndexForMesh('s1__sandstone', list)).toBe(0);
    expect(lightmapIndexForMesh('x', [{ path: 'only.webp', match: 'y' }])).toBe(-1);
  });

  it('resolves asset paths relative to the meta file', () => {
    expect(resolveMapAssetPath('/maps/x/lm.webp', '/maps/x/meta.json')).toBe('/maps/x/lm.webp');
    expect(resolveMapAssetPath('lm.webp', '/maps/x/meta.json')).toBe('/maps/x/lm.webp');
    expect(resolveMapAssetPath('https://cdn.test/lm.webp', '/maps/x/meta.json')).toBe('https://cdn.test/lm.webp');
  });

  it('swaps lightmapped standard materials for basic ones and leaves the rest alone', () => {
    const shared = new MeshStandardMaterial({ color: '#ff0000' });
    const lit = new BoxGeometry();
    lit.setAttribute('uv1', new Float32BufferAttribute(new Float32Array(lit.getAttribute('uv').count * 2), 2));
    const a = new Mesh(lit, shared);
    a.name = 's0__stone';
    const b = new Mesh(lit, shared);
    b.name = 's1__stone';
    const glow = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ emissive: '#00ffaa' }));
    glow.name = 's0__glow';
    const root = new Group();
    root.add(a, b, glow);
    const env = resolveEnvironment({ lightmaps: [{ path: 'lm.webp' }], lightMapIntensity: 5 });
    const texture = new Texture();
    expect(applyLightmaps(root, env, [texture])).toBe(2);
    expect(a.material).toBeInstanceOf(MeshBasicMaterial);
    expect(a.material).toBe(b.material);
    const basic = a.material as unknown as MeshBasicMaterial;
    expect(basic.lightMap).toBe(texture);
    expect(basic.lightMapIntensity).toBe(5);
    expect(basic.color.getHexString()).toBe('ff0000');
    expect(glow.material).toBeInstanceOf(MeshStandardMaterial);
  });
});
