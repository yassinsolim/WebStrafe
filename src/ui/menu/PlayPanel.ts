import { Check, Map as MapIcon, createElement } from 'lucide';
import type { MapManifestEntry } from '../../world/types';
import { MAP_TYPE_LABEL, mapTypeFromId } from './menuInfo';

export interface PlayPanelCallbacks {
  onSelect(mapId: string): void;
  onPlay(mapId: string): void;
}

export interface BestRun { name: string; time: string }
type MapFilter = 'all' | 'surf' | 'bhop' | 'combat';
const FILTERS: readonly [MapFilter, string][] = [['all', 'All'], ['surf', 'Surf'], ['bhop', 'Bhop'], ['combat', 'Combat']];

export class PlayPanel {
  private readonly grid: HTMLDivElement;
  private readonly detail: HTMLDivElement;
  private readonly filters: HTMLDivElement;
  private filter: MapFilter = 'all';
  private maps: MapManifestEntry[] = [];
  private selectedId = '';
  private best: { mapId: string; run: BestRun | null } | null = null;

  constructor(section: HTMLElement, private readonly callbacks: PlayPanelCallbacks) {
    this.filters = document.createElement('div');
    this.filters.className = 'menu-map-filters';
    this.filters.setAttribute('role', 'group');
    this.filters.setAttribute('aria-label', 'Game mode');
    this.grid = document.createElement('div');
    this.grid.className = 'menu-map-grid';
    this.grid.setAttribute('aria-label', 'Maps');
    this.detail = document.createElement('div');
    this.detail.className = 'menu-map-detail';
    section.append(this.detail, this.filters, this.grid);
  }

  setMaps(entries: MapManifestEntry[], selectedId: string): void {
    this.maps = entries;
    this.selectedId = entries.some(map => map.id === selectedId) ? selectedId : entries[0]?.id ?? '';
    const selected = this.getSelected();
    if (selected && !this.matches(selected)) this.filter = 'all';
    this.render();
  }

  getSelected(): MapManifestEntry | undefined { return this.maps.find(map => map.id === this.selectedId); }

  setBestRun(mapId: string, run: BestRun | null): void {
    this.best = { mapId, run };
    this.renderDetail();
  }

  private matches(map: MapManifestEntry, filter = this.filter): boolean {
    const type = mapTypeFromId(map.id);
    return filter === 'all' || (filter === 'combat' ? type === 'aim' || type === 'practice' || type === 'training' : type === filter);
  }

  private render(): void {
    this.filters.replaceChildren(...FILTERS.map(([filter, name]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = name;
      button.className = 'menu-map-filter';
      button.classList.toggle('is-active', this.filter === filter);
      button.setAttribute('aria-pressed', String(this.filter === filter));
      button.disabled = !this.maps.some(map => this.matches(map, filter));
      button.addEventListener('click', () => {
        this.filter = filter;
        const visible = this.maps.filter(map => this.matches(map));
        if (visible.length && !visible.some(map => map.id === this.selectedId)) {
          this.selectedId = visible[0].id;
          this.callbacks.onSelect(this.selectedId);
        }
        this.render();
      });
      return button;
    }));
    this.grid.replaceChildren(...this.maps.filter(map => this.matches(map)).map(map => this.card(map)));
    this.renderDetail();
  }

  private thumbnail(map: MapManifestEntry, className: string): HTMLElement {
    const frame = document.createElement('span');
    frame.className = className;
    frame.dataset.type = mapTypeFromId(map.id);
    if (map.thumbnailPath) {
      const image = document.createElement('img');
      image.src = map.thumbnailPath;
      image.alt = '';
      image.decoding = 'async';
      image.addEventListener('error', () => frame.replaceChildren(createElement(MapIcon, { 'aria-hidden': 'true' })), { once: true });
      frame.appendChild(image);
    } else frame.appendChild(createElement(MapIcon, { 'aria-hidden': 'true' }));
    return frame;
  }

  private card(map: MapManifestEntry): HTMLButtonElement {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'menu-map-card';
    card.dataset.mapId = map.id;
    card.classList.toggle('is-selected', map.id === this.selectedId);
    card.setAttribute('aria-pressed', String(map.id === this.selectedId));
    const body = document.createElement('span');
    body.className = 'menu-map-body';
    const name = document.createElement('span');
    name.className = 'menu-map-name';
    name.textContent = map.name;
    const mode = document.createElement('span');
    mode.className = 'menu-map-mode';
    mode.textContent = MAP_TYPE_LABEL[mapTypeFromId(map.id)];
    body.append(name, mode);
    card.append(this.thumbnail(map, 'menu-map-thumb'), body, createElement(Check, { class: 'menu-map-check', 'aria-hidden': 'true' }));
    card.addEventListener('click', () => {
      if (this.selectedId === map.id) return;
      this.selectedId = map.id;
      this.callbacks.onSelect(map.id);
      for (const other of this.grid.querySelectorAll<HTMLElement>('.menu-map-card')) {
        const selected = other.dataset.mapId === map.id;
        other.classList.toggle('is-selected', selected);
        other.setAttribute('aria-pressed', String(selected));
      }
      this.renderDetail();
    });
    card.addEventListener('dblclick', () => this.callbacks.onPlay(map.id));
    return card;
  }

  private renderDetail(): void {
    const selected = this.getSelected();
    this.detail.replaceChildren();
    if (!selected) { this.detail.textContent = 'No maps available'; return; }
    const heading = document.createElement('div');
    heading.className = 'menu-map-detail-head';
    const mode = document.createElement('span');
    mode.className = 'menu-map-badge';
    mode.dataset.type = mapTypeFromId(selected.id);
    mode.textContent = MAP_TYPE_LABEL[mapTypeFromId(selected.id)];
    const name = document.createElement('h3');
    name.className = 'menu-map-detail-name';
    name.textContent = selected.name;
    heading.append(mode, name);
    const info = document.createElement('div');
    info.className = 'menu-map-info';
    info.textContent = `${selected.author} / ${selected.license}`;
    this.detail.append(this.thumbnail(selected, 'menu-map-feature'), heading, info);
    const type = mapTypeFromId(selected.id);
    if ((type === 'surf' || type === 'bhop') && this.best?.mapId === selected.id) {
      const best = document.createElement('div');
      best.className = 'menu-map-best';
      const label = document.createElement('span');
      label.textContent = 'Map record';
      const value = document.createElement('b');
      value.textContent = this.best.run?.time ?? '--:--.---';
      best.append(label, value);
      this.detail.appendChild(best);
    }
  }
}