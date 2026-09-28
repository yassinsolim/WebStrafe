import { MultiplayerClient } from './MultiplayerClient';
import type { MultiplayerTransport } from './MultiplayerTransport';
import { loadSupabaseConfig } from './supabaseConfig';
import { devToolsEnabled } from '../app/devTools';

/**
 * Picks the multiplayer transport: Supabase Realtime when a config is present
 * (serverless — the deployed default), otherwise the self-hosted WebSocket
 * client (local dev / LAN). Falls back to WebSocket if the Supabase SDK fails
 * to load for any reason.
 */
export type TransportChoice = 'ws' | 'supabase';

/**
 * VITE_MULTIPLAYER_TRANSPORT=ws forces the dedicated server even when a
 * Supabase config is present (used to point a Vercel preview at the Fly
 * server while production stays on Supabase). Anything else keeps the default:
 * Supabase when configured, WebSocket otherwise.
 */
export function pickTransport(forced: unknown, hasSupabaseConfig: boolean): TransportChoice {
  if (forced === 'ws') return 'ws';
  if (forced === 'supabase' && hasSupabaseConfig) return 'supabase';
  return hasSupabaseConfig ? 'supabase' : 'ws';
}

/**
 * ?room=<id> on dev and preview builds puts the tab in its own lobby, so qa
 * runs never share a room with anyone else. production ignores it.
 */
export function qaRoomPrefix(prefix: string, search: string, devTools: boolean): string {
  if (!devTools) return prefix;
  const room = new URLSearchParams(search).get('room')?.replace(/[^a-z0-9]/gi, '').slice(0, 24);
  return room ? `${prefix}_qa${room.toLowerCase()}` : prefix;
}

export async function createMultiplayer(): Promise<MultiplayerTransport> {
  const loaded = await loadSupabaseConfig();
  const config = loaded && typeof location !== 'undefined'
    ? { ...loaded, lobbyChannelPrefix: qaRoomPrefix(loaded.lobbyChannelPrefix, location.search, devToolsEnabled(import.meta.env)) }
    : loaded;
  if (!config || pickTransport(import.meta.env.VITE_MULTIPLAYER_TRANSPORT, true) === 'ws') {
    return new MultiplayerClient();
  }
  try {
    const [{ createClient }, { SupabaseMultiplayer }] = await Promise.all([
      import('@supabase/supabase-js'),
      import('./SupabaseMultiplayer'),
    ]);
    const client = createClient(config.supabaseUrl, config.supabaseKey, {
      realtime: { params: { eventsPerSecond: 20 } },
    });
    return new SupabaseMultiplayer(client, config);
  } catch {
    return new MultiplayerClient();
  }
}
