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
// mflFetch, not bare fetch: undici DROPS the Cookie header on the api → wwwNN
// cross-origin 302, and MFL answers an unauthenticated myleagues with a
// well-formed EMPTY payload at HTTP 200. A bare fetch here would have
// reported "0 leagues, host not found" for a perfectly good session — the
// third false negative this probe has been saved from, this one by
// tests/mfl-cookie-redirect-guard.test.ts rather than by a reviewer.
import { mflFetch } from './lib/mfl-api.mjs';

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

/**
 * A cookie jar, exactly like the browser has — which is the point, because
 * the browser is the only place MFL_IS_COMMISH is known to appear. Both of
 * Copilot's findings on this file were about not having one: cookies set on
 * an early hop were not replayed on the next, and the page probes used the
 * api login's session rather than the one the flow under test established.
 * A probe that can produce a false negative is worse than no probe — it is
 * how you draw a third wrong conclusion.
 *
 * Values are stored so they can be SENT. They are never printed.
 */
const jar = new Map();

function absorb(res) {
  const fresh = [];
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';');
    const eq = pair.indexOf('=');
    if (eq < 1) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!jar.has(name)) fresh.push(name);
    jar.set(name, value);
  }
  return fresh;
}

const jarHeader = () =>
  [...jar.entries()].map(([n, v]) => `${n}=${v}`).join('; ') || undefined;

function bodyShape(text) {
  const head = text.slice(0, 400).replace(/\s+/g, ' ').trim();
  const error = head.match(/<error[^>]*>(.*?)<\/error>/)?.[1];
  if (error) return `XML error: ${error}`;
  if (/MFL_USER_ID="/.test(head)) return 'XML status with MFL_USER_ID';
  if (/^<!doctype html|^<html/i.test(head)) return `HTML (${text.length} bytes)`;
  return head.slice(0, 90) || '(empty)';
}

/**
 * One request, following up to 3 hops by hand so a cookie set on an
 * intermediate hop is both KEPT and REPLAYED on the next hop.
 */
async function probe(label, { url, method = 'GET', body }) {
  let current = url;
  const gained = [];
  let status = 0;
  let text = '';

  for (let hop = 0; hop < 4; hop++) {
    const headers = {};
    if (body && hop === 0) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const cookie = jarHeader();
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
      console.log(`${label}: request failed — ${error.message}\n`);
      return { status: 0, text: '' };
    }

    gained.push(...absorb(res));
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

  console.log(
    `${label}\n`
      + `   status ${status} | new cookies: ${gained.join(', ') || 'none'}\n`
      + `   jar now: ${[...jar.keys()].join(', ') || 'empty'}\n`
      + `   MFL_IS_COMMISH: ${jar.has('MFL_IS_COMMISH') ? 'YES  <<<<<<' : 'no'}\n`
      + `   body: ${bodyShape(text)}\n`
  );
  return { status, text };
}

console.log(`Probing league ${leagueId} on ${host}, year ${year}`);
console.log('Cookies accumulate across every step, as a browser would.\n');

// A — api host, XML. The known baseline: MFL_USER_ID and nothing else.
await probe('A  api login (XML=1)', {
  url: `https://api.myfantasyleague.com/${year}/login?XML=1`,
  method: 'POST',
  body: creds.toString(),
});

// B — league host, XML. CI already showed this yields nothing; kept so one
// run carries the whole comparison rather than half of it.
await probe('B  league login (XML=1)', {
  url: `https://${host}/${year}/login?L=${leagueId}&XML=1`,
  method: 'POST',
  body: creds.toString(),
});

// C — league host, NO XML. The interactive flow the docs actually describe,
// and the one whose session D and E then inherit through the jar.
await probe('C  league login (HTML, no XML)', {
  url: `https://${host}/${year}/login?L=${leagueId}`,
  method: 'POST',
  body: creds.toString(),
});

// D — commissioner setup. Is the cookie granted on entering commissioner
// mode rather than at login?
await probe('D  csetup (commissioner mode)', {
  url: `https://${host}/${year}/csetup?L=${leagueId}`,
});

// E — control. If E sets it too, it is not commissioner-specific at all.
await probe('E  league home (control)', {
  url: `https://${host}/${year}/home/${leagueId}`,
});

// F — the step MFL's OWN sample does and we never have: ask myleagues where
// this league actually lives, instead of trusting the registry's mflHost.
// MFL's developer sample resolves the host per user + league from the `url`
// attribute and uses THAT for everything after. If a league has moved to a
// different wwwNN, every commissioner request we send goes to the wrong host —
// and a wrong host answers "API requires commissioner access", which is
// exactly what we have been reading as a credential problem.
const mlUrl = `https://api.myfantasyleague.com/${year}/export?TYPE=myleagues`;
let discovered = '';
try {
  const res = await mflFetch({
    url: mlUrl,
    method: 'GET',
    cookies: { MFL_USER_ID: jar.get('MFL_USER_ID') ?? '' },
  });
  const xml = await res.text();
  const re = new RegExp(`url="https?://([a-z0-9]+\\.myfantasyleague\\.com)/${year}/home/${leagueId}"`);
  discovered = xml.match(re)?.[1] ?? '';
  const leagueCount = (xml.match(/<league /g) || []).length;
  console.log(
    `F  myleagues host discovery\n`
      + `   status ${res.status} | leagues visible to this account: ${leagueCount}\n`
      + `   registry says:  ${host}\n`
      + `   MFL says:       ${discovered || '(league not found in myleagues)'}\n`
      + `   ${discovered && discovered !== host ? 'MISMATCH  <<<<<< every write has been going to the wrong host' : discovered ? 'match' : 'could not resolve — the account may not be in this league'}\n`
  );
} catch (error) {
  console.log(`F  myleagues host discovery: failed — ${error.message}\n`);
}

// G — if MFL named a different host, retry the commissioner page there. A
// full-size page here where the registry host gave a stub is the whole answer.
if (discovered && discovered !== host) {
  await probe(`G  csetup on the host MFL named (${discovered})`, {
    url: `https://${discovered}/${year}/csetup?L=${leagueId}`,
  });
}

console.log(
  jar.has('MFL_IS_COMMISH')
    ? 'RESULT: the cookie IS obtainable — the first step above marked YES is the one that issued it.'
    : discovered && discovered !== host
      ? 'RESULT: no cookie was issued, but the registry host is WRONG — fix that before concluding anything about the cookie.'
      : 'RESULT: no step issued MFL_IS_COMMISH, and the registry host matches what MFL reports.'
);
