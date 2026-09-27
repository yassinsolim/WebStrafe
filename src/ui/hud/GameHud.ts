import type { GameSettings } from '../SettingsStore';
import { MAP_TYPE_LABEL, mapTypeFromId } from '../menu/menuInfo';
import { Crosshair } from './Crosshair';
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
 * The mode independent hud: crosshair, speedometer with strafe stats, net
 * graph and the hold-Tab scoreboard (with its client side kill tally).
 * Combat pieces (health, ammo, killfeed...) live in CombatHud.
 */
export class GameHud {
  readonly crosshair: Crosshair;
  readonly scores = new ScoreboardTally();
  private readonly layer: HTMLDivElement;
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
  private hudEnabled = true;
  private speedEnabled = true;
  private netGraphEnabled = false;
  private nextScoreboardRenderAt = 0;

  constructor(parent: HTMLElement, private readonly hooks: GameHudHooks) {
    this.crosshair = new Crosshair(parent);
    this.layer = document.createElement('div');
    this.layer.className = 'game-hud';
    this.layer.hidden = true;
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
  }

  recordDeath(event: { killerId: string; victimId: string }): void {
    this.scores.recordDeath(event);
    this.nextScoreboardRenderAt = 0;
  }

  /** new map or rejoin: scores count from zero again */
  resetScores(): void {
    this.scores.reset();
    this.takeoff.reset();
    this.nextScoreboardRenderAt = 0;
  }

  /** forget the jump chain (respawn, reset to spawn) */
  resetMovement(): void {
    this.takeoff.reset();
  }

  isScoreboardOpen(): boolean {
    return this.scoreboard.isOpen();
  }

  update(frame: HudFrameInput): void {
    this.pingMs = frame.pingMs ?? null;
    if (frame.jumped) {
      this.takeoff.onJump(frame.speed);
    } else {
      this.takeoff.update(frame.grounded, frame.frameMs / 1000);
    }
    if (this.playing && this.hudEnabled && this.speedEnabled) {
      const provided = normalizeStrafeStats(frame.strafeStats);
      this.speedometer.update(frame.speed, provided ?? this.takeoff.getStats());
    }
    if (this.playing && this.hudEnabled && this.netGraphEnabled) {
      this.netGraph.update(frame.frameMs, frame.nowMs, this.pingMs);
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

  private renderScoreboard(): void {
    this.scoreboard.render({
      mapName: this.mapName,
      mapType: this.mapType,
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
