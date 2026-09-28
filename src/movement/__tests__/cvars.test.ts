import { describe, expect, it } from 'vitest';
import { defaultCvars } from '../cvars';
import { MovementController } from '../MovementController';

describe('autobhop default', () => {
  it('is always on out of the box, independent of map', () => {
    expect(defaultCvars.sv_bhop_enabled).toBe(true);
    expect(defaultCvars.sv_autobhop_enabled).toBe(true);
    expect(new MovementController().getCvars().sv_autobhop_enabled).toBe(true);
  });
});
