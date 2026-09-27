import { Box3, Group, Matrix4, Mesh, Object3D, Vector3 } from 'three';
import { getKnife, type KnifeId } from '../combat/knives';
import { buildProceduralKnife, disposeProceduralKnife } from './ProceduralKnife';

/** Rough real-world length of the knife authored into the arms viewmodel, metres. */
const AUTHORED_KNIFE_LENGTH_M = 0.27;
const PROCEDURAL_NAME = 'ProceduralKnifeMount';

export interface KnifeFrame {
  /** unit vector (in the mount's local space) from grip towards the tip */
  tipAxis: Vector3;
  /** unit vector towards the spine */
  spineAxis: Vector3;
  /** where the middle of the authored handle sat */
  gripCenter: Vector3;
  /** local units per metre */
  unitsPerMetre: number;
}

/**
 * Works out the authored knife's frame from its bounding box in the parent
 * node's space: the longest extent is the blade axis, the tip is the end
 * farther from the node origin (the grip), the second extent is the spine.
 */
export function measureAuthoredKnife(mesh: Mesh): KnifeFrame {
  mesh.geometry.computeBoundingBox();
  const local = mesh.geometry.boundingBox!.clone();
  mesh.updateMatrix();
  const box = new Box3().setFromPoints(boxCorners(local).map((p) => p.applyMatrix4(mesh.matrix)));
  const size = box.getSize(new Vector3());
  const axes = [0, 1, 2].sort((a, b) => size.getComponent(b) - size.getComponent(a));
  const long = axes[0];
  const tall = axes[1];
  const min = box.min.getComponent(long);
  const max = box.max.getComponent(long);
  const tipSign = Math.abs(max) >= Math.abs(min) ? 1 : -1;
  const tipAxis = new Vector3().setComponent(long, tipSign);
  const spineAxis = new Vector3().setComponent(tall, 1);
  const length = max - min;
  const handleEnd = tipSign > 0 ? min : max;
  const gripCenter = box.getCenter(new Vector3());
  gripCenter.setComponent(long, handleEnd + tipSign * length * 0.2);
  return { tipAxis, spineAxis, gripCenter, unitsPerMetre: length / AUTHORED_KNIFE_LENGTH_M };
}

/** Places a procedural knife (tip +X, spine +Y, grip at -handle/2) into `frame`. */
export function fitProceduralKnife(knife: Group, id: KnifeId, frame: KnifeFrame): void {
  const def = getKnife(id);
  const z = new Vector3().crossVectors(frame.tipAxis, frame.spineAxis).normalize();
  const basis = new Matrix4().makeBasis(frame.tipAxis, frame.spineAxis, z);
  knife.quaternion.setFromRotationMatrix(basis);
  knife.scale.setScalar(frame.unitsPerMetre);
  // grip centre in knife space is (-handle/2, bladeHeight/2, 0)
  const grip = new Vector3(-def.shape.handleLength / 2, def.shape.bladeHeight / 2, 0)
    .applyQuaternion(knife.quaternion)
    .multiplyScalar(frame.unitsPerMetre);
  knife.position.copy(frame.gripCenter).sub(grip);
}

/**
 * Swaps the blade inside an imported arms+knife viewmodel for a procedural
 * knife. The procedural knife is parented to the authored knife node, so every
 * existing draw/idle/attack/inspect animation keeps driving it.
 * Returns false when the model has no swappable knife.
 */
export function applyKnifeStyle(root: Object3D, id: KnifeId | null, options: { nodeName?: string; meshName?: string } = {}): boolean {
  const node = root.getObjectByName(options.nodeName ?? 'knife');
  const authored = root.getObjectByName(options.meshName ?? 'knife_knife_0');
  if (!node || !(authored instanceof Mesh)) {
    return false;
  }
  const previous = node.getObjectByName(PROCEDURAL_NAME);
  if (previous) {
    node.remove(previous);
    previous.traverse((child) => {
      if (child instanceof Group && child.name.startsWith('ProceduralKnife:')) disposeProceduralKnife(child);
    });
  }
  if (!id) {
    authored.visible = true;
    return true;
  }
  if (!node.userData.authoredKnifeFrame) {
    node.userData.authoredKnifeFrame = measureAuthoredKnife(authored);
  }
  const frame = node.userData.authoredKnifeFrame as KnifeFrame;
  const mount = new Group();
  mount.name = PROCEDURAL_NAME;
  const knife = buildProceduralKnife(getKnife(id));
  fitProceduralKnife(knife, id, frame);
  // match how the authored viewmodel meshes draw in the overlay pass
  knife.traverse((child) => {
    if (child instanceof Mesh) {
      child.frustumCulled = false;
      child.renderOrder = authored.renderOrder;
      child.castShadow = false;
      child.receiveShadow = false;
    }
  });
  mount.add(knife);
  node.add(mount);
  authored.visible = false;
  return true;
}

function boxCorners(box: Box3): Vector3[] {
  const out: Vector3[] = [];
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) out.push(new Vector3(x, y, z));
    }
  }
  return out;
}
