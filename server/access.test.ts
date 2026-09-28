import { describe, expect, it } from 'vitest';
import { clientIp, isOriginAllowed, readOriginPolicy } from './access';

const policy = readOriginPolicy({
  WEBSTRAFE_ALLOWED_ORIGINS: 'https://strafe.yassin.app',
  WEBSTRAFE_ALLOWED_ORIGIN_SUFFIXES: '-yassins-projects-11732a5e.vercel.app',
});

describe('origin policy', () => {
  it('allows production, this team\'s previews, localhost and originless bots', () => {
    expect(isOriginAllowed('https://strafe.yassin.app', policy)).toBe(true);
    expect(isOriginAllowed('https://webstrafe-git-revamp-netcode-phase1-yassins-projects-11732a5e.vercel.app', policy)).toBe(true);
    expect(isOriginAllowed('http://localhost:5173', policy)).toBe(true);
    expect(isOriginAllowed(undefined, policy)).toBe(true);
  });

  it('rejects other sites and suffix tricks', () => {
    expect(isOriginAllowed('https://someone-else.vercel.app', policy)).toBe(false);
    expect(isOriginAllowed('https://x-yassins-projects-11732a5e.vercel.app.attacker.com', policy)).toBe(false);
    expect(isOriginAllowed('http://webstrafe-yassins-projects-11732a5e.vercel.app', policy)).toBe(false);
    expect(isOriginAllowed('not a url', policy)).toBe(false);
  });
});

describe('client ip', () => {
  it('trusts only Fly-Client-IP behind fly', () => {
    const headers = { 'fly-client-ip': '203.0.113.9', 'x-forwarded-for': '1.2.3.4, 203.0.113.9' };
    expect(clientIp(headers, '10.0.0.1', 'fly')).toBe('203.0.113.9');
    expect(clientIp({ 'x-forwarded-for': '1.2.3.4' }, '10.0.0.1', 'fly')).toBe('10.0.0.1');
    expect(clientIp(headers, '10.0.0.1', undefined)).toBe('10.0.0.1');
    expect(clientIp(headers, '10.0.0.1', '1')).toBe('1.2.3.4');
  });

  it('xff-last takes the entry the proxy appended, not the client-supplied one', () => {
    expect(clientIp({ 'x-forwarded-for': '6.6.6.6, 198.51.100.4' }, '10.0.0.1', 'xff-last')).toBe('198.51.100.4');
    expect(clientIp({}, '10.0.0.1', 'xff-last')).toBe('10.0.0.1');
  });

  it('trusts only CF-Connecting-IP behind a cloudflare tunnel', () => {
    const headers = { 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '1.2.3.4' };
    expect(clientIp(headers, '127.0.0.1', 'cloudflare')).toBe('198.51.100.7');
    expect(clientIp({ 'fly-client-ip': '203.0.113.9' }, '127.0.0.1', 'cloudflare')).toBe('127.0.0.1');
  });
});
