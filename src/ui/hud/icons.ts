/**
 * Original inline SVG icons (drawn for WebStrafe, not traced from any game).
 * Weapons face right so a killfeed line reads killer -> weapon -> victim.
 * Everything fills with currentColor so css decides the colour.
 */

export type IconName = 'awp' | 'deagle' | 'knife' | 'headshot' | 'health' | 'ammo' | 'skull' | 'speed' | 'ping';

interface IconDef {
  viewBox: string;
  body: string;
}

const ICONS: Record<IconName, IconDef> = {
  awp: {
    viewBox: '0 0 96 24',
    body: [
      // thumbhole stock
      '<path fill-rule="evenodd" d="M2 8.5h22l3 3.5h4v3.5h-8.5L17 20.5H4.5L2 18z M8 13h6.5l-2.5 3.8H8.2z"/>',
      // receiver, magazine, trigger guard
      '<path d="M24 8.5h33v5.5H31l-1-2.1h-3z"/>',
      '<path d="M40 14h6.5l-.8 4.8h-5z"/>',
      '<path fill-rule="evenodd" d="M31 14h6.5v2.6c0 1.6-1.2 2.6-2.8 2.6h-1c-1.6 0-2.7-1-2.7-2.6z M32.6 15.2h3.3v1.3c0 .7-.5 1.1-1.1 1.1h-1.1c-.7 0-1.1-.4-1.1-1.1z"/>',
      // scope with bells and rings
      '<path d="M27 1.6h6.2l1 1.8h13.4l1-1.8H55v6.1h-6.4l-1-1.6H34.2l-1 1.6H27z"/>',
      '<path d="M36.2 7.6h2.6v1H36.2z M44.3 7.6h2.6v1h-2.6z"/>',
      // barrel and muzzle brake
      '<path d="M57 9.6h32v3.1H57z"/>',
      '<path d="M88.4 8.4h6.2v5.5h-6.2z"/>',
      '<path d="M90.2 9.6h1v3.1h-1z" fill="rgba(0,0,0,0.35)"/>',
    ].join(''),
  },
  deagle: {
    viewBox: '0 0 48 24',
    body: [
      // slide with sights
      '<path d="M8.5 5.2h36v6.3h-36z"/>',
      '<path d="M40.4 3.6h2.4v1.8h-2.4z M10.4 3.4h2.6v1.9h-2.6z"/>',
      '<path d="M31 6.6h11.5v1.1H31z" fill="rgba(0,0,0,0.3)"/>',
      // frame, trigger guard, grip
      '<path fill-rule="evenodd" d="M20.5 11.4h12.4v5.4c0 1.7-1.3 2.9-3 2.9h-6.5c-1.7 0-2.9-1.2-2.9-2.9z M22.6 13.1h8.2v3.4c0 .6-.4 1-1 1h-6.2c-.6 0-1-.4-1-1z"/>',
      '<path d="M9.6 11.4h11.6l-2.4 11H9.2l-1.2-1.6z"/>',
      '<path d="M32.8 11.4h8.4v1.9h-8.4z"/>',
      // hammer
      '<path d="M6.4 5.6h2.4v3.4H7z"/>',
    ].join(''),
  },
  knife: {
    viewBox: '0 0 48 24',
    body: [
      // handle with grip grooves, guard, clip point blade
      '<path fill-rule="evenodd" d="M2.5 10.2c0-.9.7-1.6 1.6-1.6h13.2v7.2H4.1c-.9 0-1.6-.7-1.6-1.6z M6 10.6h1.2v3.2H6z M9.4 10.6h1.2v3.2H9.4z M12.8 10.6H14v3.2h-1.2z"/>',
      '<path d="M17.3 6.4h2.6v11.6h-2.6z"/>',
      '<path d="M19.9 8.9h19.8c3.1 0 5.5 1.4 7.4 3.4-3.6 2.2-7.8 3.4-12.5 3.6H19.9z"/>',
      '<path d="M22 10.4h14.8v.9H22z" fill="rgba(0,0,0,0.3)"/>',
    ].join(''),
  },
  headshot: {
    viewBox: '0 0 24 24',
    body: [
      // a head in a reticle
      '<path d="M12 5.2a4.1 4.1 0 1 1 0 8.2 4.1 4.1 0 0 1 0-8.2z M5.6 20.4c.8-3.3 3.3-5.3 6.4-5.3s5.6 2 6.4 5.3z"/>',
      '<path fill="none" stroke="currentColor" stroke-width="1.6" d="M12 1.6v3 M12 19.4v3 M1.6 12h3 M19.4 12h3"/>',
      '<circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="1.4"/>',
    ].join(''),
  },
  health: {
    viewBox: '0 0 24 24',
    body: '<path d="M9 2.5h6v6.5h6.5v6H15v6.5H9V15H2.5V9H9z"/>',
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
  return 'knife';
}

export function iconAspect(name: IconName): number {
  const [, , w, h] = ICONS[name].viewBox.split(' ').map(Number);
  return w / h;
}
