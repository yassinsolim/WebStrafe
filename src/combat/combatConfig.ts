/**
 * Combat feature flag. Off by default so existing solo/surf play is completely
 * unaffected until combat is explicitly enabled via `VITE_ENABLE_COMBAT=true`.
 */
export function isCombatEnabled(): boolean {
  // import.meta.env is provided by Vite; guard for non-Vite (test) contexts.
  const env = (import.meta as { env?: Record<string, unknown> }).env;
  return env?.VITE_ENABLE_COMBAT === 'true' || env?.VITE_ENABLE_COMBAT === true;
}
