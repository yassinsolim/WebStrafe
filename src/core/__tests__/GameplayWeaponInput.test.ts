import { describe, expect, it } from 'vitest';
import {
  isEditableGameplayTarget,
  selectWeaponFromInput,
  weaponCycleDirection,
  weaponSlotForKey,
} from '../GameplayWeaponInput';

describe('gameplay weapon keyboard input', () => {
  it.each([
    ['Digit1', '1', 1],
    ['Digit2', '2', 2],
    ['Digit3', '3', 3],
    ['Numpad1', '1', 1],
    ['', '2', 2],
    ['Unidentified', '3', 3],
  ] as const)('maps native code=%s key=%s to slot %s', (code, key, slot) => {
    expect(weaponSlotForKey({ code, key })).toBe(slot);
  });

  it('ignores unrelated keys', () => {
    expect(weaponSlotForKey({ code: 'KeyW', key: 'w' })).toBeNull();
  });
});

describe('gameplay weapon wheel input', () => {
  it('cycles deterministically in both directions with wraparound', () => {
    expect(selectWeaponFromInput('awp', null, 1)).toBe('deagle');
    expect(selectWeaponFromInput('deagle', null, 1)).toBe('knife');
    expect(selectWeaponFromInput('knife', null, 1)).toBe('awp');
    expect(selectWeaponFromInput('awp', null, -1)).toBe('knife');
    expect(selectWeaponFromInput('knife', null, -1)).toBe('deagle');
  });

  it('normalizes each physical wheel event to one switch', () => {
    expect(weaponCycleDirection(120)).toBe(1);
    expect(weaponCycleDirection(1)).toBe(1);
    expect(weaponCycleDirection(-120)).toBe(-1);
    expect(weaponCycleDirection(0)).toBe(0);
    expect(weaponCycleDirection(Number.NaN)).toBe(0);
  });

  it('gives an explicit number slot priority over wheel input in one frame', () => {
    expect(selectWeaponFromInput('knife', 1, 1)).toBe('awp');
    expect(selectWeaponFromInput('awp', 2, -1)).toBe('deagle');
    expect(selectWeaponFromInput('awp', 3, -1)).toBe('knife');
  });
});

describe('editable gameplay target detection', () => {
  it.each(['INPUT', 'textarea', 'Select'])('ignores %s controls', (tagName) => {
    const target = Object.assign(new EventTarget(), { tagName });
    expect(isEditableGameplayTarget(target)).toBe(true);
  });

  it('ignores contenteditable descendants but accepts the gameplay canvas', () => {
    const editable = Object.assign(new EventTarget(), {
      closest: () => ({}) as Element,
    });
    const canvas = Object.assign(new EventTarget(), {
      tagName: 'CANVAS',
      closest: () => null,
    });
    expect(isEditableGameplayTarget(editable)).toBe(true);
    expect(isEditableGameplayTarget(canvas)).toBe(false);
  });
});
