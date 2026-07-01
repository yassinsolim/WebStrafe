import type { SupabaseClient } from '@supabase/supabase-js';
import type { LeaderboardEntry, PlayerModel } from './types';

interface LeaderboardRow {
  id: string;
  map_id: string;
  name: string;
  time_ms: number;
  model: string;
  created_at: string;
}

/**
 * Supabase-backed leaderboard (the serverless deploy path). Reads/writes the
 * configured table with the publishable key; writes are bounded by row-level
 * security policies on the table (see supabase/schema.sql). All methods degrade
 * to an empty list rather than throwing, so a missing table / policy can't crash
 * the menu.
 */
export class SupabaseLeaderboard {
  constructor(
    private readonly client: SupabaseClient,
    private readonly table: string,
  ) {}

  async fetch(mapId: string): Promise<LeaderboardEntry[]> {
    const { data, error } = await this.client
      .from(this.table)
      .select('id, map_id, name, time_ms, model, created_at')
      .eq('map_id', mapId)
      .order('time_ms', { ascending: true })
      .limit(50);
    if (error || !data) {
      return [];
    }
    return (data as LeaderboardRow[]).map(toEntry);
  }

  async submit(mapId: string, name: string, timeMs: number, model: PlayerModel): Promise<LeaderboardEntry[]> {
    const { error } = await this.client
      .from(this.table)
      .insert({ map_id: mapId, name, time_ms: Math.round(timeMs), model });
    if (error) {
      throw new Error(error.message);
    }
    return this.fetch(mapId);
  }
}

function toEntry(row: LeaderboardRow): LeaderboardEntry {
  return {
    id: row.id,
    mapId: row.map_id,
    name: row.name,
    timeMs: row.time_ms,
    model: row.model === 'counterterrorist' ? 'counterterrorist' : 'terrorist',
    createdAt: row.created_at,
  };
}
