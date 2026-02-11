import {
  Box3,
  BufferGeometry,
  Float32BufferAttribute,
  Line3,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';
import type { CapsuleShape, GroundProbe } from '../movement/types';

export interface TraceResult {
  hit: boolean;
  fraction: number;
  normal: Vector3;
  position: Vector3;
}

export interface CollisionAdapter {
  queryGround(feetPosition: Vector3, capsule: CapsuleShape, probeDistance: number): GroundProbe | null;
  traceCapsule(startFeet: Vector3, endFeet: Vector3, capsule: CapsuleShape): TraceResult;
  resolveCapsulePosition(feetPosition: Vector3, capsule: CapsuleShape): OverlapResult;
}

export interface OverlapResult {
  collided: boolean;
  normal: Vector3;
  depth: number;
  position: Vector3;
}

const DOWN = new Vector3(0, -1, 0);
const UP = new Vector3(0, 1, 0);
const SKIN_WIDTH = 0.0005;

export class CollisionWorld implements CollisionAdapter {
  private collisionGeometry: BufferGeometry | null = null;
  private collisionMesh: Mesh | null = null;

  private readonly tempSegment = new Line3();
  private readonly tempSegmentStart = new Vector3();
  private readonly tempSegmentEnd = new Vector3();
  private readonly tempBox = new Box3();
  private readonly tempTriPoint = new Vector3();
  private readonly tempTriNormal = new Vector3();
  private readonly tempCapsulePoint = new Vector3();
  private readonly tempPush = new Vector3();
  private readonly tempPosition = new Vector3();

  public clear(): void {
    this.collisionGeometry?.dispose();
    this.collisionGeometry = null;
    this.collisionMesh = null;
  }

  public hasCollision(): boolean {
    return this.collisionGeometry !== null;
  }

  public getCollisionMesh(): Mesh | null {
    return this.collisionMesh;
  }

  public setCollisionFromRoot(root: Object3D): void {
    const merged = this.mergeRootToGeometry(root);
    this.setCollisionGeometry(merged);
  }

  public setCollisionGeometry(geometry: BufferGeometry): void {
    this.clear();

    const merged = geometry.clone();
    const position = merged.getAttribute('position');
    if (!position || position.count < 3) {
      throw new Error('Collision geometry is empty or missing position data.');
    }
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    (merged as BufferGeometry & { boundsTree?: MeshBVH }).boundsTree = new MeshBVH(merged, {
      maxLeafSize: 16,
      indirect: false,
      strategy: 0,
    });

    this.collisionGeometry = merged;
    this.collisionMesh = new Mesh(
      merged,
      new MeshBasicMaterial({
        color: 0x00ff00,
        wireframe: true,
        transparent: true,
        opacity: 0.08,
        depthWrite: false,
        visible: false,
      }),
    );
    this.collisionMesh.name = 'CollisionMesh';
  }

  public resolveCapsulePosition(feetPosition: Vector3, capsule: CapsuleShape): OverlapResult {
    return this.computeOverlap(feetPosition, capsule, true);
  }

  public queryGround(feetPosition: Vector3, capsule: CapsuleShape, probeDistance: number): GroundProbe | null {
    const target = this.tempPosition.copy(feetPosition).addScaledVector(DOWN, probeDistance);
    const trace = this.traceCapsule(feetPosition, target, capsule);
    if (!trace.hit) {
      return null;
    }

    const normal = trace.normal.clone();
    if (normal.y < 0) {
      normal.negate();
    }

    const clampedDot = MathUtils.clamp(normal.dot(UP), -1, 1);
    const slopeAngleDeg = MathUtils.radToDeg(Math.acos(clampedDot));
    const distance = Math.max(0, feetPosition.y - trace.position.y);
    return {
      distance,
      position: trace.position.clone(),
      normal,
      slopeAngleDeg,
    };
  }

  public traceCapsule(startFeet: Vector3, endFeet: Vector3, capsule: CapsuleShape): TraceResult {
    if (!this.collisionGeometry) {
      return {
        hit: false,
        fraction: 1,
        normal: UP.clone(),
        position: endFeet.clone(),
      };
    }

    const startResolved = this.resolveCapsulePosition(startFeet, capsule);
    const correctedStart = startResolved.position.clone();
    const delta = this.tempPosition.copy(endFeet).sub(startFeet);
    const correctedEnd = correctedStart.clone().add(delta);
    if (delta.lengthSq() < 1e-12) {
      return {
        hit: startResolved.collided,
        fraction: startResolved.collided ? 0 : 1,
        normal: startResolved.normal,
        position: correctedStart,
      };
    }

    let low = 0;
    let high = 1;
    let collided = false;
    const sweepSteps = 12;

    for (let i = 1; i <= sweepSteps; i += 1) {
      const t = i / sweepSteps;
      const samplePos = this.sampleLerp(correctedStart, correctedEnd, t);
      const overlap = this.computeOverlap(samplePos, capsule, false);
      if (overlap.collided) {
        collided = true;
        low = (i - 1) / sweepSteps;
        high = t;
        break;
      }
    }

    if (!collided) {
      const resolvedEnd = this.resolveCapsulePosition(correctedEnd, capsule);
      return {
        hit: resolvedEnd.collided,
        fraction: 1,
        normal: resolvedEnd.normal,
        position: resolvedEnd.position,
      };
    }

    for (let i = 0; i < 8; i += 1) {
      const mid = (low + high) * 0.5;
      const midPos = this.sampleLerp(correctedStart, correctedEnd, mid);
      const overlap = this.computeOverlap(midPos, capsule, false);
      if (overlap.collided) {
        high = mid;
      } else {
        low = mid;
      }
    }

    const impactFraction = MathUtils.clamp(high, 0, 1);
    const safeFraction = Math.max(0, impactFraction - 1e-4);
    const safePosition = this.sampleLerp(correctedStart, correctedEnd, safeFraction);
    const impactPosition = this.sampleLerp(correctedStart, correctedEnd, impactFraction);

    const impactOverlap = this.computeOverlap(impactPosition, capsule, false);
    const resolvedSafe = this.resolveCapsulePosition(safePosition, capsule);

    let hitNormal = impactOverlap.normal.clone();
    if (!impactOverlap.collided || hitNormal.lengthSq() < 1e-8) {
      hitNormal = resolvedSafe.normal.clone();
    }
    if (hitNormal.lengthSq() < 1e-8) {
      hitNormal.copy(UP);
    } else {
      hitNormal.normalize();
    }

    return {
      hit: true,
      fraction: safeFraction,
      normal: hitNormal,
      position: resolvedSafe.position,
    };
  }

  private sampleLerp(start: Vector3, end: Vector3, t: number): Vector3 {
    return new Vector3(
      MathUtils.lerp(start.x, end.x, t),
      MathUtils.lerp(start.y, end.y, t),
      MathUtils.lerp(start.z, end.z, t),
    );
  }

  private computeOverlap(feetPosition: Vector3, capsule: CapsuleShape, resolve: boolean): OverlapResult {
    const normal = new Vector3(0, 1, 0);
    if (!this.collisionGeometry) {
      return {
        collided: false,
        normal,
        depth: 0,
        position: feetPosition.clone(),
      };
    }

    const tree = (this.collisionGeometry as BufferGeometry & { boundsTree: MeshBVH }).boundsTree;
    if (!tree) {
      return {
        collided: false,
        normal,
        depth: 0,
        position: feetPosition.clone(),
      };
    }

    const segmentStart = this.tempSegmentStart.set(
      feetPosition.x,
      feetPosition.y + capsule.radius,
      feetPosition.z,
    );
    const segmentEnd = this.tempSegmentEnd.set(
      feetPosition.x,
      feetPosition.y + Math.max(capsule.radius + SKIN_WIDTH, capsule.height - capsule.radius),
      feetPosition.z,
    );
    this.tempSegment.set(segmentStart.clone(), segmentEnd.clone());

    let collided = false;
    let maxDepth = 0;
    const bestNormal = new Vector3(0, 1, 0);
    const accumulatedPush = new Vector3();
    const radius = capsule.radius;
    const workingSegment = this.tempSegment;

    const iterations = resolve ? 3 : 1;
    for (let iter = 0; iter < iterations; iter += 1) {
      let iterCollided = false;
      this.tempBox.makeEmpty();
      this.tempBox.expandByPoint(workingSegment.start);
      this.tempBox.expandByPoint(workingSegment.end);
      this.tempBox.min.addScalar(-radius);
      this.tempBox.max.addScalar(radius);

      tree.shapecast({
        intersectsBounds: (box) => box.intersectsBox(this.tempBox),
        intersectsTriangle: (triangle) => {
          const triExt = triangle as unknown as {
            closestPointToSegment: (segment: Line3, target1: Vector3, target2: Vector3) => number;
            getNormal: (target: Vector3) => Vector3;
          };

          if (!triExt.closestPointToSegment) {
            return false;
          }

          const distance = triExt.closestPointToSegment(workingSegment, this.tempTriPoint, this.tempCapsulePoint);
          if (distance >= radius) {
            return false;
          }

          collided = true;
          iterCollided = true;
          const depth = radius - distance;

          this.tempPush.copy(this.tempCapsulePoint).sub(this.tempTriPoint);
          triExt.getNormal(this.tempTriNormal).normalize();
          if (this.tempPush.lengthSq() < 1e-10) {
            this.tempPush.copy(this.tempTriNormal);
          }
          this.tempPush.normalize();
          if (this.tempTriNormal.dot(this.tempPush) < 0) {
            this.tempTriNormal.negate();
          }

          accumulatedPush.addScaledVector(this.tempPush, depth);

          if (depth > maxDepth) {
            maxDepth = depth;
            bestNormal.copy(this.tempPush);
          }

          if (resolve) {
            const pushAmount = depth + SKIN_WIDTH;
            workingSegment.start.addScaledVector(this.tempPush, pushAmount);
            workingSegment.end.addScaledVector(this.tempPush, pushAmount);
          }

          return false;
        },
      });

      if (!iterCollided) {
        break;
      }
    }

    const resolvedFeet = workingSegment.start.clone().addScaledVector(UP, -capsule.radius);
    const resolvedNormal = accumulatedPush.lengthSq() > 1e-10
      ? accumulatedPush.normalize()
      : bestNormal;
    return {
      collided,
      normal: resolvedNormal.clone(),
      depth: maxDepth,
      position: resolvedFeet,
    };
  }

  private mergeRootToGeometry(root: Object3D): BufferGeometry {
    root.updateWorldMatrix(true, true);
    const geometries: BufferGeometry[] = [];

    root.traverse((child) => {
      if (!(child instanceof Mesh)) {
        return;
      }
      if (!child.geometry) {
        return;
      }

      const source = child.geometry.clone();
      source.applyMatrix4(child.matrixWorld);

      const nonIndexed = source.index ? source.toNonIndexed() : source;
      if (source !== nonIndexed) {
        source.dispose();
      }

      const position = nonIndexed.getAttribute('position');
      if (!position || position.count < 3) {
        nonIndexed.dispose();
        return;
      }

      const collisionGeom = new BufferGeometry();
      // Keep only position for collision so all meshes can merge regardless of render attributes.
      const positionArray = new Float32Array(position.count * 3);
      for (let i = 0; i < position.count; i += 1) {
        const i3 = i * 3;
        positionArray[i3] = position.getX(i);
        positionArray[i3 + 1] = position.getY(i);
        positionArray[i3 + 2] = position.getZ(i);
      }
      collisionGeom.setAttribute('position', new Float32BufferAttribute(positionArray, 3));
      geometries.push(collisionGeom);
      nonIndexed.dispose();
    });

    if (geometries.length === 0) {
      return new BufferGeometry();
    }

    const merged = mergeGeometries(geometries, false);
    for (const geom of geometries) {
      geom.dispose();
    }

    if (!merged) {
      return new BufferGeometry();
    }
    return merged;
  }
}
