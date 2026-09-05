import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * MFL_IS_COMMISH comes from a LEAGUE-SCOPED login, not the api host's.
 *
 * `api.myfantasyleague.com/<year>/login` has no league in scope, so it has no
 * commissioner to grant and never sets the cookie. Every commissioner write
 * needs it, so a session built from that login alone is refused on every write
 * — which is what told a signed-in commissioner his session had no commissioner
 * credential, and why "sign out and sign in again" could not fix it.
 */

const LOGIN_XML = '<?xml version="1.0"?><status MFL_USER_ID="user-cookie-abc"/>';
const MYLEAGUES = JSON.stringify({
  leagues: { league: [{ league_id: '19621', franchise_id: '0001', name: 'AFL' }] },
});

/**
 * A league-scoped login URL, anchored at the scheme.
 *
 * Anchoring is not pedantry even in a stub: an unanchored host pattern matches
 * `https://evil.example/www44.myfantasyleague.com/login` too, so the
 * off-MFL-redirect test below could pass while the code under test was doing
 * the exact thing it forbids. CodeQL flags every unanchored host regex for
 * this reason (js/incomplete-url-substring-sanitization).
 */
const LEAGUE_LOGIN = /^https:\/\/www\d+\.myfantasyleague\.com\/\d{4}\/login(?:[?#]|$)/;

/** A fetch stub that records every URL and answers by shape. */
function stubFetch(opts: { commishOnLeagueHost: boolean }) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string | URL) => {
    const href = typeof url === 'string' ? url : url.href;
    calls.push(href);

    const headers = new Headers();
    // Only the league's own host ever hands back the commissioner cookie.
    if (opts.commishOnLeagueHost && LEAGUE_LOGIN.test(href)) {
      // A SECOND login is a SECOND session: MFL hands back its own
      // MFL_USER_ID alongside the commissioner flag.
      headers.append('set-cookie', 'MFL_USER_ID=league-session-def; Path=/');
      headers.append('set-cookie', 'MFL_IS_COMMISH=commish-xyz; Path=/');
    }
    const body = href.includes('TYPE=myleagues') ? MYLEAGUES : LOGIN_XML;
    return new Response(body, { status: 200, headers });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('authenticateWithMFL — commissioner cookie', () => {
  it('asks the league host for MFL_IS_COMMISH when the api login does not supply it', async () => {
    const calls = stubFetch({ commishOnLeagueHost: true });
    const { authenticateWithMFL } = await import('../src/utils/mfl-login');

    const result = await authenticateWithMFL('someone', 'secret', '19621', 2026);

    expect(result.commishCookie).toBe('commish-xyz');
    // BOTH cookies come from the league-scoped response. Pairing this
    // session's privilege flag with the api login's identity is what MFL
    // refuses as "not authorized" — and it would look like success here,
    // letting the write gate through to fail once per record instead.
    expect(result.userId).toBe('league-session-def');
    // It must be the LEAGUE's host, carrying L= — an api-host login cannot
    // produce this cookie no matter how many times you sign in again.
    const leagueLogin = calls.find((u) => LEAGUE_LOGIN.test(u));
    expect(leagueLogin).toBeDefined();
    expect(leagueLogin).toContain('L=19621');
    // Credentials ride in the POST body. A URL is logged by the origin, by
    // every proxy between, and by our own redirect tracing.
    for (const u of calls) {
      expect(u).not.toContain('PASSWORD=');
      expect(u).not.toContain('USERNAME=');
    }
  });

  it('leaves the session commish-less rather than failing when the league host grants nothing', async () => {
    stubFetch({ commishOnLeagueHost: false });
    const { authenticateWithMFL } = await import('../src/utils/mfl-login');

    const result = await authenticateWithMFL('someone', 'secret', '19621', 2026);

    // Best-effort: a non-commissioner still signs in, and still reads.
    expect(result.success).toBe(true);
    expect(result.commishCookie).toBeUndefined();
  });

  it('does not reach for a league host when no league was named', async () => {
    const calls = stubFetch({ commishOnLeagueHost: true });
    const { authenticateWithMFL } = await import('../src/utils/mfl-login');

    await authenticateWithMFL('someone', 'secret', undefined, 2026);

    expect(calls.some((u) => LEAGUE_LOGIN.test(u))).toBe(false);
  });

  it('keeps the api login intact when the league host grants a flag but no identity', async () => {
    // Half a session is not a session. Adopting the commissioner flag without
    // the MFL_USER_ID it was issued with rebuilds the mismatched pair.
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const href = typeof url === 'string' ? url : url.href;
      calls.push(href);
      const headers = new Headers();
      const isLeagueLogin = LEAGUE_LOGIN.test(href);
      if (isLeagueLogin) headers.append('set-cookie', 'MFL_IS_COMMISH=commish-xyz; Path=/');
      // No MFL_USER_ID anywhere in the league-host response, body included.
      const body = href.includes('TYPE=myleagues')
        ? MYLEAGUES
        : isLeagueLogin
          ? '<?xml version="1.0"?><status/>'
          : LOGIN_XML;
      return new Response(body, { status: 200, headers });
    }));

    const { authenticateWithMFL } = await import('../src/utils/mfl-login');
    const result = await authenticateWithMFL('someone', 'secret', '19621', 2026);

    expect(result.commishCookie).toBeUndefined();
    expect(result.userId).toBe('user-cookie-abc');
  });

  it('refuses to follow a redirect off MFL, because each hop re-POSTs the password', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const href = typeof url === 'string' ? url : url.href;
      calls.push(href);
      if (LEAGUE_LOGIN.test(href)) {
        return new Response('', {
          status: 302,
          headers: new Headers({ location: 'https://evil.example/collect' }),
        });
      }
      return new Response(href.includes('TYPE=myleagues') ? MYLEAGUES : LOGIN_XML, { status: 200 });
    }));

    const { authenticateWithMFL } = await import('../src/utils/mfl-login');
    const result = await authenticateWithMFL('someone', 'secret', '19621', 2026);

    expect(calls.some((u) => u.includes('evil.example'))).toBe(false);
    expect(result.commishCookie).toBeUndefined();
    // The sign-in itself still succeeds — this is a best-effort extra hop.
    expect(result.success).toBe(true);
  });
});

