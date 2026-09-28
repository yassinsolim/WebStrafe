import type { MapType } from './menu/menuInfo';

export interface LoadingTip {
  text: string;
  /** only on these map types, every type when missing */
  maps?: readonly MapType[];
  /** true: combat builds only, false: builds without combat only */
  combat?: boolean;
}

/** every tip describes how this game actually plays, check the code before adding one */
export const LOADING_TIPS: readonly LoadingTip[] = [
  { text: 'Strafe in the air by holding A or D and turning the mouse the same way. That is where speed comes from.' },
  { text: 'Hold Space to keep hopping while auto-bhop is on. You can turn it off under Settings, Game.' },
  { text: 'The speedometer turns green when you are faster than your last takeoff and red when you lost speed.' },
  { text: 'On a surf ramp, hold the strafe key that points into the ramp and leave W alone.', maps: ['surf'] },
  { text: 'Keep your mouse movement smooth on ramps. Sharp turns bleed speed.', maps: ['surf'] },
  { text: 'Land and jump again in the same moment to keep a bhop chain going.', maps: ['bhop'] },
  { text: 'Press R to reset to spawn if a run goes wrong.', combat: false },
  { text: 'Finish a timed map to put your run on the leaderboard.', maps: ['surf', 'bhop'] },
  { text: 'An AWP body shot deals 115 damage. That is a kill in one hit.', combat: true },
  { text: 'Deagle headshots do double damage, enough to drop anyone up close.', combat: true },
  { text: 'Right click scopes the AWP. Click again to zoom further, a third time to unscope.', combat: true },
  { text: 'Moving and jumping widen your spread. Stop before you take the shot.', combat: true },
  { text: 'A knife stab in the back deals 180 damage. Sneak up on them.', combat: true },
  { text: 'Press 1, 2 and 3 or roll the mouse wheel to switch weapons.', combat: true },
  { text: 'R reloads. Reloads never run out, so reload whenever there is a gap.', combat: true },
  { text: 'Hold Tab to see the scoreboard.' },
  { text: 'Press Y to inspect the weapon in your hands.' },
  { text: 'Make the crosshair yours under Settings, Crosshair, and share it with a code.' },
  { text: 'F3 shows the raw movement readout if you want to see what is going on.' },
];

/** the tips that are true on this map in this build, in a stable shuffled order */
export function tipsFor(mapType: MapType, combat: boolean, seed = 0): string[] {
  const matching = LOADING_TIPS.filter((tip) =>
    (tip.maps === undefined || tip.maps.includes(mapType))
    && (tip.combat === undefined || tip.combat === combat));
  const order = matching.map((tip, index) => ({ tip, key: hash(`${seed}:${index}`) }));
  order.sort((a, b) => a.key - b.key);
  return order.map((entry) => entry.tip.text);
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
