import { MultiplayerClient } from './MultiplayerClient';
import type { MultiplayerTransport } from './MultiplayerTransport';
import { loadSupabaseConfig } from './supabaseConfig';

/**
 * Picks the multiplayer transport: Supabase Realtime when a config is present
 * (serverless — the deployed default), otherwise the self-hosted WebSocket
 * client (local dev / LAN). Falls back to WebSocket if the Supabase SDK fails
 * to load for any reason.
 */
export async function createMultiplayer(): Promise<MultiplayerTransport> {
  const config = await loadSupabaseConfig();
  if (!config) {
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
