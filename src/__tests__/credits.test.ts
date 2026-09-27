import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CREDITS, CREDIT_CATEGORY_ORDER, creditsByCategory, renderCreditsMarkdown } from '../credits';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('credits registry', () => {
  it('matches the checked-in CREDITS.md', () => {
    const onDisk = readFileSync(path.join(root, 'CREDITS.md'), 'utf8');
    expect(onDisk).toBe(renderCreditsMarkdown());
  });

  it('only credits files that exist', () => {
    const missing = CREDITS.flatMap((entry) => (entry.files ?? []).filter((file) => !existsSync(path.join(root, file))));
    expect(missing).toEqual([]);
  });

  it('has unique ids, a licence and an author for every entry', () => {
    const ids = CREDITS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of CREDITS) {
      expect(entry.license.length, entry.id).toBeGreaterThan(0);
      expect(entry.author.length, entry.id).toBeGreaterThan(0);
      expect(CREDIT_CATEGORY_ORDER).toContain(entry.category);
    }
  });

  it('covers every recorded sample in public/audio', () => {
    const credited = new Set(CREDITS.flatMap((entry) => entry.files ?? []));
    for (const file of ['deagle_shot.mp3', 'awp_shot.mp3', 'deagle_reload.mp3', 'awp_reload.mp3']) {
      expect(credited.has(`public/audio/${file}`), file).toBe(true);
    }
  });

  it('keeps em dashes out of the copy', () => {
    expect(renderCreditsMarkdown()).not.toMatch(/\u2014/);
  });

  it('groups entries in display order', () => {
    const order = creditsByCategory().map(([category]) => category);
    expect(order).toEqual(CREDIT_CATEGORY_ORDER.filter((category) => order.includes(category)));
  });
});
