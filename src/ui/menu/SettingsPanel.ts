import {
  CROSSHAIR_STYLES,
  GRAPHICS_QUALITIES,
  SETTING_LIMITS,
  cloneSettings,
  defaultCrosshair,
  defaultSettings,
  normalizeHexColor,
  validateSettings,
  type CrosshairStyle,
  type GameSettings,
  type GraphicsQuality,
} from '../SettingsStore';
import { Crosshair } from '../hud/Crosshair';
import {
  CROSSHAIR_COLORS,
  CROSSHAIR_PRESETS,
  crosshairEquals,
  decodeCrosshairCode,
  encodeCrosshairCode,
} from '../hud/crosshairPresets';

export interface SettingsPanelCallbacks {
  onChange(settings: GameSettings): void;
}

export type SettingsSectionId = 'game' | 'video' | 'audio' | 'crosshair' | 'hud' | 'controls';

interface Limit {
  min: number;
  max: number;
  step: number;
}

interface RangeControl {
  row: HTMLElement;
  slider: HTMLInputElement;
  number: HTMLInputElement;
  set(value: number): void;
}

/** our yaw per mouse count is 0.0022 rad * sens, cs2 uses 0.022 degrees * sens */
export const CS2_SENS_PER_UNIT = (0.0022 * 180) / Math.PI / 0.022;

export const SETTINGS_SECTIONS: ReadonlyArray<[SettingsSectionId, string]> = [
  ['game', 'Game'],
  ['video', 'Video'],
  ['audio', 'Audio'],
  ['crosshair', 'Crosshair'],
  ['hud', 'HUD'],
  ['controls', 'Controls'],
];

const CROSSHAIR_LABEL: Record<CrosshairStyle, string> = {
  classic: 'Classic',
  dot: 'Dot',
  'circle-dot': 'Circle + dot',
};

const QUALITY_INFO: Record<GraphicsQuality, { label: string; description: string }> = {
  auto: { label: 'Auto', description: 'Picks a preset for your GPU when the game starts' },
  low: { label: 'Low', description: 'Fastest. Simpler lighting and fewer effects' },
  medium: { label: 'Medium', description: 'Balanced lighting and effects' },
  high: { label: 'High', description: 'Full lighting, post processing and effects' },
};

const PREVIEW_BACKGROUNDS: ReadonlyArray<{ id: string; label: string; image: string | null }> = [
  { id: 'ochre', label: 'Ochre Cut', image: '/maps/aim_ochrecut/thumbnail.webp' },
  { id: 'prism', label: 'Prismline', image: '/maps/surf_prismline/thumbnail.webp' },
  { id: 'ember', label: 'Emberdrift', image: '/maps/bhop_emberdrift/thumbnail.webp' },
  { id: 'dark', label: 'Dark', image: null },
];

const KEY_BINDINGS: ReadonlyArray<[string, string]> = [
  ['W A S D', 'Move (arrow keys work too)'],
  ['Space', 'Jump, hold to keep hopping with auto-bhop'],
  ['Ctrl / C', 'Crouch'],
  ['Mouse 1', 'Fire, knife slash'],
  ['Mouse 2', 'AWP scope and zoom, knife stab'],
  ['1 2 3', 'AWP, Deagle, knife'],
  ['Wheel', 'Cycle weapons'],
  ['R', 'Reload, or reset to spawn when combat is off'],
  ['Y', 'Inspect'],
  ['Tab', 'Scoreboard'],
  ['F3', 'Movement debug readout'],
  ['Esc', 'Menu'],
];

/** preview spread slider: 0..1 maps to this cone half angle */
const PREVIEW_MAX_SPREAD_RAD = 0.045;

/** grouped settings in sections, with a live crosshair editor */
export class SettingsPanel {
  private draft: GameSettings;
  private section: SettingsSectionId = 'game';
  private readonly ranges = new Map<string, RangeControl>();
  private readonly toggles = new Map<string, { row: HTMLElement; input: HTMLInputElement }>();
  private readonly navButtons = new Map<SettingsSectionId, HTMLButtonElement>();
  private readonly pages = new Map<SettingsSectionId, HTMLElement>();
  private readonly styleButtons = new Map<CrosshairStyle, HTMLButtonElement>();
  private readonly qualityButtons = new Map<GraphicsQuality, HTMLButtonElement>();
  private readonly presetButtons: Array<{ button: HTMLButtonElement; preset: (typeof CROSSHAIR_PRESETS)[number] }> = [];
  private readonly presetPreviews: Crosshair[] = [];
  private readonly swatchButtons: HTMLButtonElement[] = [];
  private readonly colorInput: HTMLInputElement;
  private readonly hexInput: HTMLInputElement;
  private readonly codeInput: HTMLInputElement;
  private readonly codeStatus: HTMLSpanElement;
  private readonly previewBox: HTMLDivElement;
  private readonly preview: Crosshair;
  private readonly previewSpread: HTMLInputElement;
  private readonly previewSpreadRow: HTMLElement;
  private previewBackground = PREVIEW_BACKGROUNDS[0].id;

  constructor(section: HTMLElement, settings: GameSettings, private readonly callbacks: SettingsPanelCallbacks) {
    this.draft = cloneSettings(validateSettings(settings));
    const L = SETTING_LIMITS;

    const shell = el('div', 'set-shell');
    const nav = el('nav', 'set-nav');
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-label', 'Settings sections');
    const pagesEl = el('div', 'set-pages');
    for (const [id, label] of SETTINGS_SECTIONS) {
      const button = el('button', 'set-nav-btn') as HTMLButtonElement;
      button.type = 'button';
      button.textContent = label;
      button.setAttribute('role', 'tab');
      button.addEventListener('click', () => this.setSection(id));
      nav.appendChild(button);
      this.navButtons.set(id, button);
      const page = el('div', 'set-page');
      page.dataset.section = id;
      page.setAttribute('role', 'tabpanel');
      pagesEl.appendChild(page);
      this.pages.set(id, page);
    }
    shell.append(nav, pagesEl);
    section.appendChild(shell);

    // game ---------------------------------------------------------------
    const game = this.pages.get('game') as HTMLElement;
    const gameplay = group(game, 'Gameplay');
    this.toggle(gameplay, 'autoBhop', 'Auto-bhop', 'Hold space to keep hopping');
    const fov = group(game, 'Field of view');
    this.range(fov, 'worldFov', 'World FOV', L.worldFov, {
      digits: 0,
      suffix: '°',
      hint: (v) => `${Math.round(horizontalFov(v))}° wide on this screen`,
    });
    this.range(fov, 'viewmodelFov', 'Viewmodel FOV', L.viewmodelFov, { digits: 0, suffix: '°' });
    this.range(fov, 'viewmodelScale', 'Viewmodel scale', L.viewmodelScale, { digits: 2 });

    // video --------------------------------------------------------------
    const video = this.pages.get('video') as HTMLElement;
    const graphics = group(video, 'Graphics quality');
    const qualityGrid = el('div', 'set-quality');
    qualityGrid.setAttribute('role', 'radiogroup');
    qualityGrid.setAttribute('aria-label', 'Graphics quality');
    for (const quality of GRAPHICS_QUALITIES) {
      const info = QUALITY_INFO[quality];
      const button = el('button', 'set-quality-card') as HTMLButtonElement;
      button.type = 'button';
      button.dataset.quality = quality;
      button.setAttribute('role', 'radio');
      button.innerHTML = `<span class="set-quality-bars" aria-hidden="true">${qualityBars(quality)}</span>`;
      const name = el('span', 'set-quality-name');
      name.textContent = info.label;
      const desc = el('span', 'set-quality-desc');
      desc.textContent = info.description;
      button.append(name, desc);
      button.addEventListener('click', () => {
        this.draft.graphicsQuality = quality;
        this.emit();
      });
      qualityGrid.appendChild(button);
      this.qualityButtons.set(quality, button);
    }
    graphics.appendChild(qualityGrid);
    const resolution = group(video, 'Resolution');
    this.range(resolution, 'renderScale', 'Resolution scale', L.renderScale, {
      percent: true,
      hint: (v) => (v >= 0.999 ? 'native' : `${Math.round(v * v * 100)}% of the pixels`),
    });
    this.toggle(resolution, 'adaptiveResolution', 'Adaptive resolution', 'Lowers the resolution when the frame rate drops under 55');

    // audio --------------------------------------------------------------
    const audio = group(this.pages.get('audio') as HTMLElement, 'Volume');
    this.range(audio, 'masterVolume', 'Master', L.masterVolume, { percent: true });
    this.range(audio, 'effectsVolume', 'Game effects', L.effectsVolume, { percent: true });
    this.range(audio, 'uiVolume', 'Interface', L.uiVolume, { percent: true });

    // crosshair ----------------------------------------------------------
    const xhPage = this.pages.get('crosshair') as HTMLElement;
    xhPage.classList.add('set-page-crosshair');
    const xhControls = el('div', 'set-xh-controls');
    const xhSide = el('div', 'set-xh-side');
    xhPage.append(xhControls, xhSide);

    // live preview, drawn by the same Crosshair class the game uses
    const previewCard = el('div', 'set-xh-card');
    this.previewBox = el('div', 'set-crosshair-preview') as HTMLDivElement;
    this.preview = new Crosshair(this.previewBox, { preview: true });
    const backgrounds = el('div', 'set-xh-backgrounds');
    for (const bg of PREVIEW_BACKGROUNDS) {
      const button = el('button', 'set-xh-bg') as HTMLButtonElement;
      button.type = 'button';
      button.dataset.bg = bg.id;
      button.title = bg.label;
      button.setAttribute('aria-label', `Preview background: ${bg.label}`);
      if (bg.image) {
        button.style.backgroundImage = `url("${bg.image}")`;
      }
      button.addEventListener('click', () => {
        this.previewBackground = bg.id;
        this.refreshPreviewBackground();
      });
      backgrounds.appendChild(button);
    }
    this.previewSpreadRow = el('label', 'set-xh-spread');
    const spreadLabel = el('span', 'set-xh-spread-label');
    spreadLabel.textContent = 'Preview spread';
    this.previewSpread = document.createElement('input');
    this.previewSpread.type = 'range';
    this.previewSpread.min = '0';
    this.previewSpread.max = '1';
    this.previewSpread.step = '0.01';
    this.previewSpread.value = '0';
    this.previewSpread.setAttribute('aria-label', 'Preview spread');
    this.previewSpread.dataset.sfx = 'none';
    this.previewSpread.addEventListener('input', () => {
      const value = Number(this.previewSpread.value);
      this.previewSpread.style.setProperty('--fill', String(value));
      this.preview.setSpread(value * PREVIEW_MAX_SPREAD_RAD);
    });
    this.previewSpreadRow.append(spreadLabel, this.previewSpread);
    previewCard.append(this.previewBox, backgrounds, this.previewSpreadRow);

    // share code
    const codeCard = el('div', 'set-xh-card set-xh-code');
    const codeTitle = el('span', 'set-xh-code-title');
    codeTitle.textContent = 'Share code';
    this.codeInput = document.createElement('input');
    this.codeInput.type = 'text';
    this.codeInput.className = 'set-text';
    this.codeInput.spellcheck = false;
    this.codeInput.autocomplete = 'off';
    this.codeInput.setAttribute('aria-label', 'Crosshair share code');
    this.codeInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        this.applyCode();
      }
    });
    const codeActions = el('div', 'set-xh-code-actions');
    const copy = button('Copy', 'set-btn');
    copy.addEventListener('click', () => void this.copyCode());
    const apply = button('Apply', 'set-btn');
    apply.dataset.sfx = 'confirm';
    apply.addEventListener('click', () => this.applyCode());
    this.codeStatus = el('span', 'set-xh-code-status') as HTMLSpanElement;
    codeActions.append(copy, apply, this.codeStatus);
    codeCard.append(codeTitle, this.codeInput, codeActions);
    xhSide.append(previewCard, codeCard);

    const presets = group(xhControls, 'Presets');
    const presetRow = el('div', 'set-presets');
    for (const preset of CROSSHAIR_PRESETS) {
      const presetButton = el('button', 'set-preset') as HTMLButtonElement;
      presetButton.type = 'button';
      const art = el('span', 'set-preset-art');
      const mini = new Crosshair(art, { preview: true });
      mini.applySettings(preset.settings);
      this.presetPreviews.push(mini);
      const name = el('span', 'set-preset-name');
      name.textContent = preset.label;
      presetButton.append(art, name);
      presetButton.addEventListener('click', () => {
        this.draft.crosshair = { ...preset.settings };
        this.emit();
      });
      presetRow.appendChild(presetButton);
      this.presetButtons.push({ button: presetButton, preset });
    }
    presets.appendChild(presetRow);

    const shape = group(xhControls, 'Shape');
    const styleRow = row(shape, 'Style');
    const segmented = el('div', 'set-segmented');
    for (const style of CROSSHAIR_STYLES) {
      const styleButton = button(CROSSHAIR_LABEL[style]);
      styleButton.addEventListener('click', () => {
        this.draft.crosshair = { ...this.draft.crosshair, style };
        this.emit();
      });
      this.styleButtons.set(style, styleButton);
      segmented.appendChild(styleButton);
    }
    styleRow.appendChild(segmented);
    this.range(shape, 'crosshair.size', 'Length', L.crosshairSize, { digits: 1, suffix: 'px' });
    this.range(shape, 'crosshair.gap', 'Gap', L.crosshairGap, { digits: 1, suffix: 'px' });
    this.range(shape, 'crosshair.thickness', 'Thickness', L.crosshairThickness, { digits: 1, suffix: 'px' });
    this.toggle(shape, 'crosshair.dot', 'Centre dot');
    this.toggle(shape, 'crosshair.tStyle', 'T style', 'Drops the top line');
    this.toggle(shape, 'crosshair.dynamicSpread', 'Dynamic spread', 'Gap opens up while moving, jumping or firing');

    const colour = group(xhControls, 'Colour');
    const colorRow = row(colour, 'Colour');
    const swatches = el('div', 'set-swatches');
    for (const swatch of CROSSHAIR_COLORS) {
      const swatchButton = el('button', 'set-swatch') as HTMLButtonElement;
      swatchButton.type = 'button';
      swatchButton.style.setProperty('--swatch', swatch.color);
      swatchButton.dataset.color = swatch.color;
      swatchButton.title = swatch.label;
      swatchButton.setAttribute('aria-label', `Crosshair colour ${swatch.label}`);
      swatchButton.addEventListener('click', () => {
        this.draft.crosshair = { ...this.draft.crosshair, color: swatch.color };
        this.emit();
      });
      this.swatchButtons.push(swatchButton);
      swatches.appendChild(swatchButton);
    }
    const custom = el('label', 'set-color-custom');
    custom.title = 'Custom colour';
    this.colorInput = document.createElement('input');
    this.colorInput.type = 'color';
    this.colorInput.className = 'set-color';
    this.colorInput.setAttribute('aria-label', 'Custom crosshair colour');
    this.colorInput.addEventListener('input', () => this.setColor(this.colorInput.value));
    this.hexInput = document.createElement('input');
    this.hexInput.type = 'text';
    this.hexInput.className = 'set-text set-hex';
    this.hexInput.maxLength = 7;
    this.hexInput.spellcheck = false;
    this.hexInput.setAttribute('aria-label', 'Crosshair colour hex');
    this.hexInput.addEventListener('change', () => this.setColor(this.hexInput.value));
    this.hexInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        this.hexInput.blur();
      }
    });
    custom.append(this.colorInput);
    swatches.append(custom, this.hexInput);
    colorRow.appendChild(swatches);
    this.range(colour, 'crosshair.alpha', 'Opacity', L.crosshairAlpha, { percent: true });
    this.toggle(colour, 'crosshair.outline', 'Outline', 'Dark edge that keeps it readable on bright walls');
    this.range(colour, 'crosshair.outlineThickness', 'Outline thickness', L.crosshairOutline, { digits: 1, suffix: 'px' });

    const reset = el('div', 'set-inline-actions');
    const resetCrosshair = button('Reset crosshair', 'set-btn');
    resetCrosshair.addEventListener('click', () => {
      this.draft.crosshair = { ...defaultCrosshair };
      this.emit();
    });
    reset.appendChild(resetCrosshair);
    xhControls.appendChild(reset);

    // hud ----------------------------------------------------------------
    const hud = group(this.pages.get('hud') as HTMLElement, 'Heads up display');
    this.toggle(hud, 'showHud', 'Show HUD', 'Hides everything except the crosshair when off');
    this.toggle(hud, 'showSpeedometer', 'Speedometer', 'Speed in units per second under the crosshair');
    this.toggle(hud, 'showStrafeStats', 'Strafe stats', 'Takeoff speed, gain and sync under the speedometer');
    this.toggle(hud, 'showNetGraph', 'Net graph', 'FPS, frame time and ping in the top left');
    this.toggle(hud, 'showMovementDebug', 'Movement debug', 'Raw movement readout, also on F3');

    // controls -----------------------------------------------------------
    const controls = this.pages.get('controls') as HTMLElement;
    const mouse = group(controls, 'Mouse');
    this.range(mouse, 'mouseSensitivity', 'Sensitivity', L.mouseSensitivity, {
      digits: 2,
      hint: (v) => `same as ${(v * CS2_SENS_PER_UNIT).toFixed(2)} in CS2`,
    });
    this.range(mouse, 'zoomSensitivityRatio', 'Zoom sensitivity ratio', L.zoomSensitivityRatio, {
      digits: 2,
      hint: (v) => (Math.abs(v - 1) < 1e-6 ? 'default' : v < 1 ? 'slower when scoped' : 'faster when scoped'),
    });
    const keys = group(controls, 'Keys');
    const keyList = el('dl', 'set-keys');
    for (const [key, action] of KEY_BINDINGS) {
      const item = el('div', 'set-key');
      const dt = document.createElement('dt');
      for (const part of key.split(' ')) {
        const kbd = document.createElement('kbd');
        kbd.textContent = part;
        dt.appendChild(kbd);
      }
      const dd = document.createElement('dd');
      dd.textContent = action;
      item.append(dt, dd);
      keyList.appendChild(item);
    }
    const keyNote = el('p', 'set-note');
    keyNote.textContent = 'Keys are fixed for now, rebinding is not in yet.';
    keys.append(keyList, keyNote);

    // footer -------------------------------------------------------------
    const footer = el('div', 'set-footer');
    const resetAll = button('Reset all settings', 'set-btn set-btn-quiet');
    resetAll.dataset.sfx = 'confirm';
    resetAll.addEventListener('click', () => {
      this.draft = cloneSettings(defaultSettings);
      this.emit();
    });
    footer.appendChild(resetAll);
    shell.appendChild(footer);

    this.setSection('game');
    this.refreshPreviewBackground();
    this.refresh();
    window.addEventListener('resize', this.onResize);
  }

  /** mirror settings changed elsewhere (F3, migration) without emitting */
  update(settings: GameSettings): void {
    this.draft = cloneSettings(validateSettings(settings));
    this.refresh();
  }

  setSection(id: SettingsSectionId): void {
    this.section = id;
    for (const [sectionId, navButton] of this.navButtons) {
      const active = sectionId === id;
      navButton.classList.toggle('is-active', active);
      navButton.setAttribute('aria-selected', String(active));
    }
    for (const [sectionId, page] of this.pages) {
      page.classList.toggle('is-active', sectionId === id);
    }
  }

  getSection(): SettingsSectionId {
    return this.section;
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.preview.dispose();
    for (const mini of this.presetPreviews) {
      mini.dispose();
    }
  }

  private readonly onResize = (): void => {
    this.ranges.get('worldFov')?.set(this.draft.worldFov);
  };

  private emit(): void {
    this.draft = validateSettings(this.draft);
    this.refresh();
    this.callbacks.onChange(cloneSettings(this.draft));
  }

  private setColor(raw: string): void {
    const color = normalizeHexColor(raw.startsWith('#') ? raw : `#${raw}`);
    if (!color) {
      this.hexInput.value = this.draft.crosshair.color;
      return;
    }
    this.draft.crosshair = { ...this.draft.crosshair, color };
    this.emit();
  }

  private async copyCode(): Promise<void> {
    const code = encodeCrosshairCode(this.draft.crosshair);
    this.codeInput.value = code;
    try {
      await navigator.clipboard.writeText(code);
      this.codeStatus.textContent = 'Copied';
    } catch {
      this.codeInput.select();
      this.codeStatus.textContent = 'Select and copy it';
    }
  }

  private applyCode(): void {
    const decoded = decodeCrosshairCode(this.codeInput.value);
    if (!decoded) {
      this.codeStatus.textContent = 'Not a WebStrafe code';
      this.codeStatus.classList.add('is-error');
      return;
    }
    this.codeStatus.classList.remove('is-error');
    this.codeStatus.textContent = 'Applied';
    this.draft.crosshair = decoded;
    this.emit();
  }

  private refreshPreviewBackground(): void {
    const bg = PREVIEW_BACKGROUNDS.find((entry) => entry.id === this.previewBackground) ?? PREVIEW_BACKGROUNDS[0];
    this.previewBox.style.backgroundImage = bg.image ? `url("${bg.image}")` : '';
    this.previewBox.dataset.bg = bg.id;
    for (const buttonEl of this.previewBox.parentElement?.querySelectorAll<HTMLButtonElement>('.set-xh-bg') ?? []) {
      buttonEl.classList.toggle('is-active', buttonEl.dataset.bg === bg.id);
    }
  }

  private refresh(): void {
    for (const [key, control] of this.ranges) {
      control.set(readPath(this.draft, key) as number);
    }
    for (const [key, toggle] of this.toggles) {
      toggle.input.checked = readPath(this.draft, key) as boolean;
    }
    const xh = this.draft.crosshair;
    for (const [style, styleButton] of this.styleButtons) {
      const active = style === xh.style;
      styleButton.classList.toggle('is-active', active);
      styleButton.setAttribute('aria-pressed', String(active));
    }
    for (const [quality, qualityButton] of this.qualityButtons) {
      const active = quality === this.draft.graphicsQuality;
      qualityButton.classList.toggle('is-active', active);
      qualityButton.setAttribute('aria-checked', String(active));
    }
    for (const { button: presetButton, preset } of this.presetButtons) {
      presetButton.classList.toggle('is-active', crosshairEquals(preset.settings, xh));
    }
    for (const swatch of this.swatchButtons) {
      swatch.classList.toggle('is-active', swatch.dataset.color === xh.color);
    }
    this.colorInput.value = xh.color;
    if (document.activeElement !== this.hexInput) {
      this.hexInput.value = xh.color;
    }
    if (document.activeElement !== this.codeInput) {
      this.codeInput.value = encodeCrosshairCode(xh);
    }
    // options that do nothing for the current style
    const classic = xh.style === 'classic';
    this.setDisabled(this.toggles.get('crosshair.dot')?.row, !classic);
    this.setDisabled(this.toggles.get('crosshair.tStyle')?.row, !classic);
    this.setDisabled(this.ranges.get('crosshair.gap')?.row, xh.style === 'dot');
    this.setDisabled(this.ranges.get('crosshair.size')?.row, xh.style === 'dot');
    this.setDisabled(this.ranges.get('crosshair.outlineThickness')?.row, !xh.outline);
    this.setDisabled(this.previewSpreadRow, !xh.dynamicSpread);
    this.preview.applySettings(xh);
    this.preview.setVerticalFov(this.draft.worldFov);
  }

  private setDisabled(target: HTMLElement | undefined, disabled: boolean): void {
    if (!target) {
      return;
    }
    target.classList.toggle('is-disabled', disabled);
    for (const input of target.querySelectorAll('input')) {
      input.disabled = disabled;
    }
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
      row: el,
      slider,
      number,
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
    this.toggles.set(key, { row: el, input });
  }
}

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function button(label: string, className = ''): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  if (className) {
    node.className = className;
  }
  node.textContent = label;
  return node;
}

function group(parent: HTMLElement, title: string): HTMLElement {
  const node = document.createElement('section');
  node.className = 'set-group';
  const heading = document.createElement('h3');
  heading.className = 'set-group-title';
  heading.textContent = title;
  node.appendChild(heading);
  parent.appendChild(node);
  return node;
}

function row(parent: HTMLElement, label: string, extraClass = ''): HTMLDivElement {
  const node = document.createElement('div');
  node.className = `set-row ${extraClass}`.trim();
  const text = document.createElement('span');
  text.className = 'set-label';
  text.textContent = label;
  node.appendChild(text);
  parent.appendChild(node);
  return node;
}

/** little bar meter on each quality card, auto gets a spark instead */
function qualityBars(quality: GraphicsQuality): string {
  if (quality === 'auto') {
    return '<svg viewBox="0 0 24 16"><path d="M13.5 1L5 9.4h5.6L9 15l9.2-9.2h-5.6z" fill="currentColor"/></svg>';
  }
  const lit = quality === 'low' ? 1 : quality === 'medium' ? 2 : 3;
  return [0, 1, 2].map((i) => `<i class="${i < lit ? 'is-lit' : ''}" style="height:${40 + i * 30}%"></i>`).join('');
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
