export const DEFAULT_COMBAT_VERIFY_MS: number;
export const MIN_COMBAT_VERIFY_MS: number;
export const MAX_COMBAT_VERIFY_MS: number;

export function asError(value: unknown, fallback?: string): Error;
export function parseCombatVerifyDuration(raw: string | undefined): number;
export function parseProtocolMessage(
  raw: string | { toString(): string },
  context: string,
): Record<string, unknown> & { type: string };
