import type { CosmeticsManifest, LoadoutSelection } from '../cosmetics/types';
import type { MapManifestEntry } from '../world/types';
import type { GameSettings } from './SettingsStore';
import { CharacterPreview } from './CharacterPreview';

interface MainMenuCallbacks {
  onPlay: (mapId: string) => void;
  onReloadMap: () => void;
  onMapSelected: (mapId: string) => void;
  onSettingsChanged: (settings: GameSettings) => void;
  onLoadoutChanged: (selection: LoadoutSelection) => void;
  onNameChanged: (name: string) => void;
}

interface LoadoutPreset {
  id: string;
  label: string;
  team: TeamId;
  selection: LoadoutSelection;
}

type TabId = 'maps' | 'character' | 'settings' | 'ranks';
type TeamId = 'terrorist' | 'counterterrorist';

const MODEL_BY_TEAM: Record<TeamId, string> = {
  terrorist: '/playermodels/terrorist.glb',
  counterterrorist: '/playermodels/counterterrorist.glb',
};

const TEAM_LABEL: Record<TeamId, string> = {
  terrorist: 'Terrorist',
  counterterrorist: 'Counter-Terrorist',
};

export class MainMenu {
  private readonly root: HTMLDivElement;
  private readonly nameInput: HTMLInputElement;

  private readonly mapGrid: HTMLDivElement;
  private readonly mapInfo: HTMLDivElement;
  private readonly teamGrid: HTMLDivElement;
  private readonly leaderboardInfo: HTMLDivElement;
  private readonly leaderboardList: HTMLOListElement;
  private readonly stageName: HTMLDivElement;
  private readonly stageTeam: HTMLDivElement;

  private readonly mouseSensitivityInput: HTMLInputElement;
  private readonly worldFovInput: HTMLInputElement;
  private readonly viewmodelFovInput: HTMLInputElement;
  private readonly viewmodelScaleInput: HTMLInputElement;
  private readonly autoBhopToggle: HTMLInputElement;
  private readonly showHudToggle: HTMLInputElement;

  private readonly tabs = new Map<TabId, HTMLButtonElement>();
  private readonly sections = new Map<TabId, HTMLElement>();

  private maps: MapManifestEntry[] = [];
  private selectedMapId = '';
  private settings: GameSettings;
  private loadoutPresets: LoadoutPreset[] = [];
  private activeTeam: TeamId = 'terrorist';
  private preview: CharacterPreview | null = null;

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
    identityTag.textContent = 'OPERATOR';
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
    playButton.className = 'menu-play-btn';
    playButton.innerHTML = '<span class="menu-play-glyph">▶</span> PLAY';
    playButton.addEventListener('click', () => this.callbacks.onPlay(this.selectedMapId));
    const restartButton = document.createElement('button');
    restartButton.className = 'menu-restart-btn';
    restartButton.textContent = 'RESTART RUN';
    restartButton.addEventListener('click', () => this.callbacks.onReloadMap());
    actions.append(playButton, restartButton);
    left.appendChild(actions);

    // Nav tabs ---------------------------------------------------------------
    const nav = document.createElement('nav');
    nav.className = 'menu-nav';
    const tabDefs: Array<[TabId, string]> = [
      ['maps', 'Maps'],
      ['character', 'Character'],
      ['settings', 'Settings'],
      ['ranks', 'Ranks'],
    ];
    for (const [id, label] of tabDefs) {
      const tab = document.createElement('button');
      tab.className = 'menu-tab';
      tab.textContent = label;
      tab.addEventListener('click', () => this.setActiveTab(id));
      this.tabs.set(id, tab);
      nav.appendChild(tab);
    }
    left.appendChild(nav);

    // Panels -----------------------------------------------------------------
    const panels = document.createElement('div');
    panels.className = 'menu-panels';
    left.appendChild(panels);

    const mapsSection = this.makeSection('maps');
    this.mapGrid = document.createElement('div');
    this.mapGrid.className = 'menu-map-grid';
    this.mapInfo = document.createElement('div');
    this.mapInfo.className = 'menu-map-info';
    mapsSection.append(this.mapGrid, this.mapInfo);
    panels.appendChild(mapsSection);

    const characterSection = this.makeSection('character');
    const teamHeading = document.createElement('p');
    teamHeading.className = 'menu-section-hint';
    teamHeading.textContent = 'Pick your side';
    this.teamGrid = document.createElement('div');
    this.teamGrid.className = 'menu-team-grid';
    characterSection.append(teamHeading, this.teamGrid);
    panels.appendChild(characterSection);

    const settingsSection = this.makeSection('settings');
    this.mouseSensitivityInput = this.makeRangeControl(settingsSection, 'Mouse Sensitivity', 0.1, 4, 0.05, this.settings.mouseSensitivity);
    this.worldFovInput = this.makeRangeControl(settingsSection, 'World FOV', 70, 130, 1, this.settings.worldFov);
    this.viewmodelFovInput = this.makeRangeControl(settingsSection, 'Viewmodel FOV', 45, 110, 1, this.settings.viewmodelFov);
    this.viewmodelScaleInput = this.makeRangeControl(settingsSection, 'Viewmodel Scale', 0.25, 3, 0.05, this.settings.viewmodelScale);
    this.autoBhopToggle = this.makeToggleControl(settingsSection, 'Auto-bhop', this.settings.autoBhop);
    this.showHudToggle = this.makeToggleControl(settingsSection, 'Show HUD', this.settings.showHud);
    this.attachSettingsListeners();
    panels.appendChild(settingsSection);

    const ranksSection = this.makeSection('ranks');
    this.leaderboardInfo = document.createElement('div');
    this.leaderboardInfo.className = 'menu-map-info';
    this.leaderboardInfo.textContent = 'Top runs for selected map';
    this.leaderboardList = document.createElement('ol');
    this.leaderboardList.className = 'menu-leaderboard';
    ranksSection.append(this.leaderboardInfo, this.leaderboardList);
    panels.appendChild(ranksSection);

    // Footer -----------------------------------------------------------------
    const footer = document.createElement('div');
    footer.className = 'menu-foot';
    const help = document.createElement('p');
    help.className = 'menu-help';
    help.textContent = 'WASD + Mouse · Space jump · 1/2/3 weapons · R reload · Esc menu';
    footer.appendChild(help);
    footer.appendChild(this.buildCredits());
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
      this.preview = null; // WebGL unavailable — menu still works, just no 3D
    }

    this.setActiveTab('maps');
    parent.appendChild(this.root);
  }

  public setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'grid' : 'none';
    if (visible) {
      this.preview?.start();
    } else {
      this.preview?.stop();
    }
  }

  /** Reflects the authoritative (already-sanitized) player name into the field. */
  public setPlayerName(name: string): void {
    this.nameInput.value = name;
    this.stageName.textContent = name;
  }

  public setMaps(entries: MapManifestEntry[], selectedMapId: string): void {
    this.maps = entries;
    this.selectedMapId = selectedMapId;
    this.renderMapCards();
    this.refreshMapInfo();
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
    this.mouseSensitivityInput.value = settings.mouseSensitivity.toString();
    this.worldFovInput.value = settings.worldFov.toString();
    this.viewmodelFovInput.value = settings.viewmodelFov.toString();
    this.viewmodelScaleInput.value = settings.viewmodelScale.toString();
    this.autoBhopToggle.checked = settings.autoBhop;
    this.showHudToggle.checked = settings.showHud;
  }

  public setLeaderboard(entries: Array<{ name: string; timeMs: number; model: string }>, mapName: string): void {
    this.leaderboardInfo.textContent = `Top runs · ${mapName}`;
    this.leaderboardList.innerHTML = '';
    if (entries.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'menu-leaderboard-empty';
      empty.textContent = 'No runs submitted yet';
      this.leaderboardList.appendChild(empty);
      return;
    }
    entries.slice(0, 10).forEach((entry, index) => {
      const line = document.createElement('li');
      const rank = document.createElement('span');
      rank.className = 'lb-rank';
      rank.textContent = String(index + 1).padStart(2, '0');
      const who = document.createElement('span');
      who.className = 'lb-name';
      who.textContent = entry.name;
      const time = document.createElement('span');
      time.className = 'lb-time';
      time.textContent = `${(entry.timeMs / 1000).toFixed(3)}s`;
      line.append(rank, who, time);
      this.leaderboardList.appendChild(line);
    });
  }

  public dispose(): void {
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
    this.sections.set(id, section);
    return section;
  }

  private setActiveTab(id: TabId): void {
    for (const [tabId, tab] of this.tabs) {
      tab.classList.toggle('is-active', tabId === id);
    }
    for (const [sectionId, section] of this.sections) {
      section.classList.toggle('is-active', sectionId === id);
    }
  }

  private renderMapCards(): void {
    this.mapGrid.innerHTML = '';
    for (const map of this.maps) {
      const card = document.createElement('button');
      card.className = 'menu-map-card';
      card.classList.toggle('is-selected', map.id === this.selectedMapId);
      const name = document.createElement('span');
      name.className = 'menu-map-name';
      name.textContent = map.name;
      const author = document.createElement('span');
      author.className = 'menu-map-author';
      author.textContent = map.author;
      card.append(name, author);
      card.addEventListener('click', () => {
        this.selectedMapId = map.id;
        this.renderMapCards();
        this.refreshMapInfo();
        this.callbacks.onMapSelected(map.id);
      });
      this.mapGrid.appendChild(card);
    }
  }

  private refreshMapInfo(): void {
    const selected = this.maps.find((map) => map.id === this.selectedMapId);
    this.mapInfo.textContent = selected
      ? `${selected.source} · ${selected.license}`
      : 'No map selected';
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
    void this.preview?.setModel(MODEL_BY_TEAM[team]);
    this.renderTeamCards();
    if (emit) {
      const preset = this.loadoutPresets.find((p) => p.team === team);
      if (preset) {
        this.callbacks.onLoadoutChanged({ ...preset.selection });
      }
    }
  }

  private buildCredits(): HTMLDetailsElement {
    const details = document.createElement('details');
    details.className = 'menu-credits';
    const summary = document.createElement('summary');
    summary.textContent = 'Credits & licenses';
    details.appendChild(summary);
    const lines = [
      'Knife animated by DJMaesen — CC Attribution.',
      '"CTM_SAS | CS2 Agent Model" (skfb.ly/oRO6P) by Alex — CC Attribution.',
      '"PHOENIX | CS2 Agent Model" (skfb.ly/oQyER) by Alex — CC Attribution.',
      '"AWP with Anims" by Addison Ye (sketchfab.com/redethox) — CC Attribution.',
    ];
    for (const text of lines) {
      const p = document.createElement('p');
      p.className = 'menu-credit';
      p.textContent = text;
      details.appendChild(p);
    }
    return details;
  }

  private makeRangeControl(
    parent: HTMLElement,
    label: string,
    min: number,
    max: number,
    step: number,
    value: number,
  ): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'range';
    input.min = `${min}`;
    input.max = `${max}`;
    input.step = `${step}`;
    input.value = `${value}`;

    const field = document.createElement('div');
    field.className = 'menu-field menu-field-range';
    const labelEl = document.createElement('span');
    labelEl.className = 'menu-field-label';
    labelEl.textContent = label;
    const readout = document.createElement('span');
    readout.className = 'menu-field-value';
    readout.textContent = value.toFixed(step >= 1 ? 0 : 2);
    field.append(labelEl, readout, input);
    input.addEventListener('input', () => {
      readout.textContent = Number(input.value).toFixed(step >= 1 ? 0 : 2);
    });
    parent.appendChild(field);
    return input;
  }

  private makeToggleControl(parent: HTMLElement, label: string, checked: boolean): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    const field = this.makeField(label, input);
    field.classList.add('menu-field-toggle');
    parent.appendChild(field);
    return input;
  }

  private makeField(label: string, control: HTMLElement): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'menu-field';
    const labelEl = document.createElement('span');
    labelEl.className = 'menu-field-label';
    labelEl.textContent = label;
    wrapper.append(labelEl, control);
    return wrapper;
  }

  private attachSettingsListeners(): void {
    const emit = () => {
      this.settings = {
        mouseSensitivity: Number(this.mouseSensitivityInput.value),
        worldFov: Number(this.worldFovInput.value),
        viewmodelFov: Number(this.viewmodelFovInput.value),
        viewmodelScale: Number(this.viewmodelScaleInput.value),
        autoBhop: this.autoBhopToggle.checked,
        showHud: this.showHudToggle.checked,
      };
      this.callbacks.onSettingsChanged({ ...this.settings });
    };
    this.mouseSensitivityInput.addEventListener('input', emit);
    this.worldFovInput.addEventListener('input', emit);
    this.viewmodelFovInput.addEventListener('input', emit);
    this.viewmodelScaleInput.addEventListener('input', emit);
    this.autoBhopToggle.addEventListener('change', emit);
    this.showHudToggle.addEventListener('change', emit);
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
