import type { KillFeed } from '../combat/KillFeed';
import { getWeapon, type WeaponId } from '../combat/weapons';
import {
  HitmarkerFeedback,
  type HitmarkerSnapshot,
  type HitmarkerTrigger,
} from './HitmarkerFeedback';

/**
 * DOM overlay for combat: health bar, weapon/ammo readout, a transient
 * hitmarker, a death banner, and the kill feed. Purely presentational — it is
 * driven by combat events wired in GameApp. Hidden entirely until shown.
 */
export class CombatHud {
  private readonly root: HTMLDivElement;
  private readonly healthFill: HTMLDivElement;
  private readonly healthText: HTMLSpanElement;
  private readonly ammoText: HTMLDivElement;
  private readonly practiceGuide: HTMLDivElement;
  private readonly audioStatus: HTMLSpanElement;
  private readonly hitmarker: HTMLDivElement;
  private readonly incomingCue: HTMLDivElement;
  private readonly killFeedEl: HTMLDivElement;
  private readonly deathBanner: HTMLDivElement;
  private readonly hitmarkerFeedback = new HitmarkerFeedback();
  private lastHitmarkerSequence = 0;
  private incomingCueExpiresAtMs = 0;
  private lastKillFeedSig = '';

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'combat-hud';
    this.root.style.display = 'none';

    // Health (bottom-left)
    const healthWrap = document.createElement('div');
    healthWrap.className = 'combat-health';
    this.healthFill = document.createElement('div');
    this.healthFill.className = 'combat-health-fill';
    this.healthText = document.createElement('span');
    this.healthText.className = 'combat-health-text';
    this.healthText.textContent = '100';
    healthWrap.append(this.healthFill, this.healthText);

    // Ammo (bottom-right)
    this.ammoText = document.createElement('div');
    this.ammoText.className = 'combat-ammo';
    this.ammoText.textContent = '';

    // Player-facing range drill: normal controls and real world geometry only.
    this.practiceGuide = document.createElement('div');
    this.practiceGuide.className = 'combat-practice-guide';
    this.practiceGuide.hidden = true;
    this.practiceGuide.innerHTML = [
      '<strong>FIREARM RANGE</strong>  1 AWP · 2 Deagle · 3 Knife · R reload · wheel cycles · Esc menu',
      '<span>Center bot = body · gold head = headshot · orange cover breaks LOS · tan panel / floor show impacts</span>',
    ].join('<br>');
    this.audioStatus = document.createElement('span');
    this.audioStatus.className = 'combat-audio-status starting';
    this.audioStatus.textContent = 'AUDIO STARTING';
    this.practiceGuide.append(document.createElement('br'), this.audioStatus);

    // Hitmarker (center)
    this.hitmarker = document.createElement('div');
    this.hitmarker.className = 'combat-hitmarker';
    this.hitmarker.hidden = true;
    this.hitmarker.setAttribute('role', 'status');
    this.hitmarker.setAttribute('aria-live', 'polite');
    this.hitmarker.setAttribute('aria-atomic', 'true');
    this.hitmarker.style.opacity = '0';

    this.incomingCue = document.createElement('div');
    this.incomingCue.className = 'combat-incoming-cue';

    // Kill feed (top-right)
    this.killFeedEl = document.createElement('div');
    this.killFeedEl.className = 'combat-killfeed';

    // Death banner (center)
    this.deathBanner = document.createElement('div');
    this.deathBanner.className = 'combat-death';
    this.deathBanner.style.display = 'none';
    this.deathBanner.textContent = 'You died — respawning…';

    this.root.append(
      healthWrap,
      this.ammoText,
      this.practiceGuide,
      this.incomingCue,
      this.hitmarker,
      this.killFeedEl,
      this.deathBanner,
    );
    parent.appendChild(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'block' : 'none';
  }

  setHealth(health: number, alive: boolean, showDeath = !alive): void {
    const clamped = Math.max(0, Math.min(100, Math.round(health)));
    this.healthFill.style.width = `${clamped}%`;
    this.healthText.textContent = String(clamped);
    this.healthFill.classList.toggle('low', clamped <= 25);
    this.deathBanner.style.display = !alive && showDeath ? 'block' : 'none';
  }

  setDeathVisible(visible: boolean): void {
    this.deathBanner.style.display = visible ? 'block' : 'none';
  }

  setWeapon(weaponId: WeaponId, ammo: number, reloading = false): void {
    const def = getWeapon(weaponId);
    const ammoStr = Number.isFinite(ammo) ? String(ammo) : '∞';
    this.ammoText.textContent = `${def.name}  ${ammoStr}${reloading ? ' · RELOADING' : ''}`;
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
    // Force the short keyframe to restart even if multiple hit events land in one frame.
    void this.hitmarker.offsetWidth;
    this.hitmarker.classList.add('is-active');
    this.hitmarker.style.opacity = '1';
    this.lastHitmarkerSequence = state.sequence;
  }

  /** Re-renders the kill feed from the pure model. Cheap no-op when unchanged. */
  public update(nowMs: number): void {
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
    }
  }

  renderKillFeed(feed: KillFeed, nowMs: number): void {
    const entries = feed.visible(nowMs);
    // Entries are immutable once added; the visible set only changes when one is
    // added or expires. Signature by creation time makes both cases cheap to detect.
    const sig = entries.map((e) => e.createdAtMs).join(',');
    if (sig === this.lastKillFeedSig) {
      return;
    }
    this.lastKillFeedSig = sig;
    this.killFeedEl.replaceChildren();
    for (const e of entries) {
      const line = document.createElement('div');
      line.className = 'combat-killfeed-line';
      const weapon = getWeapon(e.weaponId as WeaponId);
      const hs = e.headshot ? ' ⌖' : '';
      line.textContent = `${e.killer}  ›${weapon?.name ?? e.weaponId}${hs}›  ${e.victim}`;
      this.killFeedEl.appendChild(line);
    }
  }

  dispose(): void {
    this.hitmarkerFeedback.clear();
    this.root.remove();
  }
}
