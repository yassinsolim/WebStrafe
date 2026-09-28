import type { Camera, Object3D, Vector3 } from 'three';
import type { LoadedMap } from '../world/types';
import type { MultiplayerSnapshotPlayer, PlayerModel } from '../network/types';
import { formatRunTime } from '../ui/hud/hudMath';
import { RunTimerHud } from '../ui/surf/RunTimerHud';
import { PvpBadge } from '../ui/surf/PvpBadge';
import { Nameplates, type NameplateInfo } from '../ui/surf/Nameplates';
import { LiveRoomBoard, type MapTimeRow } from '../ui/surf/LiveRoomBoard';
import { GhostRecorder, decodeGhost, encodeGhost, type Ghost } from './ghost';
import { GhostRunner } from './GhostRunner';
import { RunTimer, ticksToMs, type FinishedRun, type RunSplit } from './RunTimer';
import { loadPersonalBest, savePersonalBestIfFaster, type PersonalBest } from './personalBests';
import { splitDeltaMs } from './splits';
import { botsFor, checkpointStages, hasTimedZones, mapModes, pvpRuleFor, type MapMode, type PvpRule } from './mapModes';
import type { RunBoardRow, SurfBoards } from './SurfBoards';

/** can't flip pvp faster than this, so nobody dodges a fight by toggling mid duel */
export const PVP_TOGGLE_COOLDOWN_MS = 3000;
/** kill totals go to the server at most this often (the server allows one per 8 s) */
const KILL_REPORT_MS = 30_000;
const TIMES_REFRESH_MS = 30_000;
const PVP_KEY = 'webstrafe.surf.pvp.v1';

export interface RoomScoreRow {
  id: string;
  kills: number;
  deaths: number;
}

export interface SurfSessionDeps {
  container: HTMLElement;
  worldScene: Object3D;
  boards: SurfBoards;
  localName: () => string;
  localModel: () => PlayerModel;
  localId: () => string | null;
  /** tell the transport, returns false when it has no pvp support */
  setTransportPvp: (on: boolean) => void;
  showStatus: (text: string, ms?: number) => void;
}

export interface SubmitOutcome {
  /** false: the caller should use the legacy leaderboard instead */
  handled: boolean;
  ok: boolean;
  text: string;
}

/**
 * everything surf on top of the game loop: the tick timer and splits, pbs and
 * the record, ghosts, the pvp opt-in, nameplates and the live boards.
 * GameApp calls into it from the fixed tick, the trigger events, snapshots and
 * the render frame.
 */
export class SurfSession {
  private readonly timerHud: RunTimerHud;
  private readonly badge: PvpBadge;
  private readonly plates: Nameplates;
  private readonly roomBoard: LiveRoomBoard;
  private readonly ghostRunner: GhostRunner;
  private readonly recorder = new GhostRecorder();

  private mapId: string | null = null;
  private modes: MapMode[] = [];
  private stages: number[] = [];
  private timer: RunTimer | null = null;
  private pb: PersonalBest | null = null;
  private record: { name: string; timeMs: number } | null = null;
  private topTimes: RunBoardRow[] = [];
  private topTimesAt = 0;
  private ghostSource: 'pb' | 'record' | null = null;
  private ghostEnabled = true;
  private runToken: Promise<string | null> | null = null;
  private lastFinished: { run: FinishedRun; ghost: Ghost; token: Promise<string | null> | null } | null = null;

  private rule: PvpRule = { defaultOn: true, toggleable: false };
  private pvpOn = true;
  private lastPvpToggleAt = -Infinity;

  private roster = new Map<string, NameplateInfo>();
  private scores: RoomScoreRow[] = [];
  private killSession: { id: Promise<string | null>; mapId: string; sent: string; at: number } | null = null;
  private loadSeq = 0;

  constructor(private readonly deps: SurfSessionDeps) {
    this.timerHud = new RunTimerHud(deps.container);
    this.badge = new PvpBadge(deps.container);
    this.plates = new Nameplates(deps.container);
    this.roomBoard = new LiveRoomBoard(deps.container);
    this.ghostRunner = new GhostRunner(deps.worldScene);
  }

  dispose(): void {
    this.timerHud.root.remove();
    this.badge.root.remove();
    this.plates.root.remove();
    this.roomBoard.dispose();
    this.ghostRunner.dispose();
  }

  // ---------------------------------------------------------------- map

  /** returns the host bot count for this map */
  mapActivated(map: LoadedMap): number {
    const seq = ++this.loadSeq;
    this.mapId = map.entry.id;
    this.modes = mapModes({ id: map.entry.id, modes: (map.meta as { modes?: unknown }).modes });
    this.stages = checkpointStages(map.meta.triggers);
    this.timer = hasTimedZones(map.meta.triggers) ? new RunTimer(this.stages) : null;
    this.pb = this.timer ? loadPersonalBest(map.entry.id) : null;
    this.record = null;
    this.topTimes = [];
    this.topTimesAt = 0;
    this.runToken = null;
    this.lastFinished = null;
    this.scores = [];
    this.roster.clear();
    this.plates.clear();
    this.useGhost(this.pb?.ghost ? decodeGhost(this.pb.ghost) : null, this.pb?.ghost ? 'pb' : null);

    this.rule = pvpRuleFor(this.modes);
    this.pvpOn = this.rule.toggleable ? loadPvpChoice(this.rule.defaultOn) : this.rule.defaultOn;
    this.deps.setTransportPvp(this.pvpOn);
    this.lastPvpToggleAt = -Infinity;

    if (this.timer) void this.loadBoards(map.entry.id, seq);
    return botsFor(this.modes);
  }

  get isTimed(): boolean {
    return this.timer !== null;
  }

  get stageCount(): number {
    return this.stages.length + 1;
  }

  get pvp(): boolean {
    return this.pvpOn;
  }

  private async loadBoards(mapId: string, seq: number): Promise<void> {
    const rows = await this.deps.boards.fetchMapBoard(mapId, 10);
    if (seq !== this.loadSeq) return;
    this.topTimes = rows;
    this.topTimesAt = performance.now();
    this.record = rows[0] ? { name: rows[0].name, timeMs: rows[0].timeMs } : null;
    // race the record when it's faster than our own pb and kept its ghost
    if (rows[0]?.hasGhost && (!this.pb || rows[0].timeMs < ticksToMs(this.pb.ticks))) {
      const wr = await this.deps.boards.fetchRecordGhost(mapId);
      if (seq !== this.loadSeq || !wr) return;
      const ghost = decodeGhost(wr.ghost);
      if (ghost) this.useGhost(ghost, 'record');
    }
  }

  private useGhost(ghost: Ghost | null, source: 'pb' | 'record' | null): void {
    this.ghostSource = ghost ? source : null;
    this.ghostRunner.setGhost(ghost, source === 'record' ? 0xffcf5a : 0x46d5ff);
  }

  // ---------------------------------------------------------------- pvp

  /** P: flips pvp on maps that allow it, returns the status line to show */
  togglePvp(nowMs: number): string {
    if (!this.rule.toggleable) return 'This is a combat map, PvP is always on';
    const wait = this.lastPvpToggleAt + PVP_TOGGLE_COOLDOWN_MS - nowMs;
    if (wait > 0) return `PvP toggle ready in ${Math.ceil(wait / 1000)}s`;
    this.lastPvpToggleAt = nowMs;
    this.pvpOn = !this.pvpOn;
    savePvpChoice(this.pvpOn);
    this.deps.setTransportPvp(this.pvpOn);
    return this.pvpOn
      ? 'PvP on: you can shoot and be shot by other PvP players'
      : 'Peaceful: you can\'t hit anyone and no one can hit you';
  }

  toggleGhost(): string {
    this.ghostEnabled = !this.ghostEnabled;
    if (!this.ghostRunner.hasGhost()) return 'No ghost for this map yet';
    return this.ghostEnabled ? `Ghost on (${this.ghostSource === 'record' ? 'record' : 'your pb'})` : 'Ghost off';
  }

  // ---------------------------------------------------------------- timer

  /**
   * once per fixed tick after movement. returns true on the tick the player
   * leaves the start zone so the caller can cap prespeed.
   */
  tick(inStartZone: boolean, feet: Vector3, yawRad: number): boolean {
    if (!this.timer) return false;
    const left = this.timer.step(inStartZone, this.pvpOn);
    if (left) {
      this.recorder.reset();
      this.runToken = this.mapId ? this.deps.boards.startRun(this.mapId) : null;
    }
    if (this.timer.phase === 'running') {
      this.recorder.sample(feet.x, feet.y, feet.z, yawRad);
    }
    return left;
  }

  checkpoint(stage: number, nowMs: number): RunSplit | null {
    const split = this.timer?.checkpoint(stage) ?? null;
    if (split) {
      const index = this.timer!.splits.length;
      this.timerHud.flashSplit(`Stage ${index + 1}`, ticksToMs(split.ticks), splitDeltaMs(split, this.pb?.splits ?? null), nowMs);
    }
    return split;
  }

  /** finish zone: stops the timer, saves a local pb and keeps the run for submitting */
  finish(nowMs: number): FinishedRun | null {
    const run = this.timer?.finish() ?? null;
    if (!run || !this.mapId) return null;
    const ghost = this.recorder.take();
    this.lastFinished = { run, ghost, token: this.runToken };
    this.runToken = null;
    const previous = this.pb;
    const isPb = savePersonalBestIfFaster(this.mapId, {
      ticks: run.ticks,
      splits: run.splits,
      ghost: encodeGhost(ghost),
      at: Date.now(),
      ranked: run.ranked,
    });
    if (isPb) {
      this.pb = loadPersonalBest(this.mapId);
      if (this.ghostSource !== 'record' || (this.record && run.timeMs < this.record.timeMs)) {
        this.useGhost(ghost, 'pb');
      }
    }
    const delta = previous ? run.timeMs - ticksToMs(previous.ticks) : null;
    this.timerHud.flashSplit(isPb ? 'New PB' : 'Finish', run.timeMs, delta, nowMs);
    return run;
  }

  /** restart, death, map change: the run is gone */
  cancelRun(): void {
    this.timer?.cancel();
    this.runToken = null;
  }

  elapsedMs(): number {
    return this.timer?.elapsedMs() ?? 0;
  }

  // ---------------------------------------------------------------- submit

  describeFinish(): string {
    const f = this.lastFinished?.run;
    if (!f) return '';
    const base = `Finished in ${formatRunTime(f.timeMs)}`;
    if (!f.ranked) return `${base} (unranked: ${f.unrankedReason})`;
    return this.pb && this.pb.ticks === f.ticks ? `${base}, new personal best` : base;
  }

  async submit(name: string, model: PlayerModel): Promise<SubmitOutcome> {
    const done = this.lastFinished;
    if (!done || !this.timer) return { handled: false, ok: false, text: '' };
    if (!this.deps.boards.available) return { handled: false, ok: false, text: '' };
    if (!done.run.ranked) {
      return { handled: true, ok: false, text: `Saved as a PB only, not ranked: ${done.run.unrankedReason}` };
    }
    const token = done.token ? await done.token : null;
    if (!this.deps.boards.available) return { handled: false, ok: false, text: '' };
    if (!token) return { handled: true, ok: false, text: 'Could not reach the leaderboard for this run' };
    const res = await this.deps.boards.submitRun({
      token,
      name,
      model,
      ticks: done.run.ticks,
      splits: done.run.splits.map((s) => s.ticks),
      pvp: done.run.pvp,
      ghost: encodeGhost(done.ghost),
    });
    if (!res) return { handled: true, ok: false, text: 'Leaderboard unavailable right now' };
    if (!res.ok) return { handled: true, ok: false, text: `Not ranked: ${res.reason ?? 'rejected'}` };
    this.lastFinished = null;
    if (this.mapId) void this.loadBoards(this.mapId, this.loadSeq);
    return {
      handled: true,
      ok: true,
      text: res.personalBest ? `Ranked #${res.rank ?? '?'}, new personal best` : `Ranked #${res.rank ?? '?'}`,
    };
  }

  // ---------------------------------------------------------------- multiplayer

  onSnapshot(players: readonly MultiplayerSnapshotPlayer[]): void {
    this.roster.clear();
    for (const p of players) {
      this.roster.set(p.id, { name: p.name, pvp: p.pvp, isBot: p.id.startsWith('bot:') });
    }
  }

  onScoreboard(rows: readonly RoomScoreRow[]): void {
    this.scores = rows.map((r) => ({ ...r }));
    this.maybeReportKills(performance.now());
  }

  /** who can be backstabbed or predicted: only pvp players, and only while we're pvp too */
  canFight(playerId: string): boolean {
    if (!this.pvpOn) return false;
    if (playerId.startsWith('bot:')) return true;
    return this.roster.get(playerId)?.pvp !== false;
  }

  private maybeReportKills(nowMs: number): void {
    const localId = this.deps.localId();
    const mine = localId ? this.scores.find((r) => r.id === localId) : undefined;
    if (!mine || !this.mapId || !this.deps.boards.available) return;
    const name = this.deps.localName();
    if (!this.killSession || this.killSession.mapId !== this.mapId) {
      if (mine.kills === 0 && mine.deaths === 0) return;
      this.killSession = { id: this.deps.boards.startSession(name, this.mapId), mapId: this.mapId, sent: '', at: -Infinity };
    }
    const session = this.killSession;
    const key = `${mine.kills}|${mine.deaths}`;
    if (key === session.sent || nowMs - session.at < KILL_REPORT_MS) return;
    session.at = nowMs;
    void session.id.then(async (id) => {
      if (!id) return;
      if (await this.deps.boards.reportSession(id, mine.kills, mine.deaths)) session.sent = key;
    });
  }

  /** for the qa hooks */
  qaState() {
    return {
      mapId: this.mapId,
      modes: this.modes,
      timed: this.timer !== null,
      phase: this.timer?.phase ?? null,
      ms: this.timer?.elapsedMs() ?? 0,
      splits: this.timer?.splits.map((s) => ({ ...s })) ?? [],
      pbMs: this.pb ? ticksToMs(this.pb.ticks) : null,
      record: this.record,
      pvp: this.pvpOn,
      pvpToggleable: this.rule.toggleable,
      scores: this.scores.map((r) => ({ ...r })),
      roster: [...this.roster.entries()].map(([id, p]) => ({ id, ...p })),
      boardsAvailable: this.deps.boards.available,
      ghost: {
        source: this.ghostSource,
        visible: this.ghostRunner.root.visible,
        pos: this.ghostRunner.root.position.toArray(),
      },
      lastFinish: this.lastFinished ? { ...this.lastFinished.run } : null,
    };
  }

  // ---------------------------------------------------------------- frame

  frame(input: {
    nowMs: number;
    playing: boolean;
    showHud: boolean;
    camera: Camera;
    displayed: ReadonlyArray<{ id: string; position: Vector3 }>;
    width: number;
    height: number;
    multiplayerActive: boolean;
  }): void {
    const { nowMs, playing, showHud } = input;
    const timed = this.timer !== null;
    this.timerHud.setVisible(playing && showHud && timed);
    if (timed && playing) {
      const t = this.timer!;
      this.timerHud.render({
        phase: t.phase,
        timeMs: t.elapsedMs(),
        stage: t.phase === 'running' || t.phase === 'finished' ? Math.min(this.stageCount, t.splits.length + 1) : 1,
        stageCount: this.stageCount,
        pbMs: this.pb ? ticksToMs(this.pb.ticks) : null,
        record: this.record,
        unranked: null,
      }, nowMs);
    }
    this.ghostRunner.update(
      timed && playing && this.timer!.phase === 'running' ? this.timer!.elapsedMs() : null,
      this.ghostEnabled,
    );

    this.badge.setVisible(playing && showHud && input.multiplayerActive);
    this.badge.render(this.pvpOn, !this.rule.toggleable);

    this.plates.setVisible(playing && showHud);
    if (playing && showHud) {
      this.plates.update(input.camera, input.displayed, (id) => this.roster.get(id) ?? null, input.width, input.height);
    }

    this.roomBoard.setEnabled(playing);
    if (this.roomBoard.isOpen()) {
      if (timed && this.mapId && nowMs - this.topTimesAt > TIMES_REFRESH_MS) {
        this.topTimesAt = nowMs;
        void this.loadBoards(this.mapId, this.loadSeq);
      }
      const me = this.deps.localName().toLowerCase();
      const localId = this.deps.localId();
      const times: MapTimeRow[] | null = timed
        ? this.topTimes.slice(0, 5).map((r) => ({ name: r.name, timeMs: r.timeMs, pvp: r.pvp, isLocal: r.name.toLowerCase() === me }))
        : null;
      this.roomBoard.render({
        kills: this.scores.map((r) => ({
          id: r.id,
          name: r.id === localId ? this.deps.localName() : this.roster.get(r.id)?.name ?? 'Player',
          kills: r.kills,
          deaths: r.deaths,
          pvp: r.id === localId ? this.pvpOn : this.roster.get(r.id)?.pvp,
          isLocal: r.id === localId,
        })),
        times,
        timesNote: this.deps.boards.available ? 'No ranked runs yet' : 'Ranked times need the new database tables',
        pbMs: this.pb ? ticksToMs(this.pb.ticks) : null,
      });
    }
    this.maybeReportKills(nowMs);
  }
}

function loadPvpChoice(fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(PVP_KEY);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

function savePvpChoice(on: boolean): void {
  try {
    localStorage.setItem(PVP_KEY, on ? '1' : '0');
  } catch {
    // private mode, fine
  }
}
