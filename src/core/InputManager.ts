import type { MoveInput } from '../movement/types';
import {
  isEditableGameplayTarget,
  weaponCycleDirection,
  weaponSlotForKey,
} from './GameplayWeaponInput';
import type { WeaponCycleDirection, WeaponSlot } from './GameplayWeaponInput';

export interface InputActions {
  inspectPressed: boolean;
  resetPressed: boolean;
  toggleGridPressed: boolean;
  toggleDebugCameraPressed: boolean;
  toggleSurfNormalPressed: boolean;
  attackPressed: boolean;
  attackAltPressed: boolean;
  weaponSlotPressed: WeaponSlot | null;
  weaponCycleDirection: WeaponCycleDirection;
}

const JUMP_KEYS = new Set(['Space']);
const MAX_MOUSE_DELTA_PER_EVENT = 512;

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
  private weaponSlotQueued: WeaponSlot | null = null;
  private weaponCycleQueued: WeaponCycleDirection = 0;

  private lookDeltaX = 0;
  private lookDeltaY = 0;
  private pointerLocked = false;
  private ignoreNextMouseMove = false;

  constructor(private readonly domElement: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
  }

  public dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
  }

  public async requestPointerLock(): Promise<boolean> {
    if (document.pointerLockElement === this.domElement) {
      this.setPointerLocked(true);
      return true;
    }

    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (locked: boolean): void => {
        if (settled) {
          return;
        }
        settled = true;
        document.removeEventListener('pointerlockchange', onChange);
        document.removeEventListener('pointerlockerror', onError);
        resolve(locked);
      };

      const onChange = (): void => {
        const locked = document.pointerLockElement === this.domElement;
        this.setPointerLocked(locked);
        if (locked) {
          finish(true);
        }
      };

      const onError = (): void => {
        this.setPointerLocked(document.pointerLockElement === this.domElement);
        finish(false);
      };

      document.addEventListener('pointerlockchange', onChange);
      document.addEventListener('pointerlockerror', onError);
      try {
        const request = this.domElement.requestPointerLock() as unknown as Promise<void> | void;
        if (request && typeof (request as Promise<void>).then === 'function') {
          (request as Promise<void>).catch(() => {
            finish(false);
          });
        }
      } catch {
        finish(false);
        return;
      }

      const startedAt = performance.now();
      const pollForLock = (): void => {
        if (settled) {
          return;
        }
        if (document.pointerLockElement === this.domElement) {
          this.setPointerLocked(true);
          finish(true);
          return;
        }
        if (performance.now() - startedAt >= 180) {
          finish(false);
          return;
        }
        window.requestAnimationFrame(pollForLock);
      };
      window.requestAnimationFrame(pollForLock);
    });
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
      weaponSlotPressed: this.weaponSlotQueued,
      weaponCycleDirection: this.weaponCycleQueued,
    };
    this.inspectQueued = false;
    this.resetQueued = false;
    this.toggleGridQueued = false;
    this.toggleDebugCameraQueued = false;
    this.toggleSurfNormalQueued = false;
    this.attackQueued = false;
    this.attackAltQueued = false;
    this.weaponSlotQueued = null;
    this.weaponCycleQueued = 0;
    return actions;
  }

  public isKeyDown(code: string): boolean {
    return this.keysDown.has(code);
  }

  private readonly onPointerLockChange = (): void => {
    this.setPointerLocked(document.pointerLockElement === this.domElement);
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.pointerLocked || document.pointerLockElement !== this.domElement) {
      return;
    }
    if (this.ignoreNextMouseMove) {
      this.ignoreNextMouseMove = false;
      return;
    }
    if (
      !Number.isFinite(event.movementX)
      || !Number.isFinite(event.movementY)
      || Math.abs(event.movementX) > MAX_MOUSE_DELTA_PER_EVENT
      || Math.abs(event.movementY) > MAX_MOUSE_DELTA_PER_EVENT
    ) {
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

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.isGameplayInputActive(event.target)) {
      return;
    }
    const direction = weaponCycleDirection(event.deltaY);
    if (direction === 0) {
      return;
    }
    event.preventDefault();
    // Keep one normalized wheel step per rendered frame. Trackpad bursts must
    // not skip several weapons before the player can see the first switch.
    this.weaponCycleQueued = direction;
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    if (this.pointerLocked) {
      event.preventDefault();
    }
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const keyIdentity = event.code || `key:${event.key}`;
    const firstPress = !event.repeat && !this.keysDown.has(keyIdentity);
    if (firstPress && JUMP_KEYS.has(event.code)) {
      this.jumpQueued = true;
    }
    if (firstPress && event.code === 'KeyY') {
      this.inspectQueued = true;
    }
    if (firstPress && event.code === 'KeyR') {
      this.resetQueued = true;
    }
    if (firstPress && event.code === 'KeyG') {
      this.toggleGridQueued = true;
    }
    if (firstPress && event.code === 'KeyV') {
      this.toggleDebugCameraQueued = true;
    }
    if (firstPress && event.code === 'KeyN') {
      this.toggleSurfNormalQueued = true;
    }
    if (firstPress && this.isGameplayInputActive(event.target)) {
      const slot = weaponSlotForKey(event);
      if (slot !== null) {
        event.preventDefault();
        this.weaponSlotQueued = slot;
      }
    }
    this.keysDown.add(keyIdentity);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keysDown.delete(event.code || `key:${event.key}`);
  };

  private readonly onBlur = (): void => {
    this.clearPressedState();
    this.ignoreNextMouseMove = this.pointerLocked;
  };

  private isGameplayInputActive(target: EventTarget | null): boolean {
    return document.pointerLockElement === this.domElement
      && !isEditableGameplayTarget(target)
      && !isEditableGameplayTarget(document.activeElement);
  }

  private clearPressedState(): void {
    this.keysDown.clear();
    this.jumpQueued = false;
    this.inspectQueued = false;
    this.resetQueued = false;
    this.toggleGridQueued = false;
    this.toggleDebugCameraQueued = false;
    this.toggleSurfNormalQueued = false;
    this.attackQueued = false;
    this.attackAltQueued = false;
    this.weaponSlotQueued = null;
    this.weaponCycleQueued = 0;
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
  }

  private setPointerLocked(locked: boolean): void {
    if (locked === this.pointerLocked) {
      if (!locked) {
        this.clearPressedState();
      }
      return;
    }
    this.pointerLocked = locked;
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
    this.ignoreNextMouseMove = locked;
    if (!locked) {
      this.clearPressedState();
    }
  }

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
