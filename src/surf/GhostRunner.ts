import {
  CapsuleGeometry,
  ConeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
} from 'three';
import { ghostPoseAt, type Ghost } from './ghost';

/**
 * translucent stand-in that replays a pb or record run in step with the local
 * timer, so a surfer can race it. a capsule plus a nose so the heading reads.
 */
export class GhostRunner {
  readonly root = new Group();
  private ghost: Ghost | null = null;
  private readonly material = new MeshBasicMaterial({
    color: 0x46d5ff,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
  });

  constructor(parent: Object3D) {
    const body = new Mesh(new CapsuleGeometry(0.34, 1.1, 4, 12), this.material);
    body.position.y = 0.9;
    const nose = new Mesh(new ConeGeometry(0.14, 0.4, 10), this.material);
    nose.rotation.x = -Math.PI / 2;
    nose.position.set(0, 1.5, -0.42);
    this.root.add(body, nose);
    this.root.visible = false;
    this.root.name = 'surf-ghost';
    this.root.renderOrder = 2;
    parent.add(this.root);
  }

  setGhost(ghost: Ghost | null, color = 0x46d5ff): void {
    this.ghost = ghost && ghost.frames.length > 1 ? ghost : null;
    this.material.color.setHex(color);
    if (!this.ghost) this.root.visible = false;
  }

  hasGhost(): boolean {
    return this.ghost !== null;
  }

  /** runMs null hides the ghost (not running) */
  update(runMs: number | null, enabled: boolean): void {
    if (!this.ghost || runMs === null || !enabled) {
      this.root.visible = false;
      return;
    }
    const pose = ghostPoseAt(this.ghost, runMs);
    if (!pose) {
      this.root.visible = false;
      return;
    }
    this.root.visible = true;
    this.root.position.set(pose.x, pose.y, pose.z);
    this.root.rotation.y = pose.yaw;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.root.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose();
    });
    this.material.dispose();
  }
}
