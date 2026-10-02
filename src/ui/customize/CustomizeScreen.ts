import './customize.css';
import {
  ARMOR_SET_INFO,
  ARMOR_SLOTS,
  BODIES,
  EMBLEM_INFO,
  EMBLEMS,
  FINISH_INFO,
  FINISHES,
  KIT_INFO,
  SKIN_INFO,
  SLOT_LABEL,
  SWATCHES,
  TEAM_LIGHT,
  bodyCode,
  bodyName,
  pieceName,
  slotOptions,
  type ArmorSlot,
  type BodyId,
  type EmblemId,
  type FinishId,
  type PieceId,
} from '../../characters/catalog';
import { emblemSvgMarkup } from '../../characters/emblems';
import {
  MAX_TAG_LENGTH,
  defaultLook,
  looksEqual,
  randomLook,
  sanitizeLook,
  sanitizeTag,
  type CharacterLook,
} from '../../characters/look';
import {
  MAX_SAVED_LOOKS,
  deleteNamedLook,
  loadSavedLooks,
  saveLook,
  saveNamedLook,
  type SavedLook,
} from '../../characters/lookStore';
import { BUILTIN_PRESETS } from '../../characters/presets';
import type { PlayerModel } from '../../network/types';
import { attachMenuSounds } from '../menu/menuSounds';
import { CustomizeStage, type StageStatus } from './CustomizeStage';
import { LookHistory, applyPreset, nextSavedName, parseHexInput, sameStyle, swatchName, withBody } from './customizeLogic';

export interface CustomizeScreenCallbacks {
  /** every edit, for live previews elsewhere (optional) */
  onChange?(look: CharacterLook): void;
  /** saved = true after Done (already persisted with saveLook), false after Cancel/Esc (look is the one from open()) */
  onClose(look: CharacterLook, saved: boolean): void;
}

type ColorChannel = 'primary' | 'secondary' | 'accent';

const CHANNELS: readonly ColorChannel[] = ['primary', 'secondary', 'accent'];
const CHANNEL_LABEL: Record<ColorChannel, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
  accent: 'Accent',
};
const CHANNEL_HINT: Record<ColorChannel, string> = {
  primary: 'Main paint on the armor plates',
  secondary: 'Cloth panels and trims',
  accent: 'Small details and your emblem',
};
/** finishes that only make sense on the kit's painted plates */
const KIT_ONLY_FINISHES: readonly FinishId[] = ['worn', 'camo'];
const SLOT_PROMPT: Record<ArmorSlot, string> = {
  helmet: 'Choose a helmet',
  arms: 'Choose arm armor',
  chest: 'Choose chest armor',
  legs: 'Choose leg armor',
  classItem: 'Choose a class item',
};
const TEAMS: readonly PlayerModel[] = ['terrorist', 'counterterrorist'];
const TEAM_SHORT: Record<PlayerModel, string> = { terrorist: 'T', counterterrorist: 'CT' };
const TEAM_NAME: Record<PlayerModel, string> = { terrorist: 'Terrorist', counterterrorist: 'Counter-Terrorist' };

let screenCount = 0;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className: string, text?: string): HTMLButtonElement {
  const node = el('button', className, text);
  node.type = 'button';
  return node;
}

function isTextField(target: EventTarget | null): boolean {
  return target instanceof HTMLTextAreaElement
    || (target instanceof HTMLInputElement && (target.type === 'text' || target.type === 'search'));
}

function setPressed(node: HTMLElement, on: boolean, className = 'is-selected'): void {
  node.classList.toggle(className, on);
  node.setAttribute('aria-pressed', String(on));
}

interface SavedRow {
  entry: SavedLook;
  card: HTMLButtonElement;
  remove: HTMLButtonElement;
}

/**
 * full screen character editor that sits over the main menu: armor per slot
 * on the left, a 3d preview in the middle, paint, finish, emblem, tag and
 * presets on the right. edits apply live; Done saves, Cancel or Esc puts the
 * look from open() back.
 */
export class CustomizeScreen {
  private readonly root = el('div', 'cz-screen');
  private readonly detachSounds: () => void;
  private readonly titleId = `cz-title-${(screenCount += 1)}`;

  private readonly undoButton = button('cz-tool', 'Undo');
  private readonly redoButton = button('cz-tool', 'Redo');

  private readonly slotTabs = new Map<ArmorSlot, { tab: HTMLButtonElement; piece: HTMLSpanElement }>();
  private readonly optionsTitle = el('h3', 'cz-options-title');
  private readonly optionList = el('div', 'cz-options');
  private readonly optionCards = new Map<PieceId, HTMLButtonElement>();
  private readonly bodyCards = new Map<BodyId, HTMLButtonElement>();
  private readonly bodyValue = el('span');
  private armorSection: HTMLElement | null = null;
  private readonly originalPaint = button('cz-tool cz-original', 'Original paint');

  private readonly stageMount = el('div', 'cz-stage-mount');
  private readonly stageStatus = el('div', 'cz-stage-status');
  private readonly teamButtons = new Map<PlayerModel, HTMLButtonElement>();

  private readonly channelButtons = new Map<ColorChannel, { button: HTMLButtonElement; chip: HTMLSpanElement; value: HTMLSpanElement }>();
  private readonly channelHint = el('span', 'cz-channel-hint');
  private readonly swatchButtons: HTMLButtonElement[] = [];
  private readonly colorPicker = el('input', 'cz-picker');
  private readonly hexInput = el('input', 'cz-hex');
  private readonly customName = el('span', 'cz-custom-name');
  private readonly finishButtons = new Map<FinishId, HTMLButtonElement>();
  private readonly finishValue = el('span');
  private readonly emblemButtons = new Map<EmblemId, HTMLButtonElement>();
  private readonly emblemValue = el('span');
  private readonly tagInput = el('input', 'cz-tag-input');
  private readonly tagPlate = el('span', 'cz-tag-plate');
  private readonly tagCount = el('span');
  private readonly watchInput = el('input', 'cz-switch');
  private readonly presetCards: Array<{ card: HTMLButtonElement; look: CharacterLook }> = [];
  private readonly savedCount = el('span', 'cz-sub-count');
  private readonly savedList = el('div', 'cz-saved-list');
  private readonly saveButton = button('cz-save-btn', 'Save current');
  private readonly saveForm = el('form', 'cz-save-form');
  private readonly saveName = el('input', 'cz-save-name');
  private readonly saveHint = el('p', 'cz-hint cz-save-hint');
  private readonly live = el('div', 'cz-sr-only');

  private stage: CustomizeStage | null = null;
  private stageFailed = false;
  private look: CharacterLook = defaultLook();
  private openedLook: CharacterLook = defaultLook();
  private team: PlayerModel = 'terrorist';
  private previewTeam: PlayerModel = 'terrorist';
  private slot: ArmorSlot = 'helmet';
  private channel: ColorChannel = 'primary';
  private readonly history = new LookHistory(defaultLook());
  private saved: SavedLook[] = [];
  private savedRows: SavedRow[] = [];
  private armedDelete: string | null = null;
  private renderedSlot: ArmorSlot | null = null;
  private emblemPaint = '';
  private opened = false;
  private disposed = false;
  private restoreFocus: HTMLElement | null = null;

  constructor(private readonly parent: HTMLElement, private readonly callbacks: CustomizeScreenCallbacks) {
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-labelledby', this.titleId);
    this.root.tabIndex = -1;

    const panels = el('div', 'cz-panels');
    panels.append(this.buildArmorColumn(), this.buildStyleColumn());
    this.live.setAttribute('aria-live', 'polite');
    this.root.append(this.buildHead(), this.buildStage(), panels, this.buildActions(), this.live);
    this.root.addEventListener('pointerdown', this.onRootPointerDown, true);
    this.detachSounds = attachMenuSounds(this.root);
    this.parent.appendChild(this.root);
  }

  open(look: CharacterLook, team: PlayerModel): void {
    if (this.disposed) return;
    const clean = sanitizeLook(look, defaultLook(team));
    if (!this.opened) {
      const active = document.activeElement;
      this.restoreFocus = active instanceof HTMLElement && !this.root.contains(active) ? active : null;
    }
    this.openedLook = { ...clean };
    this.look = { ...clean };
    this.team = team;
    this.previewTeam = team;
    this.slot = 'helmet';
    this.channel = 'primary';
    this.history.reset(clean);
    this.saved = loadSavedLooks();
    this.armedDelete = null;
    this.closeSaveForm(false);
    this.renderSaved();

    this.opened = true;
    this.root.classList.add('is-open');
    window.addEventListener('keydown', this.onKeyDown, true);
    document.addEventListener('focusin', this.onFocusIn);

    this.ensureStage();
    this.stage?.setCharacter(this.look, this.previewTeam);
    this.stage?.start();
    this.stage?.intro();
    this.refresh();
    for (const scroller of this.root.querySelectorAll<HTMLElement>('.cz-col, .cz-panels')) {
      scroller.scrollTop = 0;
    }
    this.root.focus({ preventScroll: true });
  }

  /** same as Cancel */
  close(): void {
    this.finish(false);
  }

  isOpen(): boolean {
    return this.opened;
  }

  /** tears everything down without calling onClose */
  dispose(): void {
    if (this.disposed) return;
    this.hide();
    this.disposed = true;
    this.root.removeEventListener('pointerdown', this.onRootPointerDown, true);
    this.detachSounds();
    this.stage?.dispose();
    this.stage = null;
    this.root.remove();
  }

  // --- building ------------------------------------------------------------------

  private buildHead(): HTMLElement {
    const head = el('header', 'cz-head');
    const titles = el('div', 'cz-titles');
    const title = el('h2', 'cz-title', 'Customize');
    title.id = this.titleId;
    titles.append(el('span', 'cz-kicker', 'Character'), title);
    const hint = el('p', 'cz-head-hint', 'Changes show live. Done saves them, Esc cancels.');
    const tools = el('div', 'cz-head-tools');
    this.undoButton.title = 'Undo (Ctrl+Z)';
    this.redoButton.title = 'Redo (Ctrl+Shift+Z)';
    this.undoButton.addEventListener('click', () => this.undo());
    this.redoButton.addEventListener('click', () => this.redo());
    tools.append(this.undoButton, this.redoButton);
    head.append(titles, hint, tools);
    return head;
  }

  private buildArmorColumn(): HTMLElement {
    const column = el('aside', 'cz-col cz-left');
    column.setAttribute('aria-label', 'Body and armor');
    this.buildBodies(column);
    const section = this.section(column, 'Armor');
    this.armorSection = section;
    const tabs = el('div', 'cz-slot-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-orientation', 'vertical');
    for (const slot of ARMOR_SLOTS) {
      const tab = button('cz-slot-tab');
      tab.setAttribute('role', 'tab');
      tab.dataset.slot = slot;
      const piece = el('span', 'cz-slot-piece');
      tab.append(el('span', 'cz-slot-label', SLOT_LABEL[slot]), piece);
      tab.addEventListener('click', () => this.selectSlot(slot));
      tab.addEventListener('keydown', (event) => this.onSlotKey(event, slot));
      tabs.appendChild(tab);
      this.slotTabs.set(slot, { tab, piece });
    }
    this.optionList.setAttribute('role', 'tabpanel');
    section.append(tabs, this.optionsTitle, this.optionList);
    return column;
  }

  /** whole-body skins, plus the kit (which opens the piece pickers below) */
  private buildBodies(column: HTMLElement): void {
    const section = this.section(column, 'Body', this.bodyValue);
    const list = el('div', 'cz-options cz-bodies');
    for (const id of BODIES) {
      const card = button('cz-option cz-body');
      card.dataset.body = id;
      const info = id === 'kit' ? null : SKIN_INFO[id];
      const body = el('span', 'cz-option-body');
      body.append(
        el('span', 'cz-option-name', bodyName(id)),
        el('span', 'cz-option-blurb', info ? info.blurb : KIT_INFO.blurb),
      );
      if (info) body.appendChild(el('span', 'cz-option-set cz-credit', info.credit));
      card.append(el('span', 'cz-option-badge', bodyCode(id).toUpperCase()), body, el('span', 'cz-option-tag', 'Equipped'));
      card.addEventListener('click', () => this.edit(withBody(this.look, id)));
      list.appendChild(card);
      this.bodyCards.set(id, card);
    }
    section.appendChild(list);
  }

  private buildStage(): HTMLElement {
    const stage = el('section', 'cz-stage');
    stage.setAttribute('aria-label', 'Preview');

    const top = el('div', 'cz-stage-top');
    const fullBody = button('cz-tool cz-fullbody', 'Full body');
    fullBody.title = 'Frame the whole character (double-click the preview)';
    fullBody.addEventListener('click', () => this.stage?.resetView());

    const team = el('div', 'cz-team');
    const row = el('div', 'cz-team-row');
    const segmented = el('div', 'cz-seg');
    segmented.setAttribute('role', 'group');
    segmented.setAttribute('aria-label', 'Preview side');
    for (const side of TEAMS) {
      const toggle = button('cz-team-btn');
      toggle.title = `Preview as ${TEAM_NAME[side]}`;
      const dot = el('span', 'cz-team-dot');
      dot.style.background = TEAM_LIGHT[side];
      toggle.append(dot, el('span', '', TEAM_SHORT[side]));
      toggle.addEventListener('click', () => this.setPreviewTeam(side));
      segmented.appendChild(toggle);
      this.teamButtons.set(side, toggle);
    }
    row.append(el('span', 'cz-team-label', 'Preview side'), segmented);
    team.append(row, el('span', 'cz-team-note', 'Team lights are fixed per side'));
    top.append(fullBody, team);

    const hint = el('p', 'cz-stage-hint');
    const mouseHints = ['Drag to rotate', 'Right-drag to pan', 'Scroll to zoom', 'Double-click to reset'];
    const touchHints = ['Drag to rotate', 'Pinch to zoom', 'Full body resets the view'];
    hint.innerHTML = mouseHints.map((text) => `<span class="cz-for-mouse">${text}</span>`).join('')
      + touchHints.map((text) => `<span class="cz-for-touch">${text}</span>`).join('');
    stage.append(this.stageMount, top, this.stageStatus, hint);
    return stage;
  }

  private buildStyleColumn(): HTMLElement {
    const column = el('aside', 'cz-col cz-right');
    column.setAttribute('aria-label', 'Paint and extras');
    this.buildColours(column);
    this.buildFinish(column);
    this.buildEmblems(column);
    this.buildTag(column);
    this.buildWatch(column);
    this.buildPresets(column);
    return column;
  }

  private buildColours(column: HTMLElement): void {
    const section = this.section(column, 'Colours', this.channelHint);
    const channels = el('div', 'cz-channels');
    channels.setAttribute('role', 'group');
    channels.setAttribute('aria-label', 'Paint channel');
    for (const channel of CHANNELS) {
      const choice = button('cz-channel');
      const chip = el('span', 'cz-channel-chip');
      const value = el('span', 'cz-channel-value');
      choice.append(chip, el('span', 'cz-channel-label', CHANNEL_LABEL[channel]), value);
      choice.addEventListener('click', () => {
        this.channel = channel;
        this.history.endGroup();
        this.syncColours();
      });
      channels.appendChild(choice);
      this.channelButtons.set(channel, { button: choice, chip, value });
    }

    const swatches = el('div', 'cz-swatches');
    for (const swatch of SWATCHES) {
      const chip = button('cz-swatch');
      chip.dataset.hex = swatch.hex;
      chip.style.setProperty('--cz-swatch', swatch.hex);
      chip.title = swatch.name;
      chip.setAttribute('aria-label', swatch.name);
      chip.addEventListener('click', () => this.edit(this.withColor(this.channel, swatch.hex)));
      swatches.appendChild(chip);
      this.swatchButtons.push(chip);
    }

    const custom = el('div', 'cz-custom');
    this.colorPicker.type = 'color';
    this.colorPicker.title = 'Pick any colour';
    this.colorPicker.setAttribute('aria-label', 'Pick any colour');
    this.colorPicker.addEventListener('input', () => {
      this.edit(this.withColor(this.channel, this.colorPicker.value), `pick:${this.channel}`);
    });
    this.colorPicker.addEventListener('change', () => this.history.endGroup());
    this.hexInput.type = 'text';
    this.hexInput.maxLength = 7;
    this.hexInput.placeholder = '#rrggbb';
    this.hexInput.spellcheck = false;
    this.hexInput.autocomplete = 'off';
    this.hexInput.setAttribute('aria-label', 'Hex colour');
    this.hexInput.addEventListener('input', () => {
      const text = this.hexInput.value.trim();
      // three digit codes wait for enter or blur so typing six digits doesn't flash a colour
      const hex = /^#?[0-9a-f]{6}$/i.test(text) ? parseHexInput(text) : null;
      this.hexInput.classList.toggle('is-invalid', text.replace('#', '').length >= 6 && hex === null);
      if (hex) this.edit(this.withColor(this.channel, hex), `hex:${this.channel}`);
    });
    this.hexInput.addEventListener('change', () => {
      const hex = parseHexInput(this.hexInput.value);
      if (hex) this.edit(this.withColor(this.channel, hex), `hex:${this.channel}`);
      this.history.endGroup();
    });
    this.hexInput.addEventListener('blur', () => this.syncColours());
    this.hexInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.hexInput.blur();
    });
    custom.append(this.colorPicker, this.hexInput, this.customName);
    this.originalPaint.title = 'Back to the colours the skin was painted with';
    this.originalPaint.addEventListener('click', () => {
      if (this.look.skin === 'kit') return;
      this.edit({ ...this.look, ...SKIN_INFO[this.look.skin].native });
    });
    section.append(channels, swatches, custom, this.originalPaint);
  }

  private buildFinish(column: HTMLElement): void {
    const section = this.section(column, 'Finish', this.finishValue);
    const grid = el('div', 'cz-finishes');
    for (const id of FINISHES) {
      const choice = button('cz-finish');
      choice.dataset.finish = id;
      const chip = el('span', 'cz-finish-chip');
      chip.dataset.finish = id;
      choice.append(chip, el('span', 'cz-finish-name', FINISH_INFO[id].name));
      choice.addEventListener('click', () => this.edit({ ...this.look, finish: id }));
      grid.appendChild(choice);
      this.finishButtons.set(id, choice);
    }
    section.appendChild(grid);
  }

  private buildEmblems(column: HTMLElement): void {
    const section = this.section(column, 'Emblem', this.emblemValue);
    const grid = el('div', 'cz-emblems');
    for (const id of EMBLEMS) {
      const choice = button('cz-emblem');
      choice.dataset.emblem = id;
      choice.title = EMBLEM_INFO[id].name;
      choice.setAttribute('aria-label', `Emblem ${EMBLEM_INFO[id].name}`);
      choice.addEventListener('click', () => this.edit({ ...this.look, emblem: id }));
      grid.appendChild(choice);
      this.emblemButtons.set(id, choice);
    }
    section.appendChild(grid);
  }

  private buildTag(column: HTMLElement): void {
    const section = this.section(column, 'Tag', this.tagCount);
    const row = el('div', 'cz-tag-row');
    this.tagInput.type = 'text';
    this.tagInput.placeholder = 'Callsign';
    this.tagInput.spellcheck = false;
    this.tagInput.autocomplete = 'off';
    this.tagInput.setAttribute('aria-label', 'Tag');
    this.tagInput.addEventListener('input', () => {
      const raw = this.tagInput.value;
      const clean = sanitizeTag(raw);
      if (clean !== raw) {
        const caret = Math.min(clean.length, sanitizeTag(raw.slice(0, this.tagInput.selectionStart ?? raw.length)).length);
        this.tagInput.value = clean;
        this.tagInput.setSelectionRange(caret, caret);
      }
      this.edit({ ...this.look, tag: clean }, 'tag');
    });
    this.tagInput.addEventListener('change', () => this.history.endGroup());
    this.tagInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.tagInput.blur();
    });
    row.append(this.tagInput, this.tagPlate);
    section.append(row, el('p', 'cz-hint', `Printed on your chest. Letters, numbers and dashes, up to ${MAX_TAG_LENGTH}.`));
  }

  private buildWatch(column: HTMLElement): void {
    const section = el('section', 'cz-sec');
    const toggle = el('label', 'cz-toggle');
    const text = el('span', 'cz-toggle-text');
    text.append(
      el('span', 'cz-toggle-label', 'First-person wristwatch'),
      el('span', 'cz-toggle-desc', 'Shows on your wrist in first person.'),
    );
    this.watchInput.type = 'checkbox';
    this.watchInput.addEventListener('change', () => this.edit({ ...this.look, watch: this.watchInput.checked }));
    toggle.append(text, this.watchInput);
    section.appendChild(toggle);
    column.appendChild(section);
  }

  private buildPresets(column: HTMLElement): void {
    const section = this.section(column, 'Presets');
    const builtIn = el('div', 'cz-presets');
    for (const preset of BUILTIN_PRESETS) {
      const card = this.presetCard(preset.name, preset.look);
      card.addEventListener('click', () => this.edit(applyPreset(this.look, preset.look, true)));
      builtIn.appendChild(card);
      this.presetCards.push({ card, look: preset.look });
    }

    const savedHead = el('div', 'cz-sub');
    savedHead.append(el('span', '', 'Saved'), this.savedCount);

    this.saveButton.addEventListener('click', () => this.openSaveForm());
    this.saveName.type = 'text';
    this.saveName.maxLength = 24;
    this.saveName.placeholder = 'Name this look';
    this.saveName.spellcheck = false;
    this.saveName.autocomplete = 'off';
    this.saveName.setAttribute('aria-label', 'Name for the saved look');
    this.saveName.addEventListener('input', () => this.syncSaveHint());
    const confirm = el('button', 'cz-btn cz-btn-small cz-btn-accent', 'Save');
    confirm.type = 'submit';
    const cancel = button('cz-btn cz-btn-small', 'Cancel');
    cancel.addEventListener('click', () => this.closeSaveForm(true));
    this.saveForm.append(this.saveName, confirm, cancel);
    this.saveForm.addEventListener('submit', (event) => {
      event.preventDefault();
      this.submitSave();
    });

    section.append(
      el('div', 'cz-sub', 'Built-in'),
      builtIn,
      savedHead,
      this.savedList,
      this.saveButton,
      this.saveForm,
      this.saveHint,
    );
  }

  private buildActions(): HTMLElement {
    const actions = el('div', 'cz-actions');
    const randomize = button('cz-btn cz-btn-minor', 'Randomize');
    randomize.title = 'Roll a random look (keeps your tag)';
    randomize.addEventListener('click', () => this.edit(applyPreset(this.look, randomLook(), true)));
    const reset = button('cz-btn cz-btn-minor', 'Reset');
    reset.title = 'Back to the default look for your side';
    reset.addEventListener('click', () => this.edit(defaultLook(this.team)));
    const cancel = button('cz-btn', 'Cancel');
    cancel.addEventListener('click', () => this.finish(false));
    const done = button('cz-btn cz-btn-primary', 'Done');
    done.dataset.sfx = 'confirm';
    done.addEventListener('click', () => this.finish(true));
    actions.append(randomize, reset, cancel, done);
    return actions;
  }

  private section(parent: HTMLElement, title: string, value?: HTMLElement): HTMLElement {
    const section = el('section', 'cz-sec');
    const head = el('div', 'cz-sec-head');
    head.appendChild(el('h3', 'cz-sec-title', title));
    if (value) {
      value.classList.add('cz-sec-value');
      head.appendChild(value);
    }
    section.appendChild(head);
    parent.appendChild(section);
    return section;
  }

  private presetCard(name: string, look: CharacterLook): HTMLButtonElement {
    const card = button('cz-preset');
    const badge = el('span', 'cz-preset-emblem');
    badge.style.background = look.primary;
    badge.innerHTML = emblemSvgMarkup(look.emblem, look.accent);
    const stripe = el('span', 'cz-preset-stripe');
    for (const colour of [look.primary, look.secondary, look.accent]) {
      const band = el('span');
      band.style.background = colour;
      stripe.appendChild(band);
    }
    card.append(badge, el('span', 'cz-preset-name', name), stripe);
    return card;
  }

  // --- editing -------------------------------------------------------------------

  private withColor(channel: ColorChannel, hex: string): CharacterLook {
    const next = { ...this.look };
    next[channel] = hex;
    return next;
  }

  private withPiece(slot: ArmorSlot, piece: PieceId): CharacterLook {
    const next = { ...this.look };
    if (slot === 'classItem') {
      next.classItem = piece;
    } else if (piece !== 'none') {
      next[slot] = piece;
    }
    return next;
  }

  /** every change goes through here: history, preview, ui, then onChange */
  private edit(next: CharacterLook, group: string | null = null): void {
    if (!this.opened) return;
    const clean = sanitizeLook(next, this.look);
    if (!this.history.record(clean, group)) return;
    this.setLook(clean);
  }

  private setLook(look: CharacterLook): void {
    this.look = { ...look };
    this.stage?.setCharacter(this.look, this.previewTeam);
    this.refresh();
    this.callbacks.onChange?.({ ...this.look });
  }

  private undo(): void {
    const look = this.history.undo();
    if (look) this.setLook(look);
  }

  private redo(): void {
    const look = this.history.redo();
    if (look) this.setLook(look);
  }

  private selectSlot(slot: ArmorSlot): void {
    this.slot = slot;
    this.syncSlots();
    this.stage?.setFocus(slot);
  }

  private setPreviewTeam(team: PlayerModel): void {
    if (team === this.previewTeam) return;
    this.previewTeam = team;
    this.stage?.setCharacter(this.look, team);
    this.syncTeam();
  }

  private finish(saved: boolean): void {
    if (!this.opened) return;
    const look = saved ? { ...this.look } : { ...this.openedLook };
    if (saved) saveLook(look);
    this.hide();
    this.callbacks.onClose(look, saved);
  }

  private hide(): void {
    if (!this.opened) return;
    this.opened = false;
    this.root.classList.remove('is-open');
    this.stage?.stop();
    window.removeEventListener('keydown', this.onKeyDown, true);
    document.removeEventListener('focusin', this.onFocusIn);
    const back = this.restoreFocus;
    this.restoreFocus = null;
    if (back?.isConnected) back.focus({ preventScroll: true });
  }

  private ensureStage(): void {
    if (this.stage || this.stageFailed) return;
    try {
      this.stage = new CustomizeStage(this.stageMount);
      this.stage.onStatus = (status) => this.showStageStatus(status);
    } catch (error) {
      // no webgl: everything else still works, there's just nothing to look at
      this.stageFailed = true;
      console.warn('[Customize] 3d preview unavailable', error);
      this.stageStatus.textContent = '3D preview unavailable on this device';
      this.stageStatus.classList.add('is-visible');
    }
  }

  private showStageStatus(status: StageStatus): void {
    this.stageStatus.textContent = status === 'loading' ? 'Loading preview' : status === 'error' ? 'Preview failed to load' : '';
    this.stageStatus.classList.toggle('is-visible', status !== 'ready');
  }

  // --- saved looks ---------------------------------------------------------------

  private openSaveForm(): void {
    this.armedDelete = null;
    this.syncDeleteButtons();
    this.saveForm.classList.add('is-open');
    this.saveButton.hidden = true;
    this.saveName.value = nextSavedName(this.saved.map((entry) => entry.name));
    this.syncSaveHint();
    this.saveName.focus();
    this.saveName.select();
  }

  private closeSaveForm(refocus: boolean): void {
    const wasOpen = this.saveForm.classList.contains('is-open');
    this.saveForm.classList.remove('is-open');
    this.saveButton.hidden = false;
    this.saveHint.textContent = '';
    if (wasOpen && refocus) this.saveButton.focus();
  }

  private submitSave(): void {
    const name = this.saveName.value.trim();
    if (!name) {
      this.saveName.focus();
      return;
    }
    this.saved = saveNamedLook(name, this.look);
    this.closeSaveForm(true);
    this.renderSaved();
    this.announce(`Saved ${name}`);
  }

  private syncSaveHint(): void {
    const name = this.saveName.value.trim().toLowerCase();
    if (this.saved.some((entry) => entry.name.toLowerCase() === name)) {
      this.saveHint.textContent = 'A saved look already has this name, saving replaces it.';
    } else if (this.saved.length >= MAX_SAVED_LOOKS) {
      this.saveHint.textContent = `You have ${MAX_SAVED_LOOKS} saved, this one replaces the oldest.`;
    } else {
      this.saveHint.textContent = '';
    }
  }

  private renderSaved(): void {
    this.savedCount.textContent = `${this.saved.length}/${MAX_SAVED_LOOKS}`;
    this.savedRows = this.saved.map((entry) => {
      const card = this.presetCard(entry.name, entry.look);
      card.addEventListener('click', () => this.edit(applyPreset(this.look, entry.look, false)));
      const remove = button('cz-saved-delete');
      remove.addEventListener('click', () => this.onDeleteClick(entry.name));
      return { entry, card, remove };
    });
    if (this.savedRows.length === 0) {
      this.savedList.replaceChildren(el('p', 'cz-empty', 'Nothing saved yet.'));
    } else {
      this.savedList.replaceChildren(...this.savedRows.map((row) => {
        const wrap = el('div', 'cz-saved');
        wrap.append(row.card, row.remove);
        return wrap;
      }));
    }
    this.syncDeleteButtons();
    this.syncPresets();
  }

  private onDeleteClick(name: string): void {
    // first click arms it, the second one deletes
    if (this.armedDelete !== name) {
      this.armedDelete = name;
      this.syncDeleteButtons();
      return;
    }
    this.armedDelete = null;
    this.saved = deleteNamedLook(name);
    this.renderSaved();
    this.announce(`Deleted ${name}`);
    this.saveButton.focus();
  }

  private syncDeleteButtons(): void {
    for (const row of this.savedRows) {
      const armed = row.entry.name === this.armedDelete;
      row.remove.textContent = armed ? 'Delete' : '\u00d7';
      row.remove.classList.toggle('is-armed', armed);
      row.remove.title = armed ? 'Click again to delete' : 'Delete';
      row.remove.setAttribute('aria-label', armed ? `Confirm deleting ${row.entry.name}` : `Delete ${row.entry.name}`);
    }
  }

  private announce(message: string): void {
    this.live.textContent = message;
  }

  // --- syncing the ui with the look ----------------------------------------------

  private refresh(): void {
    this.undoButton.disabled = !this.history.canUndo;
    this.redoButton.disabled = !this.history.canRedo;
    this.root.style.setProperty('--cz-paint', this.look.primary);
    this.syncBodies();
    this.syncSlots();
    this.syncColours();
    this.syncFinish();
    this.syncEmblems();
    this.syncTag();
    this.watchInput.checked = this.look.watch;
    this.syncPresets();
    this.syncTeam();
  }

  private syncBodies(): void {
    for (const [id, card] of this.bodyCards) setPressed(card, id === this.look.skin);
    this.bodyValue.textContent = bodyName(this.look.skin);
    if (this.armorSection) this.armorSection.hidden = this.look.skin !== 'kit';
  }

  private syncSlots(): void {
    for (const [slot, { tab, piece }] of this.slotTabs) {
      const active = slot === this.slot;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      piece.textContent = pieceName(slot, this.look[slot]);
    }
    if (this.renderedSlot !== this.slot) {
      this.renderedSlot = this.slot;
      this.optionsTitle.textContent = SLOT_PROMPT[this.slot];
      this.optionCards.clear();
      const cards = slotOptions(this.slot).map((piece) => {
        const card = this.optionCard(this.slot, piece);
        this.optionCards.set(piece, card);
        return card;
      });
      this.optionList.replaceChildren(...cards);
    }
    const current: PieceId = this.look[this.slot];
    for (const [piece, card] of this.optionCards) {
      setPressed(card, piece === current);
    }
  }

  private optionCard(slot: ArmorSlot, piece: PieceId): HTMLButtonElement {
    const info = piece === 'none' ? null : ARMOR_SET_INFO[piece];
    const card = button('cz-option');
    card.dataset.piece = piece;
    const badge = el('span', 'cz-option-badge', info ? info.code.toUpperCase() : '\u00d7');
    const body = el('span', 'cz-option-body');
    body.append(
      el('span', 'cz-option-name', pieceName(slot, piece)),
      el('span', 'cz-option-set', info ? `${info.name} set` : 'Empty slot'),
      el('span', 'cz-option-blurb', info ? info.blurb : 'Nothing on your back.'),
    );
    card.append(badge, body, el('span', 'cz-option-tag', 'Equipped'));
    card.addEventListener('click', () => this.edit(this.withPiece(slot, piece)));
    return card;
  }

  private syncColours(): void {
    const skin = this.look.skin === 'kit' ? null : SKIN_INFO[this.look.skin];
    for (const [channel, parts] of this.channelButtons) {
      const hex = this.look[channel];
      parts.chip.style.background = hex;
      parts.value.textContent = skin && skin.native[channel] === hex ? 'Original' : swatchName(hex) ?? hex;
      setPressed(parts.button, channel === this.channel, 'is-active');
    }
    const hex = this.look[this.channel];
    this.channelHint.textContent = skin ? skin.zones[this.channel] : CHANNEL_HINT[this.channel];
    this.originalPaint.hidden = !skin;
    this.originalPaint.disabled = !skin || CHANNELS.every((channel) => skin.native[channel] === this.look[channel]);
    for (const swatch of this.swatchButtons) {
      setPressed(swatch, swatch.dataset.hex === hex);
    }
    if (this.colorPicker.value !== hex) this.colorPicker.value = hex;
    if (document.activeElement !== this.hexInput) {
      this.hexInput.value = hex;
      this.hexInput.classList.remove('is-invalid');
    }
    this.customName.textContent = swatchName(hex) ?? 'Custom';
  }

  private syncFinish(): void {
    for (const [id, choice] of this.finishButtons) {
      setPressed(choice, id === this.look.finish);
      choice.hidden = this.look.skin !== 'kit' && KIT_ONLY_FINISHES.includes(id) && id !== this.look.finish;
    }
    this.finishValue.textContent = FINISH_INFO[this.look.finish].name;
  }

  private syncEmblems(): void {
    if (this.emblemPaint !== this.look.accent) {
      this.emblemPaint = this.look.accent;
      for (const [id, choice] of this.emblemButtons) {
        choice.innerHTML = emblemSvgMarkup(id, this.look.accent);
      }
    }
    for (const [id, choice] of this.emblemButtons) {
      setPressed(choice, id === this.look.emblem);
    }
    this.emblemValue.textContent = EMBLEM_INFO[this.look.emblem].name;
  }

  private syncTag(): void {
    const tag = this.look.tag;
    if (document.activeElement !== this.tagInput && this.tagInput.value !== tag) {
      this.tagInput.value = tag;
    }
    this.tagPlate.textContent = tag || 'No tag';
    this.tagPlate.classList.toggle('is-empty', tag.length === 0);
    this.tagCount.textContent = `${tag.length}/${MAX_TAG_LENGTH}`;
  }

  private syncPresets(): void {
    for (const { card, look } of this.presetCards) {
      setPressed(card, sameStyle(this.look, look));
    }
    for (const row of this.savedRows) {
      setPressed(row.card, looksEqual(this.look, row.entry.look));
    }
  }

  private syncTeam(): void {
    for (const [team, toggle] of this.teamButtons) {
      setPressed(toggle, team === this.previewTeam, 'is-active');
    }
  }

  // --- input ---------------------------------------------------------------------

  private onSlotKey(event: KeyboardEvent, slot: ArmorSlot): void {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = (ARMOR_SLOTS.indexOf(slot) + step + ARMOR_SLOTS.length) % ARMOR_SLOTS.length;
    const next = ARMOR_SLOTS[index];
    this.selectSlot(next);
    this.slotTabs.get(next)?.tab.focus();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.opened) return;
    if (event.key === 'Escape') {
      // capture phase on window, so the game's own esc handling never sees it
      event.preventDefault();
      event.stopPropagation();
      if (this.saveForm.classList.contains('is-open')) {
        this.closeSaveForm(true);
      } else if (this.armedDelete) {
        this.armedDelete = null;
        this.syncDeleteButtons();
      } else {
        this.finish(false);
      }
      return;
    }
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && (key === 'z' || key === 'y') && !isTextField(event.target)) {
      event.preventDefault();
      event.stopPropagation();
      if (key === 'y' || event.shiftKey) {
        this.redo();
      } else {
        this.undo();
      }
    }
  };

  private readonly onFocusIn = (event: FocusEvent): void => {
    // keep tab focus inside the screen while it covers the menu
    if (this.opened && event.target instanceof Node && !this.root.contains(event.target)) {
      this.root.focus({ preventScroll: true });
    }
  };

  private readonly onRootPointerDown = (event: PointerEvent): void => {
    if (!this.armedDelete) return;
    const row = this.savedRows.find((entry) => entry.entry.name === this.armedDelete);
    if (!row || !(event.target instanceof Node) || !row.remove.contains(event.target)) {
      this.armedDelete = null;
      this.syncDeleteButtons();
    }
  };
}
