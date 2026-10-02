import type { MeleeStats } from './knives';

/**
 * the katana: a slower melee weapon with more reach and heavier cuts than the
 * knife. same attack rules as the knife (slash with a follow-up, heavy cut,
 * backstabs), its own numbers. two slashes kill from full health, the heavy
 * cut leaves 10 hp, and either one from behind kills.
 */
export const KATANA_MELEE: MeleeStats = {
  damage: {
    primary: 60,
    primaryFollowUp: 45,
    secondary: 90,
    primaryBackstab: 120,
    secondaryBackstab: 180,
  },
  timing: {
    primaryInterval: 560,
    primaryIntervalHit: 650,
    secondaryAfterPrimary: 600,
    secondaryInterval: 1150,
    secondaryIntervalHit: 1250,
    followUpWindow: 450,
  },
  // about a blade length further than the knife
  range: {
    primary: 2.1,
    secondary: 1.8,
  },
  sweepRadius: 0.5,
};
