import { createElement, Pencil, Play, RotateCcw, ArrowUpRight } from 'lucide';
import type { CosmeticsManifest, LoadoutSelection } from '../cosmetics/types';
import type { CharacterLook } from '../characters/look';
import { DEFAULT_KNIFE_ID, type KnifeId } from '../combat/knives';
import type { KnifeFinishSelection } from '../cosmetics/finishes/catalog';
import { defaultKnifeSelection, type KnifeLoadoutSelection } from '../cosmetics/finishes/selection';
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
import './customize/customize.css';

interface MainMenuCallbacks {
  onPlay: (mapId: string) => void;
  onReloadMap: () => void;
  onMapSelected: (mapId: string) => void;
  onSettingsChanged: (settings: GameSettings) => void;
  onLoadoutChanged: (selection: LoadoutSelection) => void;
  onNameChanged: (name: string) => void;
  /** null = the authored (legacy) viewmodel knife */
  onKnifeSelected?: (knifeId: KnifeId | null) => void;
  /** opens the customize screen; the character tab only shows its button when this is set */
  onCustomize?: () => void;
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

export class MainMenu {
  private detachNavOrientation: (() => void) | null = null;
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
  private knifePick: KnifeLoadoutSelection = defaultKnifeSelection();

  constructor(parent: HTMLElement, settings: GameSettings, private readonly callbacks: MainMenuCallbacks) {
    this.settings = { ...settings };
    this.root = document.createElement('div');
    this.root.className = 'main-menu';

    const backdrop = document.createElement('div');
    backdrop.className = 'menu-bg';
    backdrop.setAttribute('aria-hidden', 'true');
    this.root.appendChild(backdrop);

    const shell = document.createElement('div');
    shell.className = 'menu-shell';
    this.root.appendChild(shell);

    const top = document.createElement('header');
    top.className = 'menu-top';
    const brand = document.createElement('div');
    brand.className = 'menu-brand';
    brand.innerHTML = `${wordmarkMarkup('ws-wordmark menu-wordmark')}<span class="menu-tagline">Surf · Bhop · Frag</span>`;

    const nav = document.createElement('nav');
    nav.className = 'menu-nav';
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-label', 'Main menu');
    const navObserver = new ResizeObserver(() => {
      nav.setAttribute('aria-orientation', getComputedStyle(nav).flexDirection === 'column' ? 'vertical' : 'horizontal');
    });
    navObserver.observe(nav);
    this.detachNavOrientation = () => navObserver.disconnect();
    for (const [index, [id, label]] of TAB_DEFS.entries()) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'menu-tab';
      tab.dataset.section = id;
      tab.id = `menu-tab-${id}`;
      tab.setAttribute('aria-controls', `menu-panel-${id}`);
      const number = document.createElement('span');
      number.className = 'menu-tab-index';
      number.textContent = String(index + 1).padStart(2, '0');
      number.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span');
      text.textContent = label;
      tab.append(number, text);
      tab.setAttribute('role', 'tab');
      tab.addEventListener('click', () => this.setActiveTab(id));
      tab.addEventListener('keydown', event => {
        const offsets: Record<string, number> = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1, Home: -index, End: TAB_DEFS.length - 1 - index };
        const offset = offsets[event.key];
        if (offset === undefined) return;
        event.preventDefault();
        const nextId = TAB_DEFS[(index + offset + TAB_DEFS.length) % TAB_DEFS.length][0];
        this.setActiveTab(nextId);
        this.tabs.get(nextId)?.focus();
      });
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
    this.nameInput.setAttribute('aria-label', 'Player name');
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
    editGlyph.appendChild(createElement(Pencil));
    identity.append(identityTag, this.nameInput, editGlyph);
    top.append(brand, identity);
    shell.append(top, nav);

    const main = document.createElement('div');
    main.className = 'menu-main';
    shell.appendChild(main);

    const panels = document.createElement('div');
    panels.className = 'menu-panels';
    main.appendChild(panels);

    const playSection = this.makeSection('play', 'Play', null);
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

    const loadoutSection = this.makeSection('loadout', 'Loadout', null);
    this.loadoutPanel = new LoadoutPanel(loadoutSection, {
      onKnifeSelected: (knifeId) => {
        this.showKnife({ ...this.knifePick, knifeId: knifeId ?? DEFAULT_KNIFE_ID });
        this.callbacks.onKnifeSelected?.(knifeId);
      },
      onKnifeFinishChanged: (selection) => {
        this.showKnife({ ...this.knifePick, ...selection, knifeId: this.knifePick.knifeId });
        this.callbacks.onKnifeFinishChanged?.(selection);
      },
    });
    panels.appendChild(loadoutSection);

    const characterSection = this.makeSection('character', 'Your operator', null);
    this.teamGrid = document.createElement('div');
    this.teamGrid.className = 'menu-team-grid';
    characterSection.append(this.teamGrid);
    if (this.callbacks.onCustomize) {
      const customize = document.createElement('button');
      customize.type = 'button';
      customize.className = 'cz-open-btn';
      customize.innerHTML = '<span class="cz-open-label">Customize operator</span>';
      customize.appendChild(createElement(ArrowUpRight, { 'aria-hidden': 'true' }));
      customize.addEventListener('click', () => this.callbacks.onCustomize?.());
      characterSection.appendChild(customize);
    }
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
    const stageMount = document.createElement('div');
    stageMount.className = 'menu-stage-mount';
    const caption = document.createElement('div');
    caption.className = 'menu-stage-caption';
    this.stageName = document.createElement('div');
    this.stageName.className = 'menu-stage-name';
    this.stageTeam = document.createElement('div');
    this.stageTeam.className = 'menu-stage-team';
    caption.append(this.stageName, this.stageTeam);
    stage.append(stageMount, caption);
    main.appendChild(stage);

    // Bottom bar: key hints and the play button ------------------------------
    const footer = document.createElement('footer');
    footer.className = 'menu-foot';
    const help = document.createElement('p');
    help.className = 'menu-help';
    help.textContent = 'SURF / BHOP / COMBAT';

    const actions = document.createElement('div');
    actions.className = 'menu-actions';
    const restartButton = document.createElement('button');
    restartButton.type = 'button';
    restartButton.className = 'menu-restart-btn';
    restartButton.title = 'Restart run';
    restartButton.setAttribute('aria-label', 'Restart run');
    restartButton.appendChild(createElement(RotateCcw, { 'aria-hidden': 'true' }));
    restartButton.addEventListener('click', () => this.callbacks.onReloadMap());
    const playButton = document.createElement('button');
    playButton.type = 'button';
    playButton.className = 'menu-play-btn';
    playButton.dataset.sfx = 'confirm';
    const playLabel = document.createElement('span');
    playLabel.className = 'menu-play-label';
    playLabel.appendChild(createElement(Play, { class: 'menu-play-glyph', 'aria-hidden': 'true', fill: 'currentColor' }));
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
      this.preview.setKnife(this.knifePick);
      // dev tools: freeze the menu idle at a time for screenshots
      if (devToolsEnabled()) {
        (window as unknown as { __menuClock?: (t: number | null) => void }).__menuClock = (t) => this.preview?.setClock(t);
        (window as unknown as { __menuPreview?: CharacterPreview | null }).__menuPreview = this.preview;
      }
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
    this.playPanel.setMaps(entries, selectedMapId);
    this.selectedMapId = this.playPanel.getSelected()?.id ?? '';
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
      empty.textContent = 'No recorded runs';
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
    this.detachNavOrientation?.();
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
    section.id = `menu-panel-${id}`;
    section.setAttribute('aria-labelledby', `menu-tab-${id}`);
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
    this.activeTab = id;
    for (const [tabId, tab] of this.tabs) {
      tab.classList.toggle('is-active', tabId === id);
      tab.setAttribute('aria-selected', String(tabId === id));
      tab.tabIndex = tabId === id ? 0 : -1;
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

  /** Dresses the menu character in the player's look. */
  public setCharacterLook(look: CharacterLook): void {
    void this.preview?.setLook(look, this.activeTeam);
  }

  /** Reflects the stored knife choice without firing the callback. */
  public setSelectedKnife(knifeId: KnifeId | null): void {
    this.loadoutPanel.setSelectedKnife(knifeId);
    this.showKnife({ ...this.knifePick, knifeId: knifeId ?? DEFAULT_KNIFE_ID });
  }

  /** reflects the stored knife finish without firing the callback */
  public setKnifeFinish(selection: KnifeFinishSelection): void {
    this.loadoutPanel.setKnifeFinish(selection);
    this.showKnife({ ...this.knifePick, finishId: selection.finishId, wear: selection.wear, seed: selection.seed });
  }

  /** the menu character holds the knife and finish the player carries */
  private showKnife(pick: KnifeLoadoutSelection): void {
    this.knifePick = pick;
    this.preview?.setKnife(pick);
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
      sub.textContent = team === this.activeTeam ? 'Selected' : 'Available';
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
