import {
  Box3,
  Camera,
  Group,
  Mesh,
  Object3D,
  Quaternion,
  SkinnedMesh,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface ViewmodelWatchConfig {
  boneName: string;
  position: readonly [number, number, number];
  rotation: readonly [number, number, number];
  scale: number;
  faceCamera?: boolean;
  cameraFaceOffset?: number;
  cameraFaceRoll?: number;
  skinnedAnchor?: {
    materialName: string;
    vertexIndex: number;
  };
}

const WATCH_NAME = 'UnifiedTacticalWatch';
const WATCH_URL = '/viewmodels/shared/deagle-watch.glb';
const watchCameraPosition = new Vector3();
const watchWorldPosition = new Vector3();
const authoredFaceNormal = new Vector3(
  0.4524661188625032,
  0.5015301836829167,
  0.2099010200763587,
).normalize();
const authoredFaceAlignment = new Quaternion().setFromUnitVectors(
  authoredFaceNormal,
  new Vector3(0, 0, 1),
);
const watchLoader = new GLTFLoader();
let watchTemplatePromise: Promise<Object3D> | null = null;

export type ViewmodelWatchAssetLoader = () => Promise<Object3D>;

export function loadAuthoredViewmodelWatch(): Promise<Object3D> {
  watchTemplatePromise ??= watchLoader.loadAsync(WATCH_URL).then(({ scene }) => {
    const materialNames = new Set<string>();
    scene.traverse((candidate) => {
      if (!(candidate instanceof Mesh)) return;
      const materials = Array.isArray(candidate.material)
        ? candidate.material
        : [candidate.material];
      for (const material of materials) {
        materialNames.add(material.name);
        material.depthTest = true;
        material.depthWrite = true;
      }
      candidate.castShadow = false;
      candidate.receiveShadow = false;
      candidate.frustumCulled = false;
    });
    if (!materialNames.has('Watch') || !materialNames.has('Watch_Emission')) {
      throw new Error('[Viewmodel] authored Deagle watch materials are missing');
    }
    const bounds = new Box3().setFromObject(scene);
    if (bounds.isEmpty()) {
      throw new Error('[Viewmodel] authored Deagle watch contains no geometry');
    }
    scene.position.sub(bounds.getCenter(new Vector3()));
    scene.name = 'DeagleAuthoredWatchSource';
    const template = new Group();
    template.name = 'DeagleAuthoredWatchTemplate';
    template.add(scene);
    return template;
  });
  return watchTemplatePromise;
}

function normalizedName(name: string): string {
  return name.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

export function findViewmodelNode(root: Object3D, name: string): Object3D | null {
  const exact = root.getObjectByName(name);
  if (exact) {
    return exact;
  }

  const target = normalizedName(name);
  let match: Object3D | null = null;
  let suffixedMatch: Object3D | null = null;
  root.traverse((candidate) => {
    const candidateName = normalizedName(candidate.name);
    if (!match && candidateName === target) {
      match = candidate;
    } else if (
      !suffixedMatch
      && candidateName.startsWith(target)
      && /^\d+$/.test(candidateName.slice(target.length))
    ) {
      suffixedMatch = candidate;
    }
  });
  return match ?? suffixedMatch;
}

export function attachViewmodelWatch(
  root: Object3D,
  assetName: string,
  config: ViewmodelWatchConfig,
  authoredTemplate: Object3D,
): Group {
  const existing = root.getObjectByName(WATCH_NAME);
  if (existing instanceof Group) {
    return existing;
  }

  const wrist = findViewmodelNode(root, config.boneName);
  if (!wrist) {
    throw new Error(`[Viewmodel] ${assetName} is missing watch bone ${config.boneName}`);
  }

  const watch = new Group();
  watch.name = WATCH_NAME;
  watch.position.set(...config.position);
  watch.rotation.set(...config.rotation);
  watch.userData.faceCamera = config.faceCamera ?? false;
  watch.userData.cameraFaceOffset = config.cameraFaceOffset ?? 0;
  watch.userData.cameraFaceRoll = config.cameraFaceRoll ?? 0;

  const display = new Group();
  display.name = 'UnifiedWatchDisplay';
  display.scale.setScalar(config.scale);
  const authoredWatch = authoredTemplate.clone(true);
  authoredWatch.name = 'DeagleAuthoredWatchModel';
  authoredWatch.quaternion.copy(authoredFaceAlignment);
  display.add(authoredWatch);
  if (config.faceCamera) {
    if (config.skinnedAnchor) {
      const anchorMeshes: SkinnedMesh[] = [];
      root.traverse((candidate) => {
        if (anchorMeshes.length > 0 || !(candidate instanceof SkinnedMesh)) {
          return;
        }
        const materials = Array.isArray(candidate.material)
          ? candidate.material
          : [candidate.material];
        if (materials.some((material) => material.name === config.skinnedAnchor?.materialName)) {
          anchorMeshes.push(candidate);
        }
      });
      const anchorMesh = anchorMeshes[0];
      if (!anchorMesh) {
        throw new Error(
          `[Viewmodel] ${assetName} is missing watch anchor material ${config.skinnedAnchor.materialName}`,
        );
      }
      const positions = anchorMesh.geometry.getAttribute('position');
      if (
        !positions
        || config.skinnedAnchor.vertexIndex < 0
        || config.skinnedAnchor.vertexIndex >= positions.count
      ) {
        throw new Error(
          `[Viewmodel] ${assetName} has invalid watch anchor vertex ${config.skinnedAnchor.vertexIndex}`,
        );
      }
      watch.userData.cameraAnchorMesh = anchorMesh;
      watch.userData.cameraAnchorVertex = config.skinnedAnchor.vertexIndex;
    }
    root.add(display);
    watch.userData.cameraDisplay = display;
    watch.userData.cameraRoot = root;
  } else {
    watch.add(display);
  }
  wrist.add(watch);
  return watch;
}

export function faceViewmodelWatchTowardCamera(watch: Group | null): void {
  if (!watch?.userData.faceCamera) {
    return;
  }
  const display = watch.userData.cameraDisplay;
  const root = watch.userData.cameraRoot;
  if (!(display instanceof Group) || !(root instanceof Object3D)) {
    throw new Error('[Viewmodel] unified watch display is missing');
  }
  root.updateWorldMatrix(true, true);
  watch.updateWorldMatrix(true, true);
  const anchorMesh = watch.userData.cameraAnchorMesh;
  const anchorVertex = watch.userData.cameraAnchorVertex;
  if (anchorMesh instanceof SkinnedMesh && Number.isInteger(anchorVertex)) {
    anchorMesh.getVertexPosition(Number(anchorVertex), watchWorldPosition);
    anchorMesh.localToWorld(watchWorldPosition);
  } else {
    watch.getWorldPosition(watchWorldPosition);
  }
  root.worldToLocal(watchWorldPosition);
  display.position.copy(watchWorldPosition);
  let camera: Object3D | null = root.parent;
  while (camera && !(camera instanceof Camera)) {
    camera = camera.parent;
  }
  if (!(camera instanceof Camera)) {
    throw new Error('[Viewmodel] unified watch is not attached beneath a camera');
  }
  camera.getWorldPosition(watchCameraPosition);
  display.lookAt(watchCameraPosition);
  display.rotateZ(Number(watch.userData.cameraFaceRoll));
  display.translateZ(Number(watch.userData.cameraFaceOffset));
}
