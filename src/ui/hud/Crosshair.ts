import { defaultCrosshair, type CrosshairSettings } from '../SettingsStore';
import { computeCrosshairLayout, crosshairScale, snapRect, spreadToPixels, type CrosshairRect } from './crosshairGeometry';

/**
 * Settings driven crosshair. The root keeps the `.crosshair` class and the
 * `shot-deagle` / `shot-awp` kick classes GameApp already toggles, so it can
 * stand in for the old element. Call setSpread() every frame with the
 * weapon's current inaccuracy (radians, cone half angle).
 */
export class Crosshair {
  readonly root: HTMLDivElement;
  private readonly arms: HTMLDivElement[] = [];
  private readonly dot: HTMLDivElement;
  private readonly circle: HTMLDivElement;
  private settings: CrosshairSettings = { ...defaultCrosshair };
  private spreadRad = 0;
  private verticalFovDeg = 100;
  private lastLayoutKey = '';

  constructor(parent: HTMLElement, private readonly options: { preview?: boolean } = {}) {
    this.root = document.createElement('div');
    this.root.className = options.preview ? 'crosshair crosshair-preview' : 'crosshair';
    this.root.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 4; i += 1) {
      const arm = document.createElement('div');
      arm.className = 'xh-part xh-arm';
      this.arms.push(arm);
      this.root.appendChild(arm);
    }
    this.dot = document.createElement('div');
    this.dot.className = 'xh-part xh-dot';
    this.circle = document.createElement('div');
    this.circle.className = 'xh-circle';
    this.root.append(this.circle, this.dot);
    parent.appendChild(this.root);
    if (options.preview) {
      this.render(true);
    } else {
      window.addEventListener('resize', this.onResize);
      this.onResize();
    }
  }

  applySettings(settings: CrosshairSettings): void {
    this.settings = { ...settings };
    this.root.style.setProperty('--xh-color', settings.color);
    this.root.style.setProperty('--xh-alpha', String(settings.alpha));
    this.root.classList.toggle('has-outline', settings.outline);
    this.root.dataset.style = settings.style;
    this.render(true);
  }

  getSettings(): CrosshairSettings {
    return { ...this.settings };
  }

  /** weapon inaccuracy in radians, 0 when perfectly accurate */
  setSpread(radians: number): void {
    const next = Number.isFinite(radians) ? Math.max(0, radians) : 0;
    if (next === this.spreadRad) {
      return;
    }
    this.spreadRad = next;
    this.render(false);
  }

  /** world camera vertical fov, needed to turn radians into pixels */
  setVerticalFov(degrees: number): void {
    if (degrees === this.verticalFovDeg) {
      return;
    }
    this.verticalFovDeg = degrees;
    this.render(true);
  }

  /** hides the reticle without touching root display (e.g. while scoped) */
  setSuppressed(suppressed: boolean): void {
    this.root.classList.toggle('is-suppressed', suppressed);
  }

  dispose(): void {
    if (!this.options.preview) {
      window.removeEventListener('resize', this.onResize);
    }
    this.root.remove();
  }

  private readonly onResize = (): void => {
    // whole pixel centre keeps 1px lines from blurring on odd viewport sizes
    this.root.style.left = `${Math.floor(window.innerWidth / 2)}px`;
    this.root.style.top = `${Math.floor(window.innerHeight / 2)}px`;
    this.render(true);
  };

  private render(force: boolean): void {
    const spreadPx = this.settings.dynamicSpread
      ? spreadToPixels(this.spreadRad, this.verticalFovDeg, window.innerHeight)
      : 0;
    const quantized = Math.round(spreadPx * 4) / 4;
    const scale = crosshairScale(window.innerHeight);
    const key = `${quantized}:${scale}`;
    if (!force && key === this.lastLayoutKey) {
      return;
    }
    this.lastLayoutKey = key;
    const dpr = window.devicePixelRatio || 1;
    const layout = computeCrosshairLayout(this.settings, quantized, scale);
    const outline = Math.round(this.settings.outlineThickness * scale * dpr) / dpr;
    this.root.style.setProperty('--xh-outline-w', `${Math.max(1 / dpr, outline)}px`);
    for (let i = 0; i < this.arms.length; i += 1) {
      const rect = layout.arms[i];
      place(this.arms[i], rect ? snapRect(rect, dpr) : null);
    }
    place(this.dot, layout.dot ? snapRect(layout.dot, dpr) : null);
    if (layout.circle) {
      const { radius, thickness } = layout.circle;
      const size = radius * 2;
      this.circle.style.display = 'block';
      this.circle.style.width = `${size}px`;
      this.circle.style.height = `${size}px`;
      this.circle.style.transform = `translate(${-radius}px, ${-radius}px)`;
      this.circle.style.borderWidth = `${thickness}px`;
    } else {
      this.circle.style.display = 'none';
    }
  }
}

function place(el: HTMLElement, rect: CrosshairRect | null): void {
  if (!rect) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  el.style.width = `${rect.w}px`;
  el.style.height = `${rect.h}px`;
  el.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
}
