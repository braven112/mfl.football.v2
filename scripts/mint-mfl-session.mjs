#!/usr/bin/env node
/**
 * Mint a fresh MFL commissioner session for the rest of a GitHub Actions job.
 *
 * Logs into MFL with MFL_USERNAME + MFL_PASSWORD and exports the resulting
 * MFL_USER_ID / MFL_IS_COMMISH cookies to $GITHUB_ENV, masked, so every later
 * step in the job authenticates with a cookie minted minutes ago rather than
 * one copied into a secret months ago.
 *
 * WHY: the stored MFL_USER_ID secret expires, and when it does every job that
 * replays it fails the same way regardless of what the commit changed. On
 * 2026-09-05 that turned the integration test's auto-revert into a loop that
 * redeployed production every 75 seconds. The username/password secrets do not
 * expire, so a job that can log in never depends on the stored cookie being
 * alive.
 *
 * ── THE LOGIN IS LEAGUE-SCOPED, ON THE LEAGUE'S OWN HOST ─────────────────
 * `api.myfantasyleague.com/<year>/login` has no league in scope, so it has no
 * commissioner to grant: it issues MFL_USER_ID and nothing else. Only
 * `<www## host>/<year>/login?L=<id>` issues MFL_IS_COMMISH, and every
 * commissioner write needs that host plus BOTH cookies
 * (docs/claude/insights/domains/mfl-api.md, 2026-09-05). `loginToMFL` in
 * scripts/lib/mfl-api.mjs is api-host-only, which is why it is not used here.
 *
 * ── BOTH COOKIES FROM ONE RESPONSE, OR NEITHER ────────────────────────────
 * A fresh MFL_USER_ID paired with the STORED MFL_IS_COMMISH is one session's
 * identity with another's privilege flag, which MFL refuses as "not
 * authorized" — the same string an expired cookie produces, so it would look
 * exactly like the failure this script exists to prevent. `pickMflSession`
 * therefore never mixes the login's cookies with the stored ones.
 *
 * Degrades in order, never fails the job by itself:
 *   1. login yields both cookies      → fresh pair exported
 *   2. login fails / incomplete / no creds → the stored pair (if any) exported
 *      unchanged, with a ::warning:: so the run shows why
 *
 * Later steps must NOT re-declare the stored cookie secrets in their own
 * `env:` — a step-level env wins over $GITHUB_ENV, which would silently put
 * the stale cookie back. tests/mfl-integration-rollback-guard.test.ts pins
 * that for the integration-test workflow.
 *
 * Env:
 *   MFL_USERNAME, MFL_PASSWORD  login pair (both required to attempt a login)
 *   MFL_LEAGUE_ID               the league to log into (required for a
 *                               commissioner session)
 *   MFL_WRITE_HOST              optional; defaults to the registry's write
 *                               host, the SAME one the contract writer uses,
 *                               so the cookie pairs with the host the writes
 *                               hit
 *   MFL_USER_ID, MFL_IS_COMMISH the stored pair, used only as the fallback
 *
 * Outside Actions ($GITHUB_ENV unset) it prints what it would export, with
 * the values redacted, so it can be smoke-tested locally.
 */

import { appendFileSync } from 'node:fs';
import { defaultMflWriteHost } from '../src/config/leagues-data.mjs';

const PER_HOP_TIMEOUT_MS = 8000;
const MAX_HOPS = 4;

/** MFL's own hosts over TLS — the only places a credential may be POSTed. */
export function isMflHost(url) {
  return (
    url.protocol === 'https:'
    && (url.hostname === 'myfantasyleague.com' || url.hostname.endsWith('.myfantasyleague.com'))
  );
}

/**
 * Pull the session pair out of ONE login response.
 *
 * MFL sets MFL_IS_COMMISH only via Set-Cookie; MFL_USER_ID arrives in
 * Set-Cookie or, on some hops, only in the XML body (`MFL_USER_ID="…"`). Pure,
 * so the parsing is testable without a network.
 *
 * @param {string[]} setCookies  every Set-Cookie header value on the response
 * @param {string} body          the response body
 * @returns {{ mflUserId?: string, mflIsCommish?: string }}
 */
export function parseSessionCookies(setCookies, body) {
  const out = {};
  for (const cookieStr of setCookies) {
    const user = cookieStr.match(/MFL_USER_ID=([^;]+)/);
    if (user) out.mflUserId = user[1];
    const commish = cookieStr.match(/MFL_IS_COMMISH=([^;]+)/);
    if (commish) out.mflIsCommish = commish[1];
  }
  if (!out.mflUserId) {
    const fromBody = body.match(/MFL_USER_ID="([^"]+)"/);
    if (fromBody) out.mflUserId = fromBody[1];
  }
  return out;
}

/**
 * Decide which pair to export. Pure, so the fallback order is testable.
 *
 * The login's cookies are used only as a COMPLETE pair — or, when the stored
 * secrets carry no commissioner flag either, as a plain user session. A
 * fresh identity is never paired with a stored privilege flag (see header).
 *
 * @param {{ mflUserId?: string, mflIsCommish?: string } | null} login
 * @param {{ userId?: string, isCommish?: string }} stored
 * @returns {{ source: 'login' | 'stored' | 'none', userId?: string, isCommish?: string }}
 */
export function pickMflSession(login, stored) {
  if (login?.mflUserId && (login.mflIsCommish || !stored.isCommish)) {
    return { source: 'login', userId: login.mflUserId, isCommish: login.mflIsCommish };
  }
  if (stored.userId) {
    return { source: 'stored', userId: stored.userId, isCommish: stored.isCommish };
  }
  return { source: 'none' };
}

/**
 * League-scoped login on the league's host. Re-POSTs the body across
 * redirects rather than folding it into the URL (credentials never ride in a
 * query string), and never follows a redirect off MFL — each hop re-sends the
 * password, so an off-MFL Location would hand it to whoever sent it.
 */
export async function loginToLeague({ username, password, leagueId, year, host, fetchImpl = fetch }) {
  const credentials = new URLSearchParams({ USERNAME: username, PASSWORD: password, XML: '1' });
  let url = `${host}/${year}/login?${new URLSearchParams({ L: leagueId })}`;
  let last = {};

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: credentials.toString(),
      redirect: 'manual',
      signal: AbortSignal.timeout(PER_HOP_TIMEOUT_MS),
    });
    const body = await res.text();
    const errorMatch = body.match(/<error[^>]*>(.*?)<\/error>/s);
    if (errorMatch) throw new Error(`MFL login failed: ${errorMatch[1].trim()}`);

    last = parseSessionCookies(res.headers.getSetCookie?.() ?? [], body);
    if (last.mflIsCommish && last.mflUserId) return last;

    if (res.status < 300 || res.status >= 400) break;
    const location = res.headers.get('location');
    if (!location) break;
    const next = location.startsWith('http') ? new URL(location) : new URL(location, url);
    if (!isMflHost(next)) {
      console.log('[mint-mfl-session] refusing an off-MFL redirect during league login');
      break;
    }
    url = next.href;
  }
  return last;
}

function exportVar(name, value) {
  if (!value) return;
  // Mask BEFORE the value can appear in any later step's output.
  console.log(`::add-mask::${value}`);
  const envFile = process.env.GITHUB_ENV;
  if (envFile) {
    appendFileSync(envFile, `${name}=${value}\n`);
  } else {
    console.log(`(no GITHUB_ENV) would export ${name}=<${value.length} chars>`);
  }
}

async function main() {
  const username = process.env.MFL_USERNAME;
  const password = process.env.MFL_PASSWORD;
  const leagueId = process.env.MFL_LEAGUE_ID;
  const stored = { userId: process.env.MFL_USER_ID, isCommish: process.env.MFL_IS_COMMISH };

  let login = null;
  if (!username || !password) {
    // Name the missing half: MFL_USERNAME (a login name) is routinely confused
    // with MFL_USER_ID (a session cookie), and half a pair is a misconfiguration.
    const missing = [!username && 'MFL_USERNAME', !password && 'MFL_PASSWORD'].filter(Boolean).join(' and ');
    console.log(`::notice::[mint-mfl-session] ${missing} not set — using the stored cookie as-is.`);
  } else if (!leagueId) {
    console.log('::warning::[mint-mfl-session] MFL_LEAGUE_ID not set — a commissioner session is league-scoped; using the stored cookie as-is.');
  } else {
    // Calendar year on purpose: it mirrors tests/mfl-write-integration.test.ts
    // and the contract writer, which address the test league by getFullYear().
    const year = new Date().getFullYear();
    const host = defaultMflWriteHost();
    try {
      login = await loginToLeague({ username, password, leagueId, year, host });
      if (login.mflUserId && login.mflIsCommish) {
        console.log(`[mint-mfl-session] Commissioner session for league ${leagueId} minted on ${host}.`);
      } else if (login.mflUserId) {
        console.log(`::warning::[mint-mfl-session] ${host} logged in but issued no MFL_IS_COMMISH for league ${leagueId} — this account is not its commissioner, or the credentials are wrong.`);
      } else {
        console.log(`::warning::[mint-mfl-session] ${host} issued no session cookie for league ${leagueId}.`);
      }
    } catch (err) {
      console.log(`::warning::[mint-mfl-session] MFL login failed — falling back to the stored cookie: ${err.message}`);
    }
  }

  const session = pickMflSession(login, stored);
  if (session.source === 'none') {
    console.log('::warning::[mint-mfl-session] No MFL session available (no login, no stored cookie).');
    return;
  }
  exportVar('MFL_USER_ID', session.userId);
  exportVar('MFL_IS_COMMISH', session.isCommish);
  console.log(`[mint-mfl-session] Exported MFL session from ${session.source}${session.isCommish ? ' (with commissioner cookie)' : ''}.`);
}

// Only run when executed directly, so the pure helpers can be imported by tests.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((err) => {
    // Never fail the job from here: a login problem is reported, and the
    // steps that need the cookie report their own failure with context.
    console.log(`::warning::[mint-mfl-session] ${err.message}`);
  });
}
