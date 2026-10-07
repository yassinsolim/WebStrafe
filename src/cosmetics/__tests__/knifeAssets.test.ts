import { describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from 'three';

const loaded: Array<{ geometry: BoxGeometry; texture: Texture }> = [];

vi.mock('../../assets/gltfLoader', () => ({
  sharedGltfLoader: () => ({
    loadAsync: async () => {
      const geometry = new BoxGeometry();
      const texture = new Texture();
      loaded.push({ geometry, texture });
      const scene = new Group();
      scene.add(new Mesh(geometry, new MeshStandardMaterial({ map: texture })));
      return { scene };
    },
  }),
}));

const { disposeKnifeModel, loadKnifeModel, loadedKnifeModels } = await import('../knifeAssets');

function disposed(target: { addEventListener(type: 'dispose', fn: () => void): void }): () => boolean {
  let done = false;
  target.addEventListener('dispose', () => {
    done = true;
  });
  return () => done;
}

describe('knife model memory', () => {
  it('keeps the last unused knife and unloads older ones', async () => {
    const a = (await loadKnifeModel('karambit'))!;
    const aTexture = disposed(loaded[0].texture);
    const aGeometry = disposed(loaded[0].geometry);
    disposeKnifeModel(a);
    expect(loadedKnifeModels()).toContain('karambit');

    const b = (await loadKnifeModel('bayonet'))!;
    disposeKnifeModel(b);
    await Promise.resolve();
    expect(loadedKnifeModels()).not.toContain('karambit');
    expect(loadedKnifeModels()).toContain('bayonet');
    expect(aTexture()).toBe(true);
    expect(aGeometry()).toBe(true);
  });

  it('never unloads a knife something still holds', async () => {
    const first = (await loadKnifeModel('flip'))!;
    const second = (await loadKnifeModel('flip'))!;
    disposeKnifeModel(first);
    const other = (await loadKnifeModel('gut'))!;
    disposeKnifeModel(other);
    const another = (await loadKnifeModel('talon'))!;
    disposeKnifeModel(another);
    await Promise.resolve();
    expect(loadedKnifeModels()).toContain('flip');
    disposeKnifeModel(second);
  });

  it('takes a knife back when a copy is asked for while it unloads', async () => {
    const held = (await loadKnifeModel('huntsman'))!;
    const bowie = (await loadKnifeModel('bowie'))!;
    disposeKnifeModel(bowie);
    const bowieTexture = disposed(loaded[loaded.length - 1].texture);
    // the copy is asked for, then the huntsman goes and pushes the bowie out before the copy is made
    const pending = loadKnifeModel('bowie');
    disposeKnifeModel(held);
    const copy = (await pending)!;
    await Promise.resolve();
    await Promise.resolve();
    expect(copy).not.toBeNull();
    expect(loadedKnifeModels()).toContain('bowie');
    expect(bowieTexture()).toBe(false);
    disposeKnifeModel(copy);
  });
});
