import type { IncomingHttpHeaders } from 'node:http';

export interface OriginPolicy {
  /** exact origins, e.g. https://strafe.yassin.app */
  exact: ReadonlySet<string>;
  /** https hostname suffixes, e.g. -yassins-projects-11732a5e.vercel.app for one team's previews */
  hostSuffixes: readonly string[];
}

function list(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export function readOriginPolicy(env: NodeJS.ProcessEnv): OriginPolicy {
  return {
    exact: new Set(list(env.WEBSTRAFE_ALLOWED_ORIGINS)),
    hostSuffixes: list(env.WEBSTRAFE_ALLOWED_ORIGIN_SUFFIXES),
  };
}

/**
 * Browsers always send Origin on websocket upgrades; non-browser clients
 * (bots, the bench) may omit it and are allowed. Localhost is always allowed
 * for development.
 */
export function isOriginAllowed(origin: string | undefined, policy: OriginPolicy): boolean {
  if (!origin) {
    return true;
  }
  if (policy.exact.has(origin)) {
    return true;
  }
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    return true;
  }
  // suffix matches only count over https and must include the leading separator,
  // so "evil-yassins-projects.vercel.app.attacker.com" can't sneak through
  return url.protocol === 'https:'
    && policy.hostSuffixes.some((suffix) => url.hostname.endsWith(suffix) && url.hostname.length > suffix.length);
}

/**
 * Client ip for rate limiting. X-Forwarded-For keeps whatever the client sent
 * in front of the proxy's own entry, so its first value is spoofable. Behind
 * Fly (TRUST_PROXY=fly) the edge sets Fly-Client-IP itself, which is the only
 * header worth trusting there.
 */
export function clientIp(
  headers: IncomingHttpHeaders,
  socketAddress: string | undefined,
  trustProxy: string | undefined,
): string {
  if (trustProxy === 'fly') {
    const fly = headers['fly-client-ip'];
    if (typeof fly === 'string' && fly.length > 0) {
      return fly.trim();
    }
  } else if (trustProxy === '1') {
    const forwarded = headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0].trim();
    }
  }
  return socketAddress ?? 'unknown';
}
