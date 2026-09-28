import type { MapManifestEntry } from '../../world/types';
import { MAP_TYPE_BLURB, MAP_TYPE_LABEL, mapHue, mapTypeFromId, type MapType } from './menuInfo';

export interface PlayPanelCallbacks {
  onSelect(mapId: string): void;
  onPlay(mapId: string): void;
}

export interface BestRun {
  name: string;
  /** already formatted, e.g. 1:02.113 */
  time: string;
}

/** simple line art per map type for cards without a thumbnail */
const PLACEHOLDER_ART: Record<MapType, string> = {
  surf: '<path d="M0 70 L38 22 L52 22 L30 70 Z M44 70 L86 16 L100 16 L100 30 L70 70 Z" /><path class="menu-map-art-line" d="M0 78 H160" />',
  bhop: '<path d="M8 62 h22 v8 h-22z M42 50 h22 v8 h-22z M76 38 h22 v8 h-22z M110 26 h22 v8 h-22z" /><path class="menu-map-art-line" d="M19 60 Q36 30 53 48 Q70 18 87 36 Q104 6 121 24" />',
  aim: '<circle cx="80" cy="44" r="22" class="menu-map-art-line" /><circle cx="80" cy="44" r="9" class="menu-map-art-line" /><path class="menu-map-art-line" d="M80 14 v14 M80 60 v14 M50 44 h14 M96 44 h14" />',
  training: '<path class="menu-map-art-line" d="M70 14 L20 80 M90 14 L140 80 M80 14 V80 M76 30 h8 M74 46 h12 M72 62 h16" />',
  practice: '<path class="menu-map-art-line" d="M0 60 H160 M0 72 H160 M20 50 L0 80 M60 50 L50 80 M100 50 L110 80 M140 50 L160 80" /><rect x="70" y="18" width="20" height="30" rx="3" /><circle cx="80" cy="12" r="6" />',
};

const CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.4l3.2 3.2L13 4.8" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>';

/** map cards: thumbnail or generated art, type badge, name, author, licence */
export class PlayPanel {
  private readonly grid: HTMLDivElement;
  private readonly detail: HTMLDivElement;
  private maps: MapManifestEntry[] = [];
  private selectedId = '';
  private best: { mapId: string; run: BestRun | null } | null = null;

  constructor(section: HTMLElement, private readonly callbacks: PlayPanelCallbacks) {
    this.grid = document.createElement('div');
    this.grid.className = 'menu-map-grid';
    this.detail = document.createElement('div');
    this.detail.className = 'menu-map-detail';
    section.append(this.grid, this.detail);
  }

  setMaps(entries: MapManifestEntry[], selectedId: string): void {
    this.maps = entries;
    this.selectedId = selectedId;
    this.render();
  }

  getSelected(): MapManifestEntry | undefined {
    return this.maps.find((map) => map.id === this.selectedId);
  }

  /** top leaderboard run for a map, shown in the detail card of timed maps */
  setBestRun(mapId: string, run: BestRun | null): void {
    this.best = { mapId, run };
    this.renderDetail();
  }

  private render(): void {
    this.grid.replaceChildren(...this.maps.map((map, index) => this.card(map, index)));
    this.renderDetail();
  }

  private card(map: MapManifestEntry, index: number): HTMLButtonElement {
    const type = mapTypeFromId(map.id);
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'menu-map-card menu-card';
    card.dataset.mapId = map.id;
    card.style.setProperty('--i', String(index));
    card.classList.toggle('is-selected', map.id === this.selectedId);

    const thumb = document.createElement('span');
    thumb.className = 'menu-map-thumb';
    thumb.dataset.type = type;
    thumb.style.setProperty('--map-hue', String(mapHue(map.id)));
    if (map.thumbnailPath) {
      const img = document.createElement('img');
      img.src = map.thumbnailPath;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.addEventListener('error', () => {
        img.remove();
        thumb.insertAdjacentHTML('afterbegin', artMarkup(type));
      });
      thumb.appendChild(img);
    } else {
      thumb.innerHTML = artMarkup(type);
    }
    const badge = document.createElement('span');
    badge.className = 'menu-map-badge';
    badge.dataset.type = type;
    badge.textContent = MAP_TYPE_LABEL[type];
    const check = document.createElement('span');
    check.className = 'menu-map-check';
    check.innerHTML = CHECK;
    const name = document.createElement('span');
    name.className = 'menu-map-name';
    name.textContent = map.name;
    thumb.append(badge, check, name);

    const body = document.createElement('span');
    body.className = 'menu-map-body';
    const author = document.createElement('span');
    author.className = 'menu-map-author';
    author.textContent = `by ${map.author}`;
    const license = document.createElement('span');
    license.className = 'menu-map-license';
    license.textContent = map.license;
    body.append(author, license);
    card.append(thumb, body);

    card.addEventListener('click', () => {
      if (this.selectedId === map.id) {
        return;
      }
      this.selectedId = map.id;
      for (const other of this.grid.querySelectorAll<HTMLElement>('.menu-map-card')) {
        other.classList.toggle('is-selected', other.dataset.mapId === map.id);
      }
      this.renderDetail();
      this.callbacks.onSelect(map.id);
    });
    card.addEventListener('dblclick', () => this.callbacks.onPlay(map.id));
    return card;
  }

  private renderDetail(): void {
    const selected = this.getSelected();
    this.detail.replaceChildren();
    if (!selected) {
      this.detail.textContent = 'No map selected';
      return;
    }
    const type = mapTypeFromId(selected.id);
    const head = document.createElement('div');
    head.className = 'menu-map-detail-head';
    const badge = document.createElement('span');
    badge.className = 'menu-map-badge';
    badge.dataset.type = type;
    badge.textContent = MAP_TYPE_LABEL[type];
    const name = document.createElement('span');
    name.className = 'menu-map-detail-name';
    name.textContent = selected.name;
    head.append(badge, name);
    const blurb = document.createElement('p');
    blurb.className = 'menu-map-detail-blurb';
    blurb.textContent = MAP_TYPE_BLURB[type];
    const parts = [`by ${selected.author}`, selected.license];
    if (selected.source && selected.source !== selected.name && !selected.source.startsWith(selected.name)) {
      parts.push(selected.source);
    }
    const info = document.createElement('div');
    info.className = 'menu-map-info';
    info.textContent = parts.join(' · ');
    this.detail.append(head, blurb);
    if ((type === 'surf' || type === 'bhop') && this.best?.mapId === selected.id) {
      const best = document.createElement('div');
      best.className = 'menu-map-best';
      const label = document.createElement('span');
      label.textContent = 'Best run';
      const value = document.createElement('b');
      value.textContent = this.best.run ? this.best.run.time : 'No runs yet';
      best.append(label, value);
      if (this.best.run) {
        const who = document.createElement('span');
        who.className = 'menu-map-best-name';
        who.textContent = this.best.run.name;
        best.appendChild(who);
      }
      this.detail.appendChild(best);
    }
    this.detail.appendChild(info);
  }
}

function artMarkup(type: MapType): string {
  return `<svg class="menu-map-art" viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${PLACEHOLDER_ART[type]}</svg>`;
}
