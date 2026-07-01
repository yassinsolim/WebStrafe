import { describe, expect, it } from 'vitest';
import {
  applyDamage,
  canFire,
  createPlayerCombat,
  isRespawnDue,
  MAX_HEALTH,
  registerFire,
  respawn,
  RESPAWN_DELAY_MS,
} from '../CombatState';
import { getWeapon } from '../weapons';

const awp = getWeapon('awp');
const deagle = getWeapon('deagle');

describe('createPlayerCombat', () => {
  it('starts at full health and alive', () => {
    const p = createPlayerCombat();
    expect(p.health).toBe(MAX_HEALTH);
    expect(p.alive).toBe(true);
    expect(p.respawnAtMs).toBeNull();
  });
});

describe('canFire / registerFire', () => {
  it('allows the first shot', () => {
    const p = createPlayerCombat();
    expect(canFire(p, deagle, 1000)).toBe(true);
  });

  it('blocks a second shot inside the fire interval', () => {
    const p = createPlayerCombat();
    registerFire(p, deagle, 1000);
    expect(canFire(p, deagle, 1000 + deagle.fireIntervalMs - 1)).toBe(false);
  });

  it('allows a shot once the interval has elapsed', () => {
    const p = createPlayerCombat();
    registerFire(p, deagle, 1000);
    expect(canFire(p, deagle, 1000 + deagle.fireIntervalMs)).toBe(true);
  });

  it('never lets a dead player fire', () => {
    const p = createPlayerCombat();
    p.alive = false;
    expect(canFire(p, deagle, 999999)).toBe(false);
  });

  it('tracks cooldowns per weapon independently', () => {
    const p = createPlayerCombat();
    registerFire(p, deagle, 1000);
    expect(canFire(p, awp, 1000)).toBe(true);
  });
});

describe('applyDamage', () => {
  it('subtracts computed damage from health', () => {
    const target = createPlayerCombat();
    const res = applyDamage(target, deagle, 'body', 0, 0);
    expect(res.applied).toBe(deagle.damage);
    expect(target.health).toBe(MAX_HEALTH - deagle.damage);
    expect(res.killed).toBe(false);
    expect(target.alive).toBe(true);
  });

  it('kills and schedules respawn when health hits 0', () => {
    const target = createPlayerCombat();
    const res = applyDamage(target, awp, 'body', 0, 5000);
    expect(res.killed).toBe(true);
    expect(target.alive).toBe(false);
    expect(target.health).toBe(0);
    expect(target.respawnAtMs).toBe(5000 + RESPAWN_DELAY_MS);
  });

  it('clamps damage so health never goes negative', () => {
    const target = createPlayerCombat();
    const res = applyDamage(target, awp, 'head', 0, 0);
    expect(target.health).toBe(0);
    expect(res.applied).toBe(MAX_HEALTH);
  });

  it('ignores damage to an already-dead target', () => {
    const target = createPlayerCombat();
    applyDamage(target, awp, 'body', 0, 0);
    const res = applyDamage(target, deagle, 'body', 0, 100);
    expect(res.applied).toBe(0);
    expect(res.killed).toBe(false);
  });

  it('does not kill when out of range (0 damage)', () => {
    const target = createPlayerCombat();
    const res = applyDamage(target, awp, 'body', awp.range + 1, 0);
    expect(res.applied).toBe(0);
    expect(target.health).toBe(MAX_HEALTH);
    expect(target.alive).toBe(true);
  });
});

describe('respawn lifecycle', () => {
  it('is not due before the timer elapses', () => {
    const p = createPlayerCombat();
    applyDamage(p, awp, 'body', 0, 1000);
    expect(isRespawnDue(p, 1000 + RESPAWN_DELAY_MS - 1)).toBe(false);
  });

  it('is due once the timer elapses', () => {
    const p = createPlayerCombat();
    applyDamage(p, awp, 'body', 0, 1000);
    expect(isRespawnDue(p, 1000 + RESPAWN_DELAY_MS)).toBe(true);
  });

  it('is never due for a living player', () => {
    const p = createPlayerCombat();
    expect(isRespawnDue(p, 999999)).toBe(false);
  });

  it('restores full health and clears the timer', () => {
    const p = createPlayerCombat();
    applyDamage(p, awp, 'body', 0, 1000);
    respawn(p);
    expect(p.health).toBe(MAX_HEALTH);
    expect(p.alive).toBe(true);
    expect(p.respawnAtMs).toBeNull();
  });
});
