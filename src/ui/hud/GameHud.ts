import type { GameSettings } from '../SettingsStore';
import { MAP_TYPE_LABEL, mapTypeFromId } from '../menu/menuInfo';
import { Crosshair } from './Crosshair';
import { ordinal, scoreSummary } from './hudFormat';
import { createIcon } from './icons';
import { NetGraph } from './NetGraph';
import { Scoreboard } from './Scoreboard';
import { ScoreboardTally, type ScoreboardPlayer } from './ScoreboardTally';
import { Speedometer } from './Speedometer';
import { TakeoffTracker, normalizeStrafeStats } from './speedometerLogic';

export interface GameHudHooks {
  /** true while pointer locked in a map, gates the Tab and F3 hotkeys */
  isActive(): boolean;
  /** F3 was pressed during play */
  onToggleMovementDebug(): void;
}

/** per-frame input from GameApp */
export interface HudFrameInput {
  nowMs: number;
  frameMs: number;
  /** horizontal speed, m/s (movement.getDebugState().speed) */
  speed: number;
  grounded: boolean;
  /** true on the frame a jump started */
  jumped: boolean;
  /**
   * movement.getStrafeStats() when it exists. Expected shape (m/s):
   * { takeoffSpeed, gain, syncPercent, jumpCount }, see normalizeStrafeStats.
   * Without it the hud tracks takeoff speed and gain itself.
   */
  strafeStats?: unknown;
  pingMs?: number | null;
}

const SCOREBOARD_REFRESH_MS = 250;

/**
 * The mode independent hud: crosshair, top bar (score summary in combat, the
 * run timer on timed maps), speedometer with strafe stats, net graph and the
 * hold-Tab scoreboard (with its client side kill tally). Combat pieces
 * (health, ammo, killfeed...) live in CombatHud.
 */
export class GameHud {
  readonly crosshair: Crosshair;
  readonly scores = new ScoreboardTally();
  private readonly layer: HTMLDivElement;
  private readonly top: HTMLDivElement;
  private readonly topKills: HTMLElement;
  private readonly topDeaths: HTMLElement;
  private readonly topPlace: HTMLElement;
  private readonly topCount: HTMLElement;
  private readonly topRival: HTMLDivElement;
  private readonly topRivalKills: HTMLElement;
  private readonly topRivalName: HTMLElement;
  private readonly runSlot: HTMLDivElement;
  private readonly speedometer: Speedometer;
  private readonly netGraph: NetGraph;
  private readonly scoreboard: Scoreboard;
  private readonly takeoff = new TakeoffTracker();
  private players: ScoreboardPlayer[] = [];
  private localId: string | null = null;
  private mapName = '';
  private mapType = '';
  private pingMs: number | null = null;
  private playing = false;
  private combat = false;
  private runTimerVisible = false;
  private hudEnabled = true;
  private speedEnabled = true;
  private netGraphEnabled = false;
  private nextScoreboardRenderAt = 0;
  private topDirty = true;
  private lastTopKey = '';

  constructor(parent: HTMLElement, private readonly hooks: GameHudHooks) {
    this.crosshair = new Crosshair(parent);
    this.layer = document.createElement('div');
    this.layer.className = 'game-hud';
    this.layer.hidden = true;

    // top centre, cs2 round bar layout: you | place or run timer | best rival
    this.top = document.createElement('div');
    this.top.className = 'hud-top';
    const you = document.createElement('div');
    you.className = 'hud-top-side is-you';
    const youScore = document.createElement('div');
    youScore.className = 'hud-top-score';
    this.topKills = document.createElement('b');
    this.topKills.className = 'hud-top-num';
    const deaths = document.createElement('span');
    deaths.className = 'hud-top-deaths';
    deaths.title = 'Deaths';
    this.topDeaths = document.createElement('span');
    deaths.append(createIcon('skull', 'hud-top-skull'), this.topDeaths);
    // the crown sits on whoever leads outright, a tie shows none
    youScore.append(createIcon('crown', 'hud-top-crown'), this.topKills, deaths);
    const youLabel = document.createElement('span');
    youLabel.className = 'hud-top-label';
    youLabel.textContent = 'You';
    you.append(youScore, youLabel);

    const mid = document.createElement('div');
    mid.className = 'hud-top-mid';
    const standing = document.createElement('div');
    standing.className = 'hud-top-standing';
    this.topPlace = document.createElement('b');
    this.topPlace.className = 'hud-top-place';
    this.topCount = document.createElement('span');
    this.topCount.className = 'hud-top-count';
    standing.append(this.topPlace, this.topCount);
    this.runSlot = document.createElement('div');
    this.runSlot.className = 'hud-top-run';
    mid.append(standing, this.runSlot);

    this.topRival = document.createElement('div');
    this.topRival.className = 'hud-top-side is-rival';
    this.topRivalKills = document.createElement('b');
    this.topRivalKills.className = 'hud-top-num';
    const rivalScore = document.createElement('div');
    rivalScore.className = 'hud-top-score';
    rivalScore.append(createIcon('crown', 'hud-top-crown'), this.topRivalKills);
    this.topRivalName = document.createElement('span');
    this.topRivalName.className = 'hud-top-label';
    this.topRival.append(rivalScore, this.topRivalName);

    this.top.append(you, mid, this.topRival);
    this.layer.appendChild(this.top);

    this.speedometer = new Speedometer(this.layer);
    this.netGraph = new NetGraph(this.layer);
    this.scoreboard = new Scoreboard(parent);
    parent.appendChild(this.layer);
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('blur', this.onBlur);
  }

  applySettings(settings: GameSettings): void {
    this.crosshair.applySettings(settings.crosshair);
    this.hudEnabled = settings.showHud;
    this.speedEnabled = settings.showSpeedometer;
    this.netGraphEnabled = settings.showNetGraph;
    this.speedometer.setStrafeStatsVisible(settings.showStrafeStats);
    this.syncVisibility();
  }

  setPlaying(playing: boolean): void {
    if (playing === this.playing) {
      return;
    }
    this.playing = playing;
    if (!playing) {
      this.scoreboard.setOpen(false);
    }
    this.syncVisibility();
  }

  /** free for all combat: score summary in the top bar and on the scoreboard */
  setCombatMode(combat: boolean): void {
    this.combat = combat;
    this.top.classList.toggle('is-combat', combat);
    this.topDirty = true;
  }

  /** GameApp's run timer and best time labels live in the middle of the top bar */
  mountRunTimer(timer: HTMLElement, info: HTMLElement): void {
    this.runSlot.append(timer, info);
  }

  setRunTimerVisible(visible: boolean): void {
    if (visible === this.runTimerVisible) {
      return;
    }
    this.runTimerVisible = visible;
    this.top.classList.toggle('has-timer', visible);
  }

  /** weapon inaccuracy in radians (cone half angle), 0 = perfectly accurate */
  setSpread(radians: number): void {
    this.crosshair.setSpread(radians);
  }

  setVerticalFov(degrees: number): void {
    this.crosshair.setVerticalFov(degrees);
  }

  setMap(mapId: string, mapName: string): void {
    this.mapName = mapName || mapId;
    this.mapType = MAP_TYPE_LABEL[mapTypeFromId(mapId)];
  }

  /** latest snapshot roster; call on every snapshot */
  setPlayers(players: readonly ScoreboardPlayer[], localId: string | null): void {
    this.players = players.map((player) => ({ id: player.id, name: player.name, alive: player.alive }));
    this.localId = localId;
    this.topDirty = true;
  }

  recordDeath(event: { killerId: string; victimId: string }): void {
    this.scores.recordDeath(event);
    this.nextScoreboardRenderAt = 0;
    this.topDirty = true;
  }

  /** new map or rejoin: scores count from zero again */
  resetScores(): void {
    this.scores.reset();
    this.takeoff.reset();
    this.nextScoreboardRenderAt = 0;
    this.topDirty = true;
  }

  /** forget the jump chain (respawn, reset to spawn) */
  resetMovement(): void {
    this.takeoff.reset();
  }

  isScoreboardOpen(): boolean {
    return this.scoreboard.isOpen();
  }

  /** opens or closes the board without the Tab key (previews, screenshots) */
  setScoreboardOpen(open: boolean): void {
    if (open) {
      this.renderScoreboard();
    }
    this.scoreboard.setOpen(open);
  }

  update(frame: HudFrameInput): void {
    this.pingMs = frame.pingMs ?? null;
    if (frame.jumped) {
      this.takeoff.onJump(frame.speed);
    } else {
      this.takeoff.update(frame.grounded, frame.frameMs / 1000);
    }
    const live = this.playing && this.hudEnabled;
    if (live && this.speedEnabled) {
      const provided = normalizeStrafeStats(frame.strafeStats);
      this.speedometer.update(frame.speed, provided ?? this.takeoff.getStats());
    }
    if (live && this.netGraphEnabled) {
      this.netGraph.update(frame.frameMs, frame.nowMs, this.pingMs);
    }
    if (live && this.combat && this.topDirty) {
      this.topDirty = false;
      this.renderTop();
    }
    if (this.scoreboard.isOpen()) {
      if (!this.hooks.isActive()) {
        this.scoreboard.setOpen(false);
      } else if (frame.nowMs >= this.nextScoreboardRenderAt) {
        this.nextScoreboardRenderAt = frame.nowMs + SCOREBOARD_REFRESH_MS;
        this.renderScoreboard();
      }
    }
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    window.removeEventListener('blur', this.onBlur);
    this.crosshair.dispose();
    this.scoreboard.root.remove();
    this.layer.remove();
  }

  private syncVisibility(): void {
    const live = this.playing && this.hudEnabled;
    this.layer.hidden = !live;
    this.speedometer.setVisible(live && this.speedEnabled);
    this.netGraph.setVisible(live && this.netGraphEnabled);
  }

  private renderTop(): void {
    const rows = this.scores.rows(this.players, this.localId, this.pingMs);
    const local = this.localId ? this.scores.getScore(this.localId) : { kills: 0, deaths: 0 };
    const summary = scoreSummary(rows, local, this.localId);
    const key = JSON.stringify(summary);
    if (key === this.lastTopKey) {
      return;
    }
    this.lastTopKey = key;
    this.topKills.textContent = String(summary.kills);
    this.topDeaths.textContent = String(summary.deaths);
    this.topPlace.textContent = ordinal(summary.place);
    this.topCount.textContent = `of ${summary.playerCount}`;
    this.top.classList.toggle('is-leading', summary.leading);
    this.topRival.hidden = summary.rival === null;
    if (summary.rival) {
      this.topRivalKills.textContent = String(summary.rival.kills);
      this.topRivalName.textContent = summary.rival.name;
      this.topRival.classList.toggle('is-ahead', summary.rival.kills > summary.kills);
    }
  }

  private renderScoreboard(): void {
    this.scoreboard.render({
      mapName: this.mapName,
      mapType: this.mapType,
      combat: this.combat,
      rows: this.scores.rows(this.players, this.localId, this.pingMs),
      localPingMs: this.pingMs,
    });
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Tab') {
      if (!this.hooks.isActive()) {
        return;
      }
      event.preventDefault();
      if (!this.scoreboard.isOpen()) {
        this.renderScoreboard();
        this.scoreboard.setOpen(true);
      }
      return;
    }
    if (event.code === 'F3' && !event.repeat && this.hooks.isActive()) {
      event.preventDefault();
      this.hooks.onToggleMovementDebug();
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === 'Tab') {
      this.scoreboard.setOpen(false);
    }
  };

  private readonly onBlur = (): void => {
    this.scoreboard.setOpen(false);
  };
}
