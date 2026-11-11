/**
 * capture and test hooks (?shot=, ?qa=1) only exist on the dev server and on
 * builds made with VITE_DEV_TOOLS=true. production builds leave it unset, so
 * the hooks are dead there.
 */
export function devToolsEnabled(env: Record<string, unknown> | undefined = (import.meta as { env?: Record<string, unknown> }).env): boolean {
  return env?.DEV === true || env?.VITE_DEV_TOOLS === 'true';
}
