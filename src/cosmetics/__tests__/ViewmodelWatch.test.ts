import { Bone, Group, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  attachViewmodelWatch,
  faceViewmodelWatchTowardCamera,
  findViewmodelNode,
} from '../ViewmodelWatch';

const config = {
  boneName: 'Wrist.L',
  position: [0, 0, 0] as const,
  rotation: [0, 0, 0] as const,
  scale: 1,
};
const authoredWatch = new Group();
authoredWatch.name = 'AuthoredWatchFixture';

describe('ViewmodelWatch', () => {
  it('matches sanitized wrist names and attaches one reusable watch', () => {
    const root = new Group();
    const ikWrist = new Bone();
    ikWrist.name = 'Wrist_IK.L_01';
    const wrist = new Bone();
    wrist.name = 'Wrist.L_09';
    root.add(ikWrist, wrist);

    expect(findViewmodelNode(root, 'Wrist.L')).toBe(wrist);
    const first = attachViewmodelWatch(root, 'test', config, authoredWatch);
    const second = attachViewmodelWatch(root, 'test', config, authoredWatch);

    expect(first).toBe(second);
    expect(first.parent).toBe(wrist);
    expect(first.getObjectByName('DeagleAuthoredWatchModel')).toBeDefined();
    expect(first.getObjectByName('UnifiedWatchBand')).toBeUndefined();
    expect(first.getObjectByName('UnifiedWatchFace')).toBeUndefined();
  });

  it('rejects an asset without the configured wrist', () => {
    expect(() => attachViewmodelWatch(new Group(), 'test', config, authoredWatch))
      .toThrow('[Viewmodel] test is missing watch bone Wrist.L');
  });

  it('keeps a camera-facing watch on the wrist-to-camera axis', () => {
    const camera = new PerspectiveCamera();
    camera.position.set(2, 3, 4);
    const viewmodelRoot = new Group();
    viewmodelRoot.position.set(0.3, -0.2, -0.8);
    camera.add(viewmodelRoot);
    const root = new Group();
    root.rotation.y = 0.35;
    viewmodelRoot.add(root);
    const wrist = new Bone();
    wrist.name = 'Wrist.L';
    wrist.position.set(0.4, -0.1, -0.6);
    root.add(wrist);
    const offset = 0.25;
    const watch = attachViewmodelWatch(root, 'test', {
      ...config,
      faceCamera: true,
      cameraFaceOffset: offset,
    }, authoredWatch);
    camera.updateWorldMatrix(true, true);
    const anchor = watch.getWorldPosition(new Vector3());
    const cameraPosition = camera.getWorldPosition(new Vector3());
    const expected = anchor.clone().add(
      cameraPosition.clone().sub(anchor).normalize().multiplyScalar(offset),
    );

    faceViewmodelWatchTowardCamera(watch);

    const display = root.getObjectByName('UnifiedWatchDisplay');
    expect(display?.getWorldPosition(new Vector3()).distanceTo(expected)).toBeLessThan(1e-9);
  });
});
