import type { MoveInput } from '../movement/types';

export interface InputActions {
  inspectPressed: boolean;
  resetPressed: boolean;
  toggleGridPressed: boolean;
  toggleDebugCameraPressed: boolean;
  toggleSurfNormalPressed: boolean;
  attackPressed: boolean;
  attackAltPressed: boolean;
}

const JUMP_KEYS = new Set(['Space']);

export class InputManager {
  private readonly keysDown = new Set<string>();
  private jumpQueued = false;
  private inspectQueued = false;
  private resetQueued = false;
  private toggleGridQueued = false;
  private toggleDebugCameraQueued = false;
  private toggleSurfNormalQueued = false;
  private attackQueued = false;
  private attackAltQueued = false;

  private lookDeltaX = 0;
  private lookDeltaY = 0;
  private pointerLocked = false;

  constructor(private readonly domElement: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('contextmenu', this.onContextMenu);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
  }

  public dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('contextmenu', this.onContextMenu);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
  }

  public requestPointerLock(): void {
    void this.domElement.requestPointerLock();
  }

  public isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  public consumeLookDelta(): { x: number; y: number } {
    const delta = { x: this.lookDeltaX, y: this.lookDeltaY };
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
    return delta;
  }

  public sampleMoveInput(): MoveInput {
    const forwardMove = (this.isDown('KeyW') || this.isDown('ArrowUp') ? 1 : 0)
      + (this.isDown('KeyS') || this.isDown('ArrowDown') ? -1 : 0);
    const sideMove = (this.isDown('KeyD') || this.isDown('ArrowRight') ? 1 : 0)
      + (this.isDown('KeyA') || this.isDown('ArrowLeft') ? -1 : 0);

    const jumpHeld = this.anyDown(JUMP_KEYS);
    const jumpPressed = this.jumpQueued;
    this.jumpQueued = false;

    return {
      forwardMove,
      sideMove,
      jumpHeld,
      jumpPressed,
    };
  }

  public consumeActions(): InputActions {
    const actions = {
      inspectPressed: this.inspectQueued,
      resetPressed: this.resetQueued,
      toggleGridPressed: this.toggleGridQueued,
      toggleDebugCameraPressed: this.toggleDebugCameraQueued,
      toggleSurfNormalPressed: this.toggleSurfNormalQueued,
      attackPressed: this.attackQueued,
      attackAltPressed: this.attackAltQueued,
    };
    this.inspectQueued = false;
    this.resetQueued = false;
    this.toggleGridQueued = false;
    this.toggleDebugCameraQueued = false;
    this.toggleSurfNormalQueued = false;
    this.attackQueued = false;
    this.attackAltQueued = false;
    return actions;
  }

  public isKeyDown(code: string): boolean {
    return this.keysDown.has(code);
  }

  private readonly onPointerLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.domElement;
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.pointerLocked) {
      return;
    }
    this.lookDeltaX += event.movementX;
    this.lookDeltaY += event.movementY;
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (!this.pointerLocked) {
      return;
    }
    if (event.button === 0) {
      this.attackQueued = true;
    } else if (event.button === 2) {
      this.attackAltQueued = true;
    }
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    if (this.pointerLocked) {
      event.preventDefault();
    }
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.keysDown.has(event.code) && JUMP_KEYS.has(event.code)) {
      this.jumpQueued = true;
    }
    if (!this.keysDown.has(event.code) && event.code === 'KeyF') {
      this.inspectQueued = true;
    }
    if (!this.keysDown.has(event.code) && event.code === 'KeyR') {
      this.resetQueued = true;
    }
    if (!this.keysDown.has(event.code) && event.code === 'KeyG') {
      this.toggleGridQueued = true;
    }
    if (!this.keysDown.has(event.code) && event.code === 'KeyV') {
      this.toggleDebugCameraQueued = true;
    }
    if (!this.keysDown.has(event.code) && event.code === 'KeyN') {
      this.toggleSurfNormalQueued = true;
    }
    this.keysDown.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keysDown.delete(event.code);
  };

  private isDown(code: string): boolean {
    return this.keysDown.has(code);
  }

  private anyDown(codes: Set<string>): boolean {
    for (const code of codes) {
      if (this.keysDown.has(code)) {
        return true;
      }
    }
    return false;
  }
}
