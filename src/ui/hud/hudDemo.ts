import type { KillFeed } from '../../combat/KillFeed';
import type { CombatHud } from '../CombatHud';
import type { GameHud } from './GameHud';

export interface HudDemoTarget {
  /** '1' (killfeed, hitmarker, damage arc), 'board', 'death', 'low', 'kill', 'body' */
  variant: string;
  gameHud: GameHud;
  combatHud: CombatHud | null;
  killFeed: KillFeed;
  localId: string | null;
  localName: string;
}

// held long enough for any screenshot, entries in the future never fade or expire early
const HOLD_MS = 60_000;

/**
 * Screenshot preview only (?shot=...&hudDemo=1, dev and preview builds):
 * fills the hud with a made up roster, kills and hit feedback so every state
 * can be captured without a live match.
 */
export function runHudDemo(target: HudDemoTarget): void {
  const { gameHud, combatHud, killFeed, variant } = target;
  const localId = target.localId ?? 'offline';
  const now = performance.now();
  const roster = [
    { id: localId, name: target.localName },
    { id: 'bot:nova', name: 'Nova' },
    { id: 'p-kestrel', name: 'kestrel' },
    { id: 'bot:rook', name: 'Rook', alive: false },
    { id: 'p-mira', name: 'mira_' },
  ];
  gameHud.resetScores();
  gameHud.setPlayers(roster, localId);
  const deaths: Array<[string, string]> = [
    ['bot:nova', 'p-kestrel'], ['bot:nova', 'p-mira'], ['bot:nova', 'bot:rook'], ['bot:nova', localId],
    ['bot:nova', 'p-kestrel'], ['bot:nova', 'p-mira'], ['bot:nova', 'bot:rook'],
    [localId, 'bot:rook'], [localId, 'p-mira'], [localId, 'bot:nova'], [localId, 'p-kestrel'], [localId, 'bot:rook'],
    ['p-kestrel', 'bot:rook'], ['p-kestrel', 'p-mira'], ['p-kestrel', localId],
    ['p-mira', 'bot:nova'],
  ];
  for (const [killerId, victimId] of deaths) {
    gameHud.recordDeath({ killerId, victimId });
  }

  const lines = [
    { killer: 'Nova', victim: 'kestrel', weaponId: 'awp', headshot: false },
    { killer: target.localName, victim: 'Rook', weaponId: 'deagle', headshot: true, killerIsLocal: true },
    { killer: 'mira_', victim: 'Nova', weaponId: 'knife', headshot: false },
    { killer: 'kestrel', victim: target.localName, weaponId: 'deagle', headshot: false, victimIsLocal: true },
    { killer: target.localName, victim: 'mira_', weaponId: 'awp', headshot: false, killerIsLocal: true },
  ];
  killFeed.clear();
  lines.forEach((line, index) => killFeed.add(line, now + HOLD_MS + index));

  if (!combatHud) {
    return;
  }
  if (variant === 'board') {
    gameHud.setScoreboardOpen(true);
    return;
  }
  if (variant === 'death') {
    combatHud.setDeathInfo({ killerName: 'Nova', weaponId: 'awp', headshot: true }, now + 2400);
    combatHud.setHealth(0, false, true);
    return;
  }
  combatHud.setHealth(variant === 'low' ? 18 : 64, true);
  combatHud.flashWeaponSlots(now + HOLD_MS);
  combatHud.holdHitmarker(variant === 'kill' ? 'kill' : variant === 'body' ? 'normal' : 'headshot');
  combatHud.flashDamageDirection(2.2, now, HOLD_MS);
}
