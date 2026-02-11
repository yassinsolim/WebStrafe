import type { MovementDebugState } from '../movement/types';

export class HUD {
  private readonly root: HTMLDivElement;
  private readonly speedLine: HTMLDivElement;
  private readonly feetLine: HTMLDivElement;
  private readonly cameraLine: HTMLDivElement;
  private readonly velocityLine: HTMLDivElement;
  private readonly groundedLine: HTMLDivElement;
  private readonly surfLine: HTMLDivElement;
  private readonly surfGraceLine: HTMLDivElement;
  private readonly slopeLine: HTMLDivElement;
  private readonly wishLine: HTMLDivElement;
  private readonly wishDirLine: HTMLDivElement;
  private readonly normalLine: HTMLDivElement;
  private readonly contactLine: HTMLDivElement;
  private readonly modeLine: HTMLDivElement;
  private readonly frictionLine: HTMLDivElement;
  private readonly collisionSpeedLine: HTMLDivElement;
  private readonly collisionNormalLine: HTMLDivElement;
  private readonly collisionWarnLine: HTMLDivElement;
  private readonly strafeHint: HTMLDivElement;
  private visible = true;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud';

    this.speedLine = this.makeLine();
    this.feetLine = this.makeLine();
    this.cameraLine = this.makeLine();
    this.velocityLine = this.makeLine();
    this.groundedLine = this.makeLine();
    this.surfLine = this.makeLine();
    this.surfGraceLine = this.makeLine();
    this.slopeLine = this.makeLine();
    this.wishLine = this.makeLine();
    this.wishDirLine = this.makeLine();
    this.normalLine = this.makeLine();
    this.contactLine = this.makeLine();
    this.modeLine = this.makeLine();
    this.frictionLine = this.makeLine();
    this.collisionSpeedLine = this.makeLine();
    this.collisionNormalLine = this.makeLine();
    this.collisionWarnLine = this.makeLine('hud-collision-warn');
    this.strafeHint = this.makeLine('hud-strafe-hint');

    this.root.append(
      this.speedLine,
      this.feetLine,
      this.cameraLine,
      this.velocityLine,
      this.groundedLine,
      this.surfLine,
      this.surfGraceLine,
      this.slopeLine,
      this.wishLine,
      this.wishDirLine,
      this.normalLine,
      this.contactLine,
      this.modeLine,
      this.frictionLine,
      this.collisionSpeedLine,
      this.collisionNormalLine,
      this.collisionWarnLine,
      this.strafeHint,
    );
    parent.appendChild(this.root);
  }

  public setVisible(visible: boolean): void {
    this.visible = visible;
    this.root.style.display = visible ? 'block' : 'none';
  }

  public update(debug: MovementDebugState): void {
    if (!this.visible) {
      return;
    }

    this.speedLine.textContent = `speed: ${debug.speed.toFixed(2)} m/s`;
    this.feetLine.textContent = `feet xyz: (${debug.feetPosition.x.toFixed(2)}, ${debug.feetPosition.y.toFixed(
      2,
    )}, ${debug.feetPosition.z.toFixed(2)})`;
    this.cameraLine.textContent = `camera xyz: (${debug.cameraPosition.x.toFixed(2)}, ${debug.cameraPosition.y.toFixed(
      2,
    )}, ${debug.cameraPosition.z.toFixed(2)})`;
    this.velocityLine.textContent = `velocity xyz: (${debug.velocity.x.toFixed(2)}, ${debug.velocity.y.toFixed(
      2,
    )}, ${debug.velocity.z.toFixed(2)})`;
    this.groundedLine.textContent = `grounded: ${debug.grounded ? 'yes' : 'no'}`;
    this.surfLine.textContent = `surfed?: ${debug.surfing ? 'yes' : 'no'}`;
    this.surfGraceLine.textContent = `surf grace ticks: ${debug.surfGraceTicks}`;
    this.slopeLine.textContent = `slope: ${debug.slopeAngleDeg.toFixed(1)} deg`;
    this.wishLine.textContent = `wishspeed: ${debug.wishSpeed.toFixed(2)}`;
    this.wishDirLine.textContent = `wishdir: (${debug.wishDir.x.toFixed(2)}, ${debug.wishDir.y.toFixed(
      2,
    )}, ${debug.wishDir.z.toFixed(2)})`;
    this.normalLine.textContent = `surface normal: (${debug.surfaceNormal.x.toFixed(2)}, ${debug.surfaceNormal.y.toFixed(
      2,
    )}, ${debug.surfaceNormal.z.toFixed(2)})`;
    this.contactLine.textContent = debug.contactPoint
      ? `contact xyz: (${debug.contactPoint.x.toFixed(2)}, ${debug.contactPoint.y.toFixed(2)}, ${debug.contactPoint.z.toFixed(2)})`
      : 'contact xyz: (none)';
    this.modeLine.textContent = `mode: ${debug.movementMode.toUpperCase()}`;
    this.frictionLine.textContent = `friction this tick: ${debug.frictionApplied ? 'yes' : 'no'}`;
    this.collisionSpeedLine.textContent = `collision speed: ${debug.collisionSpeedBefore.toFixed(2)} -> ${debug.collisionSpeedAfter.toFixed(2)}`;
    this.collisionNormalLine.textContent = `last collision normal: (${debug.lastCollisionNormal.x.toFixed(2)}, ${debug.lastCollisionNormal.y.toFixed(
      2,
    )}, ${debug.lastCollisionNormal.z.toFixed(2)}) angle: ${debug.lastCollisionAngleDeg.toFixed(1)} deg`;
    this.collisionWarnLine.textContent = debug.collisionSpeedDropWarn
      ? 'warning: speed dropped > 50% in one tick'
      : '';

    if (debug.recommendedStrafe === 'NONE') {
      this.strafeHint.textContent = '';
    } else {
      this.strafeHint.textContent = `surf hint: hold ${debug.recommendedStrafe}`;
    }
  }

  private makeLine(className?: string): HTMLDivElement {
    const line = document.createElement('div');
    line.className = className ?? 'hud-line';
    return line;
  }
}
