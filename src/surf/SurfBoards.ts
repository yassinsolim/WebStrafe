import type { SupabaseClient } from '@supabase/supabase-js';
import { loadSupabaseConfig } from '../network/supabaseConfig';
import type { PlayerModel } from '../network/types';

/**
 * client for the ranked surf runs and kill boards (supabase/migrations). every
 * call degrades to null / [] instead of throwing, and once the server says the
 * tables or functions don't exist (migration not run yet) it stops asking, so
 * the game plays exactly like before on a project without them.
 */

export interface RunBoardRow {
  id: string;
  name: string;
  model: PlayerModel;
  timeMs: number;
  stageMs: number[];
  pvp: boolean;
  hasGhost: boolean;
  createdAt: string;
}

export interface StageBoardRow {
  runId: string;
  name: string;
  timeMs: number;
  createdAt: string;
}

export interface KillBoardRow {
  name: string;
  kills: number;
  deaths: number;
}

export interface SubmitResult {
  ok: boolean;
  reason?: string;
  rank?: number;
  personalBest?: boolean;
}

export type KillPeriod = 'daily' | 'alltime';

/** postgrest / postgres codes for a missing table, view or function */
const MISSING_CODES = new Set(['42P01', '42883', 'PGRST202', 'PGRST205', 'PGRST204']);

interface PgError {
  code?: string;
  message?: string;
}

function isMissing(error: PgError | null): boolean {
  return !!error && (MISSING_CODES.has(error.code ?? '') || /does not exist|could not find/i.test(error.message ?? ''));
}

export class SurfBoards {
  private clientPromise: Promise<SupabaseClient | null> | undefined;
  private missing = false;

  constructor(private readonly makeClient?: () => Promise<SupabaseClient | null>) {}

  /** false once the server showed the migration isn't there */
  get available(): boolean {
    return !this.missing;
  }

  async startRun(mapId: string): Promise<string | null> {
    const res = await this.rpc<string>('webstrafe_start_run', { p_map_id: mapId });
    return typeof res === 'string' ? res : null;
  }

  async submitRun(input: {
    token: string;
    name: string;
    model: PlayerModel;
    ticks: number;
    splits: number[];
    pvp: boolean;
    ghost: string | null;
  }): Promise<SubmitResult | null> {
    const res = await this.rpc<Record<string, unknown>>('webstrafe_submit_run', {
      p_token: input.token,
      p_name: input.name,
      p_model: input.model,
      p_ticks: input.ticks,
      p_splits: input.splits,
      p_pvp: input.pvp,
      p_ghost: input.ghost,
    });
    if (!res || typeof res !== 'object') return null;
    return {
      ok: res.ok === true,
      reason: typeof res.reason === 'string' ? res.reason : undefined,
      rank: typeof res.rank === 'number' ? res.rank : undefined,
      personalBest: res.personal_best === true,
    };
  }

  async fetchMapBoard(mapId: string, limit = 25): Promise<RunBoardRow[]> {
    const rows = await this.select<Record<string, unknown>>((c) => c
      .from('webstrafe_run_bests')
      .select('id, name, model, time_ms, stage_ms, pvp, has_ghost, created_at')
      .eq('map_id', mapId)
      .order('time_ms', { ascending: true })
      .limit(limit));
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      model: r.model === 'counterterrorist' ? 'counterterrorist' : 'terrorist',
      timeMs: Number(r.time_ms),
      stageMs: Array.isArray(r.stage_ms) ? r.stage_ms.map(Number) : [],
      pvp: r.pvp === true,
      hasGhost: r.has_ghost === true,
      createdAt: String(r.created_at),
    }));
  }

  async fetchStageBoard(mapId: string, stage: number, limit = 25): Promise<StageBoardRow[]> {
    const rows = await this.select<Record<string, unknown>>((c) => c
      .from('webstrafe_stage_bests')
      .select('run_id, name, time_ms, created_at')
      .eq('map_id', mapId)
      .eq('stage', stage)
      .order('time_ms', { ascending: true })
      .limit(limit));
    return rows.map((r) => ({
      runId: String(r.run_id),
      name: String(r.name),
      timeMs: Number(r.time_ms),
      createdAt: String(r.created_at),
    }));
  }

  /** the world record's ghost, if it kept one */
  async fetchRecordGhost(mapId: string): Promise<{ name: string; timeMs: number; ghost: string } | null> {
    const rows = await this.select<Record<string, unknown>>((c) => c
      .from('webstrafe_runs')
      .select('name, time_ms, ghost')
      .eq('map_id', mapId)
      .not('ghost', 'is', null)
      .order('time_ms', { ascending: true })
      .limit(1));
    const r = rows[0];
    return r && typeof r.ghost === 'string'
      ? { name: String(r.name), timeMs: Number(r.time_ms), ghost: r.ghost }
      : null;
  }

  async startSession(name: string, mapId: string): Promise<string | null> {
    const res = await this.rpc<string>('webstrafe_start_session', { p_name: name, p_map_id: mapId });
    return typeof res === 'string' ? res : null;
  }

  async reportSession(sessionId: string, kills: number, deaths: number): Promise<boolean> {
    const res = await this.rpc<Record<string, unknown>>('webstrafe_report_session', {
      p_session: sessionId,
      p_kills: kills,
      p_deaths: deaths,
    });
    return !!res && res.ok === true;
  }

  async fetchKills(period: KillPeriod, limit = 25): Promise<KillBoardRow[]> {
    const view = period === 'daily' ? 'webstrafe_kills_daily' : 'webstrafe_kills_alltime';
    const rows = await this.select<Record<string, unknown>>((c) => c
      .from(view)
      .select('name, kills, deaths')
      .order('kills', { ascending: false })
      .limit(limit));
    return rows.map((r) => ({ name: String(r.name), kills: Number(r.kills) || 0, deaths: Number(r.deaths) || 0 }));
  }

  private client(): Promise<SupabaseClient | null> {
    if (this.clientPromise === undefined) {
      this.clientPromise = this.makeClient ? this.makeClient() : defaultClient();
    }
    return this.clientPromise;
  }

  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T | null> {
    if (this.missing) return null;
    const client = await this.client();
    if (!client) return null;
    try {
      const { data, error } = await client.rpc(fn, args);
      if (error) {
        if (isMissing(error)) this.missing = true;
        return null;
      }
      return data as T;
    } catch {
      return null;
    }
  }

  private async select<T>(
    build: (c: SupabaseClient) => PromiseLike<{ data: unknown; error: PgError | null }>,
  ): Promise<T[]> {
    if (this.missing) return [];
    const client = await this.client();
    if (!client) return [];
    try {
      const { data, error } = await build(client);
      if (error) {
        if (isMissing(error)) this.missing = true;
        return [];
      }
      return Array.isArray(data) ? (data as T[]) : [];
    } catch {
      return [];
    }
  }
}

async function defaultClient(): Promise<SupabaseClient | null> {
  // local qa builds can point the boards at a throwaway database (tools/surf/test-migrations.sh --serve)
  const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
  const override = env.VITE_SURF_BOARDS_URL && env.VITE_SURF_BOARDS_KEY
    ? { supabaseUrl: env.VITE_SURF_BOARDS_URL, supabaseKey: env.VITE_SURF_BOARDS_KEY }
    : null;
  const config = override ?? await loadSupabaseConfig();
  if (!config) return null;
  try {
    const { createClient } = await import('@supabase/supabase-js');
    return createClient(config.supabaseUrl, config.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: 'webstrafe-surf-boards' },
    });
  } catch {
    return null;
  }
}

let shared: SurfBoards | null = null;

/** one client for the menu and the game */
export function getSurfBoards(): SurfBoards {
  shared ??= new SurfBoards();
  return shared;
}
