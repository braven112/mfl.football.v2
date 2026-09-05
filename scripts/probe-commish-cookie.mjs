/**
 * Where does MFL_IS_COMMISH actually come from?
 *
 * Read-only probe. It writes nothing to MFL and prints no secret — only the
 * status, which cookie NAMES came back, and a one-line shape of the body.
 *
 * What we already know, from evidence rather than guesswork:
 *   - `api.myfantasyleague.com/<year>/login` issues MFL_USER_ID and nothing
 *     else (#878).
 *   - `<mflHost>/<year>/login?L=<id>&XML=1` ALSO issues nothing — CI's
 *     mint-mfl-session step logged in successfully against www49 and reported
 *     "logged in but issued no MFL_IS_COMMISH" (2026-09-05). That disproved
 *     the theory #878 was built on.
 *
 * So the remaining candidates are the ones this probe walks, in order of how
 * much they'd simplify life if they worked:
 *
 *   C  the same league-scoped login WITHOUT `XML=1`. The doc note says the
 *      cookie is set by "MFL's commissioner login flow" — the interactive HTML
 *      one. `XML=1` may be exactly what switches MFL onto an API path that
 *      never sets it. This is the cheapest possible fix if it is true.
 *   D  a commissioner-only page (`csetup`) fetched WITH the session cookie —
 *      i.e. the cookie is granted on entering commissioner mode, not at login.
 *   E  the league home page, as a control: if E also sets it, it is not about
 *      commissioner pages at all.
 *
 * Run: node scripts/probe-commish-cookie.mjs
 *   MFL_USERNAME, MFL_PASSWORD   required
 *   MFL_LEAGUE_ID                defaults to the AFL
 */

import { LEAGUES } from '../src/config/leagues-data.mjs';

const username = process.env.MFL_USERNAME;
const password = process.env.MFL_PASSWORD;
if (!username || !password) {
  console.error('Set MFL_USERNAME and MFL_PASSWORD.');
  process.exit(1);
}

const leagueId = process.env.MFL_LEAGUE_ID || LEAGUES['afl-fantasy'].id;
const league = Object.values(LEAGUES).find((l) => l.id === leagueId);
const host = league?.mflHost;
if (!host) {
  console.error(`No registry entry for league ${leagueId}.`);
  process.exit(1);
}
const year = Number(process.env.MFL_YEAR) || new Date().getFullYear();

const creds = new URLSearchParams({ USERNAME: username, PASSWORD: password });

/** Cookie NAMES only — never a value. */
function cookieNames(res) {
  const names = new Set();
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const name = c.split('=')[0]?.trim();
    if (name) names.add(name);
  }
  return names;
}

function bodyShape(text) {
  const head = text.slice(0, 400).replace(/\s+/g, ' ').trim();
  const error = head.match(/<error[^>]*>(.*?)<\/error>/)?.[1];
  if (error) return `XML error: ${error}`;
  if (/MFL_USER_ID="/.test(head)) return 'XML status with MFL_USER_ID';
  if (/^<!doctype html|^<html/i.test(head)) return `HTML (${text.length} bytes)`;
  return head.slice(0, 90) || '(empty)';
}

/**
 * One request, following up to 3 hops manually so a cookie set on an
 * intermediate hop is not lost the way redirect:'follow' loses it.
 */
async function probe(label, { url, method = 'GET', body, cookie }) {
  let current = url;
  const seen = new Set();
  let status = 0;
  let text = '';

  for (let hop = 0; hop < 4; hop++) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (cookie) headers.Cookie = cookie;

    let res;
    try {
      res = await fetch(current, {
        method: hop === 0 ? method : 'GET',
        headers,
        body: hop === 0 ? body : undefined,
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
      });
    } catch (error) {
      console.log(`${label}: request failed — ${error.message}`);
      return { names: seen, status: 0, text: '' };
    }

    for (const n of cookieNames(res)) seen.add(n);
    status = res.status;

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) break;
      const next = location.startsWith('http') ? new URL(location) : new URL(location, current);
      if (!/(^|\.)myfantasyleague\.com$/.test(next.hostname)) break;
      current = next.href;
      continue;
    }
    text = await res.text();
    break;
  }

  const commish = seen.has('MFL_IS_COMMISH');
  console.log(
    `${label}\n`
      + `   status ${status} | cookies: ${[...seen].join(', ') || 'none'}\n`
      + `   MFL_IS_COMMISH: ${commish ? 'YES  <<<<<<' : 'no'}\n`
      + `   body: ${bodyShape(text)}\n`
  );
  return { names: seen, status, text };
}

console.log(`Probing league ${leagueId} on ${host}, year ${year}\n`);

// A — api host, XML. The known baseline.
const a = await probe('A  api login (XML=1)', {
  url: `https://api.myfantasyleague.com/${year}/login?XML=1`,
  method: 'POST',
  body: creds.toString(),
});

// The session cookie for the page probes. Parsed from the XML body so no
// value is ever logged.
const userId = a.text.match(/MFL_USER_ID="([^"]+)"/)?.[1] ?? '';
console.log(userId ? 'Got a session from A.\n' : 'A gave no session — page probes will be unauthenticated.\n');
const cookie = userId ? `MFL_USER_ID=${userId}` : undefined;

// B — league host, XML. CI already showed this yields nothing; included so a
// single run carries the whole comparison.
await probe('B  league login (XML=1)', {
  url: `https://${host}/${year}/login?L=${leagueId}&XML=1`,
  method: 'POST',
  body: creds.toString(),
});

// C — league host, NO XML. The interactive flow the docs actually describe.
await probe('C  league login (HTML, no XML)', {
  url: `https://${host}/${year}/login?L=${leagueId}`,
  method: 'POST',
  body: creds.toString(),
});

// D — commissioner setup, carrying the session. Is the cookie granted on
// entering commissioner mode rather than at login?
await probe('D  csetup with session', {
  url: `https://${host}/${year}/csetup?L=${leagueId}`,
  cookie,
});

// E — control. If the league home also sets it, it is not commissioner-specific.
await probe('E  league home with session (control)', {
  url: `https://${host}/${year}/home/${leagueId}`,
  cookie,
});

console.log('Any line marked YES is the request that issues the cookie.');
