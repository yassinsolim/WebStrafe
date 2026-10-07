import { DirectionalLight, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, type ShaderMaterial, type WebGLRenderer } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { RenderPipeline } from '../RenderPipeline';
import { QUALITY_PRESETS } from '../quality';

describe('shader warm-up ownership', () => {
  it('prepares the low composite without changing the active preset', async () => {
    const compileAsync = vi.fn(async (scene: Scene) => {
      const material = (scene.children[0] as Mesh).material as ShaderMaterial;
      expect(material.defines).not.toHaveProperty('USE_BLOOM');
      expect(material.defines).not.toHaveProperty('USE_AO');
      return new Set();
    });
    const pipeline = new RenderPipeline({ compileAsync } as unknown as WebGLRenderer);
    pipeline.setPreset(QUALITY_PRESETS.medium);
    await pipeline.warmUpComposite(QUALITY_PRESETS.low);
    expect(pipeline.getPreset()).toBe(QUALITY_PRESETS.medium);
    const material = (compileAsync.mock.calls[0][0].children[0] as Mesh).material as ShaderMaterial;
    expect(material.defines).toHaveProperty('USE_BLOOM');
    pipeline.dispose();
  });

  it('retains independent materials and their shader customizations until cleared', async () => {
    const compileAsync = vi.fn(async (_scene: Scene) => new Set());
    const pipeline = new RenderPipeline({ compileAsync } as unknown as WebGLRenderer);
    const scene = new Scene();
    const material = new MeshStandardMaterial();
    material.onBeforeCompile = vi.fn();
    material.customProgramCacheKey = () => 'custom-knife-shader';
    scene.add(new Mesh(undefined, material), new Mesh(undefined, material));
    scene.add(new DirectionalLight());
    const camera = new PerspectiveCamera();
    await pipeline.warmUp(scene, camera);
    const snapshot = compileAsync.mock.calls[0][0];
    expect(compileAsync.mock.calls[0]).toHaveLength(2);
    expect(snapshot.children.filter(node => node instanceof DirectionalLight)).toHaveLength(1);
    const first = snapshot.children[0] as Mesh;
    const second = snapshot.children[1] as Mesh;
    expect(first.material).not.toBe(material);
    expect(first.material).toBe(second.material);
    const copy = first.material as MeshStandardMaterial;
    expect(copy.onBeforeCompile).toBe(material.onBeforeCompile);
    expect(copy.customProgramCacheKey()).toBe('custom-knife-shader');
    const dispose = vi.spyOn(copy, 'dispose');
    material.dispose();
    expect(dispose).not.toHaveBeenCalled();
    pipeline.clearWarmup();
    expect(dispose).toHaveBeenCalledOnce();
    pipeline.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('does not retain a compile that finishes after the map changed', async () => {
    let finish!: () => void;
    const compileAsync = vi.fn((_scene: Scene) => new Promise<void>(resolve => { finish = resolve; }));
    const pipeline = new RenderPipeline({ compileAsync } as unknown as WebGLRenderer);
    const scene = new Scene();
    scene.add(new Mesh(undefined, new MeshStandardMaterial()));
    const pending = pipeline.warmUp(scene, new PerspectiveCamera());
    const snapshot = compileAsync.mock.calls[0][0];
    const dispose = vi.spyOn((snapshot.children[0] as Mesh).material as MeshStandardMaterial, 'dispose');
    pipeline.clearWarmup();
    finish();
    await pending;
    expect(dispose).toHaveBeenCalledOnce();
    pipeline.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });
});