import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputManager } from '../InputManager';

function inputEvent(
  type: 'keydown' | 'keyup',
  code: string,
  key: string,
  repeat = false,
): KeyboardEvent {
  return Object.assign(new Event(type, { cancelable: true }), {
    code,
    key,
    repeat,
  }) as KeyboardEvent;
}

function wheelEvent(deltaY: number): WheelEvent {
  return Object.assign(new Event('wheel', { cancelable: true }), { deltaY }) as WheelEvent;
}

function mouseMove(movementX: number, movementY: number): MouseEvent {
  return Object.assign(new Event('mousemove'), { movementX, movementY }) as MouseEvent;
}

function setupInput(): {
  input: InputManager;
  canvas: HTMLElement;
  documentTarget: EventTarget & {
    activeElement: EventTarget | null;
    pointerLockElement: EventTarget | null;
  };
} {
  const windowTarget = new EventTarget();
  const canvas = Object.assign(new EventTarget(), { tagName: 'CANVAS' }) as unknown as HTMLElement;
  const documentTarget = Object.assign(new EventTarget(), {
    activeElement: canvas as EventTarget,
    pointerLockElement: canvas as EventTarget,
  });
  vi.stubGlobal('window', windowTarget);
  vi.stubGlobal('document', documentTarget);
  return {
    input: new InputManager(canvas),
    canvas,
    documentTarget,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('InputManager weapon actions', () => {
  it('retains a native number-key edge even when keyup precedes the next frame', () => {
    const { input } = setupInput();
    window.dispatchEvent(inputEvent('keydown', 'Digit2', '2'));
    window.dispatchEvent(inputEvent('keyup', 'Digit2', '2'));

    expect(input.consumeActions().weaponSlotPressed).toBe(2);
    expect(input.consumeActions().weaponSlotPressed).toBeNull();
    input.dispose();
  });

  it('queues inspect once from Y without retaining the old F binding', () => {
    const { input } = setupInput();
    window.dispatchEvent(inputEvent('keydown', 'KeyF', 'f'));
    expect(input.consumeActions().inspectPressed).toBe(false);

    window.dispatchEvent(inputEvent('keydown', 'KeyY', 'y'));
    expect(input.consumeActions().inspectPressed).toBe(true);
    expect(input.consumeActions().inspectPressed).toBe(false);
    input.dispose();
  });

  it('normalizes wheel input and prevents default only during pointer-locked gameplay', () => {
    const { input, documentTarget } = setupInput();
    const gameplayWheel = wheelEvent(120);
    window.dispatchEvent(gameplayWheel);
    expect(gameplayWheel.defaultPrevented).toBe(true);
    expect(input.consumeActions().weaponCycleDirection).toBe(1);

    documentTarget.pointerLockElement = null;
    const menuWheel = wheelEvent(-120);
    window.dispatchEvent(menuWheel);
    expect(menuWheel.defaultPrevented).toBe(false);
    expect(input.consumeActions().weaponCycleDirection).toBe(0);
    input.dispose();
  });

  it('ignores editable focus and clears queued state when pointer lock is lost', () => {
    const { input, documentTarget } = setupInput();
    documentTarget.activeElement = Object.assign(new EventTarget(), { tagName: 'INPUT' });
    window.dispatchEvent(inputEvent('keydown', 'Digit3', '3'));
    expect(input.consumeActions().weaponSlotPressed).toBeNull();

    documentTarget.activeElement = documentTarget.pointerLockElement;
    window.dispatchEvent(inputEvent('keyup', 'Digit3', '3'));
    window.dispatchEvent(inputEvent('keydown', 'Digit1', '1'));
    documentTarget.pointerLockElement = null;
    document.dispatchEvent(new Event('pointerlockchange'));
    expect(input.consumeActions().weaponSlotPressed).toBeNull();
    input.dispose();
  });
});

describe('InputManager pointer-lock look input', () => {
  it('drops the stale transition event and accumulates normal mouse motion exactly', () => {
    const { input } = setupInput();
    document.dispatchEvent(new Event('pointerlockchange'));

    window.dispatchEvent(mouseMove(240, -180));
    window.dispatchEvent(mouseMove(18, -7));
    window.dispatchEvent(mouseMove(-5, 3));

    expect(input.consumeLookDelta()).toEqual({ x: 13, y: -4 });
    expect(input.consumeLookDelta()).toEqual({ x: 0, y: 0 });
    input.dispose();
  });

  it('rejects isolated impossible movement spikes without clipping adjacent input', () => {
    const { input } = setupInput();
    document.dispatchEvent(new Event('pointerlockchange'));
    window.dispatchEvent(mouseMove(0, 0));

    window.dispatchEvent(mouseMove(130, -90));
    window.dispatchEvent(mouseMove(1400, -1200));
    window.dispatchEvent(mouseMove(110, 40));

    expect(input.consumeLookDelta()).toEqual({ x: 240, y: -50 });
    input.dispose();
  });

  it('clears pending look input across lock loss and reacquisition', () => {
    const { input, documentTarget } = setupInput();
    document.dispatchEvent(new Event('pointerlockchange'));
    window.dispatchEvent(mouseMove(0, 0));
    window.dispatchEvent(mouseMove(45, -12));

    documentTarget.pointerLockElement = null;
    document.dispatchEvent(new Event('pointerlockchange'));
    expect(input.consumeLookDelta()).toEqual({ x: 0, y: 0 });

    documentTarget.pointerLockElement = documentTarget.activeElement;
    document.dispatchEvent(new Event('pointerlockchange'));
    window.dispatchEvent(mouseMove(900, 700));
    window.dispatchEvent(mouseMove(9, -4));
    expect(input.consumeLookDelta()).toEqual({ x: 9, y: -4 });
    input.dispose();
  });
});
