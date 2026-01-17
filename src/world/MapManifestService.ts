import type { MapManifest, MapManifestEntry } from './types';

export async function loadBuiltinManifest(): Promise<MapManifestEntry[]> {
  const response = await fetch('/maps/manifest.json');
  if (!response.ok) {
    throw new Error(`Failed to load map manifest: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as MapManifest;
  return payload.maps ?? [];
}
