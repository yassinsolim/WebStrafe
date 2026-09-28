import { DEFAULT_KNIFE_ID, getKnife, type KnifeId } from '../../combat/knives';
import {
  clampKnifeWear,
  finishPatternLabel,
  KNIFE_FINISHES,
  type KnifeFinishDef,
  type KnifeFinishSelection,
  normalizePatternSeed,
  PATTERN_SEED_MAX,
  resolveKnifeFinish,
  wearCondition,
} from '../../cosmetics/finishes/catalog';
import { KnifeInspectPreview } from './KnifeInspectPreview';

export interface FinishPickerCallbacks {
  onChange(selection: KnifeFinishSelection): void;
}

// seeds the swatches use to show off each finish
const SWATCH_SEEDS: Readonly<Record<string, number>> = {
  case_hardened: 12,
  marble_fade: 1,
  fade: 16,
  crimson_web: 5,
};
const SWATCH_W = 192;
const SWATCH_H = 80;

/**
 * finish controls for the loadout: a grid of rendered swatches, the doppler
 * phases, a wear slider with the cs exterior name, the pattern seed with a
 * random button and a live 3d inspect view of the knife.
 */
export class FinishPicker {
  readonly element: HTMLElement;
  private readonly preview: KnifeInspectPreview;
  private selection: KnifeFinishSelection = { finishId: 'vanilla', wear: 0, seed: 0 };
  private knifeId: KnifeId = DEFAULT_KNIFE_ID;
  private readonly swatches = new Map<string, HTMLButtonElement>();
  private readonly variants: HTMLDivElement;
  private readonly captionKnife: HTMLSpanElement;
  private readonly captionName: HTMLSpanElement;
  private readonly captionMeta: HTMLSpanElement;
  private readonly wearRow: HTMLDivElement;
  private readonly wearSlider: HTMLInputElement;
  private readonly wearNumber: HTMLInputElement;
  private readonly wearHint: HTMLSpanElement;
  private readonly seedRow: HTMLDivElement;
  private readonly seedInput: HTMLInputElement;
  private readonly seedHint: HTMLSpanElement;
  private readonly randomButton: HTMLButtonElement;

  constructor(private readonly callbacks: FinishPickerCallbacks) {
    this.element = document.createElement('section');
    this.element.className = 'set-group finish-panel';
    const title = document.createElement('h3');
    title.className = 'set-group-title';
    title.textContent = 'Finish';

    // inspect view
    this.preview = new KnifeInspectPreview(this.knifeId, this.selection);
    const inspect = document.createElement('div');
    inspect.className = 'finish-inspect';
    const caption = document.createElement('div');
    caption.className = 'finish-inspect-caption';
    this.captionKnife = document.createElement('span');
    this.captionKnife.className = 'finish-inspect-knife';
    this.captionName = document.createElement('span');
    this.captionName.className = 'finish-inspect-name';
    this.captionMeta = document.createElement('span');
    this.captionMeta.className = 'finish-inspect-meta';
    caption.append(this.captionKnife, this.captionName, this.captionMeta);
    const hint = document.createElement('span');
    hint.className = 'finish-inspect-hint';
    hint.textContent = 'Drag to rotate';
    inspect.append(this.preview.canvas, caption, hint);

    // swatches
    const grid = document.createElement('div');
    grid.className = 'finish-grid';
    for (const finish of KNIFE_FINISHES) grid.appendChild(this.swatch(finish));

    // doppler phases and gems
    this.variants = document.createElement('div');
    this.variants.className = 'finish-variants';

    // wear
    this.wearRow = document.createElement('div');
    this.wearRow.className = 'set-row set-row-range finish-wear-row';
    const wearLabel = label('Wear');
    this.wearHint = document.createElement('span');
    this.wearHint.className = 'set-hint';
    wearLabel.appendChild(this.wearHint);
    this.wearSlider = document.createElement('input');
    this.wearSlider.type = 'range';
    this.wearSlider.step = '0.0001';
    this.wearSlider.setAttribute('aria-label', 'Wear');
    this.wearNumber = document.createElement('input');
    this.wearNumber.type = 'number';
    this.wearNumber.className = 'set-number';
    this.wearNumber.step = '0.0001';
    this.wearNumber.setAttribute('aria-label', 'Wear float');
    const wearValue = document.createElement('span');
    wearValue.className = 'set-value';
    wearValue.appendChild(this.wearNumber);
    this.wearRow.append(wearLabel, this.wearSlider, wearValue);
    this.wearSlider.addEventListener('input', () => this.commit({ wear: Number(this.wearSlider.value) }));
    this.wearNumber.addEventListener('change', () => {
      const value = Number(this.wearNumber.value);
      if (Number.isFinite(value)) this.commit({ wear: value });
      else this.refresh();
    });
    this.wearNumber.addEventListener('keydown', blurOnEnter);

    // pattern seed
    this.seedRow = document.createElement('div');
    this.seedRow.className = 'set-row finish-seed-row';
    const seedLabel = label('Pattern');
    this.seedHint = document.createElement('span');
    this.seedHint.className = 'set-hint';
    seedLabel.appendChild(this.seedHint);
    const seedControls = document.createElement('div');
    seedControls.className = 'finish-seed-controls';
    this.seedInput = document.createElement('input');
    this.seedInput.type = 'number';
    this.seedInput.className = 'set-number finish-seed-input';
    this.seedInput.min = '0';
    this.seedInput.max = String(PATTERN_SEED_MAX);
    this.seedInput.step = '1';
    this.seedInput.setAttribute('aria-label', 'Pattern seed');
    this.seedInput.addEventListener('change', () => this.commit({ seed: normalizePatternSeed(this.seedInput.value) }));
    this.seedInput.addEventListener('keydown', blurOnEnter);
    this.randomButton = document.createElement('button');
    this.randomButton.type = 'button';
    this.randomButton.className = 'menu-restart-btn finish-random';
    this.randomButton.textContent = 'Random';
    this.randomButton.addEventListener('click', () => {
      this.commit({ seed: Math.floor(Math.random() * (PATTERN_SEED_MAX + 1)) });
    });
    seedControls.append(this.seedInput, this.randomButton);
    this.seedRow.append(seedLabel, seedControls);

    this.element.append(title, inspect, grid, this.variants, this.wearRow, this.seedRow);
    this.refresh();
  }

  setKnife(id: KnifeId): void {
    this.knifeId = id;
    this.preview.setKnife(id);
    this.refresh();
  }

  /** reflects a stored selection without firing the callback */
  setSelection(selection: KnifeFinishSelection): void {
    const resolved = resolveKnifeFinish(selection.finishId);
    this.selection = {
      finishId: resolved.id,
      wear: clampKnifeWear(resolved.id, selection.wear),
      seed: normalizePatternSeed(selection.seed),
    };
    this.preview.setFinish(this.selection);
    this.refresh();
  }

  getSelection(): KnifeFinishSelection {
    return { ...this.selection };
  }

  setActive(active: boolean): void {
    this.preview.setActive(active);
  }

  dispose(): void {
    this.preview.dispose();
  }

  private commit(change: Partial<KnifeFinishSelection>): void {
    const next = { ...this.selection, ...change };
    const resolved = resolveKnifeFinish(next.finishId);
    next.finishId = resolved.id;
    next.wear = clampKnifeWear(resolved.id, next.wear);
    next.seed = normalizePatternSeed(next.seed);
    this.selection = next;
    this.preview.setFinish(next);
    this.refresh();
    this.callbacks.onChange({ ...next });
  }

  private swatch(finish: KnifeFinishDef): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'menu-card finish-swatch';
    button.dataset.finish = finish.id;
    button.style.setProperty('--finish-swatch', `linear-gradient(115deg, ${finish.swatch.join(', ')})`);
    const art = document.createElement('canvas');
    art.className = 'finish-swatch-art';
    art.width = SWATCH_W;
    art.height = SWATCH_H;
    const name = document.createElement('span');
    name.className = 'finish-swatch-name';
    name.textContent = finish.name;
    button.append(art, name);
    button.addEventListener('click', () => {
      const current = resolveKnifeFinish(this.selection.finishId);
      if (current.finish.id === finish.id) return;
      // a family with phases starts on its first one
      this.commit({ finishId: finish.variants?.[0].id ?? finish.id });
    });
    const variant = finish.variants?.[1] ?? finish.variants?.[0];
    this.preview.queueSwatch({
      finishId: variant?.id ?? finish.id,
      wear: finish.wearRange[0],
      seed: SWATCH_SEEDS[finish.id] ?? 12,
    }, art);
    this.swatches.set(finish.id, button);
    return button;
  }

  private refresh(): void {
    const resolved = resolveKnifeFinish(this.selection.finishId);
    const { finish } = resolved;
    for (const [id, button] of this.swatches) {
      const on = id === finish.id;
      button.classList.toggle('is-selected', on);
      button.setAttribute('aria-pressed', String(on));
    }

    this.variants.hidden = !finish.variants;
    if (finish.variants) {
      const buttons = finish.variants.map((v) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'finish-variant';
        b.classList.toggle('is-active', v.id === resolved.id);
        b.setAttribute('aria-pressed', String(v.id === resolved.id));
        b.style.setProperty('--finish-variant', `linear-gradient(135deg, ${v.swatch.join(', ')})`);
        const dot = document.createElement('span');
        dot.className = 'finish-variant-dot';
        const text = document.createElement('span');
        text.textContent = v.name;
        b.append(dot, text);
        b.addEventListener('click', () => this.commit({ finishId: v.id }));
        return b;
      });
      this.variants.replaceChildren(...buttons);
    }

    // vanilla has no float and no pattern
    const [min, max] = finish.wearRange;
    this.wearRow.hidden = finish.id === 'vanilla';
    this.wearSlider.min = String(min);
    this.wearSlider.max = String(max);
    this.wearSlider.value = String(this.selection.wear);
    this.wearSlider.style.setProperty('--fill', String(max > min ? (this.selection.wear - min) / (max - min) : 0));
    this.wearNumber.min = String(min);
    this.wearNumber.max = String(max);
    if (document.activeElement !== this.wearNumber) this.wearNumber.value = this.selection.wear.toFixed(4);
    this.wearHint.textContent = wearCondition(this.selection.wear).name;

    this.seedRow.hidden = finish.id === 'vanilla';
    this.seedInput.disabled = !finish.seedMatters;
    this.randomButton.disabled = !finish.seedMatters;
    if (document.activeElement !== this.seedInput) this.seedInput.value = String(this.selection.seed);
    this.seedHint.textContent = finish.seedMatters
      ? finishPatternLabel(resolved.id, this.selection.seed) ?? `Seed ${this.selection.seed}`
      : 'No pattern variation';

    this.captionKnife.textContent = getKnife(this.knifeId).name;
    this.captionName.textContent = resolved.name;
    this.captionMeta.textContent = finish.id === 'vanilla'
      ? 'Stock satin steel'
      : [
        `${wearCondition(this.selection.wear).name} ${this.selection.wear.toFixed(4)}`,
        finish.seedMatters ? `Pattern ${this.selection.seed}` : null,
      ].filter(Boolean).join(' · ');
  }
}

function label(text: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = 'set-label';
  el.textContent = text;
  return el;
}

function blurOnEnter(event: KeyboardEvent): void {
  if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
}
