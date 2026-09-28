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
 * Largest room the budget can serve: 64 / 6^2 = 1.8 Hz per client, 65 events/s
 * of position traffic. At 7 the 1.8 Hz floor alone would be 88/s before any
 * combat, so rooms stop at 6.
 */
export const MAX_ROOM_PLAYERS = 6;

/**
 * Position traffic gets 64 of the 100 events/s. Fires and combat results ride
 * on state messages but each shot still costs ~12 events (request to every peer,
 * result to every peer), so a full room lands near 71/s at 2 shots/s and 85/s
 * at 4 shots/s. Going lower barely helps heavy combat and costs interpolation.
 * A full 6-player room runs at 1.8 Hz, which RemoteTimeline and the 1 s rewind
 * window cover (556 ms interval, ~616 ms render delay).
 */
export const DEFAULT_BUDGET: BudgetOptions = {
  budget: 64,
  maxHz: 20,
  minHz: 1.8,
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
