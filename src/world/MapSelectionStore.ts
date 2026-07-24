const STORAGE_KEY = 'webstrafe-selected-map-v1';

interface MapSelectionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function resolveSelectedMapId(
  storedMapId: string | null,
  availableMapIds: Iterable<string>,
  fallbackMapId: string,
): string {
  if (!storedMapId) return fallbackMapId;
  for (const mapId of availableMapIds) {
    if (mapId === storedMapId) return storedMapId;
  }
  return fallbackMapId;
}

export function loadSelectedMapId(
  availableMapIds: Iterable<string>,
  fallbackMapId: string,
  storage: MapSelectionStorage = localStorage,
): string {
  try {
    return resolveSelectedMapId(storage.getItem(STORAGE_KEY), availableMapIds, fallbackMapId);
  } catch {
    return fallbackMapId;
  }
}

export function saveSelectedMapId(
  mapId: string,
  storage: MapSelectionStorage = localStorage,
): boolean {
  try {
    storage.setItem(STORAGE_KEY, mapId);
    return true;
  } catch {
    return false;
  }
}
