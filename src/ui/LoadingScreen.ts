import { wordmarkMarkup } from './brand';
import { MAP_TYPE_LABEL, mapTypeFromId } from './menu/menuInfo';

export interface LoadingMapInfo {
  id: string;
  name: string;
  author?: string;
  thumbnailPath?: string;
}

const HIDE_MS = 360;

export class LoadingScreen {
  readonly root: HTMLDivElement;
  readonly title: HTMLDivElement;
  readonly progress: HTMLDivElement;
  readonly detail: HTMLPreElement;
  private readonly backdrop: HTMLDivElement;
  private readonly mode: HTMLSpanElement;
  private readonly author: HTMLSpanElement;
  private readonly stage: HTMLSpanElement;
  private readonly bar: HTMLDivElement;
  private readonly barFill: HTMLDivElement;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFill = '';
  private lastStage = '';

  constructor(parent: HTMLElement) {
    this.root = div('loading-overlay');
    this.root.style.display = 'none';
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-live', 'polite');

    this.backdrop = div('loading-backdrop');
    const shade = div('loading-shade');
    const brand = div('loading-brand');
    brand.innerHTML = wordmarkMarkup('ws-wordmark loading-wordmark');

    const panel = div('loading-panel');
    const info = div('loading-info');
    const meta = div('loading-meta');
    this.mode = document.createElement('span');
    this.mode.className = 'loading-mode';
    this.author = document.createElement('span');
    this.author.className = 'loading-author';
    meta.append(this.mode, this.author);
    this.title = div('loading-title');
    info.append(meta, this.title);
    panel.appendChild(info);

    const foot = div('loading-foot');
    const status = div('loading-status');
    this.stage = document.createElement('span');
    this.stage.className = 'loading-stage';
    this.progress = div('loading-progress');
    status.append(this.stage, this.progress);
    this.bar = div('loading-bar');
    this.barFill = div('loading-bar-fill');
    this.bar.appendChild(this.barFill);
    foot.append(status, this.bar);

    this.detail = document.createElement('pre');
    this.detail.className = 'loading-detail';

    this.root.append(this.backdrop, shade, brand, panel, foot, this.detail);
    parent.appendChild(this.root);
  }

  isVisible(): boolean {
    return this.root.style.display !== 'none';
  }

  show(map: LoadingMapInfo, options: { combat: boolean }): void {
    this.cancelHide();
    const type = mapTypeFromId(map.id);
    this.root.classList.remove('loading-overlay-error', 'is-leaving');
    this.root.dataset.type = type;
    const art = map.thumbnailPath ? `url("${map.thumbnailPath}")` : 'none';
    this.backdrop.style.backgroundImage = art;
    this.mode.textContent = options.combat ? `${MAP_TYPE_LABEL[type]} · Free for all` : MAP_TYPE_LABEL[type];
    this.author.textContent = map.author ? `by ${map.author}` : '';
    this.title.textContent = map.name;
    this.progress.textContent = '0%';
    this.detail.textContent = '';
    this.lastFill = '';
    this.lastStage = '';
    this.setProgress(0, 'Loading map');
    this.root.style.display = 'grid';
  }

  /** percent 0..100, null while the size is unknown; stage is the loader's latest step */
  setProgress(percent: number | null, stage?: string): void {
    const fill = percent === null ? 'indeterminate' : `scaleX(${(Math.max(0, Math.min(100, percent)) / 100).toFixed(3)})`;
    if (fill !== this.lastFill) {
      this.lastFill = fill;
      this.bar.classList.toggle('is-indeterminate', percent === null);
      if (percent !== null) {
        this.barFill.style.transform = fill;
        this.progress.textContent = `${Math.round(percent)}%`;
      } else {
        this.progress.textContent = '';
      }
    }
    if (stage) {
      // loader steps look like "Loading scene: /maps/x/scene.glb", the path is noise here
      const label = stage.split(':')[0].trim();
      if (label && label !== this.lastStage) {
        this.lastStage = label;
        this.stage.textContent = label;
      }
    }
  }

  hide(): void {
    if (!this.isVisible() || this.hideTimer !== null) {
      return;
    }
    this.root.classList.add('is-leaving');
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      // an error screen may have taken over in the meantime
      if (!this.root.classList.contains('loading-overlay-error')) {
        this.root.style.display = 'none';
        this.detail.textContent = '';
      }
      this.root.classList.remove('is-leaving');
    }, HIDE_MS);
  }

  private cancelHide(): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

}

function div(className: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  return el;
}
