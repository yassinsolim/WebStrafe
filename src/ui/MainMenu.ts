import type { CosmeticsManifest, LoadoutSelection } from '../cosmetics/types';
import type { KnifeId } from '../combat/knives';
import type { KnifeFinishSelection } from '../cosmetics/finishes/catalog';
import type { KnifeLoadoutSelection } from '../cosmetics/finishes/selection';
import type { MapManifestEntry } from '../world/types';
import { devToolsEnabled } from '../app/devTools';
import type { GameSettings } from './SettingsStore';
import { wordmarkMarkup } from './brand';
import { CharacterPreview } from './CharacterPreview';
import { formatRunTime } from './hud/hudMath';
import { CreditsPanel } from './menu/CreditsPanel';
import { LoadoutPanel } from './menu/LoadoutPanel';
import { attachMenuSounds } from './menu/menuSounds';
import { MAP_TYPE_LABEL, mapTypeFromId } from './menu/menuInfo';
import { PlayPanel } from './menu/PlayPanel';
import { SETTINGS_SECTIONS, SettingsPanel, type SettingsSectionId } from './menu/SettingsPanel';

interface MainMenuCallbacks {
  onPlay: (mapId: string) => void;
  onReloadMap: () => void;
  onMapSelected: (mapId: string) => void;
  onSettingsChanged: (settings: GameSettings) => void;
  onLoadoutChanged: (selection: LoadoutSelection) => void;
  onNameChanged: (name: string) => void;
  /** null = the authored (legacy) viewmodel knife */
  onKnifeSelected?: (knifeId: KnifeId | null) => void;
  /** finish, wear or pattern seed of the equipped knife changed */
  onKnifeFinishChanged?: (selection: KnifeLoadoutSelection) => void;
  /** true while this map is loaded and paused, so Play reads Resume */
  canResume?: (mapId: string) => boolean;
}

interface LoadoutPreset {
  id: string;
  label: string;
  team: TeamId;
  selection: LoadoutSelection;
}

type TabId = 'play' | 'loadout' | 'character' | 'settings' | 'leaderboard' | 'credits';
type TeamId = 'terrorist' | 'counterterrorist';

const TEAM_LABEL: Record<TeamId, string> = {
  terrorist: 'Terrorist',
  counterterrorist: 'Counter-Terrorist',
};

const TAB_DEFS: ReadonlyArray<[TabId, string]> = [
  ['play', 'Play'],
  ['loadout', 'Loadout'],
  ['character', 'Character'],
  ['settings', 'Settings'],
  ['leaderboard', 'Leaderboard'],
  ['credits', 'Credits'],
];

const PLAY_GLYPH = '<svg class="menu-play-glyph" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1.8L14 8 3 14.2z" fill="currentColor"/></svg>';

// backdrop streaks: top %, length rem, seconds per pass, start offset, cool tint
const STREAKS: ReadonlyArray<[number, number, number, number, boolean]> = [
  [16, 26, 19, -3, false],
  [31, 14, 27, -15, true],
  [48, 34, 23, -9, false],
  [63, 18, 31, -22, false],
  [77, 24, 25, -5, true],
  [88, 12, 35, -28, false],
];

export class MainMenu {
  private readonly root: HTMLDivElement;
  private readonly nameInput: HTMLInputElement;
  private readonly playMapLabel: HTMLSpanElement;
  private readonly playWord: HTMLSpanElement;

  private readonly playPanel: PlayPanel;
  private readonly loadoutPanel: LoadoutPanel;
  private readonly settingsPanel: SettingsPanel;
  private readonly creditsPanel: CreditsPanel;
  private readonly teamGrid: HTMLDivElement;
  private readonly leaderboardInfo: HTMLDivElement;
  private readonly leaderboardList: HTMLOListElement;
  private readonly stageName: HTMLDivElement;
  private readonly stageTeam: HTMLDivElement;
  private readonly detachSounds: () => void;

  private readonly tabs = new Map<TabId, HTMLButtonElement>();
  private readonly sections = new Map<TabId, HTMLElement>();

  private maps: MapManifestEntry[] = [];
  private selectedMapId = '';
  private settings: GameSettings;
  private loadoutPresets: LoadoutPreset[] = [];
  private activeTeam: TeamId = 'terrorist';
  private activeTab: TabId = 'play';
  private visible = true;
  private preview: CharacterPreview | null = null;

  constructor(parent: HTMLElement, settings: GameSettings, private readonly callbacks: MainMenuCallbacks) {
    this.settings = { ...settings };
    this.root = document.createElement('div');
    this.root.className = 'main-menu';

    // animated backdrop: grid, drifting glow, slow light sweep and strafe streaks
    const backdrop = document.createElement('div');
    backdrop.className = 'menu-bg';
    backdrop.setAttribute('aria-hidden', 'true');
    const streaks = STREAKS.map(([y, width, seconds, delay, cool]) =>
      `<b style="--y:${y}%;--w:${width}rem;--d:${seconds}s;--delay:${delay}s${cool ? ';--c:rgba(120,220,255,0.26)' : ''}"></b>`).join('');
    backdrop.innerHTML = `<i class="menu-bg-grid"></i><i class="menu-bg-glow"></i><i class="menu-bg-streaks">${streaks}</i><i class="menu-bg-sweep"></i>`;
    this.root.appendChild(backdrop);

    const shell = document.createElement('div');
    shell.className = 'menu-shell';
    this.root.appendChild(shell);

    // Top bar: brand, tabs, player -----------------------------------------
    const top = document.createElement('header');
    top.className = 'menu-top';
    const brand = document.createElement('div');
    brand.className = 'menu-brand';
    brand.innerHTML = `${wordmarkMarkup('ws-wordmark menu-wordmark')}<span class="menu-tagline">Surf · Bhop · Frag</span>`;

    const nav = document.createElement('nav');
    nav.className = 'menu-nav';
    nav.setAttribute('role', 'tablist');
    for (const [id, label] of TAB_DEFS) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'menu-tab';
      tab.textContent = label;
      tab.setAttribute('role', 'tab');
      tab.addEventListener('click', () => this.setActiveTab(id));
      this.tabs.set(id, tab);
      nav.appendChild(tab);
    }

    const identity = document.createElement('label');
    identity.className = 'menu-identity';
    const identityTag = document.createElement('span');
    identityTag.className = 'menu-identity-tag';
    identityTag.textContent = 'Player';
    this.nameInput = document.createElement('input');
    this.nameInput.type = 'text';
    this.nameInput.className = 'menu-name-input';
    this.nameInput.maxLength = 24;
    this.nameInput.placeholder = 'Choose a username';
    this.nameInput.autocomplete = 'off';
    this.nameInput.spellcheck = false;
    this.nameInput.addEventListener('change', () => this.commitName());
    this.nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        this.nameInput.blur();
      }
    });
    const editGlyph = document.createElement('span');
    editGlyph.className = 'menu-identity-edit';
    editGlyph.setAttribute('aria-hidden', 'true');
    editGlyph.innerHTML = '<svg viewBox="0 0 16 16"><path d="M10.8 2.2l3 3-8.4 8.4H2.4v-3z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
    identity.append(identityTag, this.nameInput, editGlyph);
    top.append(brand, nav, identity);
    shell.appendChild(top);

    // Main: panels on the left, character on the right ----------------------
    const main = document.createElement('div');
    main.className = 'menu-main';
    shell.appendChild(main);

    const panels = document.createElement('div');
    panels.className = 'menu-panels';
    main.appendChild(panels);

    const playSection = this.makeSection('play', 'Play', 'Pick a map. Double click a card to jump straight in.');
    this.playPanel = new PlayPanel(playSection, {
      onSelect: (mapId) => {
        this.selectedMapId = mapId;
        this.refreshPlayLabel();
        this.callbacks.onMapSelected(mapId);
      },
      onPlay: (mapId) => {
        this.selectedMapId = mapId;
        this.refreshPlayLabel();
        this.callbacks.onPlay(mapId);
      },
    });
    panels.appendChild(playSection);

    const loadoutSection = this.makeSection('loadout', 'Loadout', 'Your AWP, Deagle and the knife you carry.');
    this.loadoutPanel = new LoadoutPanel(loadoutSection, {
      onKnifeSelected: (knifeId) => this.callbacks.onKnifeSelected?.(knifeId),
      onKnifeFinishChanged: (selection) => this.callbacks.onKnifeFinishChanged?.(selection),
    });
    panels.appendChild(loadoutSection);

    const characterSection = this.makeSection('character', 'Character', 'Pick your side. Other players see this model.');
    this.teamGrid = document.createElement('div');
    this.teamGrid.className = 'menu-team-grid';
    characterSection.append(this.teamGrid);
    panels.appendChild(characterSection);

    const settingsSection = this.makeSection('settings', 'Settings', null);
    this.settingsPanel = new SettingsPanel(settingsSection, this.settings, {
      onChange: (next) => {
        this.settings = next;
        this.callbacks.onSettingsChanged(next);
      },
    });
    panels.appendChild(settingsSection);

    const leaderboardSection = this.makeSection('leaderboard', 'Leaderboard', null);
    this.leaderboardInfo = document.createElement('div');
    this.leaderboardInfo.className = 'menu-section-hint';
    this.leaderboardInfo.textContent = 'Top runs for the selected map';
    this.leaderboardList = document.createElement('ol');
    this.leaderboardList.className = 'menu-leaderboard';
    leaderboardSection.append(this.leaderboardInfo, this.leaderboardList);
    panels.appendChild(leaderboardSection);

    const creditsSection = this.makeSection('credits', 'Credits', null);
    this.creditsPanel = new CreditsPanel(creditsSection);
    panels.appendChild(creditsSection);

    // Character stage --------------------------------------------------------
    const stage = document.createElement('div');
    stage.className = 'menu-stage';
    const stageGlow = document.createElement('div');
    stageGlow.className = 'menu-stage-glow';
    const stageRing = document.createElement('div');
    stageRing.className = 'menu-stage-ring';
    stageRing.innerHTML = '<i></i>';
    const stageMount = document.createElement('div');
    stageMount.className = 'menu-stage-mount';
    const caption = document.createElement('div');
    caption.className = 'menu-stage-caption';
    this.stageName = document.createElement('div');
    this.stageName.className = 'menu-stage-name';
    this.stageTeam = document.createElement('div');
    this.stageTeam.className = 'menu-stage-team';
    caption.append(this.stageName, this.stageTeam);
    stage.append(stageGlow, stageRing, stageMount, caption);
    main.appendChild(stage);

    // Bottom bar: key hints and the play button ------------------------------
    const footer = document.createElement('footer');
    footer.className = 'menu-foot';
    const help = document.createElement('p');
    help.className = 'menu-help';
    help.innerHTML = [
      '<kbd>WASD</kbd> move',
      '<kbd>Space</kbd> jump',
      '<kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> weapons',
      '<kbd>R</kbd> reload',
      '<kbd>Tab</kbd> scores',
      '<kbd>F3</kbd> debug',
      '<kbd>Esc</kbd> menu',
    ].map((item) => `<span class="menu-help-item">${item}</span>`).join('');

    const actions = document.createElement('div');
    actions.className = 'menu-actions';
    const restartButton = document.createElement('button');
    restartButton.type = 'button';
    restartButton.className = 'menu-restart-btn';
    restartButton.textContent = 'Restart run';
    restartButton.addEventListener('click', () => this.callbacks.onReloadMap());
    const playButton = document.createElement('button');
    playButton.type = 'button';
    playButton.className = 'menu-play-btn';
    playButton.dataset.sfx = 'confirm';
    const playLabel = document.createElement('span');
    playLabel.className = 'menu-play-label';
    playLabel.innerHTML = PLAY_GLYPH;
    this.playWord = document.createElement('span');
    this.playWord.textContent = 'Play';
    playLabel.appendChild(this.playWord);
    this.playMapLabel = document.createElement('span');
    this.playMapLabel.className = 'menu-play-map';
    playButton.append(playLabel, this.playMapLabel);
    playButton.addEventListener('click', () => this.callbacks.onPlay(this.selectedMapId));
    actions.append(restartButton, playButton);
    footer.append(help, actions);
    shell.appendChild(footer);

    try {
      this.preview = new CharacterPreview(stageMount);
    } catch {
      this.preview = null; // WebGL unavailable, menu still works, just no 3D
    }

    this.detachSounds = attachMenuSounds(this.root);
    this.setActiveTab('play');
    this.applyDevTabHook();
    parent.appendChild(this.root);
  }

  public setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'grid' : 'none';
    this.visible = visible;
    if (visible) this.refreshPlayLabel();
    this.syncPreview();
  }

  /** the 3d character only renders while it can be seen */
  private syncPreview(): void {
    if (this.visible && this.activeTab !== 'settings') {
      this.preview?.start();
    } else {
      this.preview?.stop();
    }
    this.loadoutPanel.setActive(this.visible && this.activeTab === 'loadout');
  }

  /** Reflects the authoritative (already-sanitized) player name into the field. */
  public setPlayerName(name: string): void {
    this.nameInput.value = name;
    this.stageName.textContent = name;
  }

  public setMaps(entries: MapManifestEntry[], selectedMapId: string): void {
    this.maps = entries;
    this.selectedMapId = selectedMapId;
    this.playPanel.setMaps(entries, selectedMapId);
    this.creditsPanel.setMaps(entries);
    this.refreshPlayLabel();
  }

  public setCosmetics(manifest: CosmeticsManifest, selection: LoadoutSelection): void {
    this.loadoutPresets = this.buildLoadoutPresets(manifest);
    this.renderTeamCards();
    if (this.loadoutPresets.length === 0) {
      return;
    }
    const preset = this.findPresetForSelection(selection) ?? this.loadoutPresets[0];
    this.applyTeam(preset.team, false);
  }

  public updateSettings(settings: GameSettings): void {
    this.settings = { ...settings };
    this.settingsPanel.update(settings);
  }

  public setLeaderboard(entries: Array<{ name: string; timeMs: number; model: string }>, mapName: string): void {
    // the fetch is async, so tie the result to the map it names rather than the current pick
    const mapId = this.maps.find((map) => map.name === mapName)?.id ?? this.selectedMapId;
    const top = entries[0];
    this.playPanel.setBestRun(mapId, top ? { name: top.name, time: formatRunTime(top.timeMs) } : null);
    this.leaderboardInfo.textContent = `Top runs on ${mapName}`;
    this.leaderboardList.innerHTML = '';
    if (entries.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'menu-leaderboard-empty';
      empty.textContent = 'No runs yet. Finish the map to set the first time.';
      this.leaderboardList.appendChild(empty);
      return;
    }
    entries.slice(0, 10).forEach((entry, index) => {
      const line = document.createElement('li');
      if (index < 3) {
        line.classList.add(`is-top-${index + 1}`);
      }
      const rank = document.createElement('span');
      rank.className = 'lb-rank';
      rank.textContent = String(index + 1).padStart(2, '0');
      const who = document.createElement('span');
      who.className = 'lb-name';
      who.textContent = entry.name;
      const time = document.createElement('span');
      time.className = 'lb-time';
      time.textContent = formatRunTime(entry.timeMs);
      line.append(rank, who, time);
      this.leaderboardList.appendChild(line);
    });
  }

  public dispose(): void {
    this.detachSounds();
    this.settingsPanel.dispose();
    this.loadoutPanel.dispose();
    this.preview?.dispose();
    this.preview = null;
  }

  // --- internals ----------------------------------------------------------

  private commitName(): void {
    this.callbacks.onNameChanged(this.nameInput.value);
  }

  private makeSection(id: TabId, title: string, hint: string | null): HTMLElement {
    const section = document.createElement('section');
    section.className = 'menu-section';
    section.dataset.tab = id;
    section.setAttribute('role', 'tabpanel');
    const heading = document.createElement('h2');
    heading.className = 'menu-section-title';
    heading.textContent = title;
    section.appendChild(heading);
    if (hint) {
      const text = document.createElement('p');
      text.className = 'menu-section-hint';
      text.textContent = hint;
      section.appendChild(text);
    }
    this.sections.set(id, section);
    return section;
  }

  private setActiveTab(id: TabId): void {
    const order = TAB_DEFS.map(([tabId]) => tabId);
    // new panels slide in from the side of the tab you came from
    this.root.style.setProperty('--menu-dir', order.indexOf(id) >= order.indexOf(this.activeTab) ? '1' : '-1');
    this.activeTab = id;
    for (const [tabId, tab] of this.tabs) {
      tab.classList.toggle('is-active', tabId === id);
      tab.setAttribute('aria-selected', String(tabId === id));
    }
    for (const [sectionId, section] of this.sections) {
      section.classList.toggle('is-active', sectionId === id);
      section.setAttribute('aria-hidden', String(sectionId !== id));
    }
    this.root.dataset.tab = id;
    this.syncPreview();
  }

  /** dev and preview builds: ?menu=settings or ?menu=settings.crosshair opens a tab for screenshots */
  private applyDevTabHook(): void {
    if (!devToolsEnabled()) {
      return;
    }
    const raw = new URLSearchParams(window.location.search).get('menu');
    if (!raw) {
      return;
    }
    const [tab, sub] = raw.split('.');
    if (TAB_DEFS.some(([id]) => id === tab)) {
      this.setActiveTab(tab as TabId);
    }
    if (sub && SETTINGS_SECTIONS.some(([id]) => id === sub)) {
      this.settingsPanel.setSection(sub as SettingsSectionId);
    }
  }

  /** Reflects the stored knife choice without firing the callback. */
  public setSelectedKnife(knifeId: KnifeId | null): void {
    this.loadoutPanel.setSelectedKnife(knifeId);
  }

  /** reflects the stored knife finish without firing the callback */
  public setKnifeFinish(selection: KnifeFinishSelection): void {
    this.loadoutPanel.setKnifeFinish(selection);
  }

  private refreshPlayLabel(): void {
    this.playWord.textContent = this.callbacks.canResume?.(this.selectedMapId) ? 'Resume' : 'Play';
    const selected = this.maps.find((map) => map.id === this.selectedMapId);
    this.playMapLabel.textContent = selected
      ? `${selected.name} · ${MAP_TYPE_LABEL[mapTypeFromId(selected.id)]}`
      : 'Pick a map';
  }

  private renderTeamCards(): void {
    this.teamGrid.innerHTML = '';
    const teams: TeamId[] = ['terrorist', 'counterterrorist'];
    const hasPreset = (team: TeamId) => this.loadoutPresets.some((p) => p.team === team);
    for (const team of teams) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'menu-team-card';
      card.dataset.team = team;
      card.classList.toggle('is-selected', team === this.activeTeam);
      card.disabled = !hasPreset(team) && this.loadoutPresets.length > 0;
      const tag = document.createElement('span');
      tag.className = 'menu-team-tag';
      tag.textContent = team === 'terrorist' ? 'T' : 'CT';
      const text = document.createElement('span');
      text.className = 'menu-team-text';
      const label = document.createElement('span');
      label.className = 'menu-team-label';
      label.textContent = TEAM_LABEL[team];
      const sub = document.createElement('span');
      sub.className = 'menu-team-sub';
      sub.textContent = team === this.activeTeam ? 'Selected' : 'Click to wear';
      text.append(label, sub);
      card.append(tag, text);
      card.addEventListener('click', () => this.applyTeam(team, true));
      this.teamGrid.appendChild(card);
    }
  }

  private applyTeam(team: TeamId, emit: boolean): void {
    this.activeTeam = team;
    this.stageTeam.textContent = TEAM_LABEL[team];
    void this.preview?.setModel(team);
    this.renderTeamCards();
    if (emit) {
      const preset = this.loadoutPresets.find((p) => p.team === team);
      if (preset) {
        this.callbacks.onLoadoutChanged({ ...preset.selection });
      }
    }
  }

  private buildLoadoutPresets(manifest: CosmeticsManifest): LoadoutPreset[] {
    const glove = manifest.gloves[0];
    const knifeA = manifest.knives.find((entry) => entry.id === 'real_knife_viewmodel') ?? manifest.knives[0];
    const knifeB =
      manifest.knives.find((entry) => entry.id === 'knife_animated_viewmodel')
      ?? manifest.knives.find((entry) => entry.id !== knifeA?.id)
      ?? knifeA;

    if (!glove || !knifeA || !knifeB || glove.variants.length === 0 || knifeA.variants.length === 0 || knifeB.variants.length === 0) {
      return [];
    }

    const gloveVariantA = glove.variants[0];
    const gloveVariantB = glove.variants[Math.min(1, glove.variants.length - 1)] ?? gloveVariantA;

    return [
      {
        id: 'preset_1',
        label: 'Terrorist',
        team: 'terrorist',
        selection: {
          gloveId: glove.id,
          gloveVariantId: gloveVariantA.id,
          knifeId: knifeA.id,
          knifeVariantId: knifeA.variants[0].id,
        },
      },
      {
        id: 'preset_2',
        label: 'Counter-Terrorist',
        team: 'counterterrorist',
        selection: {
          gloveId: glove.id,
          gloveVariantId: gloveVariantB.id,
          knifeId: knifeB.id,
          knifeVariantId: knifeB.variants[0].id,
        },
      },
    ];
  }

  private findPresetForSelection(selection: LoadoutSelection): LoadoutPreset | null {
    return (
      this.loadoutPresets.find((preset) =>
        preset.selection.gloveId === selection.gloveId
        && preset.selection.gloveVariantId === selection.gloveVariantId
        && preset.selection.knifeId === selection.knifeId
        && preset.selection.knifeVariantId === selection.knifeVariantId) ?? null
    );
  }
}
