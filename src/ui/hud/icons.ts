/**
 * Original inline SVG icons (drawn for WebStrafe, not traced from any game).
 * Weapons face right so a killfeed line reads killer -> weapon -> victim.
 * Everything fills with currentColor so css decides the colour; the darker
 * detail cuts use a translucent black so they read on any colour.
 */

export type IconName =
  | 'awp'
  | 'deagle'
  | 'knife'
  | 'katana'
  | 'headshot'
  | 'health'
  | 'ammo'
  | 'skull'
  | 'speed'
  | 'ping'
  | 'infinity'
  | 'crown'
  | 'players'
  | 'timer';

interface IconDef {
  viewBox: string;
  body: string;
}

const CUT = 'rgba(0,0,0,0.38)';

const ICONS: Record<IconName, IconDef> = {
  awp: {
    viewBox: '0 0 120 30',
    body: [
      // thumbhole stock with the grip behind the trigger
      '<path fill-rule="evenodd" d="M2 9.2L34.5 9.6V15.8H33.6L32.4 25.4C32.3 26.3 31.6 26.8 30.8 26.8H27.6C26.7 26.8 26.1 26.1 26.2 25.2L26.9 19.8H21.2L4.4 21.6H2Z'
        + ' M18.6 12.6H28.4C29.3 12.6 29.9 13.3 29.7 14.2L29.1 17.2C29 17.9 28.4 18.4 27.7 18.4H20.4C19.4 18.4 18.6 17.6 18.6 16.6Z"/>',
      // receiver, trigger guard, trigger, magazine
      '<path d="M34.5 9.2H62V14.6H34.5Z"/>',
      '<path fill-rule="evenodd" d="M34.2 14.4H41.6V17C41.6 19 40.2 20.2 38.2 20.2H36.8C35 20.2 34.2 19.2 34.2 17.6Z'
        + ' M35.8 14.8H40V16.8C40 18 39.2 18.6 38 18.6H37C36.2 18.6 35.8 18 35.8 17.2Z"/>',
      '<path d="M37.2 15H38.4L38 17.6H37.2Z"/>',
      '<path d="M46 14.4H52.4L51.6 20.2H46.6Z"/>',
      // scope: eyepiece bell, tube, turret, objective bell and the two mounts
      '<path d="M34.2 2.8H40.2L40.8 4V7.2L40.2 8.4H34.2Z"/>',
      '<path d="M40 4H62V7.2H40Z"/>',
      '<path d="M48.8 1.8H52.6V4H48.8Z"/>',
      '<path d="M61.6 3.6L63.2 2H70.4V9.2H63.2L61.6 7.6Z"/>',
      '<path d="M44 7.2H47V9.4H44Z M55.8 7.2H58.8V9.4H55.8Z"/>',
      // forend, barrel and muzzle brake with its ports
      '<path d="M62 9.8H80.4L82 11.2V13.6L80.6 15H62Z"/>',
      '<path d="M80 10.8H108.6V13.2H80Z"/>',
      '<path d="M107.8 9.6H116.8L117.6 10.4V13.6L116.8 14.4H107.8Z"/>',
      `<path fill="${CUT}" d="M110 10.8H111.1V13.2H110Z M112.6 10.8H113.7V13.2H112.6Z"/>`,
    ].join(''),
  },
  deagle: {
    viewBox: '0 0 64 30',
    body: [
      // slide with sights and a chamfered nose, hammer at the back
      '<path d="M12.6 5.2H58.4L60.2 7V12.6H12.6Z"/>',
      '<path d="M55.6 3.6H58V5.2H55.6Z M13.6 3.4H17.6V5.2H13.6Z"/>',
      '<path d="M9.6 6.4L12.6 5.8V10.8H10.4Z"/>',
      // frame under the barrel, trigger guard, trigger
      '<path d="M21 12.6H59.6V14.4L57.2 16.2H24Z"/>',
      '<path fill-rule="evenodd" d="M26.4 15.4H38.4C38.2 20.2 35.8 22.6 31.8 22.6H29.4C27.4 22.6 26.4 21.2 26.4 19.4Z'
        + ' M28.4 16.4H36C35.6 19.4 34 20.8 31.6 20.8H29.8C28.9 20.8 28.4 20.2 28.4 19.4Z"/>',
      '<path d="M31.2 16.4H32.8L32 19.8H30.8Z"/>',
      // raked grip
      '<path d="M13.2 12.6H26.6V15.6L22.4 29.2C22.2 29.8 21.6 30 21 30H10.4C9.4 30 8.8 29.2 9 28.2Z"/>',
      // slide serrations and ejection port
      `<path fill="${CUT}" d="M15.2 6.8H16.2V11H15.2Z M17.2 6.8H18.2V11H17.2Z M19.2 6.8H20.2V11H19.2Z M36 6.6H46V8.2H36Z"/>`,
    ].join(''),
  },
  knife: {
    viewBox: '0 0 64 24',
    body: [
      // handle with grip grooves, guard, clip point blade with a fuller
      '<path d="M3 10.6C3 9.4 3.9 8.6 5 8.6H22.4V15.6H5C3.9 15.6 3 14.8 3 13.6Z"/>',
      '<path d="M22.4 6.4H25.4V17.8H22.4Z"/>',
      '<path d="M25.4 8.6H48.6L55.4 10.8L61.6 11.6C58.2 14.6 52.6 16.4 45.6 16.4H25.4Z"/>',
      `<path fill="${CUT}" d="M8 9.8H9.4V14.4H8Z M11.8 9.8H13.2V14.4H11.8Z M15.6 9.8H17V14.4H15.6Z M28 10.4H44.6V11.4H28Z"/>`,
    ].join(''),
  },
  katana: {
    viewBox: '0 0 120 24',
    body: [
      // wrapped handle with a pommel cap, angular guard, long gently curved blade to a sharp tip
      '<path d="M2 11.2C2 10 2.8 9.2 4 9.2H31V14.8H4C2.8 14.8 2 14 2 12.8Z"/>',
      '<path d="M31 5.4L35.6 6.6V17.4L31 18.6Z"/>',
      '<path d="M35.6 9.4H38.4V14.6H35.6Z"/>',
      '<path d="M38.4 9.6C62 9.2 88 8.4 106 6.4L118.6 5.2C113 9.4 104 12.4 92 13.6C74 14.6 56 14.6 38.4 14.4Z"/>',
      `<path fill="${CUT}" d="M7 9.8L9.4 14.2H10.8L8.4 9.8Z M13 9.8L15.4 14.2H16.8L14.4 9.8Z M19 9.8L21.4 14.2H22.8L20.4 9.8Z M25 9.8L27.4 14.2H28.8L26.4 9.8Z M42 10.6C64 10.2 86 9.6 102 7.8L102.4 8.6C86 10.6 64 11.4 42 11.6Z"/>`,
    ].join(''),
  },
  headshot: {
    viewBox: '0 0 24 24',
    body: [
      // a head in a reticle
      '<path d="M12 5.4a4.2 4.2 0 1 1 0 8.4 4.2 4.2 0 0 1 0-8.4z M4.8 21.2C5.6 17.4 8.4 15.2 12 15.2s6.4 2.2 7.2 6z"/>',
      '<path fill="none" stroke="currentColor" stroke-width="2.4" d="M12 0.6v3.6 M12 19.8v3.6 M0.6 12h3.6 M19.8 12h3.6"/>',
      '<circle cx="12" cy="12" r="9.6" fill="none" stroke="currentColor" stroke-width="2"/>',
    ].join(''),
  },
  health: {
    viewBox: '0 0 24 24',
    body: '<path d="M8.6 2.4H15.4V8.6H21.6V15.4H15.4V21.6H8.6V15.4H2.4V8.6H8.6Z"/>',
  },
  ammo: {
    viewBox: '0 0 12 24',
    body: '<path d="M6 1.5c2 1.6 3.2 4 3.3 6.8V18H2.7V8.3C2.8 5.5 4 3.1 6 1.5z M2.2 19.2h7.6v3.3H2.2z"/>',
  },
  skull: {
    viewBox: '0 0 24 24',
    body: '<path fill-rule="evenodd" d="M12 2.2c5 0 8.6 3.4 8.6 8 0 2.9-1.4 4.9-3.4 6.1v3.2c0 1-.8 1.8-1.8 1.8H8.6c-1 0-1.8-.8-1.8-1.8v-3.2c-2-1.2-3.4-3.2-3.4-6.1 0-4.6 3.6-8 8.6-8z M8.4 9.6a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4z M15.6 9.6a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4z M12 14.6l-1.4 2.4h2.8z"/>',
  },
  speed: {
    viewBox: '0 0 24 24',
    body: '<path d="M3 13.5L13.5 3l-1.8 7.5H21L10.5 21l1.8-7.5z"/>',
  },
  ping: {
    viewBox: '0 0 24 24',
    body: '<path d="M3 17h3.5v4H3z M8.5 13h3.5v8H8.5z M14 9h3.5v12H14z M19.5 4H23v17h-3.5z"/>',
  },
  infinity: {
    viewBox: '0 0 26 14',
    body: '<path fill="none" stroke="currentColor" stroke-width="2.6" d="M7 2.6C4.6 2.6 2.6 4.6 2.6 7s2 4.4 4.4 4.4c2.2 0 3.6-1.6 6-4.4s3.8-4.4 6-4.4c2.4 0 4.4 2 4.4 4.4s-2 4.4-4.4 4.4c-2.2 0-3.6-1.6-6-4.4S9.2 2.6 7 2.6z"/>',
  },
  crown: {
    viewBox: '0 0 24 20',
    body: '<path d="M2 5.4L7.4 10 12 2.4 16.6 10 22 5.4 20.2 15.4H3.8Z M3.8 16.8H20.2V19H3.8Z"/>',
  },
  players: {
    viewBox: '0 0 24 24',
    body: '<path d="M8.6 4.4a3.6 3.6 0 1 1 0 7.2 3.6 3.6 0 0 1 0-7.2z M2 20c.6-3.8 3.2-6.2 6.6-6.2s6 2.4 6.6 6.2z M16.4 6a3 3 0 1 1 0 6 3 3 0 0 1 0-6z M16.6 13.6c2.8 0 4.8 2 5.4 5.4h-5.2c-.2-2-1-3.8-2.2-5 .6-.3 1.3-.4 2-.4z"/>',
  },
  timer: {
    viewBox: '0 0 24 24',
    body: '<path d="M9.4 1.4h5.2v2.4H9.4z M11 8.4h2v5.8h-2z"/><circle cx="12" cy="13.6" r="8" fill="none" stroke="currentColor" stroke-width="2.2"/>',
  },
};

export function iconMarkup(name: IconName, className = ''): string {
  const icon = ICONS[name];
  const cls = className ? ` class="${className}"` : '';
  return `<svg${cls} viewBox="${icon.viewBox}" fill="currentColor" aria-hidden="true" focusable="false">${icon.body}</svg>`;
}

/** builds a fresh svg element for the icon */
export function createIcon(name: IconName, className = ''): SVGSVGElement {
  const template = document.createElement('template');
  template.innerHTML = iconMarkup(name, className);
  return template.content.firstElementChild as SVGSVGElement;
}

/** weapon id from the network to an icon, unknown ids fall back to the knife */
export function weaponIcon(weaponId: string): IconName {
  if (weaponId === 'awp') return 'awp';
  if (weaponId === 'deagle') return 'deagle';
  if (weaponId === 'katana') return 'katana';
  return 'knife';
}

export function iconAspect(name: IconName): number {
  const [, , w, h] = ICONS[name].viewBox.split(' ').map(Number);
  return w / h;
}
