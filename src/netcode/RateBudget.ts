/**
 * Supabase Realtime counts every broadcast twice against the project cap: once
 * when a client sends it and once per client it is delivered to. With N peers
 * each broadcasting at r Hz that is N * r sent + N * (N - 1) * r delivered, so
 * N^2 * r events per second. The free plan disconnects the whole project
 * (`tenant_events`) above 100/s.
 */
export const SUPABASE_FREE_EVENTS_PER_SEC = 100;

export interface BudgetOptions {
  /** events/s allowed for position traffic (leave headroom for combat events) */
  budget: number;
  maxHz: number;
  minHz: number;
}

/**
 * Largest room the budget can serve: 80 / 6^2 = 2.2 Hz per client. At 7 the
 * 2 Hz floor would put a room at 98 events/s before any combat traffic, and
 * from 8 the floor alone passes the 100/s cap, so rooms stop at 6.
 */
export const MAX_ROOM_PLAYERS = 6;

export const DEFAULT_BUDGET: BudgetOptions = {
  budget: 80,
  maxHz: 20,
  minHz: 2,
};

/** Per-client state broadcast rate that keeps a room of `peers` inside the budget. */
export function broadcastRateHz(peers: number, options: BudgetOptions = DEFAULT_BUDGET): number {
  const n = Math.max(1, Math.floor(peers));
  const hz = options.budget / (n * n);
  return Math.max(options.minHz, Math.min(options.maxHz, hz));
}

/** Total project events/s a room generates at a given per-client rate. */
export function roomEventsPerSecond(peers: number, hz: number): number {
  const n = Math.max(1, Math.floor(peers));
  return n * n * hz;
}
