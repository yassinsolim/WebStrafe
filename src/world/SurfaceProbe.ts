import { Mesh, Raycaster, Vector3, type Material, type Object3D } from 'three';
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh';
import { surfaceProfile, type SurfaceKind } from '../render/worldMaterials';

/**
 * tells what a bullet hit by casting a short ray against the render meshes
 * (the collision mesh has no materials). each map mesh gets a bvh once, built
 * indirect so the render index buffer is left alone.
 */
export class SurfaceProbe {
  private readonly meshes: Mesh[] = [];
  private readonly raycaster = new Raycaster();
  private readonly origin = new Vector3();
  private readonly dir = new Vector3();

  constructor(root: Object3D) {
    root.updateMatrixWorld(true);
    root.traverse((child) => {
      if (!(child instanceof Mesh) || !child.geometry.getAttribute('position')) return;
      if (!child.geometry.boundsTree) {
        child.geometry.boundsTree = new MeshBVH(child.geometry, { indirect: true });
      }
      child.raycast = acceleratedRaycast;
      this.meshes.push(child);
    });
    this.raycaster.firstHitOnly = true;
  }

  /** surface kind at `point` for a round travelling along `direction`, or null */
  surfaceAt(point: Vector3, direction: Vector3): SurfaceKind | null {
    if (this.meshes.length === 0 || direction.lengthSq() < 1e-10) return null;
    this.dir.copy(direction).normalize();
    this.origin.copy(point).addScaledVector(this.dir, -0.3);
    this.raycaster.set(this.origin, this.dir);
    this.raycaster.near = 0;
    this.raycaster.far = 0.6;
    const hit = this.raycaster.intersectObjects(this.meshes, false)[0];
    if (!hit) return null;
    const mesh = hit.object as Mesh;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const group = hit.face && Array.isArray(mesh.material)
      ? mesh.geometry.groups.find((g) => hit.faceIndex !== undefined && hit.faceIndex !== null && hit.faceIndex * 3 >= g.start && hit.faceIndex * 3 < g.start + g.count)
      : undefined;
    const material: Material | undefined = group ? materials[group.materialIndex ?? 0] : materials[0];
    const tagged = material?.userData?.surface as SurfaceKind | undefined;
    return tagged ?? surfaceProfile(material?.name).kind;
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.geometry.boundsTree = undefined;
    }
    this.meshes.length = 0;
  }
}
