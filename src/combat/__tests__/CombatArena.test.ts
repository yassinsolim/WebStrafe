import { describe, expect, it } from 'vitest';
import { CombatArena } from '../CombatArena';
import { MAX_HEALTH, RESPAWN_DELAY_MS } from '../CombatState';
import { getWeapon } from '../weapons';

const deagle = getWeapon('deagle');

/** Sets up two players on the same map: shooter at origin, target 10u down -Z. */
function twoPlayers(): CombatArena {
  const a = new CombatArena();
  a.addPlayer('shooter', 'map1', 'deagle');
  a.addPlayer('target', 'map1', 'deagle');
  a.setPosition('shooter', [0, 0, 0]);
  a.setPosition('target', [0, 0, -10]);
  return a;
}

const eye: [number, number, number] = [0, 1.6, 0];
const aimAtTarget: [number, number, number] = [0, 0, -1];

describe('CombatArena.handleFire', () => {
  it('reports the active weapon (and equips)', () => {
    const a = twoPlayers();
    expect(a.getActiveWeapon('shooter')).toBe('deagle');
    a.equip('shooter', 'awp');
    expect(a.getActiveWeapon('shooter')).toBe('awp');
    expect(a.getActiveWeapon('nobody')).toBeNull();
  });

  it('hits a target directly in the line of fire', () => {
    const a = twoPlayers();
    const out = a.handleFire('shooter', eye, aimAtTarget, 1000);
    expect(out.fired).toBe(true);
    expect(out.hit?.targetId).toBe('target');
    expect(out.hit?.damage).toBeGreaterThan(0);
    expect(a.getHealth('target')).toBe(MAX_HEALTH - out.hit!.damage);
  });

  it('misses when aimed away from every target', () => {
    const a = twoPlayers();
    const out = a.handleFire('shooter', eye, [1, 0, 0], 1000);
    expect(out.fired).toBe(true);
    expect(out.hit).toBeUndefined();
    expect(a.getHealth('target')).toBe(MAX_HEALTH);
  });

  it('does not let a dead shooter fire', () => {
    const a = twoPlayers();
    // Kill the shooter first by having the target shoot back enough times.
    a.setPosition('shooter', [0, 0, 0]);
    // Manually drain: fire AWP once at shooter from a third player.
    a.addPlayer('sniper', 'map1', 'awp');
    a.setPosition('sniper', [0, 0, 5]);
    a.handleFire('sniper', [0, 1.6, 5], [0, 0, -1], 1000); // AWP body one-shots shooter
    expect(a.isAlive('shooter')).toBe(false);
    const out = a.handleFire('shooter', eye, aimAtTarget, 2000);
    expect(out.fired).toBe(false);
  });

  it('ignores targets on a different map', () => {
    const a = new CombatArena();
    a.addPlayer('shooter', 'map1', 'deagle');
    a.addPlayer('elsewhere', 'map2', 'deagle');
    a.setPosition('shooter', [0, 0, 0]);
    a.setPosition('elsewhere', [0, 0, -10]);
    const out = a.handleFire('shooter', eye, aimAtTarget, 1000);
    expect(out.hit).toBeUndefined();
    expect(a.getHealth('elsewhere')).toBe(MAX_HEALTH);
  });

  it('enforces fire cooldown (rapid re-fire does nothing)', () => {
    const a = twoPlayers();
    expect(a.handleFire('shooter', eye, aimAtTarget, 1000).fired).toBe(true);
    expect(a.handleFire('shooter', eye, aimAtTarget, 1000 + deagle.fireIntervalMs - 1).fired).toBe(false);
  });

  it('rejects an implausible fire origin (anti teleport-shoot) but still fires', () => {
    const a = twoPlayers();
    const farOrigin: [number, number, number] = [0, 1.6, 500];
    const out = a.handleFire('shooter', farOrigin, aimAtTarget, 1000);
    expect(out.fired).toBe(true);
    expect(out.hit).toBeUndefined();
    expect(a.getHealth('target')).toBe(MAX_HEALTH);
  });

  it('accepts an origin within the deviation tolerance', () => {
    const a = twoPlayers();
    // Nudge origin sideways within tolerance and aim back at the target so the
    // ray still passes through the capsule.
    const nudged: [number, number, number] = [1, 1.6, 0];
    const dir: [number, number, number] = [-1 / Math.hypot(1, 10), 0, -10 / Math.hypot(1, 10)];
    const out = a.handleFire('shooter', nudged, dir, 1000);
    expect(out.hit?.targetId).toBe('target');
  });

  it('emits a death event and stops the victim from being hit again', () => {
    const a = new CombatArena();
    a.addPlayer('shooter', 'map1', 'awp');
    a.addPlayer('target', 'map1', 'deagle');
    a.setPosition('shooter', [0, 0, 0]);
    a.setPosition('target', [0, 0, -10]);
    const out = a.handleFire('shooter', eye, aimAtTarget, 1000); // AWP one-shots
    expect(out.death?.victimId).toBe('target');
    expect(a.isAlive('target')).toBe(false);
    // A dead target is no longer a valid capsule.
    const out2 = a.handleFire('shooter', eye, aimAtTarget, 1000 + getWeapon('awp').fireIntervalMs);
    expect(out2.hit).toBeUndefined();
  });

  it('cannot fire with an empty magazine', () => {
    const a = twoPlayers();
    let now = 0;
    for (let i = 0; i < deagle.magazine; i++) {
      a.handleFire('shooter', eye, [1, 0, 0], now); // aim away, just burn ammo
      now += deagle.fireIntervalMs;
    }
    expect(a.getAmmo('shooter')).toBe(0);
    expect(a.handleFire('shooter', eye, aimAtTarget, now).fired).toBe(false);
  });
});

describe('CombatArena.tickRespawns', () => {
  it('respawns a dead player after the delay and restores health', () => {
    const a = new CombatArena();
    a.addPlayer('shooter', 'map1', 'awp');
    a.addPlayer('target', 'map1', 'deagle');
    a.setPosition('shooter', [0, 0, 0]);
    a.setPosition('target', [0, 0, -10]);
    a.handleFire('shooter', eye, aimAtTarget, 1000);
    expect(a.isAlive('target')).toBe(false);

    expect(a.tickRespawns(1000 + RESPAWN_DELAY_MS - 1)).toHaveLength(0);
    const events = a.tickRespawns(1000 + RESPAWN_DELAY_MS);
    expect(events).toHaveLength(1);
    expect(events[0].playerId).toBe('target');
    expect(a.isAlive('target')).toBe(true);
    expect(a.getHealth('target')).toBe(MAX_HEALTH);
  });

  it('uses the provided spawn position', () => {
    const a = new CombatArena();
    a.addPlayer('shooter', 'map1', 'awp');
    a.addPlayer('target', 'map1', 'deagle');
    a.setPosition('shooter', [0, 0, 0]);
    a.setPosition('target', [0, 0, -10]);
    a.handleFire('shooter', eye, aimAtTarget, 1000);
    const events = a.tickRespawns(1000 + RESPAWN_DELAY_MS, () => [7, 8, 9]);
    expect(events[0].position).toEqual([7, 8, 9]);
  });
});

describe('CombatArena membership', () => {
  it('tracks and removes players', () => {
    const a = new CombatArena();
    a.addPlayer('p', 'map1');
    expect(a.has('p')).toBe(true);
    a.removePlayer('p');
    expect(a.has('p')).toBe(false);
    expect(a.getHealth('p')).toBeNull();
  });
});

describe('CombatArena spawn protection', () => {
  it('ignores damage to a spawn-protected target, then lands once it expires', () => {
    const a = twoPlayers();
    a.protectSpawn('target', 1000); // protected until 1000 + SPAWN_PROTECTION_MS

    // Shot during protection: counts as fired but deals no damage.
    const blocked = a.handleFire('shooter', eye, aimAtTarget, 1500);
    expect(blocked.fired).toBe(true);
    expect(blocked.hit).toBeUndefined();
    expect(a.getHealth('target')).toBe(MAX_HEALTH);
    expect(a.isSpawnProtected('target', 1500)).toBe(true);

    // After the window, the same shot connects.
    const landed = a.handleFire('shooter', eye, aimAtTarget, 4000);
    expect(landed.hit?.targetId).toBe('target');
    expect(a.getHealth('target')).toBeLessThan(MAX_HEALTH);
  });

  it('re-grants protection on respawn', () => {
    const a = twoPlayers();
    // Kill the target outright with repeated fire.
    for (let i = 0; i < 4; i += 1) {
      a.handleFire('shooter', eye, aimAtTarget, 1000 + i * deagle.fireIntervalMs);
    }
    expect(a.isAlive('target')).toBe(false);
    const respawnAt = 1000 + 4 * deagle.fireIntervalMs + RESPAWN_DELAY_MS;
    a.tickRespawns(respawnAt, () => [0, 0, -10]);
    expect(a.isAlive('target')).toBe(true);
    // Freshly respawned => protected.
    expect(a.isSpawnProtected('target', respawnAt + 100)).toBe(true);
  });
});
