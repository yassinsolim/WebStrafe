import { describe, expect, it } from 'vitest';
import { decodeCosmetics, encodeCosmetics, sameCosmetics } from '../cosmetics';

describe('player cosmetics wire form', () => {
  it('round trips a knife with finish, wear and seed plus armour', () => {
    const c = { knife: { id: 'karambit' as const, finish: 'doppler_ruby', wear: 0.012, seed: 412 }, armor: { helmet: 'h2', vest: 'v1' } };
    const back = decodeCosmetics(JSON.parse(JSON.stringify(encodeCosmetics(c))));
    expect(back).toEqual(c);
  });

  it('drops malformed fields instead of guessing', () => {
    expect(decodeCosmetics({ k: 'not_a_knife' })).toBeUndefined();
    expect(decodeCosmetics({ k: 'm9_bayonet', f: 'Bad Finish!', w: 7, s: 5000 })).toEqual({ knife: { id: 'm9_bayonet', wear: 1 } });
    expect(decodeCosmetics({ a: { 'x y': 'z', ok: 'fine' } })).toEqual({ armor: { ok: 'fine' } });
    expect(decodeCosmetics(null)).toBeUndefined();
  });

  it('leaves the stock finish off the wire', () => {
    expect(encodeCosmetics({ knife: { id: 'flip', finish: 'vanilla' } })).toEqual({ k: 'flip' });
    expect(sameCosmetics({ knife: { id: 'flip' } }, { knife: { id: 'flip', finish: 'vanilla' } })).toBe(true);
  });
});
