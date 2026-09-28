import type { EmblemId } from './catalog';

/**
 * original emblem shapes as svg path data in a 100x100 box, nonzero fill.
 * the same paths draw the ui thumbnails (inline svg) and the decal texture on
 * the armor (canvas Path2D), so they always match.
 */
export const EMBLEM_PATHS: Record<Exclude<EmblemId, 'none'>, string> = {
  chevron: 'M50 12 L88 50 L75 63 L50 38 L25 63 L12 50 Z M50 45 L88 83 L75 96 L50 71 L25 96 L12 83 Z',
  wave:
    'M6 88 C14 60 30 34 56 26 C78 19 95 33 93 52 C91 68 74 74 65 64 C58 56 64 45 74 48 '
    + 'C70 39 56 39 50 50 C42 64 52 80 70 80 L94 80 L94 88 Z',
  bolt: 'M60 4 L20 56 L46 56 L36 96 L80 40 L54 40 L66 4 Z',
  star: 'M50 4 L60 40 L96 50 L60 60 L50 96 L40 60 L4 50 L40 40 Z',
  ring: 'M50 10 A40 40 0 1 1 49.99 10 Z M50 22 A28 28 0 1 0 50.01 22 Z M50 39 A11 11 0 1 1 49.99 39 Z',
  hex:
    'M50 6 L88.1 28 L88.1 72 L50 94 L11.9 72 L11.9 28 Z '
    + 'M50 20 L24 35 L24 65 L50 80 L76 65 L76 35 Z '
    + 'M50 38 L60.4 44 L60.4 56 L50 62 L39.6 56 L39.6 44 Z',
  arrow: 'M50 6 L88 46 L63 46 L63 94 L37 94 L37 46 L12 46 Z',
  triad: 'M14 62 H33 V94 H14 Z M40.5 36 H59.5 V94 H40.5 Z M67 10 H86 V94 H67 Z',
  wing:
    'M6 60 C28 30 60 16 96 14 L89 28 C64 30 44 38 30 54 Z '
    + 'M18 70 C38 50 62 42 92 40 L85 53 C64 54 50 60 37 71 Z '
    + 'M30 80 C46 67 64 63 88 64 L81 76 C66 76 56 80 45 88 Z',
  reticle:
    'M50 12 A38 38 0 1 1 49.99 12 Z M50 19 A31 31 0 1 0 50.01 19 Z '
    + 'M46.5 2 H53.5 V30 H46.5 Z M46.5 70 H53.5 V98 H46.5 Z M2 46.5 H30 V53.5 H2 Z M70 46.5 H98 V53.5 H70 Z '
    + 'M50 45 A5 5 0 1 1 49.99 45 Z',
  crown: 'M10 78 L16 26 L35 50 L50 14 L65 50 L84 26 L90 78 Z M10 84 H90 V94 H10 Z',
};

/** inline svg for a picker card */
export function emblemSvgMarkup(id: EmblemId, color: string, className = 'cz-emblem-svg'): string {
  if (id === 'none') {
    return `<svg class="${className}" viewBox="0 0 100 100" aria-hidden="true">`
      + '<path d="M20 20 L80 80 M80 20 L20 80" stroke="currentColor" stroke-width="6" fill="none" opacity="0.35"/></svg>';
  }
  return `<svg class="${className}" viewBox="0 0 100 100" aria-hidden="true">`
    + `<path d="${EMBLEM_PATHS[id]}" fill="${color}"/></svg>`;
}

/** draws an emblem into a 2d canvas, centred at (cx, cy), `size` px square */
export function drawEmblem(
  ctx: CanvasRenderingContext2D,
  id: EmblemId,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  if (id === 'none') return;
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(size / 100, size / 100);
  ctx.fillStyle = color;
  ctx.fill(new Path2D(EMBLEM_PATHS[id]));
  ctx.restore();
}
