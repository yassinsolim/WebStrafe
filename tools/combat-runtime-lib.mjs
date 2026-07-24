export const DEFAULT_COMBAT_VERIFY_MS = 90_000;
export const MIN_COMBAT_VERIFY_MS = 1_000;
export const MAX_COMBAT_VERIFY_MS = 86_400_000;

export function asError(value, fallback = 'Unknown runtime failure') {
  if (value instanceof Error) return value;
  return new Error(value === undefined ? fallback : String(value));
}

export function parseCombatVerifyDuration(raw) {
  const value = raw === undefined ? String(DEFAULT_COMBAT_VERIFY_MS) : raw;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new Error(
      `COMBAT_VERIFY_MS must be a base-10 integer from ${MIN_COMBAT_VERIFY_MS}`
        + ` to ${MAX_COMBAT_VERIFY_MS}; received ${JSON.stringify(value)}`,
    );
  }

  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed)
    || parsed < MIN_COMBAT_VERIFY_MS
    || parsed > MAX_COMBAT_VERIFY_MS
  ) {
    throw new Error(
      `COMBAT_VERIFY_MS must be a safe integer from ${MIN_COMBAT_VERIFY_MS}`
        + ` to ${MAX_COMBAT_VERIFY_MS}; received ${JSON.stringify(value)}`,
    );
  }
  return parsed;
}

export function parseProtocolMessage(raw, context) {
  let payload;
  try {
    const text = typeof raw === 'string' ? raw : raw.toString();
    payload = JSON.parse(text);
  } catch (error) {
    throw new Error(`${context} received malformed JSON`, { cause: asError(error) });
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`${context} expected a JSON object`);
  }
  if (typeof payload.type !== 'string' || payload.type.length === 0) {
    throw new Error(`${context} expected a non-empty string message type`);
  }
  return payload;
}
