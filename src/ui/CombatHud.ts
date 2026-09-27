import type { KillFeed } from '../combat/KillFeed';
import { getWeapon, isMelee, type WeaponId } from '../combat/weapons';
import {
  HitmarkerFeedback,
  type HitmarkerSnapshot,
  type HitmarkerTrigger,
} from './HitmarkerFeedback';
import { createIcon, weaponIcon } from './hud/icons';
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

/**
 * DOM overlay for combat: health, ammo with reload progress, the weapon slot
 * strip, hitmarker, directional damage, low health vignette, death banner and
 * the kill feed. Purely presentational, driven by combat events wired in
 * GameApp. Class names the browser verifier reads (.combat-ammo,
 * .combat-health-text, .combat-hitmarker, .combat-incoming-cue, .combat-death,
 * .combat-audio-status) are kept.
 */
export class CombatHud {
  private readonly root: HTMLDivElement;
  private readonly healthPanel: HTMLDivElement;
  private readonly healthFill: HTMLDivElement;
  private readonly healthText: HTMLSpanElement;
  private readonly ammoPanel: HTMLDivElement;
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
  private incomingCueExpiresAtMs = 0;
  private lastKillFeedSig = '';
  private visible = false;
  private hudEnabled = true;
  private knifeName = 'Knife';
  private activeWeapon: WeaponId | null = null;
  private lastAmmoKey = '';
  private reloadStartedAtMs: number | null = null;
  private reloadDurationMs = 0;
  private slotsHideAtMs = 0;
  private nextDamageArc = 0;
  private respawnAtMs: number | null = null;
  private deathShownAtMs = 0;
  private lastNowMs = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'combat-hud';
    this.root.style.display = 'none';

    // low health vignette and incoming flash sit under everything else
    this.lowHealth = document.createElement('div');
    this.lowHealth.className = 'hud-lowhealth';
    this.incomingCue = document.createElement('div');
    this.incomingCue.className = 'combat-incoming-cue';

    // health, bottom left
    this.healthPanel = document.createElement('div');
    this.healthPanel.className = 'combat-health hud-panel';
    const healthIcon = createIcon('health', 'hud-health-icon');
    this.healthText = document.createElement('span');
    this.healthText.className = 'combat-health-text';
    this.healthText.textContent = '100';
    const healthBar = document.createElement('div');
    healthBar.className = 'hud-health-bar';
    this.healthFill = document.createElement('div');
    this.healthFill.className = 'combat-health-fill';
    healthBar.appendChild(this.healthFill);
    this.healthPanel.append(healthIcon, this.healthText, healthBar);

    // ammo, bottom right
    this.ammoPanel = document.createElement('div');
    this.ammoPanel.className = 'combat-ammo hud-panel';
    const ammoTop = document.createElement('div');
    ammoTop.className = 'hud-ammo-top';
    this.ammoCount = document.createElement('span');
    this.ammoCount.className = 'hud-ammo-count';
    const ammoMeta = document.createElement('div');
    ammoMeta.className = 'hud-ammo-meta';
    this.ammoName = document.createElement('span');
    this.ammoName.className = 'hud-ammo-name';
    this.ammoState = document.createElement('span');
    this.ammoState.className = 'hud-ammo-state';
    ammoMeta.append(this.ammoName, this.ammoState);
    ammoTop.append(this.ammoCount, ammoMeta);
    this.ammoPips = document.createElement('div');
    this.ammoPips.className = 'hud-ammo-pips';
    const reloadBar = document.createElement('div');
    reloadBar.className = 'hud-reload-bar';
    this.reloadFill = document.createElement('div');
    reloadBar.appendChild(this.reloadFill);
    this.ammoPanel.append(ammoTop, this.ammoPips, reloadBar);

    // weapon slot strip, above the ammo
    this.slotStrip = document.createElement('div');
    this.slotStrip.className = 'hud-slots';
    SLOT_ORDER.forEach((id, index) => {
      const row = document.createElement('div');
      row.className = 'hud-slot';
      const key = document.createElement('span');
      key.className = 'hud-slot-key';
      key.textContent = String(index + 1);
      const name = document.createElement('span');
      name.className = 'hud-slot-name';
      name.textContent = weaponDisplayName(id, this.knifeName);
      row.append(key, name, createIcon(weaponIcon(id), 'hud-slot-icon'));
      this.slotStrip.appendChild(row);
      this.slotRows.set(id, { row, name });
    });

    // player-facing range drill: normal controls and real world geometry only
    this.practiceGuide = document.createElement('div');
    this.practiceGuide.className = 'combat-practice-guide';
    this.practiceGuide.hidden = true;
    this.practiceGuide.innerHTML = [
      '<strong>FIREARM RANGE</strong>  1 AWP · 2 Deagle · 3 Knife · R reload · wheel cycles · Tab scores · Esc menu',
      '<span>Center bot = body · gold head = headshot · orange cover breaks LOS · tan panel / floor show impacts</span>',
    ].join('<br>');
    this.audioStatus = document.createElement('span');
    this.audioStatus.className = 'combat-audio-status starting';
    this.audioStatus.textContent = 'AUDIO STARTING';
    this.practiceGuide.append(document.createElement('br'), this.audioStatus);

    // hitmarker and damage direction, centre
    this.hitmarker = document.createElement('div');
    this.hitmarker.className = 'combat-hitmarker';
    this.hitmarker.hidden = true;
    this.hitmarker.setAttribute('role', 'status');
    this.hitmarker.setAttribute('aria-live', 'polite');
    this.hitmarker.setAttribute('aria-atomic', 'true');
    this.hitmarker.style.opacity = '0';
    const damageLayer = document.createElement('div');
    damageLayer.className = 'hud-damage';
    for (let i = 0; i < DAMAGE_ARC_COUNT; i += 1) {
      const arc = document.createElement('div');
      arc.className = 'hud-damage-arc';
      arc.appendChild(document.createElement('i'));
      this.damageArcs.push(arc);
      damageLayer.appendChild(arc);
    }

    // kill feed, top right
    this.killFeedEl = document.createElement('div');
    this.killFeedEl.className = 'combat-killfeed';

    // death banner, centre
    this.deathBanner = document.createElement('div');
    this.deathBanner.className = 'combat-death';
    this.deathBanner.style.display = 'none';
    const deathTitle = document.createElement('div');
    deathTitle.className = 'hud-death-title';
    deathTitle.textContent = 'You died';
    this.deathKiller = document.createElement('div');
    this.deathKiller.className = 'hud-death-killer';
    this.deathTimer = document.createElement('div');
    this.deathTimer.className = 'hud-death-timer';
    this.deathTimer.textContent = 'Respawning soon';
    const deathBar = document.createElement('div');
    deathBar.className = 'hud-death-bar';
    this.deathBarFill = document.createElement('div');
    deathBar.appendChild(this.deathBarFill);
    this.deathBanner.append(deathTitle, this.deathKiller, this.deathTimer, deathBar);

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
    this.healthFill.style.width = `${clamped}%`;
    this.healthText.textContent = String(clamped);
    this.healthFill.classList.toggle('low', clamped <= 25);
    this.healthPanel.classList.toggle('is-low', clamped <= 25);
    const intensity = alive ? lowHealthIntensity(clamped) : 0;
    this.lowHealth.style.opacity = intensity.toFixed(3);
    this.lowHealth.classList.toggle('is-critical', alive && clamped <= 20);
    if (alive) {
      this.respawnAtMs = null;
    }
    this.setDeathVisible(!alive && showDeath);
  }

  setDeathVisible(visible: boolean): void {
    const wasVisible = this.deathBanner.style.display !== 'none';
    this.deathBanner.style.display = visible ? 'block' : 'none';
    if (visible && !wasVisible) {
      this.deathShownAtMs = this.lastNowMs || performance.now();
      this.renderDeathTimer(this.deathShownAtMs);
    }
  }

  /** who killed the local player; call from the death event */
  setDeathInfo(info: DeathInfo | null, respawnAtMs: number | null = null): void {
    this.respawnAtMs = respawnAtMs;
    this.deathKiller.replaceChildren();
    if (!info) {
      return;
    }
    if (info.bySelf) {
      this.deathKiller.textContent = 'You took yourself out';
      return;
    }
    const label = document.createElement('span');
    label.textContent = 'Killed by';
    const name = document.createElement('b');
    name.textContent = info.killerName;
    const weapon = document.createElement('span');
    weapon.className = 'hud-death-weapon';
    weapon.append(createIcon(weaponIcon(info.weaponId), 'hud-icon'));
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
    this.ammoPanel.dataset.weapon = weaponId;
    this.ammoPanel.classList.toggle('is-melee', melee);
    this.ammoPanel.classList.toggle('is-reloading', reloading);
    this.ammoName.textContent = weaponDisplayName(weaponId, this.knifeName);
    if (melee || !Number.isFinite(ammo)) {
      this.ammoCount.textContent = '';
      this.ammoState.textContent = '';
      this.ammoPips.replaceChildren();
      return;
    }
    this.ammoCount.textContent = String(ammo);
    const low = ammo <= Math.max(1, Math.floor(def.magazine * 0.3));
    this.ammoPanel.classList.toggle('is-low', low);
    this.ammoState.textContent = reloading ? 'Reloading' : ammo === 0 ? 'Empty, press R' : `/ ${def.magazine}`;
    if (this.ammoPips.childElementCount !== def.magazine) {
      this.ammoPips.replaceChildren(...Array.from({ length: def.magazine }, () => document.createElement('i')));
    }
    Array.from(this.ammoPips.children).forEach((pip, index) => {
      pip.classList.toggle('is-spent', index >= ammo);
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
        ? 'AUDIO NEEDS GESTURE'
        : status === 'unavailable'
          ? 'AUDIO UNAVAILABLE · VISUAL FEEDBACK ACTIVE'
          : 'AUDIO ERROR · SEE CONSOLE';
  }

  public flashHitmarker(kind: HitmarkerTrigger, nowMs = performance.now()): void {
    this.renderHitmarker(this.hitmarkerFeedback.trigger(kind, nowMs), nowMs);
  }

  public flashIncomingDamage(fatal: boolean, nowMs = performance.now()): void {
    this.incomingCueExpiresAtMs = nowMs + (fatal ? 780 : 380);
    this.incomingCue.classList.remove('nonfatal', 'fatal', 'is-active');
    this.incomingCue.classList.add(fatal ? 'fatal' : 'nonfatal');
    void this.incomingCue.offsetWidth;
    this.incomingCue.classList.add('is-active');
  }

  /**
   * Arc around the crosshair pointing at the attacker. `angleRad` is
   * clockwise from straight ahead (see damageDirection); null falls back to
   * the generic edge flash.
   */
  public flashDamageDirection(angleRad: number | null, nowMs = performance.now()): void {
    if (angleRad === null || !Number.isFinite(angleRad)) {
      this.flashIncomingDamage(false, nowMs);
      return;
    }
    const arc = this.damageArcs[this.nextDamageArc];
    this.nextDamageArc = (this.nextDamageArc + 1) % this.damageArcs.length;
    arc.style.transform = `rotate(${angleRad}rad)`;
    arc.style.setProperty('--damage-ms', `${DAMAGE_ARC_MS}ms`);
    arc.classList.remove('is-active');
    void arc.offsetWidth;
    arc.classList.add('is-active');
  }

  private renderHitmarker(state: HitmarkerSnapshot, nowMs: number): void {
    const kind = state.kind;
    this.hitmarker.classList.remove('normal', 'headshot', 'kill', 'is-active');
    this.hitmarker.classList.add(kind);
    this.hitmarker.hidden = false;
    this.hitmarker.textContent = kind === 'kill' ? '✦' : kind === 'headshot' ? '◆' : '✕';
    this.hitmarker.setAttribute(
      'aria-label',
      kind === 'kill' ? 'Kill confirmed' : kind === 'headshot' ? 'Headshot' : 'Body hit',
    );
    this.hitmarker.style.setProperty('--hit-chain-scale', String(1 + (state.chainCount - 1) * 0.12));
    const phaseMs = Math.max(180, state.phaseEndsAtMs - nowMs);
    this.hitmarker.style.setProperty('--hitmarker-phase-ms', `${Math.round(phaseMs)}ms`);
    // force the short keyframe to restart even if multiple hit events land in one frame
    void this.hitmarker.offsetWidth;
    this.hitmarker.classList.add('is-active');
    this.hitmarker.style.opacity = '1';
    this.lastHitmarkerSequence = state.sequence;
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
    if (!state.active) {
      this.hitmarker.classList.remove('is-active');
      this.hitmarker.style.opacity = '0';
      this.hitmarker.hidden = true;
      this.hitmarker.textContent = '';
      this.hitmarker.removeAttribute('aria-label');
    }
    if (this.incomingCueExpiresAtMs > 0 && nowMs >= this.incomingCueExpiresAtMs) {
      this.incomingCueExpiresAtMs = 0;
      this.incomingCue.classList.remove('nonfatal', 'fatal', 'is-active');
    }
    if (this.reloadStartedAtMs !== null && this.reloadDurationMs > 0) {
      const progress = Math.min(1, Math.max(0, (nowMs - this.reloadStartedAtMs) / this.reloadDurationMs));
      this.reloadFill.style.transform = `scaleX(${progress.toFixed(3)})`;
    } else {
      this.reloadFill.style.transform = 'scaleX(0)';
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
    this.hitmarker.classList.remove('normal', 'headshot', 'kill', 'is-active');
    this.hitmarker.style.opacity = '0';
    this.hitmarker.hidden = true;
    this.hitmarker.textContent = '';
    this.hitmarker.removeAttribute('aria-label');
    if (!preserveIncoming) {
      this.incomingCueExpiresAtMs = 0;
      this.incomingCue.classList.remove('nonfatal', 'fatal', 'is-active');
      for (const arc of this.damageArcs) {
        arc.classList.remove('is-active');
      }
    }
  }

  renderKillFeed(feed: KillFeed, nowMs: number): void {
    const entries = feed.visible(nowMs);
    // entries are immutable once added; the set only changes on add, fade or expiry
    const sig = entries
      .map((e) => `${e.createdAtMs}${nowMs - e.createdAtMs > KILLFEED_TTL_MS - KILLFEED_FADE_MS ? 'f' : ''}`)
      .join(',');
    if (sig === this.lastKillFeedSig) {
      return;
    }
    this.lastKillFeedSig = sig;
    this.killFeedEl.replaceChildren();
    for (const e of entries) {
      const line = document.createElement('div');
      line.className = 'combat-killfeed-line';
      line.classList.toggle('is-local', e.killerIsLocal === true);
      line.classList.toggle('is-local-death', e.victimIsLocal === true && e.killerIsLocal !== true);
      line.classList.toggle('is-fading', nowMs - e.createdAtMs > KILLFEED_TTL_MS - KILLFEED_FADE_MS);
      const killer = document.createElement('span');
      killer.className = 'kf-name kf-killer';
      killer.textContent = e.killer;
      const weapon = document.createElement('span');
      weapon.className = 'kf-weapon';
      weapon.title = weaponDisplayName(e.weaponId);
      weapon.appendChild(createIcon(weaponIcon(e.weaponId), `kf-icon kf-icon-${weaponIcon(e.weaponId)}`));
      if (e.headshot) {
        weapon.appendChild(createIcon('headshot', 'kf-icon kf-icon-hs'));
      }
      const victim = document.createElement('span');
      victim.className = 'kf-name kf-victim';
      victim.textContent = e.victim;
      line.append(killer, weapon, victim);
      this.killFeedEl.appendChild(line);
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
    if (this.respawnAtMs === null) {
      this.deathTimer.textContent = 'Respawning soon';
      this.deathBarFill.style.transform = 'scaleX(0)';
      return;
    }
    const remaining = Math.max(0, this.respawnAtMs - nowMs);
    const total = Math.max(1, this.respawnAtMs - this.deathShownAtMs);
    this.deathTimer.textContent = remaining > 50 ? `Respawning in ${(remaining / 1000).toFixed(1)}` : 'Respawning';
    this.deathBarFill.style.transform = `scaleX(${(1 - remaining / total).toFixed(3)})`;
  }
}
