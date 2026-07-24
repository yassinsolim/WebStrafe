import type { InputActions } from './InputManager';

export type FixedInputActions = Pick<
  InputActions,
  'inspectPressed' | 'resetPressed' | 'attackPressed' | 'attackAltPressed'
>;

const emptyActions = (): FixedInputActions => ({
  inspectPressed: false,
  resetPressed: false,
  attackPressed: false,
  attackAltPressed: false,
});

/**
 * Latches render-frame input edges until the next fixed simulation tick.
 *
 * A render frame can legitimately contain no 128 Hz fixed tick. Without this
 * buffer, a click sampled during that frame is cleared on the next render and
 * never reaches gameplay.
 */
export class FixedInputActionBuffer {
  private queued = emptyActions();

  enqueue(actions: FixedInputActions): void {
    this.queued.inspectPressed ||= actions.inspectPressed;
    this.queued.resetPressed ||= actions.resetPressed;
    this.queued.attackPressed ||= actions.attackPressed;
    this.queued.attackAltPressed ||= actions.attackAltPressed;
  }

  consume(): FixedInputActions {
    const actions = this.queued;
    this.queued = emptyActions();
    return actions;
  }

  clear(): void {
    this.queued = emptyActions();
  }
}
