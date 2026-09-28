/**
 * WebStrafe mark and wordmark, drawn for this project. The mark is the ui's
 * notched panel corner with a strafe zig-zag cut through it: a W whose last
 * leg climbs past the first, like a bhop chain gaining height.
 */

let gradientSeq = 0;

/** the mark on its own; `solid` drops the gradient for tiny sizes */
export function brandMarkMarkup(className = 'ws-mark', options: { solid?: boolean } = {}): string {
  const id = `ws-mark-grad-${(gradientSeq += 1)}`;
  const fill = options.solid ? 'currentColor' : `url(#${id})`;
  const defs = options.solid
    ? ''
    : `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">`
      + '<stop offset="0" stop-color="#ffa24a"/><stop offset="0.55" stop-color="#ff6a2b"/><stop offset="1" stop-color="#e5461a"/>'
      + '</linearGradient></defs>';
  return `<svg class="${className}" viewBox="0 0 64 64" aria-hidden="true" focusable="false">${defs}`
    + `<path fill="${fill}" d="${MARK_BADGE}"/>`
    + `<path fill="#120804" d="${MARK_ZIGZAG}" transform="${MARK_SLANT}"/>`
    + '</svg>';
}

/** mark plus the two tone WEBSTRAFE lettering */
export function wordmarkMarkup(className = 'ws-wordmark'): string {
  return `<span class="${className}">${brandMarkMarkup('ws-mark')}`
    + '<span class="ws-wordmark-text"><span class="ws-wordmark-web">WEB</span><span class="ws-wordmark-strafe">STRAFE</span></span>'
    + '</span>';
}

// badge: square with the bottom left corner cut, same cut as the panels
export const MARK_BADGE = 'M4 4H60V60H18L4 46Z';
// zig-zag drawn as one filled polygon so it stays crisp without stroke joins
export const MARK_ZIGZAG = 'M11.5 15H19.5L25.2 35.4L30.4 24H36.6L41.8 35.4L50.2 10H58.2L45.4 49H38.9L33.5 37.2L28.1 49H21.6Z';
// same -8 degree lean as the lettering, pivoting near the middle of the badge
export const MARK_SLANT = 'matrix(1 0 -0.1405 1 2.1 0)';
