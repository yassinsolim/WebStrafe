import type { KillFeed } from '../combat/KillFeed';
import { getWeapon, isMelee, type WeaponId } from '../combat/weapons';
import {
  HitmarkerFeedback,
  type HitmarkerKind,
  type HitmarkerSnapshot,
  type HitmarkerTrigger,
} from './HitmarkerFeedback';
import { createIcon, weaponIcon } from './hud/icons';
import { ammoView, killfeedLineView, killfeedSignature } from './hud/hudFormat';
import { lowHealthIntensity } from './hud/hudMath';
import { weaponDisplayName } from './menu/menuInfo';

export interface DeathInfo {
  killerName: string;
  weaponId: string;
  headshot: boolean;
  /** killed by your own hand (fall, world, self) */
  bySelf?: boolean;
}

const SLOT_ORDER: readonly WeaponId[] = ['awp', 'deagle', 'knife'];
const SLOT_VISIBLE_MS = 1800;
const DAMAGE_ARC_MS = 1100;
const DAMAGE_ARC_COUNT = 4;
const KILLFEED_FADE_MS = 700;
const KILLFEED_TTL_MS = 6000;
const LOW_HEALTH = 25;

const HITMARKER_GLYPH: Record<HitmarkerKind, string> = { normal: '✕', headshot: '◆', kill: '✦' };
const HITMARKER_LABEL: Record<HitmarkerKind, string> = { normal: 'Body hit', headshot: 'Headshot', kill: 'Kill confirmed' };

// four diagonal ticks; headshots add a thin ring around them, kills are
// longer heavier ticks. every shape is drawn twice: a dark wide pass under
// the coloured pass
const HITMARKER_SVG = (() => {
  const ticks = 'M4.4 -4.4L8.9 -8.9M4.4 4.4L8.9 8.9M-4.4 4.4L-8.9 8.9M-4.4 -4.4L-8.9 -8.9';
  const ring = 'M14.4 0A14.4 14.4 0 1 1 -14.4 0A14.4 14.4 0 1 1 14.4 0';
  const kill = 'M4.8 -4.8L12.2 -12.2M4.8 4.8L12.2 12.2M-4.8 4.8L-12.2 12.2M-4.8 -4.8L-12.2 -12.2';
  const pair = (cls: string, d: string) =>
    `<g class="${cls}"><path class="hm-under" d="${d}"/><path class="hm-over" d="${d}"/></g>`;
  return '<svg class="hm-svg" viewBox="-16 -16 32 32" aria-hidden="true" focusable="false">'
    + pair('hm-ticks', ticks)
    + pair('hm-ring', ring)
    + pair('hm-kill', kill)
    + '</svg>';
})();

/**
 * DOM overlay for combat: health, ammo with reload progress, the weapon slot
 * strip, hitmarker, directional damage, low health vignette, death banner and
 * the kill feed. Purely presentational, driven by combat events wired in
 * GameApp. Class names the browser verifier reads (.combat-ammo,
 * .combat-health-text, .combat-hitmarker, .combat-incoming-cue, .combat-death,
 * .combat-audio-status) are kept. Text and styles are only written when the
 * value behind them changes.
 */
export class CombatHud {
  private readonly root: HTMLDivElement;
  private readonly healthPanel: HTMLDivElement;
  private readonly healthFill: HTMLDivElement;
  private readonly healthText: HTMLSpanElement;
  private readonly ammoPanel: HTMLDivElement;
  private readonly ammoIcon: HTMLSpanElement;
  private readonly ammoCount: HTMLSpanElement;
  private readonly ammoName: HTMLSpanElement;
  private readonly ammoState: HTMLSpanElement;
  private readonly ammoPips: HTMLDivElement;
  private readonly reloadFill: HTMLDivElement;
  private readonly slotStrip: HTMLDivElement;
  private readonly slotRows = new Map<WeaponId, { row: HTMLDivElement; name: HTMLSpanElement }>();
  private readonly practiceGuide: HTMLDivElement;
  private readonly audioStatus: HTMLSpanElement;
  private readonly hitmarker: HTMLDivElement;
  private readonly hitmarkerGlyph: HTMLSpanElement;
  private readonly incomingCue: HTMLDivElement;
  private readonly damageArcs: HTMLDivElement[] = [];
  private readonly lowHealth: HTMLDivElement;
  private readonly killFeedEl: HTMLDivElement;
  private readonly deathBanner: HTMLDivElement;
  private readonly deathKiller: HTMLDivElement;
  private readonly deathTimer: HTMLDivElement;
  private readonly deathBarFill: HTMLDivElement;
  private readonly hitmarkerFeedback = new HitmarkerFeedback();
  private lastHitmarkerSequence = 0;
  private hitmarkerShown = false;
  private hitmarkerHeld = false;
  private hitmarkerFlip = false;
  private incomingCueExpiresAtMs = 0;
  private lastKillFeedSig = '';
  private visible = false;
  private hudEnabled = true;
  private knifeName = 'Knife';
  private activeWeapon: WeaponId | null = null;
  private iconWeapon: WeaponId | null = null;
  private lastAmmoKey = '';
  private lastHealthKey = '';
  private lastHealth = 100;
  private reloadStartedAtMs: number | null = null;
  private reloadDurationMs = 0;
  private lastReloadScale = '';
  private slotsHideAtMs = 0;
  private nextDamageArc = 0;
  private respawnAtMs: number | null = null;
  private deathShownAtMs = 0;
  private lastDeathText = '';
  private lastNowMs = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'combat-hud';
    this.root.style.display = 'none';

    // low health vignette and incoming flash sit under everything else
    this.lowHealth = div('hud-lowhealth');
    this.incomingCue = div('combat-incoming-cue');

    // health, bottom left
    this.healthPanel = div('combat-health hud-panel');
    const healthIcon = createIcon('health', 'hud-health-icon');
    this.healthText = document.createElement('span');
    this.healthText.className = 'combat-health-text';
    this.healthText.textContent = '100';
    const healthBar = div('hud-health-bar');
    this.healthFill = div('combat-health-fill');
    healthBar.appendChild(this.healthFill);
    this.healthPanel.append(healthIcon, this.healthText, healthBar);

    // ammo, bottom right: weapon line, then magazine / reserve and the rounds strip
    this.ammoPanel = div('combat-ammo hud-panel');
    const weaponLine = div('hud-ammo-weapon');
    this.ammoIcon = document.createElement('span');
    this.ammoIcon.className = 'hud-ammo-icon';
    this.ammoName = document.createElement('span');
    this.ammoName.className = 'hud-ammo-name';
    weaponLine.append(this.ammoIcon, this.ammoName);
    const countLine = div('hud-ammo-main');
    this.ammoCount = document.createElement('span');
    this.ammoCount.className = 'hud-ammo-count';
    const reserve = document.createElement('span');
    reserve.className = 'hud-ammo-reserve';
    reserve.title = 'Unlimited reserve';
    reserve.append(createIcon('infinity', 'hud-ammo-inf'));
    countLine.append(this.ammoCount, reserve);
    this.ammoPips = div('hud-ammo-pips');
    this.ammoState = document.createElement('span');
    this.ammoState.className = 'hud-ammo-state';
    const reloadBar = div('hud-reload-bar');
    this.reloadFill = div('hud-reload-fill');
    reloadBar.appendChild(this.reloadFill);
    this.ammoPanel.append(weaponLine, countLine, this.ammoPips, reloadBar, this.ammoState);

    // weapon slot strip, above the ammo
    this.slotStrip = div('hud-slots');
    SLOT_ORDER.forEach((id, index) => {
      const row = div('hud-slot');
      row.dataset.weapon = id;
      const key = document.createElement('span');
      key.className = 'hud-slot-key';
      key.textContent = String(index + 1);
      const name = document.createElement('span');
      name.className = 'hud-slot-name';
      name.textContent = weaponDisplayName(id, this.knifeName);
      row.append(key, name, createIcon(weaponIcon(id), `hud-slot-icon hud-slot-icon-${id}`));
      this.slotStrip.appendChild(row);
      this.slotRows.set(id, { row, name });
    });

    // player-facing range drill: normal controls and real world geometry only
    this.practiceGuide = div('combat-practice-guide');
    this.practiceGuide.hidden = true;
    this.practiceGuide.innerHTML = [
      '<strong>Firearm range</strong><span class="hud-guide-keys"><kbd>1</kbd> AWP <kbd>2</kbd> Deagle <kbd>3</kbd> Knife <kbd>R</kbd> reload <kbd>Tab</kbd> scores <kbd>Esc</kbd> menu</span>',
      '<span class="hud-guide-note">Centre bot is the body target, the gold head counts as a headshot. Orange cover blocks shots, the tan panel and floor show impacts.</span>',
    ].join('');
    this.audioStatus = document.createElement('span');
    this.audioStatus.className = 'combat-audio-status starting';
    this.audioStatus.textContent = 'AUDIO STARTING';
    this.practiceGuide.append(this.audioStatus);

    // hitmarker and damage direction, centre
    this.hitmarker = div('combat-hitmarker');
    this.hitmarker.hidden = true;
    this.hitmarker.setAttribute('role', 'status');
    this.hitmarker.setAttribute('aria-live', 'polite');
    this.hitmarker.setAttribute('aria-atomic', 'true');
    this.hitmarker.style.opacity = '0';
    this.hitmarker.innerHTML = HITMARKER_SVG;
    this.hitmarkerGlyph = document.createElement('span');
    this.hitmarkerGlyph.className = 'hud-sr-only';
    this.hitmarker.appendChild(this.hitmarkerGlyph);
    const damageLayer = div('hud-damage');
    for (let i = 0; i < DAMAGE_ARC_COUNT; i += 1) {
      const arc = div('hud-damage-arc');
      arc.appendChild(document.createElement('i'));
      this.damageArcs.push(arc);
      damageLayer.appendChild(arc);
    }

    // kill feed, top right
    this.killFeedEl = div('combat-killfeed');

    // death banner, centre
    this.deathBanner = div('combat-death');
    this.deathBanner.style.display = 'none';
    const deathHead = div('hud-death-head');
    deathHead.append(createIcon('skull', 'hud-death-skull'));
    const deathTitle = div('hud-death-title');
    deathTitle.textContent = 'You died';
    deathHead.appendChild(deathTitle);
    this.deathKiller = div('hud-death-killer');
    this.deathTimer = div('hud-death-timer');
    this.deathTimer.textContent = 'Respawning soon';
    const deathBar = div('hud-death-bar');
    this.deathBarFill = div('hud-death-fill');
    deathBar.appendChild(this.deathBarFill);
    this.deathBanner.append(deathHead, this.deathKiller, this.deathTimer, deathBar);

    this.root.append(
      this.lowHealth,
      this.incomingCue,
      this.healthPanel,
      this.slotStrip,
      this.ammoPanel,
      this.practiceGuide,
      damageLayer,
      this.hitmarker,
      this.killFeedEl,
      this.deathBanner,
    );
    parent.appendChild(this.root);
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) {
      return;
    }
    this.visible = visible;
    this.syncVisibility();
  }

  /** the settings master switch; combined with setVisible */
  setHudEnabled(enabled: boolean): void {
    this.hudEnabled = enabled;
    this.syncVisibility();
  }

  setHealth(health: number, alive: boolean, showDeath = !alive): void {
    const clamped = Math.max(0, Math.min(100, Math.round(health)));
    const key = `${clamped}|${alive}`;
    if (key !== this.lastHealthKey) {
      this.lastHealthKey = key;
      const low = clamped <= LOW_HEALTH;
      this.healthFill.style.transform = `scaleX(${(clamped / 100).toFixed(3)})`;
      this.healthText.textContent = String(clamped);
      this.healthFill.classList.toggle('low', low);
      this.healthPanel.classList.toggle('is-low', low && alive);
      this.healthPanel.classList.toggle('is-dead', !alive);
      const intensity = alive ? lowHealthIntensity(clamped) : 0;
      this.lowHealth.style.opacity = intensity.toFixed(3);
      this.lowHealth.classList.toggle('is-critical', alive && clamped <= 20);
      if (alive && clamped < this.lastHealth) {
        flash(this.healthPanel, 'is-hurt-a', 'is-hurt-b');
      }
      this.lastHealth = clamped;
    }
    if (alive) {
      this.respawnAtMs = null;
    }
    this.setDeathVisible(!alive && showDeath);
  }

  setDeathVisible(visible: boolean): void {
    const wasVisible = this.deathBanner.style.display !== 'none';
    if (visible === wasVisible) {
      return;
    }
    this.deathBanner.style.display = visible ? 'block' : 'none';
    if (visible) {
      this.deathShownAtMs = this.lastNowMs || performance.now();
      this.renderDeathTimer(this.deathShownAtMs);
    }
  }

  /** who killed the local player; call from the death event */
  setDeathInfo(info: DeathInfo | null, respawnAtMs: number | null = null): void {
    this.respawnAtMs = respawnAtMs;
    this.lastDeathText = '';
    this.deathKiller.replaceChildren();
    if (!info) {
      return;
    }
    if (info.bySelf) {
      this.deathKiller.textContent = 'You took yourself out';
      return;
    }
    const label = document.createElement('span');
    label.className = 'hud-death-by';
    label.textContent = 'Killed by';
    const name = document.createElement('b');
    name.textContent = info.killerName;
    const weapon = document.createElement('span');
    weapon.className = 'hud-death-weapon';
    weapon.title = weaponDisplayName(info.weaponId);
    weapon.append(createIcon(weaponIcon(info.weaponId), `hud-icon hud-icon-${weaponIcon(info.weaponId)}`));
    if (info.headshot) {
      weapon.append(createIcon('headshot', 'hud-icon hud-icon-hs'));
    }
    this.deathKiller.append(label, name, weapon);
  }

  setWeapon(weaponId: WeaponId, ammo: number, reloading = false): void {
    const def = getWeapon(weaponId);
    const melee = isMelee(def);
    if (weaponId !== this.activeWeapon) {
      const first = this.activeWeapon === null;
      this.activeWeapon = weaponId;
      this.reloadStartedAtMs = null;
      for (const [id, entry] of this.slotRows) {
        entry.row.classList.toggle('is-active', id === weaponId);
      }
      if (!first) {
        this.flashWeaponSlots();
      }
    }
    if (reloading && this.reloadStartedAtMs === null) {
      this.reloadStartedAtMs = this.lastNowMs || performance.now();
      this.reloadDurationMs = def.reloadMs;
    } else if (!reloading) {
      this.reloadStartedAtMs = null;
    }

    const key = `${weaponId}|${ammo}|${reloading}|${this.knifeName}`;
    if (key === this.lastAmmoKey) {
      return;
    }
    this.lastAmmoKey = key;
    if (this.iconWeapon !== weaponId) {
      this.iconWeapon = weaponId;
      this.ammoIcon.replaceChildren(createIcon(weaponIcon(weaponId), `hud-ammo-svg hud-ammo-svg-${weaponId}`));
    }
    const view = ammoView(ammo, def.magazine, reloading, melee);
    this.ammoPanel.dataset.weapon = weaponId;
    this.ammoPanel.dataset.state = view.state;
    this.ammoPanel.classList.toggle('is-melee', view.state === 'melee');
    this.ammoPanel.classList.toggle('is-reloading', view.state === 'reloading');
    this.ammoPanel.classList.toggle('is-low', view.state === 'low' || view.state === 'empty');
    this.ammoName.textContent = weaponDisplayName(weaponId, this.knifeName);
    this.ammoCount.textContent = view.count;
    this.ammoState.textContent = view.hint;
    if (view.state === 'melee') {
      this.ammoPips.replaceChildren();
      return;
    }
    if (this.ammoPips.childElementCount !== view.magazine) {
      this.ammoPips.replaceChildren(...Array.from({ length: view.magazine }, () => document.createElement('i')));
    }
    const rounds = Number(view.count);
    Array.from(this.ammoPips.children).forEach((pip, index) => {
      pip.classList.toggle('is-spent', index >= rounds);
    });
  }

  /** shown in the ammo panel and slot strip for the knife */
  setKnifeName(name: string): void {
    this.knifeName = name || 'Knife';
    const knife = this.slotRows.get('knife');
    if (knife) {
      knife.name.textContent = this.knifeName;
    }
    this.lastAmmoKey = '';
  }

  /** briefly shows the 1/2/3 strip, called automatically on weapon change */
  flashWeaponSlots(nowMs = this.lastNowMs || performance.now()): void {
    this.slotsHideAtMs = nowMs + SLOT_VISIBLE_MS;
    this.slotStrip.classList.add('is-visible');
  }

  setPracticeGuide(visible: boolean): void {
    this.practiceGuide.hidden = !visible;
  }

  setAudioStatus(status: 'running' | 'suspended' | 'unavailable' | 'error'): void {
    this.audioStatus.className = `combat-audio-status ${status}`;
    this.audioStatus.textContent = status === 'running'
      ? 'AUDIO READY'
      : status === 'suspended'
        ? 'AUDIO NEEDS A CLICK'
        : status === 'unavailable'
          ? 'AUDIO UNAVAILABLE · VISUAL FEEDBACK ACTIVE'
          : 'AUDIO ERROR · SEE CONSOLE';
  }

  public flashHitmarker(kind: HitmarkerTrigger, nowMs = performance.now()): void {
    this.renderHitmarker(this.hitmarkerFeedback.trigger(kind, nowMs), nowMs);
  }

  /** screenshot and preview hook: pins one hitmarker state on screen, null releases it */
  public holdHitmarker(kind: HitmarkerKind | null): void {
    this.hitmarkerHeld = kind !== null;
    if (kind === null) {
      this.hideHitmarker();
      return;
    }
    this.setHitmarkerKind(kind);
    this.hitmarker.classList.remove('is-active', 'phase-a', 'phase-b');
    this.hitmarker.classList.add('is-held');
    this.hitmarker.hidden = false;
    this.hitmarker.style.opacity = '1';
    this.hitmarkerShown = true;
  }

  public flashIncomingDamage(fatal: boolean, nowMs = performance.now()): void {
    this.incomingCueExpiresAtMs = nowMs + (fatal ? 780 : 380);
    this.incomingCue.classList.remove('nonfatal', 'fatal');
    this.incomingCue.classList.add(fatal ? 'fatal' : 'nonfatal');
    flash(this.incomingCue, 'is-active', 'is-active-b');
  }

  /**
   * Arc around the crosshair pointing at the attacker. `angleRad` is
   * clockwise from straight ahead (see damageDirection); null falls back to
   * the generic edge flash.
   */
  public flashDamageDirection(angleRad: number | null, nowMs = performance.now(), durationMs = DAMAGE_ARC_MS): void {
    if (angleRad === null || !Number.isFinite(angleRad)) {
      this.flashIncomingDamage(false, nowMs);
      return;
    }
    const arc = this.damageArcs[this.nextDamageArc];
    this.nextDamageArc = (this.nextDamageArc + 1) % this.damageArcs.length;
    arc.style.transform = `rotate(${angleRad.toFixed(4)}rad)`;
    arc.style.setProperty('--damage-ms', `${Math.round(durationMs)}ms`);
    flash(arc, 'is-active', 'is-active-b');
  }

  private renderHitmarker(state: HitmarkerSnapshot, nowMs: number): void {
    if (this.hitmarkerHeld) {
      this.lastHitmarkerSequence = state.sequence;
      return;
    }
    this.setHitmarkerKind(state.kind);
    this.hitmarker.hidden = false;
    this.hitmarker.style.setProperty('--hit-chain-scale', String(1 + (state.chainCount - 1) * 0.12));
    const phaseMs = Math.max(180, state.phaseEndsAtMs - nowMs);
    this.hitmarker.style.setProperty('--hitmarker-phase-ms', `${Math.round(phaseMs)}ms`);
    // switching between two identical animations restarts it without a forced layout
    this.hitmarkerFlip = !this.hitmarkerFlip;
    this.hitmarker.classList.toggle('phase-a', this.hitmarkerFlip);
    this.hitmarker.classList.toggle('phase-b', !this.hitmarkerFlip);
    this.hitmarker.classList.add('is-active');
    this.hitmarker.style.opacity = '1';
    this.hitmarkerShown = true;
    this.lastHitmarkerSequence = state.sequence;
  }

  private setHitmarkerKind(kind: HitmarkerKind): void {
    this.hitmarker.classList.remove('normal', 'headshot', 'kill');
    this.hitmarker.classList.add(kind);
    this.hitmarkerGlyph.textContent = HITMARKER_GLYPH[kind];
    this.hitmarker.setAttribute('aria-label', HITMARKER_LABEL[kind]);
  }

  private hideHitmarker(): void {
    this.hitmarker.classList.remove('normal', 'headshot', 'kill', 'is-active', 'is-held', 'phase-a', 'phase-b');
    this.hitmarker.style.opacity = '0';
    this.hitmarker.hidden = true;
    this.hitmarkerGlyph.textContent = '';
    this.hitmarker.removeAttribute('aria-label');
    this.hitmarkerShown = false;
  }

  /** advances timers: hitmarker phases, reload bar, slot strip, death countdown */
  public update(nowMs: number): void {
    this.lastNowMs = nowMs;
    const state = this.hitmarkerFeedback.get(nowMs);
    if (state.sequence !== this.lastHitmarkerSequence) {
      this.lastHitmarkerSequence = state.sequence;
      if (state.active) {
        this.renderHitmarker(state, nowMs);
      }
    }
    if (!state.active && this.hitmarkerShown && !this.hitmarkerHeld) {
      this.hideHitmarker();
    }
    if (this.incomingCueExpiresAtMs > 0 && nowMs >= this.incomingCueExpiresAtMs) {
      this.incomingCueExpiresAtMs = 0;
      this.incomingCue.classList.remove('nonfatal', 'fatal', 'is-active', 'is-active-b');
    }
    let reloadScale = 'scaleX(0)';
    if (this.reloadStartedAtMs !== null && this.reloadDurationMs > 0) {
      const progress = Math.min(1, Math.max(0, (nowMs - this.reloadStartedAtMs) / this.reloadDurationMs));
      reloadScale = `scaleX(${progress.toFixed(3)})`;
    }
    if (reloadScale !== this.lastReloadScale) {
      this.lastReloadScale = reloadScale;
      this.reloadFill.style.transform = reloadScale;
    }
    if (this.slotsHideAtMs > 0 && nowMs >= this.slotsHideAtMs) {
      this.slotsHideAtMs = 0;
      this.slotStrip.classList.remove('is-visible');
    }
    if (this.deathBanner.style.display !== 'none') {
      this.renderDeathTimer(nowMs);
    }
  }

  public clearTransient(preserveIncoming = false): void {
    const state = this.hitmarkerFeedback.clear();
    this.lastHitmarkerSequence = state.sequence;
    if (!this.hitmarkerHeld) {
      this.hideHitmarker();
    }
    if (!preserveIncoming) {
      this.incomingCueExpiresAtMs = 0;
      this.incomingCue.classList.remove('nonfatal', 'fatal', 'is-active', 'is-active-b');
      for (const arc of this.damageArcs) {
        arc.classList.remove('is-active', 'is-active-b');
      }
    }
  }

  renderKillFeed(feed: KillFeed, nowMs: number): void {
    const entries = feed.visible(nowMs);
    // entries are immutable once added; the set only changes on add, fade or expiry
    const sig = killfeedSignature(entries, nowMs, KILLFEED_TTL_MS, KILLFEED_FADE_MS);
    if (sig === this.lastKillFeedSig) {
      return;
    }
    this.lastKillFeedSig = sig;
    // keyed update: lines already on screen stay attached so their entry
    // animation doesn't replay; new kills are always the newest, so they append
    const seen = new Map<number, number>();
    const keyed = entries.map((entry) => {
      const n = seen.get(entry.createdAtMs) ?? 0;
      seen.set(entry.createdAtMs, n + 1);
      return { entry, key: `${entry.createdAtMs}:${n}` };
    });
    const wanted = new Set(keyed.map((item) => item.key));
    const existing = new Map<string, HTMLDivElement>();
    for (const child of Array.from(this.killFeedEl.children) as HTMLDivElement[]) {
      const key = child.dataset.key ?? '';
      if (wanted.has(key)) {
        existing.set(key, child);
      } else {
        child.remove();
      }
    }
    for (const { entry, key } of keyed) {
      const view = killfeedLineView(entry, nowMs, KILLFEED_TTL_MS, KILLFEED_FADE_MS);
      let line = existing.get(key);
      if (!line) {
        line = div('combat-killfeed-line');
        line.dataset.key = key;
        line.classList.toggle('is-local', view.isLocalKill);
        line.classList.toggle('is-local-death', view.isLocalDeath);
        line.classList.toggle('is-self', view.selfKill);
        if (!view.selfKill) {
          const killer = document.createElement('span');
          killer.className = 'kf-name kf-killer';
          killer.classList.toggle('is-me', view.killerIsLocal);
          killer.textContent = view.killer;
          line.appendChild(killer);
        }
        const weapon = document.createElement('span');
        weapon.className = 'kf-weapon';
        weapon.title = view.weaponLabel;
        weapon.appendChild(createIcon(view.icon, `kf-icon kf-icon-${view.icon}`));
        if (view.headshot) {
          weapon.appendChild(createIcon('headshot', 'kf-icon kf-icon-hs'));
        }
        const victim = document.createElement('span');
        victim.className = 'kf-name kf-victim';
        victim.classList.toggle('is-me', view.victimIsLocal);
        victim.textContent = view.victim;
        line.append(weapon, victim);
        this.killFeedEl.appendChild(line);
      }
      line.classList.toggle('is-fading', view.fading);
    }
  }

  dispose(): void {
    this.hitmarkerFeedback.clear();
    this.root.remove();
  }

  private syncVisibility(): void {
    this.root.style.display = this.visible && this.hudEnabled ? 'block' : 'none';
  }

  private renderDeathTimer(nowMs: number): void {
    let text = 'Respawning soon';
    let scale = 'scaleX(0)';
    if (this.respawnAtMs !== null) {
      const remaining = Math.max(0, this.respawnAtMs - nowMs);
      const total = Math.max(1, this.respawnAtMs - this.deathShownAtMs);
      text = remaining > 50 ? `Respawning in ${(remaining / 1000).toFixed(1)}` : 'Respawning';
      scale = `scaleX(${(1 - remaining / total).toFixed(3)})`;
    }
    if (text !== this.lastDeathText) {
      this.lastDeathText = text;
      this.deathTimer.textContent = text;
    }
    this.deathBarFill.style.transform = scale;
  }
}

function div(className: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  return el;
}

/** restarts a css animation by swapping between two classes that run the same keyframes */
function flash(el: HTMLElement, a: string, b: string): void {
  if (el.classList.contains(a)) {
    el.classList.remove(a);
    el.classList.add(b);
  } else {
    el.classList.remove(b);
    el.classList.add(a);
  }
}
