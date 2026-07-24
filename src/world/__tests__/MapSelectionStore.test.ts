import { describe, expect, it } from 'vitest';
import {
  loadSelectedMapId,
  resolveSelectedMapId,
  saveSelectedMapId,
} from '../MapSelectionStore';

describe('MapSelectionStore', () => {
  it('restores an available normal map selection', () => {
    expect(
      resolveSelectedMapId(
        'movement_test_scene',
        ['surf_skyworld_x', 'movement_test_scene'],
        'surf_skyworld_x',
      ),
    ).toBe('movement_test_scene');
  });

  it.each([null, '', 'removed-map'])(
    'falls back when the stored map is missing or invalid (%s)',
    (storedMapId) => {
      expect(
        resolveSelectedMapId(
          storedMapId,
          ['surf_skyworld_x', 'movement_test_scene'],
          'surf_skyworld_x',
        ),
      ).toBe('surf_skyworld_x');
    },
  );

  it('uses storage and safely falls back when storage reads fail', () => {
    const failingStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => undefined,
    };
    expect(loadSelectedMapId(['movement_test_scene'], 'movement_test_scene', failingStorage))
      .toBe('movement_test_scene');
  });

  it('writes the selected map through the established storage contract', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    expect(saveSelectedMapId('movement_test_scene', storage)).toBe(true);
    expect(loadSelectedMapId(['movement_test_scene'], 'fallback', storage))
      .toBe('movement_test_scene');
  });

  it('reports blocked writes without interrupting map loading', () => {
    const blockedStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(saveSelectedMapId('movement_test_scene', blockedStorage)).toBe(false);
  });
});
