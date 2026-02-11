import type { CosmeticsManifest, LoadoutSelection } from '../cosmetics/types';
import type { MapManifestEntry } from '../world/types';
import type { GameSettings } from './SettingsStore';

interface MainMenuCallbacks {
  onPlay: (mapId: string) => void;
  onReloadMap: () => void;
  onMapSelected: (mapId: string) => void;
  onSettingsChanged: (settings: GameSettings) => void;
  onLoadoutChanged: (selection: LoadoutSelection) => void;
}

interface LoadoutPreset {
  id: string;
  label: string;
  selection: LoadoutSelection;
}

export class MainMenu {
  private readonly root: HTMLDivElement;
  private readonly playButton: HTMLButtonElement;
  private readonly reloadButton: HTMLButtonElement;
  private readonly mapSelect: HTMLSelectElement;
  private readonly mapInfo: HTMLDivElement;
  private readonly leaderboardInfo: HTMLDivElement;
  private readonly leaderboardList: HTMLOListElement;

  private readonly mouseSensitivityInput: HTMLInputElement;
  private readonly worldFovInput: HTMLInputElement;
  private readonly viewmodelFovInput: HTMLInputElement;
  private readonly viewmodelScaleInput: HTMLInputElement;
  private readonly autoBhopToggle: HTMLInputElement;
  private readonly showHudToggle: HTMLInputElement;

  private readonly loadoutPresetSelect: HTMLSelectElement;

  private maps: MapManifestEntry[] = [];
  private selectedMapId = '';
  private settings: GameSettings;
  private loadoutPresets: LoadoutPreset[] = [];

  constructor(parent: HTMLElement, settings: GameSettings, private readonly callbacks: MainMenuCallbacks) {
    this.settings = { ...settings };
    this.root = document.createElement('div');
    this.root.className = 'main-menu';

    const panel = document.createElement('div');
    panel.className = 'menu-panel';
    this.root.appendChild(panel);

    const title = document.createElement('h1');
    title.textContent = 'WebStrafe';
    panel.appendChild(title);

    const subtitle = document.createElement('p');
    subtitle.className = 'menu-subtitle';
    subtitle.textContent = 'Source-like surf + bhop + air-strafe sandbox';
    panel.appendChild(subtitle);

    this.playButton = document.createElement('button');
    this.playButton.className = 'menu-play';
    this.playButton.textContent = 'Play';
    this.playButton.addEventListener('click', () => {
      this.callbacks.onPlay(this.selectedMapId);
    });
    panel.appendChild(this.playButton);

    this.reloadButton = document.createElement('button');
    this.reloadButton.className = 'menu-play menu-reload';
    this.reloadButton.textContent = 'Restart Run';
    this.reloadButton.addEventListener('click', () => this.callbacks.onReloadMap());
    panel.appendChild(this.reloadButton);

    const mapGroup = this.makeGroup(panel, 'Select Map');
    this.mapSelect = document.createElement('select');
    this.mapSelect.addEventListener('change', () => {
      this.selectedMapId = this.mapSelect.value;
      this.refreshMapInfo();
      this.callbacks.onMapSelected(this.selectedMapId);
    });
    mapGroup.appendChild(this.mapSelect);

    this.mapInfo = document.createElement('div');
    this.mapInfo.className = 'menu-map-info';
    mapGroup.appendChild(this.mapInfo);

    const leaderboardGroup = this.makeGroup(panel, 'Leaderboard');
    this.leaderboardInfo = document.createElement('div');
    this.leaderboardInfo.className = 'menu-map-info';
    this.leaderboardInfo.textContent = 'Top runs for selected map';
    leaderboardGroup.appendChild(this.leaderboardInfo);

    this.leaderboardList = document.createElement('ol');
    this.leaderboardList.className = 'menu-leaderboard';
    leaderboardGroup.appendChild(this.leaderboardList);

    const settingsGroup = this.makeGroup(panel, 'Settings');
    this.mouseSensitivityInput = this.makeRangeControl(
      settingsGroup,
      'Mouse Sensitivity',
      0.1,
      4,
      0.05,
      this.settings.mouseSensitivity,
    );
    this.worldFovInput = this.makeRangeControl(settingsGroup, 'World FOV', 70, 130, 1, this.settings.worldFov);
    this.viewmodelFovInput = this.makeRangeControl(
      settingsGroup,
      'Viewmodel FOV',
      45,
      110,
      1,
      this.settings.viewmodelFov,
    );
    this.viewmodelScaleInput = this.makeRangeControl(
      settingsGroup,
      'Viewmodel Scale',
      0.25,
      3,
      0.05,
      this.settings.viewmodelScale,
    );
    this.autoBhopToggle = this.makeToggleControl(settingsGroup, 'Auto-bhop', this.settings.autoBhop);
    this.showHudToggle = this.makeToggleControl(settingsGroup, 'Show HUD', this.settings.showHud);
    this.attachSettingsListeners();

    const loadoutGroup = this.makeGroup(panel, 'Loadout');
    this.loadoutPresetSelect = document.createElement('select');
    this.loadoutPresetSelect.addEventListener('change', () => this.applyPresetById(this.loadoutPresetSelect.value));
    loadoutGroup.append(this.makeLabeledField('Knife + Gloves', this.loadoutPresetSelect));

    const loadoutCredit = document.createElement('p');
    loadoutCredit.className = 'menu-credit';
    loadoutCredit.textContent =
      'Credit the Creator: knife animated by DJMaesen is licensed under Creative Commons Attribution. He made both.';
    loadoutGroup.appendChild(loadoutCredit);

    const playerModelCredit = document.createElement('p');
    playerModelCredit.className = 'menu-credit';
    playerModelCredit.textContent =
      '"CTM_SAS | CS2 Agent Model" (https://skfb.ly/oRO6P) by Alex is licensed under Creative Commons Attribution (http://creativecommons.org/licenses/by/4.0/).';
    loadoutGroup.appendChild(playerModelCredit);

    const playerModelCreditTwo = document.createElement('p');
    playerModelCreditTwo.className = 'menu-credit';
    playerModelCreditTwo.textContent =
      '"PHOENIX | CS2 Agent Model" (https://skfb.ly/oQyER) by Alex is licensed under Creative Commons Attribution (http://creativecommons.org/licenses/by/4.0/).';
    loadoutGroup.appendChild(playerModelCreditTwo);

    const footer = document.createElement('p');
    footer.className = 'menu-help';
    footer.textContent = 'Controls: WASD + Mouse, LMB/RMB attack, Space jump, R reset, F inspect, Esc menu';
    panel.appendChild(footer);

    parent.appendChild(this.root);
  }

  public setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'grid' : 'none';
  }

  public setMaps(entries: MapManifestEntry[], selectedMapId: string): void {
    this.maps = entries;
    this.mapSelect.innerHTML = '';
    for (const map of entries) {
      const option = document.createElement('option');
      option.value = map.id;
      option.textContent = `${map.name} - ${map.author}`;
      this.mapSelect.appendChild(option);
    }

    this.selectedMapId = selectedMapId;
    this.mapSelect.value = selectedMapId;
    this.refreshMapInfo();
  }

  public setCosmetics(manifest: CosmeticsManifest, selection: LoadoutSelection): void {
    this.loadoutPresets = this.buildLoadoutPresets(manifest);

    this.loadoutPresetSelect.innerHTML = '';
    for (const preset of this.loadoutPresets) {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.label;
      this.loadoutPresetSelect.appendChild(option);
    }

    if (this.loadoutPresets.length === 0) {
      this.loadoutPresetSelect.disabled = true;
      return;
    }

    this.loadoutPresetSelect.disabled = false;
    const selectedPresetId = this.findPresetIdForSelection(selection) ?? this.loadoutPresets[0].id;
    this.loadoutPresetSelect.value = selectedPresetId;
    this.applyPresetById(selectedPresetId, false);
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
    this.leaderboardInfo.textContent = `Top runs for ${mapName}`;
    this.leaderboardList.innerHTML = '';

    if (entries.length === 0) {
      const empty = document.createElement('li');
      empty.textContent = 'No runs submitted yet';
      this.leaderboardList.appendChild(empty);
      return;
    }

    const top = entries.slice(0, 10);
    top.forEach((entry, index) => {
      const line = document.createElement('li');
      const seconds = entry.timeMs / 1000;
      const modelTag = entry.model === 'terrorist' ? 'T' : 'CT';
      line.textContent = `${index + 1}. ${entry.name} - ${seconds.toFixed(3)}s (${modelTag})`;
      this.leaderboardList.appendChild(line);
    });
  }

  private refreshMapInfo(): void {
    const selected = this.maps.find((map) => map.id === this.selectedMapId);
    if (!selected) {
      this.mapInfo.textContent = 'No map selected';
      return;
    }
    this.mapInfo.textContent = `Author: ${selected.author} | Source: ${selected.source} | License: ${selected.license}`;
  }

  private makeGroup(parent: HTMLElement, title: string): HTMLDivElement {
    const group = document.createElement('div');
    group.className = 'menu-group';

    const heading = document.createElement('h2');
    heading.textContent = title;
    group.appendChild(heading);

    parent.appendChild(group);
    return group;
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

    parent.appendChild(this.makeLabeledField(`${label}: ${value}`, input, (next) => {
      const num = Number(next.value);
      next.parentElement?.setAttribute('data-label', `${label}: ${num.toFixed(step >= 1 ? 0 : 2)}`);
    }));

    return input;
  }

  private makeToggleControl(parent: HTMLElement, label: string, checked: boolean): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    parent.appendChild(this.makeLabeledField(label, input));
    return input;
  }

  private makeLabeledField(
    label: string,
    input: HTMLElement,
    onInput?: (input: HTMLInputElement) => void,
  ): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'menu-field';
    wrapper.setAttribute('data-label', label);
    wrapper.appendChild(input);
    if (onInput && input instanceof HTMLInputElement) {
      input.addEventListener('input', () => onInput(input));
    }
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
        label: 'Knife + Gloves 1',
        selection: {
          gloveId: glove.id,
          gloveVariantId: gloveVariantA.id,
          knifeId: knifeA.id,
          knifeVariantId: knifeA.variants[0].id,
        },
      },
      {
        id: 'preset_2',
        label: 'Knife + Gloves 2',
        selection: {
          gloveId: glove.id,
          gloveVariantId: gloveVariantB.id,
          knifeId: knifeB.id,
          knifeVariantId: knifeB.variants[0].id,
        },
      },
    ];
  }

  private findPresetIdForSelection(selection: LoadoutSelection): string | null {
    const matched = this.loadoutPresets.find((preset) =>
      preset.selection.gloveId === selection.gloveId
      && preset.selection.gloveVariantId === selection.gloveVariantId
      && preset.selection.knifeId === selection.knifeId
      && preset.selection.knifeVariantId === selection.knifeVariantId);
    return matched?.id ?? null;
  }

  private applyPresetById(presetId: string, emit = true): void {
    const preset = this.loadoutPresets.find((candidate) => candidate.id === presetId);
    if (!preset) {
      return;
    }
    if (emit) {
      this.callbacks.onLoadoutChanged({ ...preset.selection });
    }
  }
}
