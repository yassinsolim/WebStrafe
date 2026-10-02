import { SKIN_INFO } from './catalog';
import type { CharacterLook } from './look';

export interface LookPreset {
  id: string;
  name: string;
  look: CharacterLook;
}

type PresetLook = Omit<CharacterLook, 'tag' | 'watch' | 'helmet' | 'arms' | 'chest' | 'legs' | 'classItem'>
  & Partial<Pick<CharacterLook, 'helmet' | 'arms' | 'chest' | 'legs' | 'classItem'>>;

const preset = (id: string, name: string, look: PresetLook): LookPreset => ({
  id,
  name,
  look: { helmet: 'edge', arms: 'edge', chest: 'edge', legs: 'edge', classItem: 'edge', ...look, tag: '', watch: true },
});

/** built-in starting points: each skin as its artist painted it, repaints, and two kit builds */
export const BUILTIN_PRESETS: readonly LookPreset[] = [
  preset('ronin', 'Ronin', { skin: 'ronin', ...SKIN_INFO.ronin.paint, finish: 'satin', emblem: 'chevron' }),
  preset('sentinel', 'Sentinel', { skin: 'sentinel', ...SKIN_INFO.sentinel.paint, finish: 'satin', emblem: 'reticle' }),
  preset('blackout', 'Blackout', {
    skin: 'ronin', primary: '#141518', secondary: '#0c0c0d', accent: '#9e2231', finish: 'gloss', emblem: 'chevron',
  }),
  preset('whiteout', 'Whiteout', {
    skin: 'ronin', primary: '#d9dde2', secondary: '#2b2e33', accent: '#2f6fd1', finish: 'gloss', emblem: 'reticle',
  }),
  preset('quicksilver', 'Quicksilver', {
    skin: 'ronin', primary: '#8a949f', secondary: '#141518', accent: '#c9a43c', finish: 'metallic', emblem: 'bolt',
  }),
  preset('moss', 'Moss Walker', {
    skin: 'ronin', primary: '#3d4a2f', secondary: '#141518', accent: '#8f8161', finish: 'matte', emblem: 'triad',
  }),
  preset('nightshift', 'Night Shift', {
    skin: 'sentinel', primary: '#2b2e33', secondary: '#1f8a86', accent: '#141518', finish: 'matte', emblem: 'reticle',
  }),
  preset('ember', 'Ember Court', {
    skin: 'sentinel', primary: '#9e2231', secondary: '#141518', accent: '#c9a43c', finish: 'gloss', emblem: 'wing',
  }),
  preset('dune', 'Dune Runner', {
    skin: 'sentinel', primary: '#c2a67a', secondary: '#556043', accent: '#a4502a', finish: 'matte', emblem: 'chevron',
  }),
  preset('harbor', 'Harbor Watch', {
    skin: 'sentinel', primary: '#26334a', secondary: '#8a949f', accent: '#2f5fa8', finish: 'satin', emblem: 'wave',
  }),
  preset('ironside', 'Ironside (kit)', {
    skin: 'kit', helmet: 'anvil', arms: 'anvil', chest: 'anvil', legs: 'anvil', classItem: 'anvil',
    primary: '#4a4f57', secondary: '#c9a43c', accent: '#2b2e33', finish: 'metallic', emblem: 'crown',
  }),
  preset('signal', 'Signal Fire (kit)', {
    skin: 'kit', helmet: 'quill', arms: 'strafe', chest: 'quill', legs: 'strafe', classItem: 'strafe',
    primary: '#e4ddcf', secondary: '#a4502a', accent: '#1f8a86', finish: 'gloss', emblem: 'bolt',
  }),
];
