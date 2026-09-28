import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { Color } from 'three';
import { gradeLinear, resolveGrade } from '../../render/grade';
import { TEAM_GLOW_STRENGTH, TEAM_LIGHT, WORLD_TEAM_LIGHT } from '../catalog';
import { ArmorMaterial } from '../armorMaterial';
import { defaultLook } from '../look';

// three's ACESFilmicToneMapping, as the menu stages draw it (exposure 1.1 and 1.05)
function aces(c: number[], exposure: number): number[] {
  const m1 = [[0.59719, 0.076, 0.0284], [0.35458, 0.90834, 0.13383], [0.04823, 0.01566, 0.83777]];
  const m2 = [[1.60475, -0.10208, -0.00327], [-0.53108, 1.10813, -0.07276], [-0.07367, -0.00605, 1.07602]];
  const mul = (m: number[][], v: number[]) => [0, 1, 2].map((i) => m[0][i] * v[0] + m[1][i] * v[1] + m[2][i] * v[2]);
  let v = mul(m1, c.map((x) => (x * exposure) / 0.6));
  v = v.map((x) => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081));
  return mul(m2, v).map((x) => Math.min(1, Math.max(0, x)));
}
const srgb8 = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const glow = (hex: string, strength: number): [number, number, number] => {
  const c = new Color(hex);
  return [c.r * strength, c.g * strength, c.b * strength];
};
const mapGrades = readdirSync('public/maps', { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => JSON.parse(readFileSync(`public/maps/${d.name}/meta.json`, 'utf8')).environment?.grade)
  .map((g) => resolveGrade(g, g?.exposure ?? 1));

describe('team light glow', () => {
  it('t in the world grades to the pale gold the menu shows, on every map', () => {
    const menu = aces(glow(TEAM_LIGHT.terrorist, TEAM_GLOW_STRENGTH), 1.1).map(srgb8);
    const world = WORLD_TEAM_LIGHT.terrorist;
    for (const grade of mapGrades) {
      const out = gradeLinear(glow(world.color, world.strength), grade).map(srgb8);
      for (let i = 0; i < 3; i++) expect(Math.abs(out[i] - menu[i])).toBeLessThan(14);
    }
    // the old light at the old strength graded to peach: blue far above the menu's, green far below
    const old = gradeLinear(glow(TEAM_LIGHT.terrorist, TEAM_GLOW_STRENGTH), mapGrades[0]).map(srgb8);
    expect(menu[1] - old[1]).toBeGreaterThan(40);
  });

  it('the menu stages keep the team colour, the world gets its own glow', () => {
    const look = defaultLook('terrorist');
    const menu = new ArmorMaterial();
    menu.applyLook(look, 'terrorist', 'aces');
    const world = new ArmorMaterial();
    world.applyLook(look, 'terrorist');
    const light = 5;
    expect(menu.slotPbr[light].z).toBe(TEAM_GLOW_STRENGTH);
    expect(new Color().setRGB(menu.slotColor[light].x, menu.slotColor[light].y, menu.slotColor[light].z).getHexString()).toBe(TEAM_LIGHT.terrorist.slice(1));
    expect(world.slotPbr[light].z).toBe(WORLD_TEAM_LIGHT.terrorist.strength);
    expect(new Color().setRGB(world.slotColor[light].x, world.slotColor[light].y, world.slotColor[light].z).getHexString()).toBe(WORLD_TEAM_LIGHT.terrorist.color.slice(1));
    // the visor's faint glow still carries the team colour everywhere
    expect(world.team.value.getHexString()).toBe(TEAM_LIGHT.terrorist.slice(1));
  });
});
