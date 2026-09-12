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
import { getClientIdentity } from '../src/utils/client-ip';

const ROOT = join(__dirname, '..');
const LOGIN = readFileSync(join(ROOT, 'src/pages/api/auth/login.ts'), 'utf8');

const req = (headers: Record<string, string>) =>
  new Request('https://www.theleague.us/api/auth/login', { headers });

describe('login route rate limiting', () => {
  it('calls checkRateLimit', () => {
    expect(LOGIN).toMatch(/checkRateLimit\(/);
  });

  it('keys the fine limit on caller AND username, not the address alone', () => {
    // Address-alone locks a whole office, draft party or CGNAT range out of
    // each other's accounts after ten attempts nobody got wrong.
    expect(LOGIN).toMatch(/getClientIdentity\(/);
    expect(LOGIN).toMatch(/identity\.client/);
    expect(LOGIN).toMatch(/\$\{identity\.client\}\|\$\{account\}/);
    // Scoped to the limiter call: login.ts legitimately uses franchiseId
    // further down, when it builds the session.
    const fineAt = LOGIN.indexOf("'login',");
    expect(fineAt).toBeGreaterThan(-1);
    expect(LOGIN.slice(fineAt, fineAt + 200)).not.toMatch(/franchiseId/);
  });

  it('also enforces a ceiling on the un-forgeable nearest hop', () => {
    // CF-Connecting-IP is caller-supplied on the *.vercel.app URLs that
    // bypass Cloudflare, so a fine limit keyed on it alone is no limit there.
    expect(LOGIN).toMatch(/identity\.nearestHop/);
    expect(LOGIN).toMatch(/'login-hop'/);
  });

  it('gives the hop ceiling a far looser cap than the per-account limit', () => {
    // Behind Cloudflare the hop key is an edge address shared by many real
    // owners at once, so a per-user-sized cap there would lock them out.
    const fine = Number(LOGIN.match(/LOGIN_MAX_ATTEMPTS = (\d+)/)?.[1]);
    const hop = Number(LOGIN.match(/LOGIN_MAX_PER_HOP = (\d+)/)?.[1]);
    expect(fine).toBeGreaterThan(0);
    expect(hop).toBeGreaterThan(fine);
  });

  it('bounds the caller-supplied username before it reaches a Redis key', () => {
    expect(LOGIN).toMatch(/USERNAME_KEY_MAX/);
    expect(LOGIN).toMatch(/\.slice\(0, USERNAME_KEY_MAX\)/);
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

describe('getClientIdentity', () => {
  it('prefers CF-Connecting-IP for the caller — Cloudflare overwrites it', () => {
    const id = getClientIdentity(
      req({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.1' }),
    );
    expect(id.client).toBe('203.0.113.7');
  });

  it('falls back to the leftmost X-Forwarded-For entry for the caller', () => {
    expect(getClientIdentity(req({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1, 10.0.0.2' })).client)
      .toBe('198.51.100.1');
  });

  it('takes the LAST chain entry as the nearest hop', () => {
    // The hop our own infrastructure appended — the one a caller cannot move.
    expect(getClientIdentity(req({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1, 10.0.0.2' })).nearestHop)
      .toBe('10.0.0.2');
  });

  it('does not let a forged CF-Connecting-IP move the nearest hop', () => {
    // The whole point: rotating this header must not mint a fresh hop bucket.
    const a = getClientIdentity(req({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '203.0.113.9' }));
    const b = getClientIdentity(req({ 'cf-connecting-ip': '2.2.2.2', 'x-forwarded-for': '203.0.113.9' }));
    expect(a.client).not.toBe(b.client);
    expect(a.nearestHop).toBe(b.nearestHop);
    expect(a.nearestHop).toBe('203.0.113.9');
  });

  it('reads a single-entry chain as both caller and nearest hop', () => {
    // Holds whether the platform APPENDS to a caller-supplied chain or
    // REPLACES it: in the replace case last === first === the real address.
    const id = getClientIdentity(req({ 'x-forwarded-for': '198.51.100.1' }));
    expect(id.client).toBe('198.51.100.1');
    expect(id.nearestHop).toBe('198.51.100.1');
  });

  it('falls back to X-Real-IP for both', () => {
    const id = getClientIdentity(req({ 'x-real-ip': '198.51.100.9' }));
    expect(id.client).toBe('198.51.100.9');
    expect(id.nearestHop).toBe('198.51.100.9');
  });

  it('returns nulls when no header identifies the caller', () => {
    // The route treats null as "cannot count this one" and proceeds, matching
    // checkRateLimit's fail-open contract — a header or Redis problem must
    // never lock every owner out of the site.
    const id = getClientIdentity(req({}));
    expect(id.client).toBeNull();
    expect(id.nearestHop).toBeNull();
  });

  it('ignores empty and whitespace-only entries', () => {
    const id = getClientIdentity(req({ 'cf-connecting-ip': '   ', 'x-forwarded-for': ' , 198.51.100.1 ,  ' }));
    expect(id.client).toBe('198.51.100.1');
    expect(id.nearestHop).toBe('198.51.100.1');
  });
});
