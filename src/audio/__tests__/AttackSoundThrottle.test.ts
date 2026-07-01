import { describe, expect, it } from 'vitest';
import { AttackSoundThrottle } from '../AttackSoundThrottle';

describe('AttackSoundThrottle', () => {
  it('allows the first attack for a player', () => {
    const t = new AttackSoundThrottle(110);
    expect(t.shouldPlay('a', 1000)).toBe(true);
  });

  it('blocks a second attack within the cooldown window', () => {
    const t = new AttackSoundThrottle(110);
    expect(t.shouldPlay('a', 1000)).toBe(true);
    expect(t.shouldPlay('a', 1050)).toBe(false);
    expect(t.shouldPlay('a', 1109)).toBe(false);
  });

  it('allows again once the cooldown has elapsed', () => {
    const t = new AttackSoundThrottle(110);
    expect(t.shouldPlay('a', 1000)).toBe(true);
    expect(t.shouldPlay('a', 1110)).toBe(true);
  });

  it('tracks players independently', () => {
    const t = new AttackSoundThrottle(110);
    expect(t.shouldPlay('a', 1000)).toBe(true);
    expect(t.shouldPlay('b', 1000)).toBe(true);
    expect(t.shouldPlay('a', 1000)).toBe(false);
    expect(t.shouldPlay('b', 1000)).toBe(false);
  });

  it('does not advance the timer on a blocked attempt', () => {
    const t = new AttackSoundThrottle(110);
    expect(t.shouldPlay('a', 1000)).toBe(true);
    // Blocked at 1100 (within window) must NOT reset the clock...
    expect(t.shouldPlay('a', 1100)).toBe(false);
    // ...so 1110 (110ms after the last *played*) is allowed.
    expect(t.shouldPlay('a', 1110)).toBe(true);
  });

  it('forgets a player so their next attack plays immediately', () => {
    const t = new AttackSoundThrottle(110);
    expect(t.shouldPlay('a', 1000)).toBe(true);
    t.forget('a');
    expect(t.shouldPlay('a', 1001)).toBe(true);
  });
});
