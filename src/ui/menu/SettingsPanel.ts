import {
  CROSSHAIR_STYLES,
  SETTING_LIMITS,
  cloneSettings,
  defaultSettings,
  normalizeHexColor,
  validateSettings,
  type CrosshairStyle,
  type GameSettings,
} from '../SettingsStore';
import { Crosshair } from '../hud/Crosshair';

export interface SettingsPanelCallbacks {
  onChange(settings: GameSettings): void;
}

interface Limit {
  min: number;
  max: number;
  step: number;
}

interface RangeControl {
  slider: HTMLInputElement;
  number: HTMLInputElement;
  hint: HTMLSpanElement | null;
  set(value: number): void;
}

/** our yaw per mouse count is 0.0022 rad * sens, cs2 uses 0.022 degrees * sens */
export const CS2_SENS_PER_UNIT = (0.0022 * 180) / Math.PI / 0.022;

const CROSSHAIR_LABEL: Record<CrosshairStyle, string> = {
  classic: 'Classic',
  dot: 'Dot',
  'circle-dot': 'Circle + dot',
};

const SWATCHES = ['#4dff94', '#2ee6ff', '#ffe14d', '#ffffff', '#ff5bd6', '#ff6a2b'];

/** grouped settings with a live crosshair preview */
export class SettingsPanel {
  private draft: GameSettings;
  private readonly ranges = new Map<string, RangeControl>();
  private readonly toggles = new Map<string, HTMLInputElement>();
  private readonly styleButtons = new Map<CrosshairStyle, HTMLButtonElement>();
  private readonly swatchButtons: HTMLButtonElement[] = [];
  private readonly colorInput: HTMLInputElement;
  private readonly preview: Crosshair;

  constructor(section: HTMLElement, settings: GameSettings, private readonly callbacks: SettingsPanelCallbacks) {
    this.draft = cloneSettings(validateSettings(settings));
    const L = SETTING_LIMITS;

    const mouse = group(section, 'Mouse');
    this.range(mouse, 'mouseSensitivity', 'Sensitivity', L.mouseSensitivity, {
      digits: 2,
      hint: (v) => `CS2 ${(v * CS2_SENS_PER_UNIT).toFixed(2)}`,
    });
    this.range(mouse, 'zoomSensitivityRatio', 'Zoom sensitivity ratio', L.zoomSensitivityRatio, {
      digits: 2,
      hint: (v) => (Math.abs(v - 1) < 1e-6 ? 'default' : v < 1 ? 'slower scoped' : 'faster scoped'),
    });

    const video = group(section, 'Field of view');
    this.range(video, 'worldFov', 'World FOV', L.worldFov, {
      digits: 0,
      suffix: '°',
      hint: (v) => `${Math.round(horizontalFov(v))}° wide`,
    });
    this.range(video, 'viewmodelFov', 'Viewmodel FOV', L.viewmodelFov, { digits: 0, suffix: '°' });
    this.range(video, 'viewmodelScale', 'Viewmodel scale', L.viewmodelScale, { digits: 2 });

    const audio = group(section, 'Audio');
    this.range(audio, 'masterVolume', 'Master volume', L.masterVolume, { percent: true });
    this.range(audio, 'effectsVolume', 'Game effects', L.effectsVolume, { percent: true });
    this.range(audio, 'uiVolume', 'Interface', L.uiVolume, { percent: true });

    const crosshair = group(section, 'Crosshair');
    const previewBox = document.createElement('div');
    previewBox.className = 'set-crosshair-preview';
    this.preview = new Crosshair(previewBox, { preview: true });
    crosshair.appendChild(previewBox);

    const styleRow = row(crosshair, 'Style');
    const segmented = document.createElement('div');
    segmented.className = 'set-segmented';
    for (const style of CROSSHAIR_STYLES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = CROSSHAIR_LABEL[style];
      button.addEventListener('click', () => {
        this.draft.crosshair = { ...this.draft.crosshair, style };
        this.emit();
      });
      this.styleButtons.set(style, button);
      segmented.appendChild(button);
    }
    styleRow.appendChild(segmented);

    this.range(crosshair, 'crosshair.size', 'Size', L.crosshairSize, { digits: 1, suffix: 'px' });
    this.range(crosshair, 'crosshair.gap', 'Gap', L.crosshairGap, { digits: 1, suffix: 'px' });
    this.range(crosshair, 'crosshair.thickness', 'Thickness', L.crosshairThickness, { digits: 1, suffix: 'px' });

    const colorRow = row(crosshair, 'Colour');
    const swatches = document.createElement('div');
    swatches.className = 'set-swatches';
    for (const color of SWATCHES) {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'set-swatch';
      swatch.style.setProperty('--swatch', color);
      swatch.dataset.color = color;
      swatch.setAttribute('aria-label', `Crosshair colour ${color}`);
      swatch.addEventListener('click', () => {
        this.draft.crosshair = { ...this.draft.crosshair, color };
        this.emit();
      });
      this.swatchButtons.push(swatch);
      swatches.appendChild(swatch);
    }
    this.colorInput = document.createElement('input');
    this.colorInput.type = 'color';
    this.colorInput.className = 'set-color';
    this.colorInput.setAttribute('aria-label', 'Custom crosshair colour');
    this.colorInput.addEventListener('input', () => {
      const color = normalizeHexColor(this.colorInput.value);
      if (color) {
        this.draft.crosshair = { ...this.draft.crosshair, color };
        this.emit();
      }
    });
    swatches.appendChild(this.colorInput);
    colorRow.appendChild(swatches);

    this.toggle(crosshair, 'crosshair.outline', 'Outline');
    this.toggle(crosshair, 'crosshair.dynamicSpread', 'Dynamic spread', 'Gap opens up while moving, jumping or firing');

    const hud = group(section, 'HUD');
    this.toggle(hud, 'showHud', 'Show HUD', 'Hides everything except the crosshair when off');
    this.toggle(hud, 'showSpeedometer', 'Speedometer');
    this.toggle(hud, 'showStrafeStats', 'Strafe stats', 'Takeoff speed, gain and sync under the speedometer');
    this.toggle(hud, 'showNetGraph', 'Net graph', 'FPS, frame time and ping');
    this.toggle(hud, 'showMovementDebug', 'Movement debug', 'Raw movement readout, also on F3');

    const gameplay = group(section, 'Gameplay');
    this.toggle(gameplay, 'autoBhop', 'Auto-bhop', 'Hold space to keep hopping');

    const footer = document.createElement('div');
    footer.className = 'set-footer';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'menu-restart-btn set-reset';
    reset.textContent = 'Reset to defaults';
    reset.dataset.sfx = 'confirm';
    reset.addEventListener('click', () => {
      this.draft = cloneSettings(defaultSettings);
      this.emit();
    });
    footer.appendChild(reset);
    section.appendChild(footer);

    this.refresh();
    window.addEventListener('resize', this.onResize);
  }

  /** mirror settings changed elsewhere (F3, migration) without emitting */
  update(settings: GameSettings): void {
    this.draft = cloneSettings(validateSettings(settings));
    this.refresh();
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.preview.dispose();
  }

  private readonly onResize = (): void => {
    this.ranges.get('worldFov')?.set(this.draft.worldFov);
  };

  private emit(): void {
    this.draft = validateSettings(this.draft);
    this.refresh();
    this.callbacks.onChange(cloneSettings(this.draft));
  }

  private refresh(): void {
    for (const [key, control] of this.ranges) {
      control.set(readPath(this.draft, key) as number);
    }
    for (const [key, input] of this.toggles) {
      input.checked = readPath(this.draft, key) as boolean;
    }
    for (const [style, button] of this.styleButtons) {
      const active = style === this.draft.crosshair.style;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    for (const swatch of this.swatchButtons) {
      swatch.classList.toggle('is-active', swatch.dataset.color === this.draft.crosshair.color);
    }
    this.colorInput.value = this.draft.crosshair.color;
    this.preview.applySettings(this.draft.crosshair);
  }

  private range(
    parent: HTMLElement,
    key: string,
    label: string,
    limit: Limit,
    format: { digits?: number; suffix?: string; percent?: boolean; hint?: (value: number) => string },
  ): void {
    const el = row(parent, label, 'set-row-range');
    const hint = format.hint ? document.createElement('span') : null;
    if (hint) {
      hint.className = 'set-hint';
      el.querySelector('.set-label')?.appendChild(hint);
    }
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(limit.min);
    slider.max = String(limit.max);
    slider.step = String(limit.step);
    slider.setAttribute('aria-label', label);
    const number = document.createElement('input');
    number.type = 'number';
    number.className = 'set-number';
    const scale = format.percent ? 100 : 1;
    number.min = String(limit.min * scale);
    number.max = String(limit.max * scale);
    number.step = String(format.percent ? 1 : limit.step);
    number.setAttribute('aria-label', `${label} value`);
    const suffix = document.createElement('span');
    suffix.className = 'set-suffix';
    suffix.textContent = format.percent ? '%' : format.suffix ?? '';
    const valueBox = document.createElement('span');
    valueBox.className = 'set-value';
    valueBox.append(number, suffix);
    el.append(slider, valueBox);

    const commit = (raw: number) => {
      if (!Number.isFinite(raw)) {
        return;
      }
      writePath(this.draft, key, Math.max(limit.min, Math.min(limit.max, raw)));
      this.emit();
    };
    slider.addEventListener('input', () => commit(Number(slider.value)));
    number.addEventListener('change', () => commit(Number(number.value) / scale));
    number.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        number.blur();
      }
    });

    const digits = format.percent ? 0 : format.digits ?? 2;
    this.ranges.set(key, {
      slider,
      number,
      hint,
      set: (value: number) => {
        slider.value = String(value);
        slider.style.setProperty('--fill', String((value - limit.min) / (limit.max - limit.min)));
        if (document.activeElement !== number) {
          number.value = (value * scale).toFixed(digits);
        }
        if (hint && format.hint) {
          hint.textContent = format.hint(value);
        }
      },
    });
  }

  private toggle(parent: HTMLElement, key: string, label: string, description?: string): void {
    const el = document.createElement('label');
    el.className = 'set-row set-row-toggle';
    const text = document.createElement('span');
    text.className = 'set-label';
    text.textContent = label;
    if (description) {
      const sub = document.createElement('span');
      sub.className = 'set-desc';
      sub.textContent = description;
      text.appendChild(sub);
    }
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'set-switch';
    input.addEventListener('change', () => {
      writePath(this.draft, key, input.checked);
      this.emit();
    });
    el.append(text, input);
    parent.appendChild(el);
    this.toggles.set(key, input);
  }
}

function group(parent: HTMLElement, title: string): HTMLElement {
  const el = document.createElement('section');
  el.className = 'set-group';
  const heading = document.createElement('h3');
  heading.className = 'set-group-title';
  heading.textContent = title;
  el.appendChild(heading);
  parent.appendChild(el);
  return el;
}

function row(parent: HTMLElement, label: string, extraClass = ''): HTMLDivElement {
  const el = document.createElement('div');
  el.className = `set-row ${extraClass}`.trim();
  const text = document.createElement('span');
  text.className = 'set-label';
  text.textContent = label;
  el.appendChild(text);
  parent.appendChild(el);
  return el;
}

function readPath(settings: GameSettings, key: string): unknown {
  if (key.startsWith('crosshair.')) {
    return settings.crosshair[key.slice('crosshair.'.length) as keyof GameSettings['crosshair']];
  }
  return settings[key as keyof GameSettings];
}

function writePath(settings: GameSettings, key: string, value: number | boolean): void {
  if (key.startsWith('crosshair.')) {
    settings.crosshair = { ...settings.crosshair, [key.slice('crosshair.'.length)]: value };
    return;
  }
  (settings as unknown as Record<string, unknown>)[key] = value;
}

/** horizontal fov on this screen for a vertical fov */
function horizontalFov(verticalDeg: number): number {
  const aspect = typeof window === 'undefined' ? 16 / 9 : window.innerWidth / Math.max(1, window.innerHeight);
  const v = (verticalDeg * Math.PI) / 180;
  return (2 * Math.atan(Math.tan(v / 2) * aspect) * 180) / Math.PI;
}
