import {
  Box3,
  Color,
  DoubleSide,
  Group,
  LoadingManager,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { CustomMapRecord, LoadedMap, MapManifestEntry, MapMeta } from './types';
import { resolveSpawn } from './SpawnResolver';
import { createMovementTestScene } from '../movement/MovementTestScene';

export interface MapLoadReporter {
  onStage?: (message: string) => void;
  onResolvedUrl?: (url: string) => void;
  onAssetProgress?: (progress: { url: string; loaded: number; total: number }) => void;
  onManagerProgress?: (progress: { url: string; itemsLoaded: number; itemsTotal: number }) => void;
  onLog?: (message: string) => void;
}

export class MapLoader {
  public async loadManifestEntry(entry: MapManifestEntry, reporter?: MapLoadReporter): Promise<LoadedMap> {
    if (entry.id === 'movement_test_scene') {
      reporter?.onStage?.(`Generating ${entry.name}`);
      const meta = await this.loadMeta(entry.metaPath, reporter);
      const generated = createMovementTestScene();
      const spawn = resolveSpawn(
        {
          ...meta,
          spawns: meta.spawns && meta.spawns.length > 0
            ? meta.spawns
            : [
                {
                  position: [generated.spawn.x, generated.spawn.y, generated.spawn.z],
                  yawDeg: 180,
                },
              ],
        },
        generated.root,
      );
      return {
        entry,
        meta,
        sceneRoot: generated.root,
        collisionRoot: generated.root.clone(true),
        spawnPosition: spawn.position,
        spawnYawDeg: spawn.yawDeg,
      };
    }

    const loader = this.createLoader(reporter);
    reporter?.onStage?.(`Loading scene: ${entry.scenePath}`);
    reporter?.onStage?.(`Loading collision: ${entry.collisionPath ?? entry.scenePath}`);
    reporter?.onStage?.(`Loading metadata: ${entry.metaPath}`);
    const [sceneRoot, collisionRoot, meta] = await Promise.all([
      this.loadGlbFromPath(loader, entry.scenePath, reporter),
      entry.collisionPath
        ? this.loadGlbFromPath(loader, entry.collisionPath, reporter)
        : this.loadGlbFromPath(loader, entry.scenePath, reporter),
      this.loadMeta(entry.metaPath, reporter),
    ]);
    this.normalizeRenderRoot(sceneRoot);
    this.normalizeCollisionRoot(collisionRoot);
    this.normalizeMapScale(sceneRoot, collisionRoot, meta, reporter);

    const spawn = resolveSpawn(meta, collisionRoot);
    return {
      entry,
      meta,
      sceneRoot,
      collisionRoot,
      spawnPosition: spawn.position,
      spawnYawDeg: spawn.yawDeg,
    };
  }

  public async loadCustomMap(record: CustomMapRecord, reporter?: MapLoadReporter): Promise<LoadedMap> {
    const loader = this.createLoader(reporter);
    reporter?.onStage?.(`Loading custom map blob: ${record.name}`);
    const root = await this.loadGlbFromBlob(loader, record.blob, reporter);
    this.normalizeRenderRoot(root);
    const collisionRoot = root.clone(true);
    this.normalizeCollisionRoot(collisionRoot);
    const meta = record.meta ?? this.makeFallbackMeta(record.name, record.id);
    this.normalizeMapScale(root, collisionRoot, meta, reporter);
    const spawn = resolveSpawn(meta, collisionRoot);

    const entry: MapManifestEntry = {
      id: record.id,
      name: record.name,
      author: meta.author,
      source: meta.source,
      license: meta.license,
      scenePath: '',
      collisionPath: '',
      metaPath: '',
    };

    return {
      entry,
      meta,
      sceneRoot: root,
      collisionRoot,
      spawnPosition: spawn.position,
      spawnYawDeg: spawn.yawDeg,
    };
  }

  private createLoader(reporter?: MapLoadReporter): GLTFLoader {
    const manager = new LoadingManager();
    manager.onProgress = (url, itemsLoaded, itemsTotal) => {
      reporter?.onManagerProgress?.({ url, itemsLoaded, itemsTotal });
    };
    manager.onError = (url) => {
      reporter?.onLog?.(`[MapLoader] LoadingManager error: ${url}`);
    };
    return new GLTFLoader(manager);
  }

  private async loadMeta(metaPath: string, reporter?: MapLoadReporter): Promise<MapMeta> {
    const resolvedUrl = this.resolveUrl(metaPath);
    reporter?.onResolvedUrl?.(resolvedUrl);
    const response = await fetch(metaPath);
    if (!response.ok) {
      throw new Error(`Failed to load map meta: ${resolvedUrl} (${response.status} ${response.statusText})`);
    }
    return (await response.json()) as MapMeta;
  }

  private async loadGlbFromPath(
    loader: GLTFLoader,
    path: string,
    reporter?: MapLoadReporter,
  ): Promise<Object3D> {
    const resolvedUrl = this.resolveUrl(path);
    reporter?.onResolvedUrl?.(resolvedUrl);
    return this.loadGlbWithLoader(loader, resolvedUrl, reporter);
  }

  private async loadGlbFromBlob(
    loader: GLTFLoader,
    blob: Blob,
    reporter?: MapLoadReporter,
  ): Promise<Object3D> {
    const url = URL.createObjectURL(blob);
    try {
      reporter?.onResolvedUrl?.(url);
      return await this.loadGlbWithLoader(loader, url, reporter);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  private loadGlbWithLoader(loader: GLTFLoader, url: string, reporter?: MapLoadReporter): Promise<Object3D> {
    return new Promise<Object3D>((resolve, reject) => {
      loader.load(
        url,
        (gltf) => {
          const root = gltf.scene ?? new Group();
          root.updateWorldMatrix(true, true);
          resolve(root);
        },
        (progressEvent) => {
          reporter?.onAssetProgress?.({
            url,
            loaded: progressEvent.loaded ?? 0,
            total: progressEvent.total ?? 0,
          });
        },
        (error) => {
          const errorMessage = this.formatLoadError(error);
          reject(new Error(`Failed to load GLB: ${url}\n${errorMessage}`));
        },
      );
    });
  }

  private normalizeMapScale(
    sceneRoot: Object3D,
    collisionRoot: Object3D,
    meta: MapMeta,
    reporter?: MapLoadReporter,
  ): void {
    const configured = meta.sceneScale;
    const configuredValid = typeof configured === 'number' && Number.isFinite(configured) && configured > 0;
    const autoScale = this.computeAutoScale(collisionRoot);
    const scale = configuredValid ? configured : autoScale;
    if (Math.abs(scale - 1) <= 1e-6) {
      return;
    }

    sceneRoot.scale.multiplyScalar(scale);
    collisionRoot.scale.multiplyScalar(scale);
    sceneRoot.updateWorldMatrix(true, true);
    collisionRoot.updateWorldMatrix(true, true);

    if (!configuredValid && Math.abs(autoScale - 1) > 1e-6) {
      meta.sceneScale = autoScale;
      reporter?.onLog?.(
        `[MapLoader] Applied auto scale ${autoScale.toFixed(6)}. Persist "sceneScale": ${autoScale} in map meta.json.`,
      );
    }
  }

  private computeAutoScale(root: Object3D): number {
    const bounds = new Box3().setFromObject(root);
    if (bounds.isEmpty()) {
      return 1;
    }

    const size = new Vector3();
    bounds.getSize(size);
    const largestDimension = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(largestDimension) || largestDimension <= 1e-6) {
      return 1;
    }
    if (largestDimension <= 5000 && largestDimension >= 5) {
      return 1;
    }

    const targetLargest = 600;
    return targetLargest / largestDimension;
  }

  private resolveUrl(path: string): string {
    try {
      return new URL(path, window.location.href).href;
    } catch {
      return path;
    }
  }

  private formatLoadError(error: unknown): string {
    if (error instanceof Error) {
      return `${error.message}\n${error.stack ?? ''}`.trim();
    }
    if (typeof error === 'string') {
      return error;
    }
    return JSON.stringify(error);
  }

  private makeFallbackMeta(name: string, id: string): MapMeta {
    return {
      id,
      name,
      author: 'Custom',
      source: 'Local import',
      license: 'User supplied',
    };
  }

  private normalizeRenderRoot(root: Object3D): void {
    let meshIndex = 0;
    root.traverse((child) => {
      if (!(child instanceof Mesh)) {
        return;
      }
      meshIndex += 1;
      child.geometry.computeVertexNormals();

      const source = child.material;
      if (source instanceof MeshStandardMaterial) {
        source.side = DoubleSide;
        source.needsUpdate = true;
      } else {
        const seededColor = new Color().setHSL((meshIndex * 0.14) % 1, 0.36, 0.56);
        child.material = new MeshStandardMaterial({
          color: seededColor,
          roughness: 0.9,
          metalness: 0.05,
          side: DoubleSide,
        });
      }
    });
  }

  private normalizeCollisionRoot(root: Object3D): void {
    root.traverse((child) => {
      if (!(child instanceof Mesh)) {
        return;
      }
      child.geometry.computeVertexNormals();
    });
  }
}

export function vectorToSpawn(v: Vector3): [number, number, number] {
  return [v.x, v.y, v.z];
}
