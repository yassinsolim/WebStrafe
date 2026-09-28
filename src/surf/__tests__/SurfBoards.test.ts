import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SurfBoards } from '../SurfBoards';

function fakeClient(opts: { rpc?: (fn: string, args: unknown) => unknown; rows?: unknown[]; error?: unknown }) {
  const query: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'limit', 'not']) query[m] = vi.fn(() => query);
  query.then = (resolve: (v: unknown) => void) => resolve({ data: opts.error ? null : opts.rows ?? [], error: opts.error ?? null });
  const client = {
    from: vi.fn(() => query),
    rpc: vi.fn(async (fn: string, args: unknown) => {
      if (opts.error) return { data: null, error: opts.error };
      return { data: opts.rpc?.(fn, args) ?? null, error: null };
    }),
  };
  return client as unknown as SupabaseClient & { from: ReturnType<typeof vi.fn>; rpc: ReturnType<typeof vi.fn> };
}

describe('SurfBoards', () => {
  it('maps board rows and rpc results', async () => {
    const client = fakeClient({
      rows: [{ id: 'r1', name: 'A', model: 'counterterrorist', time_ms: 12345, stage_ms: [5000, 7345], pvp: true, has_ghost: true, created_at: 'x' }],
      rpc: (fn) => (fn === 'webstrafe_start_run' ? 'tok' : { ok: true, rank: 2, personal_best: true }),
    });
    const boards = new SurfBoards(async () => client);
    expect(await boards.fetchMapBoard('surf_x')).toEqual([
      { id: 'r1', name: 'A', model: 'counterterrorist', timeMs: 12345, stageMs: [5000, 7345], pvp: true, hasGhost: true, createdAt: 'x' },
    ]);
    expect(await boards.startRun('surf_x')).toBe('tok');
    const res = await boards.submitRun({ token: 'tok', name: 'A', model: 'terrorist', ticks: 1280, splits: [640], pvp: false, ghost: null });
    expect(res).toEqual({ ok: true, reason: undefined, rank: 2, personalBest: true });
    expect(client.rpc).toHaveBeenCalledWith('webstrafe_submit_run', expect.objectContaining({ p_ticks: 1280, p_splits: [640] }));
  });

  it('goes quiet once the migration is missing', async () => {
    const client = fakeClient({ error: { code: 'PGRST205', message: 'Could not find the table' } });
    const boards = new SurfBoards(async () => client);
    expect(await boards.fetchKills('daily')).toEqual([]);
    expect(boards.available).toBe(false);
    expect(await boards.startRun('surf_x')).toBeNull();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('keeps trying after an ordinary error (rate limit, network)', async () => {
    const client = fakeClient({ error: { code: '53400', message: 'rate limited' } });
    const boards = new SurfBoards(async () => client);
    expect(await boards.startRun('surf_x')).toBeNull();
    expect(boards.available).toBe(true);
  });

  it('is a no-op without a supabase config', async () => {
    const boards = new SurfBoards(async () => null);
    expect(await boards.fetchMapBoard('surf_x')).toEqual([]);
    expect(await boards.submitRun({ token: 't', name: 'A', model: 'terrorist', ticks: 1, splits: [], pvp: false, ghost: null })).toBeNull();
  });
});
