/**
 * capture and test hooks (?shot=, ?qa=1) only exist on the dev server and on
 * vercel preview builds. vite.config.ts sets VITE_DEV_TOOLS for previews;
 * production builds leave it unset, so the hooks are dead there.
 */
export function devToolsEnabled(env: Record<string, unknown> | undefined = (import.meta as { env?: Record<string, unknown> }).env): boolean {
  return env?.DEV === true || env?.VITE_DEV_TOOLS === 'true';
}
