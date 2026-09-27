import type { KnifeDef } from '../../combat/knives';
import { bladeShape } from '../../cosmetics/ProceduralKnife';

export interface KnifeSilhouette {
  viewBox: string;
  blade: string;
  handle: string;
  guard: string | null;
}

const PAD = 0.006;

/**
 * Flat side view of a catalog knife for the loadout grid, built from the
 * same blade profile the 3d model is extruded from. Blade points right,
 * units are metres (the viewBox scales it).
 */
export function knifeSilhouette(def: KnifeDef): KnifeSilhouette {
  const s = def.shape;
  const points = bladeShape(s.profile, s.bladeLength, s.bladeHeight).getPoints(10);
  const guardW = s.guard === 'none' ? 0 : s.guard === 'bolster' ? 0.012 : 0.008;
  const bladeX = guardW;
  const blade = pathFrom(points.map((p) => [bladeX + p.x, -p.y + s.bladeHeight * 0.5]));

  let minY = Math.min(...points.map((p) => -p.y + s.bladeHeight * 0.5));
  let maxY = Math.max(...points.map((p) => -p.y + s.bladeHeight * 0.5));
  const handleH = handleHeight(s.handle, s.bladeHeight);
  const handle = handlePath(s.handle, s.handleLength, handleH);
  minY = Math.min(minY, -handleH / 2 - (s.handle === 'ring' ? handleH * 0.9 : 0));
  maxY = Math.max(maxY, handleH / 2 + (s.handle === 'tee' ? handleH * 0.7 : 0));

  let guard: string | null = null;
  if (s.guard !== 'none') {
    const gh = s.guard === 'cross' ? Math.max(s.bladeHeight, handleH) * 1.75 : s.guard === 'ring' ? handleH * 1.5 : handleH * 1.15;
    guard = rectPath(0, -gh / 2, guardW, gh);
    minY = Math.min(minY, -gh / 2);
    maxY = Math.max(maxY, gh / 2);
  }

  const minX = -s.handleLength - (s.handle === 'ring' ? handleH : 0);
  const maxX = bladeX + s.bladeLength;
  const viewBox = [minX - PAD, minY - PAD, maxX - minX + PAD * 2, maxY - minY + PAD * 2].map(fmt).join(' ');
  return { viewBox, blade, handle, guard };
}

export function knifeSilhouetteMarkup(def: KnifeDef, className = ''): string {
  const art = knifeSilhouette(def);
  const cls = className ? ` class="${className}"` : '';
  return [
    `<svg${cls} viewBox="${art.viewBox}" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid meet">`,
    `<path class="knife-art-handle" d="${art.handle}"/>`,
    art.guard ? `<path class="knife-art-guard" d="${art.guard}"/>` : '',
    `<path class="knife-art-blade" d="${art.blade}"/>`,
    '</svg>',
  ].join('');
}

/** short human description instead of the reference game name */
export function knifeDescriptor(def: KnifeDef): string {
  const profile: Record<string, string> = {
    spear: 'spear point',
    drop: 'drop point',
    clip: 'clip point',
    tanto: 'tanto',
    hawkbill: 'hawkbill',
    recurve: 'recurve',
    needle: 'needle point',
    cleaver: 'cleaver belly',
    gut: 'gut hook',
  };
  const handle: Record<string, string> = {
    grip: 'rubber grip',
    scales: 'flat scales',
    wood: 'wood handle',
    cord: 'cord wrap',
    split: 'split handles',
    ring: 'finger ring',
    skeleton: 'open frame',
    tee: 'push grip',
  };
  const parts = [profile[def.shape.profile] ?? def.shape.profile, handle[def.shape.handle] ?? def.shape.handle];
  if (def.shape.pair) {
    parts.push('pair');
  }
  return parts.join(', ');
}

function handleHeight(style: string, bladeHeight: number): number {
  if (style === 'tee') return bladeHeight * 0.9;
  if (style === 'split') return bladeHeight * 1.05;
  return Math.max(0.018, bladeHeight * 0.78);
}

function handlePath(style: string, length: number, height: number): string {
  const h = height / 2;
  switch (style) {
    case 'ring': {
      const r = height * 0.9;
      const cx = -length - r * 0.3;
      return `${rectPath(-length, -h, length, height)} M${fmt(cx + r)} ${fmt(0)} a${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(-2 * r)} 0 a${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(2 * r)} 0z M${fmt(cx + r * 0.55)} 0 a${fmt(r * 0.55)} ${fmt(r * 0.55)} 0 1 1 ${fmt(-r * 1.1)} 0 a${fmt(r * 0.55)} ${fmt(r * 0.55)} 0 1 1 ${fmt(r * 1.1)} 0z`;
    }
    case 'tee':
      return `${rectPath(-length * 0.35, -h, length * 0.35, height)} ${rectPath(-length * 0.55, -h - height * 0.2, length * 0.2, height * 2.1)}`;
    case 'skeleton':
      return `${rectPath(-length, -h, length, height)} ${rectPath(-length * 0.82, -h * 0.4, length * 0.62, h * 0.8)}`;
    case 'split':
      return `${rectPath(-length, -h, length, height * 0.44)} ${rectPath(-length, h - height * 0.44, length, height * 0.44)}`;
    default: {
      // slight taper and a rounded butt
      const butt = Math.min(h, length * 0.2);
      return `M0 ${fmt(-h)} L${fmt(-length + butt)} ${fmt(-h * 1.08)} Q${fmt(-length)} ${fmt(-h * 1.08)} ${fmt(-length)} 0 Q${fmt(-length)} ${fmt(h * 1.08)} ${fmt(-length + butt)} ${fmt(h * 1.08)} L0 ${fmt(h)}z`;
    }
  }
}

function rectPath(x: number, y: number, w: number, h: number): string {
  return `M${fmt(x)} ${fmt(y)}h${fmt(w)}v${fmt(h)}h${fmt(-w)}z`;
}

function pathFrom(points: Array<[number, number]>): string {
  if (points.length === 0) {
    return '';
  }
  return `M${points.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join('L')}z`;
}

function fmt(value: number): string {
  const rounded = Math.round(value * 100000) / 100000;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}
