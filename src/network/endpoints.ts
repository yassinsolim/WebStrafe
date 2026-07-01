/**
 * Resolves the backend WebSocket / API endpoints. In a single-origin deploy
 * (the Node server serving the built client), these fall back to the current
 * origin. In a split deploy (static client on Vercel, WS backend elsewhere),
 * set VITE_WS_URL and VITE_API_BASE at build time to point at the backend.
 */

export interface EndpointEnv {
  VITE_WS_URL?: string;
  VITE_API_BASE?: string;
  [key: string]: unknown;
}

export interface LocationLike {
  protocol: string;
  host: string;
}

/** Full ws(s):// URL for the multiplayer socket. */
export function resolveWsUrl(env: EndpointEnv, location: LocationLike): string {
  if (env.VITE_WS_URL) {
    return env.VITE_WS_URL;
  }
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws`;
}

/**
 * Base for REST calls (e.g. the leaderboard). Empty string means "same origin"
 * (relative `/api/...`). A configured base has any trailing slash trimmed.
 */
export function resolveApiBase(env: EndpointEnv): string {
  const base = env.VITE_API_BASE;
  return base ? base.replace(/\/+$/, '') : '';
}
