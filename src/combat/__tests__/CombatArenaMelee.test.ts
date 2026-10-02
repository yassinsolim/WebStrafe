import { describe, expect, it } from 'vitest';
import {
  CombatArena,
  MELEE_ATTACK_TIME_SLACK_MS,
  SPAWN_PROTECTION_MS,
} from '../CombatArena';
import { MAX_HEALTH } from '../CombatState';
import { KATANA_MELEE } from '../katana';
import { KNIFE_DAMAGE, KNIFE_TIMING_MS } from '../knives';

const eye: [number, number, number] = [0, 1.6, 0];
const ahead: [number, number, number] = [0, 0, -1];
/** victim yaw facing the attacker (+z) and facing away (-z) */
const FACING = Math.PI;
const AWAY = 0;

function duel(victimZ = -1.2, victimYaw = FACING): CombatArena {
  const arena = new CombatArena();
  arena.addPlayer('attacker', 'map', 'knife');
  arena.addPlayer('victim', 'map', 'knife');
  arena.setPosition('attacker', [0, 0, 0], 'map', 1000, [0, 0, 0], 0);
  arena.setPosition('victim', [0, 0, victimZ], 'map', 1000, [0, 0, 0], victimYaw);
  return arena;
}

function aimYaw(deg: number): [number, number, number] {
  const rad = (deg * Math.PI) / 180;
  return [-Math.sin(rad), 0, -Math.cos(rad)];
}

describe('CombatArena.handleMelee', () => {
  it('slashes for 40 from the front, then 25 on the follow-up, then 40 once rested', () => {
    const arena = duel();
    const first = arena.handleMelee('attacker', 'primary', eye, ahead, 1000);
    expect(first.hit).toMatchObject({
      targetId: 'victim',
      weaponId: 'knife',
      damage: KNIFE_DAMAGE.primary,
      hitbox: 'body',
      melee: 'primary',
      backstab: false,
      killed: false,
    });
    expect(first.melee).toBe('primary');
    expect(first.impactPoint?.every(Number.isFinite)).toBe(true);

    const followUp = arena.handleMelee('attacker', 'primary', eye, ahead, 1000 + KNIFE_TIMING_MS.primaryIntervalHit);
    expect(followUp.hit?.damage).toBe(KNIFE_DAMAGE.primaryFollowUp);
    expect(arena.getHealth('victim')).toBe(MAX_HEALTH - 40 - 25);

    // rest past the cooldown plus the follow-up window: a full 40 finishes the
    // 35 hp left, where another follow-up (25) would not
    const rested = 1500 + KNIFE_TIMING_MS.primaryIntervalHit + KNIFE_TIMING_MS.followUpWindow;
    const fresh = arena.handleMelee('attacker', 'primary', eye, ahead, rested);
    expect(fresh.hit).toMatchObject({ damage: 35, killed: true });
    expect(fresh.death?.weaponId).toBe('knife');
  });

  it('keeps spam at 25 inside the follow-up window', () => {
    const arena = duel();
    arena.handleMelee('attacker', 'primary', eye, ahead, 1000);
    const almostRested = 1000 + KNIFE_TIMING_MS.primaryIntervalHit + KNIFE_TIMING_MS.followUpWindow - 1;
    expect(arena.handleMelee('attacker', 'primary', eye, ahead, almostRested).hit?.damage)
      .toBe(KNIFE_DAMAGE.primaryFollowUp);
  });

  it('stabs for 65 from the front', () => {
    const arena = duel();
    const out = arena.handleMelee('attacker', 'secondary', eye, ahead, 1000);
    expect(out.hit).toMatchObject({ damage: KNIFE_DAMAGE.secondary, melee: 'secondary', backstab: false });
    expect(arena.getHealth('victim')).toBe(MAX_HEALTH - 65);
  });

  it('kills with a stab to the back (180) from full health', () => {
    const arena = duel(-1.2, AWAY);
    const out = arena.handleMelee('attacker', 'secondary', eye, ahead, 1000);
    expect(out.hit).toMatchObject({ damage: MAX_HEALTH, backstab: true, killed: true });
    expect(out.death).toEqual({ victimId: 'victim', killerId: 'attacker', weaponId: 'knife', headshot: false });
    expect(arena.isAlive('victim')).toBe(false);
  });

  it('slash backstab deals 90 and kills a wounded victim (not lethal from 100, like cs)', () => {
    const fromFull = duel(-1.2, AWAY);
    const ninety = fromFull.handleMelee('attacker', 'primary', eye, ahead, 1000);
    expect(ninety.hit).toMatchObject({ damage: KNIFE_DAMAGE.primaryBackstab, backstab: true, killed: false });
    expect(fromFull.getHealth('victim')).toBe(10);

    const arena = duel(-1.2, FACING);
    arena.handleMelee('attacker', 'primary', eye, ahead, 1000);
    expect(arena.getHealth('victim')).toBe(60);
    // victim turns away; backstab damage ignores the follow-up reduction
    arena.setPosition('victim', [0, 0, -1.2], 'map', 1100, [0, 0, 0], AWAY);
    const kill = arena.handleMelee('attacker', 'primary', eye, ahead, 1500);
    expect(kill.hit).toMatchObject({ backstab: true, killed: true, damage: 60 });
    expect(kill.death?.weaponId).toBe('knife');
  });

  it('misses beyond each attack range (slash reaches further than stab)', () => {
    // capsule surface 1.26 m away: inside the 1.45 m slash, outside the 1.2 m stab
    const arena = duel(-1.6);
    expect(arena.handleMelee('attacker', 'secondary', eye, ahead, 1000)).toEqual({ fired: true, melee: 'secondary' });
    expect(arena.getHealth('victim')).toBe(MAX_HEALTH);
    expect(arena.handleMelee('attacker', 'primary', eye, ahead, 3000).hit?.targetId).toBe('victim');

    const far = duel(-1.9);
    expect(far.handleMelee('attacker', 'primary', eye, ahead, 1000).hit).toBeUndefined();
  });

  it('misses when the aim is well off the victim', () => {
    const arena = duel();
    expect(arena.handleMelee('attacker', 'primary', eye, aimYaw(55), 1000).hit).toBeUndefined();
    // a small miss is forgiven like cs's hull trace
    expect(arena.handleMelee('attacker', 'primary', eye, aimYaw(20), 2000).hit?.targetId).toBe('victim');
  });

  it('cannot cut through world geometry', () => {
    const arena = duel();
    const blocked = arena.handleMelee('attacker', 'secondary', eye, ahead, 1000, { isBlocked: () => true });
    expect(blocked.fired).toBe(true);
    expect(blocked.hit).toBeUndefined();
    const shortWall = duel().handleMelee('attacker', 'primary', eye, ahead, 1000, { blockingDistance: 0.4 });
    expect(shortWall.hit).toBeUndefined();
    expect(arena.getHealth('victim')).toBe(MAX_HEALTH);
  });

  it('applies cs cooldowns: stab locks both attacks, a hit adds 0.1 s', () => {
    const arena = duel();
    expect(arena.handleMelee('attacker', 'secondary', eye, ahead, 1000).hit).toBeDefined();
    expect(arena.handleMelee('attacker', 'primary', eye, ahead, 2099).fired).toBe(false);
    expect(arena.handleMelee('attacker', 'secondary', eye, ahead, 2099).fired).toBe(false);
    expect(arena.handleMelee('attacker', 'primary', eye, ahead, 2100).fired).toBe(true);
    // after that slash (a hit) the stab waits 0.5 s
    expect(arena.handleMelee('attacker', 'secondary', eye, ahead, 2599).fired).toBe(false);
    expect(arena.handleMelee('attacker', 'secondary', eye, ahead, 2600).fired).toBe(true);

    const misses = duel(-5);
    expect(misses.handleMelee('attacker', 'primary', eye, ahead, 1000).fired).toBe(true);
    expect(misses.handleMelee('attacker', 'primary', eye, ahead, 1399).fired).toBe(false);
    expect(misses.handleMelee('attacker', 'primary', eye, ahead, 1400).fired).toBe(true);
  });

  it('respects spawn protection', () => {
    const arena = duel(-1.2, AWAY);
    arena.protectSpawn('victim', 1000);
    const blocked = arena.handleMelee('attacker', 'secondary', eye, ahead, 1500);
    expect(blocked.fired).toBe(true);
    expect(blocked.hit).toBeUndefined();
    expect(arena.getHealth('victim')).toBe(MAX_HEALTH);
    const later = arena.handleMelee('attacker', 'secondary', eye, ahead, 1000 + SPAWN_PROTECTION_MS);
    expect(later.hit?.killed).toBe(true);
  });

  it('judges the backstab on the yaw the attacker saw', () => {
    const arena = duel(-1.2, FACING);
    // the victim turned away 100 ms later, but the attacker was still drawing the old pose
    arena.setPosition('victim', [0, 0, -1.2], 'map', 1100, [0, 0, 0], AWAY);
    const seen = arena.handleMelee('attacker', 'secondary', eye, ahead, 1150, { targetTimes: { victim: 1000 } });
    expect(seen.hit).toMatchObject({ backstab: false, damage: KNIFE_DAMAGE.secondary });

    const now = duel(-1.2, FACING);
    now.setPosition('victim', [0, 0, -1.2], 'map', 1100, [0, 0, 0], AWAY);
    expect(now.handleMelee('attacker', 'secondary', eye, ahead, 1150).hit?.backstab).toBe(true);
  });

  it('hits the rewound position of a moving victim', () => {
    const arena = duel(-1.2);
    arena.setPosition('victim', [3, 0, -1.2], 'map', 1200, [15, 0, 0], FACING);
    expect(arena.handleMelee('attacker', 'primary', eye, ahead, 1250).hit).toBeUndefined();
    const rewound = duel(-1.2);
    rewound.setPosition('victim', [3, 0, -1.2], 'map', 1200, [15, 0, 0], FACING);
    expect(rewound.handleMelee('attacker', 'primary', eye, ahead, 1250, { targetTimes: { victim: 1000 } }).hit)
      .toBeDefined();
  });

  it('treats a knife fire without a melee kind as a slash (older clients)', () => {
    const arena = duel();
    const out = arena.handleFire('attacker', eye, ahead, 1000);
    expect(out.hit).toMatchObject({ weaponId: 'knife', damage: KNIFE_DAMAGE.primary, melee: 'primary' });
  });

  it('uses the mapped swing time so network jitter does not eat spaced swings', () => {
    const arena = duel(-5);
    expect(arena.handleMelee('attacker', 'primary', eye, ahead, 1030, { attackTimeMs: 1000 }).fired).toBe(true);
    // arrives 385 ms after the first packet, but was sent 400 ms after it
    expect(arena.handleMelee('attacker', 'primary', eye, ahead, 1415, { attackTimeMs: 1400 }).fired).toBe(true);

    const arrivalOnly = duel(-5);
    expect(arrivalOnly.handleMelee('attacker', 'primary', eye, ahead, 1030).fired).toBe(true);
    expect(arrivalOnly.handleMelee('attacker', 'primary', eye, ahead, 1415).fired).toBe(false);
  });

  it('bounds claimed swing times so swings cannot be banked', () => {
    const arena = duel(-5);
    expect(arena.handleMelee('attacker', 'primary', eye, ahead, 5000, { attackTimeMs: 0 }).fired).toBe(true);
    // the claim was clamped to 5000 - slack, so the next slash waits from there
    const next = 5000 - MELEE_ATTACK_TIME_SLACK_MS + KNIFE_TIMING_MS.primaryInterval;
    expect(arena.handleMelee('attacker', 'primary', eye, ahead, next - 1, { attackTimeMs: next - 1 }).fired).toBe(false);
    expect(arena.handleMelee('attacker', 'primary', eye, ahead, next, { attackTimeMs: next + 500 }).fired).toBe(true);
  });

  it('spends but voids a swing from an implausible origin', () => {
    const arena = duel();
    const out = arena.handleMelee('attacker', 'secondary', [0, 1.6, 1.5], ahead, 1000);
    expect(out).toEqual({ fired: true, melee: 'secondary' });
    expect(arena.handleMelee('attacker', 'secondary', eye, ahead, 1500).fired).toBe(false);
  });

  it('needs the knife in hand and a living attacker', () => {
    const arena = duel();
    arena.equip('attacker', 'deagle');
    expect(arena.handleMelee('attacker', 'primary', eye, ahead, 1000).fired).toBe(false);
    expect(arena.handleMelee('nobody', 'primary', eye, ahead, 1000).fired).toBe(false);
  });
});

describe('CombatArena.handleMelee with the katana', () => {
  function katanaDuel(victimZ: number): CombatArena {
    const arena = duel(victimZ);
    arena.equip('attacker', 'katana', 1000);
    return arena;
  }

  it('reaches past the knife and cuts harder', () => {
    // just past knife reach, inside the katana's
    const knife = duel(-2.0).handleMelee('attacker', 'primary', eye, ahead, 1000);
    expect(knife.hit).toBeUndefined();
    const katana = katanaDuel(-2.0).handleMelee('attacker', 'primary', eye, ahead, 1000);
    expect(katana.hit).toMatchObject({ weaponId: 'katana', damage: KATANA_MELEE.damage.primary, melee: 'primary' });
  });

  it('kills in two slashes, keeps its own cooldown and reports the katana', () => {
    const arena = katanaDuel(-1.2);
    arena.handleMelee('attacker', 'primary', eye, ahead, 1000);
    // the knife's cooldown has run out, the katana's has not
    expect(arena.handleMelee('attacker', 'primary', eye, ahead, 1000 + KNIFE_TIMING_MS.primaryIntervalHit).fired).toBe(false);
    const second = arena.handleMelee('attacker', 'primary', eye, ahead, 1000 + KATANA_MELEE.timing.primaryIntervalHit);
    // the follow-up (45) is more than the 40 left
    expect(second.hit).toMatchObject({ damage: MAX_HEALTH - KATANA_MELEE.damage.primary, killed: true });
    expect(second.death?.weaponId).toBe('katana');
  });

  it('heavy cut leaves 10 hp from the front', () => {
    const arena = katanaDuel(-1.2);
    const heavy = arena.handleMelee('attacker', 'secondary', eye, ahead, 1000);
    expect(heavy.hit).toMatchObject({ damage: KATANA_MELEE.damage.secondary, killed: false });
    expect(arena.getHealth('victim')).toBe(MAX_HEALTH - KATANA_MELEE.damage.secondary);
  });
});
