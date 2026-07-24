import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBAT_VERIFY_MS,
  MAX_COMBAT_VERIFY_MS,
  parseCombatVerifyDuration,
  parseProtocolMessage,
} from '../tools/combat-runtime-lib.mjs';

describe('parseCombatVerifyDuration', () => {
  it('uses the documented default only when the variable is absent', () => {
    expect(parseCombatVerifyDuration(undefined)).toBe(DEFAULT_COMBAT_VERIFY_MS);
  });

  it.each(['1000invalid', ' 1000', '1000 ', '1e3', '0x1000', '', '-1000', '1.5'])(
    'rejects the complete malformed value %j',
    (value) => {
      expect(() => parseCombatVerifyDuration(value)).toThrow(/COMBAT_VERIFY_MS/);
    },
  );

  it('accepts bounded safe base-10 integers', () => {
    expect(parseCombatVerifyDuration('1000')).toBe(1000);
    expect(parseCombatVerifyDuration(String(MAX_COMBAT_VERIFY_MS))).toBe(MAX_COMBAT_VERIFY_MS);
  });

  it.each(['999', String(MAX_COMBAT_VERIFY_MS + 1), '9007199254740992'])(
    'rejects the out-of-range value %s',
    (value) => {
      expect(() => parseCombatVerifyDuration(value)).toThrow(/safe integer|base-10 integer/);
    },
  );
});

describe('parseProtocolMessage', () => {
  it('returns protocol objects with a string type', () => {
    expect(parseProtocolMessage(Buffer.from('{"type":"welcome"}'), 'probe')).toEqual({
      type: 'welcome',
    });
  });

  it.each(['not-json', 'null', '[]', '{}', '{"type":42}'])(
    'rejects malformed JSON or protocol payload %s',
    (value) => {
      expect(() => parseProtocolMessage(Buffer.from(value), 'probe')).toThrow(/probe/);
    },
  );
});
