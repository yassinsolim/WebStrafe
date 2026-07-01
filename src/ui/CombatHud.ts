import type { KillFeed } from '../combat/KillFeed';
import { getWeapon, type WeaponId } from '../combat/weapons';

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
  private readonly hitmarker: HTMLDivElement;
  private readonly killFeedEl: HTMLDivElement;
  private readonly deathBanner: HTMLDivElement;
  private hitmarkerTimer: number | null = null;
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

    // Hitmarker (center)
    this.hitmarker = document.createElement('div');
    this.hitmarker.className = 'combat-hitmarker';
    this.hitmarker.textContent = '✕';
    this.hitmarker.style.opacity = '0';

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
      this.hitmarker,
      this.killFeedEl,
      this.deathBanner,
    );
    parent.appendChild(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'block' : 'none';
  }

  setHealth(health: number, alive: boolean): void {
    const clamped = Math.max(0, Math.min(100, Math.round(health)));
    this.healthFill.style.width = `${clamped}%`;
    this.healthText.textContent = String(clamped);
    this.healthFill.classList.toggle('low', clamped <= 25);
    this.deathBanner.style.display = alive ? 'none' : 'block';
  }

  setWeapon(weaponId: WeaponId, ammo: number): void {
    const def = getWeapon(weaponId);
    const ammoStr = Number.isFinite(ammo) ? String(ammo) : '∞';
    this.ammoText.textContent = `${def.name}  ${ammoStr}`;
  }

  flashHitmarker(headshot: boolean): void {
    this.hitmarker.classList.toggle('headshot', headshot);
    this.hitmarker.style.opacity = '1';
    if (this.hitmarkerTimer !== null) {
      window.clearTimeout(this.hitmarkerTimer);
    }
    this.hitmarkerTimer = window.setTimeout(() => {
      this.hitmarker.style.opacity = '0';
      this.hitmarkerTimer = null;
    }, 120);
  }

  /** Re-renders the kill feed from the pure model. Cheap no-op when unchanged. */
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
    if (this.hitmarkerTimer !== null) {
      window.clearTimeout(this.hitmarkerTimer);
    }
    this.root.remove();
  }
}
