import type { APIRoute } from 'astro';
import { authenticateWithMFL } from '../../../utils/mfl-login';
import { createSessionToken, createSessionCookie, createMFLCookies } from '../../../utils/session';
import { setTheLeaguePreference, setAFLPreference, setBestBall1Preference, getAFLTeamData } from '../../../utils/team-preferences';
import { json } from '../../../utils/api-response';
import { getLeagueById, getLeagueBySlug, MFL_LIVE_OPEN_SIGN_IN, mflLiveSignInLeagueIds } from '../../../config/leagues';
import { captureCredential } from '../../../utils/autocut-storage';
import { checkRateLimit } from '../../../utils/rate-limit';
import { getClientIdentity } from '../../../utils/client-ip';
import { recordInsightLogin } from '../../../utils/site-insights';

const AFL_LEAGUE_ID = getLeagueBySlug('afl-fantasy')!.id;
const THELEAGUE_ID = getLeagueBySlug('theleague')!.id;
const BB1_LEAGUE_ID = getLeagueBySlug('best-ball-1')!.id;

/**
 * Login throttle. This is the ONE endpoint an unauthenticated caller can use
 * to make us relay credential guesses to MFL, and there is no session yet, so
 * the shared limiter's franchiseId key is unavailable. Two tiers, because
 * neither identifier alone is both fine-grained and trustworthy — see
 * getClientIdentity.
 *
 * PER CALLER+USERNAME. Keyed on the caller's apparent address AND the account
 * being attempted, NOT the address alone: a whole league on one office,
 * stadium or CGNAT address would otherwise share a single budget and lock
 * each other out having typed nothing wrong. 10 per quarter hour is generous
 * for an owner mistyping a password and useless for guessing one.
 *
 * PER NEAREST HOP. A ceiling on the hop our own infrastructure saw, which a
 * caller cannot forge. It is what still bites when someone reaches the origin
 * directly on a *.vercel.app URL and rotates a spoofed CF-Connecting-IP (or
 * sprays usernames) to give every request a fresh fine-grained key. It has to
 * be loose, because behind Cloudflare this key is an edge address shared by
 * many real owners at once — so it is a flood ceiling, not a per-user limit.
 */
const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_MAX_PER_HOP = 100;
const LOGIN_WINDOW_SECONDS = 15 * 60;

/** Bound the key: the username is caller-supplied and otherwise unbounded. */
const USERNAME_KEY_MAX = 64;

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const body = await request.json();
    const { username, password, leagueId, year, scope } = body;

    // Validate inputs
    if (!username || !password) {
      return json({ success: false, message: 'Username and password are required' }, 400);
    }

    // Sessions exist only for leagues this site runs. Without this, a direct
    // POST naming any MFL league (or none — the resolver then takes the
    // account's first league) minted a valid session for a stranger's league,
    // and every endpoint keyed on franchiseId alone could not tell their 0001
    // from ours. Every sign-in form sends its own registry league, so this
    // only ever refuses a hand-built request. Checked BEFORE the MFL call so a
    // refused league never relays a credential guess. The one exception is
    // MFL Live's shared /login (the mfl-live scope), which signs in against
    // the registry's own list plus the invited pilot leagues — never a list
    // from the request body.
    if (scope !== 'mfl-live' && !(typeof leagueId === 'string' && getLeagueById(leagueId))) {
      return json({ success: false, message: 'Sign in from one of the league sites.' }, 400);
    }

    // Throttle BEFORE the MFL call, not after. The point is to stop an
    // unauthenticated caller relaying unlimited guesses through us to MFL;
    // checking afterwards would still hand MFL every attempt.
    //
    // Counts every attempt, not just failures, because a failure is only
    // known after the call we are trying to avoid making. Including the
    // username in the fine key is what keeps that from punishing an owner who
    // simply signs in a few times from a shared address.
    //
    // FAILS OPEN (checkRateLimit returns allowed on a Redis error), and an
    // absent identifier means no key to count against, so both degrade to the
    // previous behaviour rather than locking every owner out of the site when
    // Upstash hiccups. The dependency-free layer is the Cloudflare
    // rate-limiting rule at the edge; this is defence in depth behind it, and
    // covers the *.vercel.app URLs that never pass through that edge at all.
    const identity = getClientIdentity(request);
    const tooManyAttempts = () =>
      json(
        {
          success: false,
          message: 'Too many login attempts. Wait a few minutes and try again.',
        },
        429,
      );

    if (identity.nearestHop) {
      const { allowed } = await checkRateLimit(
        'login-hop',
        identity.nearestHop,
        LOGIN_MAX_PER_HOP,
        LOGIN_WINDOW_SECONDS,
      );
      if (!allowed) return tooManyAttempts();
    }

    if (identity.client) {
      const account = String(username).toLowerCase().slice(0, USERNAME_KEY_MAX);
      const { allowed } = await checkRateLimit(
        'login',
        `${identity.client}|${account}`,
        LOGIN_MAX_ATTEMPTS,
        LOGIN_WINDOW_SECONDS,
      );
      if (!allowed) return tooManyAttempts();
    }

    // Authenticate with MFL — year override lets AFL pass 2025 because
    // the AFL 2026 league hasn't been created on MFL yet.
    const seasonYear = Number.isInteger(Number(year)) ? Number(year) : undefined;
    // MFL Live (the shared host's /login) accepts an owner of ANY registered
    // league, or of an invited pilot league, rather than one named league. The
    // list comes from the registry here, never from the request body: a
    // client-supplied list would let anyone name their own league in.
    const leagueTarget = scope === 'mfl-live' ? mflLiveSignInLeagueIds() : leagueId;
    // With MFL_LIVE_OPEN_SIGN_IN on, an account in none of those leagues
    // still signs in to MFL Live, scoped to a league of its own.
    const openSignIn = scope === 'mfl-live' && MFL_LIVE_OPEN_SIGN_IN;
    const mflResponse = await authenticateWithMFL(username, password, leagueTarget, seasonYear, {
      openFallback: openSignIn,
    });

    if (!mflResponse.success) {
      return json(
        {
          success: false,
          message: mflResponse.error || 'Authentication failed',
        },
        401,
      );
    }

    if (!mflResponse.franchiseId) {
      // Forward the more specific error from the MFL resolver so the user
      // gets a useful message ("not a member of league X", "no leagues
      // found", etc.) instead of a generic "contact the commissioner".
      return json(
        {
          success: false,
          message:
            mflResponse.error ||
            'Login succeeded but your franchise could not be determined. Contact the commissioner.',
        },
        401,
      );
    }

    // The league the session is scoped to. A scalar sign-in names the registry
    // league it asked for, whatever MFL echoes back. An MFL Live sign-in takes
    // the first listed league the account is in — and must still be one of
    // the listed leagues, or there is no session.
    const sessionLeagueId: string =
      scope === 'mfl-live' ? String(mflResponse.leagueId ?? '') : String(leagueId);
    const listedLeague = mflLiveSignInLeagueIds().includes(sessionLeagueId);
    const openLeague = openSignIn && !listedLeague && /^\d+$/.test(sessionLeagueId);
    if (!listedLeague && !openLeague) {
      return json({ success: false, message: 'MFL Live is invite-only for now.' }, 403);
    }

    // Create JWT session
    const sessionToken = createSessionToken({
      userId: mflResponse.userId || username,
      username,
      franchiseId: mflResponse.franchiseId,
      leagueId: sessionLeagueId,
      // An open sign-in's session is MFL-Live-only and never a commissioner
      // here, whatever MFL said about the owner's own league.
      role: openLeague ? 'owner' : (mflResponse.role as 'owner' | 'commissioner' | 'admin') || 'owner',
    });

    // Set session cookie
    const isDev = import.meta.env.DEV;
    const sessionCookie = createSessionCookie(sessionToken, isDev);

    // Set team preference cookie for the league the user logged into
    const resolvedLeagueId = sessionLeagueId;
    if (resolvedLeagueId === AFL_LEAGUE_ID) {
      const teamData = getAFLTeamData(mflResponse.franchiseId);
      if (teamData) {
        setAFLPreference(cookies, mflResponse.franchiseId, teamData.conference, teamData.tier);
      }
    } else if (resolvedLeagueId === BB1_LEAGUE_ID) {
      setBestBall1Preference(cookies, mflResponse.franchiseId);
    } else if (resolvedLeagueId === THELEAGUE_ID) {
      setTheLeaguePreference(cookies, mflResponse.franchiseId);
    }
    // Any other league (an MFL Live pilot league) has no team-preference
    // cookie. It used to fall through to TheLeague's, which would have
    // highlighted a stranger's franchise id as "your team" on TheLeague.

    // Build all Set-Cookie headers: session + MFL credentials
    const setCookieHeaders = [sessionCookie];
    if (mflResponse.userId) {
      setCookieHeaders.push(
        // No commissioner cookie for an open sign-in: it names a league this
        // site does not run.
        ...createMFLCookies(mflResponse.userId, openLeague ? undefined : mflResponse.commishCookie, isDev),
      );
    }

    const headers = new Headers({ 'Content-Type': 'application/json' });
    for (const cookie of setCookieHeaders) {
      headers.append('Set-Cookie', cookie);
    }

    // Refresh-on-login credential capture for the August cut automation
    // (TheLeague only — the autocut job replays owner cookies). AWAITED, not
    // fire-and-forget: on serverless (Vercel) the function can be frozen the
    // instant the response is returned, killing an in-flight Redis write
    // before it lands. captureCredential never throws by contract, and the
    // try/catch is belt-and-suspenders so a degraded store can never break or
    // meaningfully slow login.
    if (resolvedLeagueId === THELEAGUE_ID && mflResponse.userId && mflResponse.franchiseId) {
      try {
        await captureCredential(mflResponse.franchiseId, mflResponse.userId);
      } catch {
        /* never block login on credential capture */
      }
    }

    // Site insights (/live/analytics): who signed in, and when. Awaited for
    // the same freeze reason as above; recordInsightLogin never throws.
    await recordInsightLogin({
      leagueId: resolvedLeagueId,
      franchiseId: mflResponse.franchiseId,
      username: String(username),
    });

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          userId: mflResponse.userId || username,
          username,
          franchiseId: mflResponse.franchiseId,
          leagueId: sessionLeagueId,
          role: openLeague ? 'owner' : mflResponse.role || 'owner',
        },
      }),
      { status: 200, headers },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ success: false, message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
