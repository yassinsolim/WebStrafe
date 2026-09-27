import { CREDITS, CREDIT_CATEGORY_LABEL, creditsByCategory, type CreditEntry } from '../../credits';
import type { MapManifestEntry } from '../../world/types';

/** renders the attribution registry, plus any manifest map it does not list */
export class CreditsPanel {
  private readonly list: HTMLDivElement;
  private maps: MapManifestEntry[] = [];

  constructor(section: HTMLElement) {
    const intro = document.createElement('p');
    intro.className = 'menu-section-hint';
    intro.textContent = 'Everything not listed here is original WebStrafe work. No Valve or Counter-Strike assets are used.';
    this.list = document.createElement('div');
    this.list.className = 'credits-list';
    section.append(intro, this.list);
    this.render();
  }

  setMaps(maps: MapManifestEntry[]): void {
    this.maps = maps;
    this.render();
  }

  private render(): void {
    const covered = new Set(CREDITS.map((entry) => entry.mapId).filter(Boolean));
    const fromManifest: CreditEntry[] = this.maps
      .filter((map) => !covered.has(map.id) && map.author && !/webstrafe/i.test(map.author))
      .map((map) => ({
        id: `manifest-${map.id}`,
        category: 'maps',
        title: map.name,
        author: map.author,
        license: map.license,
        sourceUrl: /^https?:\/\//.test(map.source) ? map.source : undefined,
        notes: /^https?:\/\//.test(map.source) ? undefined : map.source,
      }));
    this.list.replaceChildren();
    for (const [category, entries] of creditsByCategory([...CREDITS, ...fromManifest])) {
      const group = document.createElement('section');
      group.className = 'credits-group';
      const title = document.createElement('h3');
      title.className = 'set-group-title';
      title.textContent = CREDIT_CATEGORY_LABEL[category];
      group.appendChild(title);
      for (const entry of entries) {
        group.appendChild(this.entry(entry));
      }
      this.list.appendChild(group);
    }
  }

  private entry(entry: CreditEntry): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'credit-entry';
    const head = document.createElement('div');
    head.className = 'credit-head';
    head.appendChild(linkOrText(entry.title, entry.sourceUrl, 'credit-title'));
    const by = document.createElement('span');
    by.className = 'credit-author';
    by.textContent = `by ${entry.author}`;
    head.appendChild(by);
    el.appendChild(head);
    const license = linkOrText(entry.license, entry.licenseUrl, 'credit-license');
    el.appendChild(license);
    if (entry.notes) {
      const notes = document.createElement('p');
      notes.className = 'credit-notes';
      notes.textContent = entry.notes;
      el.appendChild(notes);
    }
    return el;
  }
}

function linkOrText(text: string, url: string | undefined, className: string): HTMLElement {
  if (!url) {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = text;
    return span;
  }
  const link = document.createElement('a');
  link.className = className;
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = text;
  return link;
}
