import { DEFAULT_KNIFE_ID, KNIFE_DAMAGE, KNIVES, getKnife, type KnifeId } from '../../combat/knives';
import { getWeapon, type WeaponId } from '../../combat/weapons';
import { knifeFinishDisplayName, resolveKnifeFinish, wearCondition, type KnifeFinishSelection } from '../../cosmetics/finishes/catalog';
import type { KnifeLoadoutSelection } from '../../cosmetics/finishes/selection';
import { iconMarkup, type IconName } from '../hud/icons';
import { FinishPicker } from './FinishPicker';
import { knifeDescriptor, knifeSilhouetteMarkup } from './knifeSilhouette';
import { firearmStats, weaponDisplayName } from './menuInfo';

export interface LoadoutPanelCallbacks {
  /** null = the default knife */
  onKnifeSelected(knifeId: KnifeId | null): void;
  /** finish, wear or pattern changed on the equipped knife */
  onKnifeFinishChanged?(selection: KnifeLoadoutSelection): void;
}

/**
 * Loadout: the AWP and Deagle as fixed slots with their numbers from
 * weapons.ts, the equipped knife, its finish, and a picker grid for all 20 knives.
 */
export class LoadoutPanel {
  private readonly knifeSlot: HTMLDivElement;
  private readonly grid: HTMLDivElement;
  private readonly finishPicker: FinishPicker;
  private selected: KnifeId | null = null;

  constructor(section: HTMLElement, private readonly callbacks: LoadoutPanelCallbacks) {
    const slots = document.createElement('div');
    slots.className = 'loadout-slots';
    slots.append(this.firearmSlot('awp', 1, 'Primary'), this.firearmSlot('deagle', 2, 'Secondary'));
    this.knifeSlot = document.createElement('div');
    this.knifeSlot.className = 'loadout-slot loadout-slot-knife';
    slots.appendChild(this.knifeSlot);

    this.finishPicker = new FinishPicker({
      onChange: (finish) => {
        this.renderKnifeSlot();
        this.callbacks.onKnifeFinishChanged?.({ knifeId: this.selected ?? DEFAULT_KNIFE_ID, ...finish });
      },
    });

    const hint = document.createElement('p');
    hint.className = 'menu-section-hint';
    hint.textContent = 'Knife: every type shares the same damage, pick the one you like holding.';
    this.grid = document.createElement('div');
    this.grid.className = 'knife-grid';
    section.append(slots, this.finishPicker.element, hint, this.grid);
    this.render();
  }

  /** reflects the stored knife choice without firing the callback */
  setSelectedKnife(knifeId: KnifeId | null): void {
    this.selected = knifeId;
    this.finishPicker.setKnife(knifeId ?? DEFAULT_KNIFE_ID);
    this.render();
  }

  /** reflects the stored finish without firing the callback */
  setKnifeFinish(selection: KnifeFinishSelection): void {
    this.finishPicker.setSelection(selection);
    this.renderKnifeSlot();
  }

  /** true while the loadout tab is on screen, the inspect view only renders then */
  setActive(active: boolean): void {
    this.finishPicker.setActive(active);
  }

  dispose(): void {
    this.finishPicker.dispose();
  }

  private firearmSlot(id: WeaponId, key: number, role: string): HTMLDivElement {
    const def = getWeapon(id);
    const slot = document.createElement('div');
    slot.className = 'loadout-slot';
    slot.dataset.weapon = id;
    slot.innerHTML = [
      `<div class="loadout-slot-head"><span class="loadout-key">${key}</span><span class="loadout-role">${role}</span></div>`,
      `<div class="loadout-art">${iconMarkup(id as IconName, 'loadout-icon')}</div>`,
      `<div class="loadout-name">${weaponDisplayName(id)}</div>`,
    ].join('');
    const stats = document.createElement('dl');
    stats.className = 'loadout-stats';
    for (const line of firearmStats(def)) {
      const row = document.createElement('div');
      row.className = 'loadout-stat';
      const dt = document.createElement('dt');
      dt.textContent = line.label;
      const dd = document.createElement('dd');
      dd.textContent = line.value;
      const bar = document.createElement('span');
      bar.className = 'loadout-stat-bar';
      bar.style.setProperty('--fill', line.fraction.toFixed(3));
      row.append(dt, dd, bar);
      stats.appendChild(row);
    }
    slot.appendChild(stats);
    return slot;
  }

  private render(): void {
    this.renderKnifeSlot();
    const cards: HTMLButtonElement[] = KNIVES.map((knife) => this.knifeCard(
      knife.id,
      knife.name,
      knifeDescriptor(knife),
      knifeSilhouetteMarkup(knife, 'knife-art'),
    ));
    this.grid.replaceChildren(...cards);
  }

  private renderKnifeSlot(): void {
    // no saved pick means the viewmodel's default knife
    const knife = getKnife(this.selected ?? DEFAULT_KNIFE_ID);
    const name = knife.name;
    const art = knifeSilhouetteMarkup(knife, 'loadout-icon knife-art');
    const d = KNIFE_DAMAGE;
    this.knifeSlot.innerHTML = [
      '<div class="loadout-slot-head"><span class="loadout-key">3</span><span class="loadout-role">Melee</span></div>',
      `<div class="loadout-art">${art}</div>`,
      `<div class="loadout-name"></div>`,
      `<div class="loadout-sub"></div>`,
      `<div class="loadout-sub loadout-finish"></div>`,
      '<dl class="loadout-stats loadout-stats-compact">',
      `<div class="loadout-stat"><dt>Slash</dt><dd>${d.primary} / ${d.primaryFollowUp}</dd></div>`,
      `<div class="loadout-stat"><dt>Stab</dt><dd>${d.secondary}</dd></div>`,
      `<div class="loadout-stat"><dt>Backstab</dt><dd>${d.primaryBackstab} / ${d.secondaryBackstab}</dd></div>`,
      '</dl>',
    ].join('');
    (this.knifeSlot.querySelector('.loadout-name') as HTMLElement).textContent = name;
    (this.knifeSlot.querySelector('.loadout-sub') as HTMLElement).textContent = knifeDescriptor(knife);
    const finish = this.finishPicker.getSelection();
    const vanilla = resolveKnifeFinish(finish.finishId).finish.id === 'vanilla';
    (this.knifeSlot.querySelector('.loadout-finish') as HTMLElement).textContent = vanilla
      ? knifeFinishDisplayName(finish.finishId)
      : `${knifeFinishDisplayName(finish.finishId)} · ${wearCondition(finish.wear).short}`;
  }

  private knifeCard(id: KnifeId | null, name: string, detail: string, art: string): HTMLButtonElement {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'menu-card menu-knife-card';
    const selected = id === this.selected;
    card.classList.toggle('is-selected', selected);
    card.setAttribute('aria-pressed', String(selected));
    card.innerHTML = `<span class="knife-card-art">${art}</span>`;
    const label = document.createElement('span');
    label.className = 'knife-card-name';
    label.textContent = name;
    const sub = document.createElement('span');
    sub.className = 'knife-card-detail';
    sub.textContent = detail;
    card.append(label, sub);
    if (selected) {
      const tag = document.createElement('span');
      tag.className = 'knife-card-tag';
      tag.textContent = 'Equipped';
      card.appendChild(tag);
    }
    card.addEventListener('click', () => {
      if (this.selected === id) {
        return;
      }
      this.selected = id;
      this.finishPicker.setKnife(id ?? DEFAULT_KNIFE_ID);
      this.render();
      this.callbacks.onKnifeSelected(id);
    });
    return card;
  }
}
