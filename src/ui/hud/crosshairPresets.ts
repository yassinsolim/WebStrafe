import {
  CROSSHAIR_STYLES,
  defaultCrosshair,
  validateCrosshair,
  type CrosshairSettings,
} from '../SettingsStore';

export interface CrosshairPreset {
  id: string;
  label: string;
  settings: CrosshairSettings;
}

export interface CrosshairColor {
  label: string;
  color: string;
}

/** colour presets for the swatch row, custom colours go through the picker */
export const CROSSHAIR_COLORS: readonly CrosshairColor[] = [
  { label: 'Green', color: '#4dff94' },
  { label: 'Cyan', color: '#2ee6ff' },
  { label: 'Yellow', color: '#ffe14d' },
  { label: 'White', color: '#ffffff' },
  { label: 'Pink', color: '#ff5bd6' },
  { label: 'Ember', color: '#ff6a2b' },
  { label: 'Red', color: '#ff3b4e' },
];

const base = (overrides: Partial<CrosshairSettings>): CrosshairSettings =>
  validateCrosshair({ ...defaultCrosshair, ...overrides });

/** starting points for the editor, all of them valid crosshair settings */
export const CROSSHAIR_PRESETS: readonly CrosshairPreset[] = [
  { id: 'default', label: 'Default', settings: base({}) },
  { id: 'compact', label: 'Compact', settings: base({ size: 3, gap: 1, thickness: 1, color: '#2ee6ff' }) },
  { id: 'open', label: 'Wide open', settings: base({ size: 7, gap: 5, thickness: 1.5, color: '#ffe14d', dot: true }) },
  { id: 'tee', label: 'T shape', settings: base({ size: 5, gap: 2, thickness: 1.5, color: '#ffffff', tStyle: true }) },
  { id: 'dot', label: 'Dot', settings: base({ style: 'dot', thickness: 3, color: '#ff5bd6' }) },
  { id: 'circle', label: 'Circle', settings: base({ style: 'circle-dot', size: 6, gap: 3, thickness: 1.5, dynamicSpread: false }) },
];

export function crosshairEquals(a: CrosshairSettings, b: CrosshairSettings): boolean {
  return a.style === b.style
    && a.size === b.size
    && a.gap === b.gap
    && a.thickness === b.thickness
    && a.color === b.color
    && a.outline === b.outline
    && a.outlineThickness === b.outlineThickness
    && a.dot === b.dot
    && a.tStyle === b.tStyle
    && a.alpha === b.alpha
    && a.dynamicSpread === b.dynamicSpread;
}

const CODE_PREFIX = 'WS1';
const CODE_LENGTH = 16;

/**
 * Short share code for a crosshair, like WS1-0A0C-34DF-F94B-1414. Every field
 * is packed in fixed width hex so the code stays the same length:
 * style (1) size*2 (2) gap*2+8 (2) thickness*2 (1) colour (6) flags (1)
 * outline*2 (1) alpha*20 (2). Values are snapped to the slider steps first.
 */
export function encodeCrosshairCode(settings: CrosshairSettings): string {
  const s = validateCrosshair(settings);
  const hex = (value: number, width: number) =>
    Math.max(0, Math.round(value)).toString(16).toUpperCase().padStart(width, '0').slice(-width);
  const flags = (s.outline ? 1 : 0) | (s.dot ? 2 : 0) | (s.tStyle ? 4 : 0) | (s.dynamicSpread ? 8 : 0);
  const packed = [
    hex(CROSSHAIR_STYLES.indexOf(s.style), 1),
    hex(s.size * 2, 2),
    hex(s.gap * 2 + 8, 2),
    hex(s.thickness * 2, 1),
    s.color.slice(1).toUpperCase(),
    hex(flags, 1),
    hex(s.outlineThickness * 2, 1),
    hex(s.alpha * 20, 2),
  ].join('');
  return [CODE_PREFIX, ...(packed.match(/.{1,4}/g) ?? [])].join('-');
}

/** null when the text is not a WebStrafe crosshair code */
export function decodeCrosshairCode(code: string): CrosshairSettings | null {
  const cleaned = code.trim().toUpperCase().replace(/[\s-]/g, '');
  if (!cleaned.startsWith(CODE_PREFIX)) {
    return null;
  }
  const body = cleaned.slice(CODE_PREFIX.length);
  if (body.length !== CODE_LENGTH || !/^[0-9A-F]+$/.test(body)) {
    return null;
  }
  let at = 0;
  const take = (width: number) => {
    const value = parseInt(body.slice(at, at + width), 16);
    at += width;
    return value;
  };
  const styleIndex = take(1);
  const size = take(2) / 2;
  const gap = (take(2) - 8) / 2;
  const thickness = take(1) / 2;
  const color = `#${body.slice(at, at + 6).toLowerCase()}`;
  at += 6;
  const flags = take(1);
  const outlineThickness = take(1) / 2;
  const alpha = take(2) / 20;
  const style = CROSSHAIR_STYLES[styleIndex];
  if (!style) {
    return null;
  }
  return validateCrosshair({
    style,
    size,
    gap,
    thickness,
    color,
    outline: (flags & 1) !== 0,
    dot: (flags & 2) !== 0,
    tStyle: (flags & 4) !== 0,
    dynamicSpread: (flags & 8) !== 0,
    outlineThickness,
    alpha,
  });
}
