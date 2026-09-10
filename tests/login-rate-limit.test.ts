/**
 * Guard: the login route throttles per client IP, BEFORE it calls MFL.
 *
 * /api/auth/login is the only endpoint an UNAUTHENTICATED caller can use to
 * make us relay credential guesses to MyFantasyLeague. The shared limiter
 * (src/utils/rate-limit.ts) keys on the franchiseId from the session by
 * design, so it does nothing here — there is no session yet. This route has
 * to key on the IP instead, and the check has to run before the MFL call or
 * it hands MFL every attempt it was meant to prevent.
 *
 * Cloudflare's Bot Fight Mode never covered this (it challenges page loads by
 * IP reputation, not POSTs), and it is off on these zones as of Sep 2026
 * because it was challenging real owners — see docs/claude/staging-sites.md.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getClientIp } from '../src/utils/client-ip';

const ROOT = join(__dirname, '..');
const LOGIN = readFileSync(join(ROOT, 'src/pages/api/auth/login.ts'), 'utf8');

const req = (headers: Record<string, string>) =>
  new Request('https://www.theleague.us/api/auth/login', { headers });

describe('login route rate limiting', () => {
  it('calls checkRateLimit', () => {
    expect(LOGIN).toMatch(/checkRateLimit\(/);
  });

  it('keys the limit on the client IP, not a franchiseId', () => {
    // A session-keyed limit is unreachable here: the caller is anonymous.
    expect(LOGIN).toMatch(/getClientIp\(/);
    const call = LOGIN.slice(LOGIN.indexOf('checkRateLimit('), LOGIN.indexOf('checkRateLimit(') + 200);
    expect(call).toMatch(/clientIp/);
    expect(call).not.toMatch(/franchiseId/);
  });

  it('throttles BEFORE authenticating with MFL', () => {
    const limitAt = LOGIN.indexOf('checkRateLimit(');
    const mflAt = LOGIN.indexOf('authenticateWithMFL(');
    expect(limitAt).toBeGreaterThan(-1);
    expect(mflAt).toBeGreaterThan(-1);
    expect(
      limitAt,
      'rate limit must be checked before the MFL call, or MFL still sees every guess',
    ).toBeLessThan(mflAt);
  });

  it('answers a throttled caller with 429', () => {
    // 4xx passes through the Cloudflare edge intact; a 5xx would be replaced
    // by the edge's own HTML page (see docs/claude/insights/domains/deployment.md).
    expect(LOGIN).toMatch(/\b429\b/);
  });
});

describe('getClientIp', () => {
  it('prefers CF-Connecting-IP — Cloudflare overwrites it, so it cannot be forged', () => {
    const ip = getClientIp(
      req({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.1' }),
    );
    expect(ip).toBe('203.0.113.7');
  });

  it('falls back to the leftmost X-Forwarded-For entry', () => {
    expect(getClientIp(req({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1, 10.0.0.2' })))
      .toBe('198.51.100.1');
  });

  it('falls back to X-Real-IP last', () => {
    expect(getClientIp(req({ 'x-real-ip': '198.51.100.9' }))).toBe('198.51.100.9');
  });

  it('returns null when no header identifies the caller', () => {
    // The login route treats null as "cannot count this one" and proceeds,
    // matching checkRateLimit's own fail-open contract — a Redis or header
    // problem must never lock every owner out of the site.
    expect(getClientIp(req({}))).toBeNull();
  });

  it('ignores empty and whitespace-only header values', () => {
    expect(getClientIp(req({ 'cf-connecting-ip': '   ', 'x-forwarded-for': '198.51.100.1' })))
      .toBe('198.51.100.1');
    expect(getClientIp(req({ 'x-forwarded-for': ' , 10.0.0.1' }))).toBe(null);
  });
});
