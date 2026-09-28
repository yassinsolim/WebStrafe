import type { CosmeticsManifest, LoadoutSelection } from '../cosmetics/types';
import type { CharacterLook } from '../characters/look';
import type { KnifeId } from '../combat/knives';
import type { KnifeFinishSelection } from '../cosmetics/finishes/catalog';
import type { KnifeLoadoutSelection } from '../cosmetics/finishes/selection';
import type { MapManifestEntry } from '../world/types';
import type { GameSettings } from './SettingsStore';
import { CharacterPreview } from './CharacterPreview';
import { formatRunTime } from './hud/hudMath';
import { CreditsPanel } from './menu/CreditsPanel';
import { LoadoutPanel } from './menu/LoadoutPanel';
import { attachMenuSounds } from './menu/menuSounds';
import { MAP_TYPE_LABEL, mapTypeFromId } from './menu/menuInfo';
import { PlayPanel } from './menu/PlayPanel';
import { SettingsPanel } from './menu/SettingsPanel';
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
  private readonly root: HTMLDivElement;
  private readonly nameInput: HTMLInputElement;
  private readonly playMapLabel: HTMLSpanElement;

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
  private preview: CharacterPreview | null = null;
  private visible = false;
  private activeTab: TabId = 'play';

  constructor(parent: HTMLElement, settings: GameSettings, private readonly callbacks: MainMenuCallbacks) {
    this.settings = { ...settings };
    this.root = document.createElement('div');
    this.root.className = 'main-menu';

    const shell = document.createElement('div');
    shell.className = 'menu-shell';
    this.root.appendChild(shell);

    const left = document.createElement('div');
    left.className = 'menu-left';
    shell.appendChild(left);

    // Brand ------------------------------------------------------------------
    const brand = document.createElement('div');
    brand.className = 'menu-brand';
    const wordmark = document.createElement('h1');
    wordmark.className = 'menu-wordmark';
    wordmark.innerHTML = 'WEB<span>STRAFE</span>';
    const tagline = document.createElement('p');
    tagline.className = 'menu-tagline';
    tagline.textContent = 'SURF · BHOP · FRAG';
    brand.append(wordmark, tagline);
    left.appendChild(brand);

    // Identity (username) ----------------------------------------------------
    const identity = document.createElement('label');
    identity.className = 'menu-identity';
    const identityTag = document.createElement('span');
    identityTag.className = 'menu-identity-tag';
    identityTag.textContent = 'PLAYER';
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
    identity.append(identityTag, this.nameInput);
    left.appendChild(identity);

    // Primary actions --------------------------------------------------------
    const actions = document.createElement('div');
    actions.className = 'menu-actions';
    const playButton = document.createElement('button');
    playButton.type = 'button';
    playButton.className = 'menu-play-btn';
    playButton.dataset.sfx = 'confirm';
    const playLabel = document.createElement('span');
    playLabel.className = 'menu-play-label';
    playLabel.innerHTML = '<span class="menu-play-glyph">▶</span> PLAY';
    this.playMapLabel = document.createElement('span');
    this.playMapLabel.className = 'menu-play-map';
    playButton.append(playLabel, this.playMapLabel);
    playButton.addEventListener('click', () => this.callbacks.onPlay(this.selectedMapId));
    const restartButton = document.createElement('button');
    restartButton.type = 'button';
    restartButton.className = 'menu-restart-btn';
    restartButton.textContent = 'Restart run';
    restartButton.addEventListener('click', () => this.callbacks.onReloadMap());
    actions.append(playButton, restartButton);
    left.appendChild(actions);

    // Nav tabs ---------------------------------------------------------------
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
    left.appendChild(nav);

    // Panels -----------------------------------------------------------------
    const panels = document.createElement('div');
    panels.className = 'menu-panels';
    left.appendChild(panels);

    const playSection = this.makeSection('play');
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

    const loadoutSection = this.makeSection('loadout');
    this.loadoutPanel = new LoadoutPanel(loadoutSection, {
      onKnifeSelected: (knifeId) => this.callbacks.onKnifeSelected?.(knifeId),
      onKnifeFinishChanged: (selection) => this.callbacks.onKnifeFinishChanged?.(selection),
    });
    panels.appendChild(loadoutSection);

    const characterSection = this.makeSection('character');
    const teamHeading = document.createElement('p');
    teamHeading.className = 'menu-section-hint';
    teamHeading.textContent = 'Pick your side';
    this.teamGrid = document.createElement('div');
    this.teamGrid.className = 'menu-team-grid';
    characterSection.append(teamHeading, this.teamGrid);
    if (this.callbacks.onCustomize) {
      const customize = document.createElement('button');
      customize.type = 'button';
      customize.className = 'cz-open-btn';
      customize.innerHTML = '<span class="cz-open-label">Customize character</span>'
        + '<span class="cz-open-go">Open</span>'
        + '<span class="cz-open-sub">Armor, paint, emblem and tag</span>';
      customize.addEventListener('click', () => this.callbacks.onCustomize?.());
      characterSection.appendChild(customize);
    }
    panels.appendChild(characterSection);

    const settingsSection = this.makeSection('settings');
    this.settingsPanel = new SettingsPanel(settingsSection, this.settings, {
      onChange: (next) => {
        this.settings = next;
        this.callbacks.onSettingsChanged(next);
      },
    });
    panels.appendChild(settingsSection);

    const leaderboardSection = this.makeSection('leaderboard');
    this.leaderboardInfo = document.createElement('div');
    this.leaderboardInfo.className = 'menu-map-info';
    this.leaderboardInfo.textContent = 'Top runs for selected map';
    this.leaderboardList = document.createElement('ol');
    this.leaderboardList.className = 'menu-leaderboard';
    leaderboardSection.append(this.leaderboardInfo, this.leaderboardList);
    panels.appendChild(leaderboardSection);

    const creditsSection = this.makeSection('credits');
    this.creditsPanel = new CreditsPanel(creditsSection);
    panels.appendChild(creditsSection);

    // Footer -----------------------------------------------------------------
    const footer = document.createElement('div');
    footer.className = 'menu-foot';
    const help = document.createElement('p');
    help.className = 'menu-help';
    help.innerHTML = [
      '<kbd>WASD</kbd> move',
      '<kbd>Space</kbd> jump',
      '<kbd>1</kbd> AWP',
      '<kbd>2</kbd> Deagle',
      '<kbd>3</kbd> Knife',
      '<kbd>R</kbd> reload',
      '<kbd>Tab</kbd> scores',
      '<kbd>F3</kbd> debug',
      '<kbd>Esc</kbd> menu',
    ].join('<span class="menu-help-sep"></span>');
    footer.appendChild(help);
    left.appendChild(footer);

    // Character stage --------------------------------------------------------
    const stage = document.createElement('div');
    stage.className = 'menu-stage';
    const stageGlow = document.createElement('div');
    stageGlow.className = 'menu-stage-glow';
    const stageMount = document.createElement('div');
    stageMount.className = 'menu-stage-mount';
    const caption = document.createElement('div');
    caption.className = 'menu-stage-caption';
    this.stageName = document.createElement('div');
    this.stageName.className = 'menu-stage-name';
    this.stageTeam = document.createElement('div');
    this.stageTeam.className = 'menu-stage-team';
    caption.append(this.stageName, this.stageTeam);
    stage.append(stageGlow, stageMount, caption);
    shell.appendChild(stage);

    try {
      this.preview = new CharacterPreview(stageMount);
    } catch {
      this.preview = null; // WebGL unavailable, menu still works, just no 3D
    }

    this.detachSounds = attachMenuSounds(this.root);
    this.setActiveTab('play');
    parent.appendChild(this.root);
  }

  public setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'grid' : 'none';
    if (visible) {
      this.preview?.start();
    } else {
      this.preview?.stop();
    }
    this.visible = visible;
    this.loadoutPanel.setActive(visible && this.activeTab === 'loadout');
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
    this.leaderboardInfo.textContent = `Top runs · ${mapName}`;
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

  private makeSection(id: TabId): HTMLElement {
    const section = document.createElement('section');
    section.className = 'menu-section';
    section.dataset.tab = id;
    this.sections.set(id, section);
    return section;
  }

  private setActiveTab(id: TabId): void {
    for (const [tabId, tab] of this.tabs) {
      tab.classList.toggle('is-active', tabId === id);
      tab.setAttribute('aria-selected', String(tabId === id));
    }
    for (const [sectionId, section] of this.sections) {
      section.classList.toggle('is-active', sectionId === id);
    }
    this.root.dataset.tab = id;
    this.activeTab = id;
    this.loadoutPanel.setActive(this.visible && id === 'loadout');
  }

  /** Dresses the menu character in the player's look. */
  public setCharacterLook(look: CharacterLook): void {
    void this.preview?.setLook(look, this.activeTeam);
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
      card.className = 'menu-team-card';
      card.classList.toggle('is-selected', team === this.activeTeam);
      card.disabled = !hasPreset(team) && this.loadoutPresets.length > 0;
      const tag = document.createElement('span');
      tag.className = 'menu-team-tag';
      tag.textContent = team === 'terrorist' ? 'T' : 'CT';
      const label = document.createElement('span');
      label.className = 'menu-team-label';
      label.textContent = TEAM_LABEL[team];
      card.append(tag, label);
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
