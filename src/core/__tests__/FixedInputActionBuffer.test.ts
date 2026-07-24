import { describe, expect, it } from 'vitest';
import { FixedInputActionBuffer } from '../FixedInputActionBuffer';

const noActions = {
  inspectPressed: false,
  resetPressed: false,
  attackPressed: false,
  attackAltPressed: false,
};

describe('FixedInputActionBuffer', () => {
  it('retains a native attack edge across a render frame with no fixed tick', () => {
    const buffer = new FixedInputActionBuffer();
    buffer.enqueue({ ...noActions, attackPressed: true });

    // The next render can arrive before a 128 Hz simulation tick.
    buffer.enqueue(noActions);

    expect(buffer.consume()).toEqual({ ...noActions, attackPressed: true });
    expect(buffer.consume()).toEqual(noActions);
  });

  it('clears a latched attack when pointer-lock gameplay ends', () => {
    const buffer = new FixedInputActionBuffer();
    buffer.enqueue({ ...noActions, attackPressed: true });
    buffer.clear();

    expect(buffer.consume()).toEqual(noActions);
  });
});
