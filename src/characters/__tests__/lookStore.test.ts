import { describe, expect, it } from 'vitest';
import { defaultLook } from '../look';
import {
  deleteNamedLook,
  hasStoredLook,
  loadLook,
  loadSavedLooks,
  LOOK_STORAGE_KEY,
  MAX_SAVED_LOOKS,
  saveLook,
  saveNamedLook,
} from '../lookStore';

class MemoryStorage {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe('look persistence', () => {
  it('falls back to the team default when nothing is stored', () => {
    const store = new MemoryStorage();
    expect(hasStoredLook(store)).toBe(false);
    expect(loadLook('counterterrorist', store)).toEqual(defaultLook('counterterrorist'));
  });

  it('saves and loads a look', () => {
    const store = new MemoryStorage();
    const look = { ...defaultLook(), helmet: 'anvil' as const, tag: 'ACE' };
    saveLook(look, store);
    expect(hasStoredLook(store)).toBe(true);
    expect(loadLook('counterterrorist', store)).toEqual(look);
  });

  it('survives corrupt storage', () => {
    const store = new MemoryStorage();
    store.setItem(LOOK_STORAGE_KEY, '{not json');
    expect(loadLook('terrorist', store)).toEqual(defaultLook('terrorist'));
    store.setItem(LOOK_STORAGE_KEY, JSON.stringify({ look: { helmet: 'nope', primary: 'red' }, saved: 'x' }));
    expect(loadLook('terrorist', store)).toEqual(defaultLook('terrorist'));
    expect(loadSavedLooks(store)).toEqual([]);
  });

  it('keeps named presets capped and replaces by name', () => {
    const store = new MemoryStorage();
    for (let i = 0; i < MAX_SAVED_LOOKS + 2; i += 1) {
      saveNamedLook(`look ${i}`, { ...defaultLook(), tag: `T${i}` }, store);
    }
    let saved = loadSavedLooks(store);
    expect(saved).toHaveLength(MAX_SAVED_LOOKS);
    expect(saved[0].name).toBe('look 2');
    saved = saveNamedLook('look 2', { ...defaultLook(), tag: 'NEW' }, store);
    expect(saved.filter((s) => s.name === 'look 2')).toHaveLength(1);
    expect(saved.at(-1)?.look.tag).toBe('NEW');
    saved = deleteNamedLook('look 2', store);
    expect(saved.some((s) => s.name === 'look 2')).toBe(false);
    // presets never create a current look on their own
    expect(hasStoredLook(store)).toBe(false);
  });
});
