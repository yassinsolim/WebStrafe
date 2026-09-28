import { describe, expect, it } from 'vitest';
import { METRES_PER_UNIT as U } from '../../movement/cvars';
import { WEAPONS, weaponMaxSpeed } from '../weapons';

describe('weapon run speeds', () => {
  it('match cs2 weapons.vdata m_flMaxSpeed', () => {
    // knife [250, 250], deagle [230, 230], awp [200, 100] (second value is scoped)
    expect(WEAPONS.knife.maxSpeed).toBeCloseTo(250 * U, 12);
    expect(WEAPONS.deagle.maxSpeed).toBeCloseTo(230 * U, 12);
    expect(WEAPONS.awp.maxSpeed).toBeCloseTo(200 * U, 12);
    expect(WEAPONS.awp.scopedMaxSpeed).toBeCloseTo(100 * U, 12);
  });

  it('only the awp slows down scoped', () => {
    expect(weaponMaxSpeed('awp')).toBe(WEAPONS.awp.maxSpeed);
    expect(weaponMaxSpeed('awp', true)).toBe(WEAPONS.awp.scopedMaxSpeed);
    expect(weaponMaxSpeed('deagle', true)).toBe(WEAPONS.deagle.maxSpeed);
    expect(weaponMaxSpeed('knife', true)).toBe(WEAPONS.knife.maxSpeed);
  });
});
