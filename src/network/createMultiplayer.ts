import { MultiplayerClient } from './MultiplayerClient';
import type { MultiplayerTransport } from './MultiplayerTransport';
import { loadSupabaseConfig } from './supabaseConfig';

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

export async function createMultiplayer(): Promise<MultiplayerTransport> {
  const config = await loadSupabaseConfig();
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
