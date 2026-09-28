import type { CharacterLook } from './look';

export interface LookPreset {
  id: string;
  name: string;
  look: CharacterLook;
}

const preset = (id: string, name: string, look: Omit<CharacterLook, 'tag' | 'watch'>): LookPreset => ({
  id,
  name,
  look: { ...look, tag: '', watch: true },
});

/** built-in starting points; several mix sets on purpose to show pieces swap freely */
export const BUILTIN_PRESETS: readonly LookPreset[] = [
  preset('dune', 'Dune Runner', {
    helmet: 'strafe', arms: 'strafe', chest: 'strafe', legs: 'strafe', classItem: 'strafe',
    primary: '#c2a67a', secondary: '#556043', accent: '#a4502a', finish: 'worn', emblem: 'chevron',
  }),
  preset('harbor', 'Harbor Watch', {
    helmet: 'strafe', arms: 'anvil', chest: 'strafe', legs: 'anvil', classItem: 'none',
    primary: '#26334a', secondary: '#8a949f', accent: '#2f5fa8', finish: 'satin', emblem: 'wave',
  }),
  preset('ironside', 'Ironside', {
    helmet: 'anvil', arms: 'anvil', chest: 'anvil', legs: 'anvil', classItem: 'anvil',
    primary: '#4a4f57', secondary: '#c9a43c', accent: '#2b2e33', finish: 'metallic', emblem: 'crown',
  }),
  preset('nightshift', 'Night Shift', {
    helmet: 'vector', arms: 'vector', chest: 'vector', legs: 'vector', classItem: 'vector',
    primary: '#2b2e33', secondary: '#141518', accent: '#1f8a86', finish: 'matte', emblem: 'reticle',
  }),
  preset('snowline', 'Snowline', {
    helmet: 'vector', arms: 'strafe', chest: 'vector', legs: 'strafe', classItem: 'vector',
    primary: '#e4ddcf', secondary: '#8a949f', accent: '#9e2231', finish: 'satin', emblem: 'star',
  }),
  preset('ember', 'Ember Court', {
    helmet: 'quill', arms: 'quill', chest: 'quill', legs: 'quill', classItem: 'quill',
    primary: '#9e2231', secondary: '#141518', accent: '#c9a43c', finish: 'gloss', emblem: 'wing',
  }),
  preset('moss', 'Moss Walker', {
    helmet: 'vector', arms: 'vector', chest: 'anvil', legs: 'vector', classItem: 'vector',
    primary: '#3d4a2f', secondary: '#8f8161', accent: '#8cc63f', finish: 'matte', emblem: 'triad',
  }),
  preset('signal', 'Signal Fire', {
    helmet: 'quill', arms: 'strafe', chest: 'quill', legs: 'strafe', classItem: 'strafe',
    primary: '#e4ddcf', secondary: '#a4502a', accent: '#1f8a86', finish: 'gloss', emblem: 'bolt',
  }),
];
