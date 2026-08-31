#!/usr/bin/env tsx
/**
 * READ-ONLY: fetch an authenticated MFL page and print its form structure.
 *
 * WHY THIS EXISTS: some things MFL does through its own web UI have no API
 * equivalent — the 2026-08-31 finding that `import?TYPE=franchises` reports
 * `<status>OK</status>` and ignores `waiverSortOrder` means waiver order is one
 * of them. The way this repo handles that is to replay the page's own form POST
 * (see src/pages/api/cut-player.ts, which replays `add_drop` because
 * `import?TYPE=fcfsWaiver` refused the job).
 *
 * Replaying a form requires its EXACT field names, and guessing them is how
 * this repo has burned time before — "Don't ship inferred parameter names to a
 * write endpoint" is a curated rule in the mfl-api insights doc. So: read the
 * real form instead of inferring it.
 *
 * This script only ever issues a GET. It cannot submit anything.
 *
 * Env: MFL_USER_ID, MFL_IS_COMMISH (commissioner of the league).
 *
 * Usage:
 *   # by league + commissioner-setup page code (preferred — no literals)
 *   pnpm exec tsx scripts/inspect-mfl-form.ts --league afl-fantasy --page WAIVORD
 *   # or an explicit URL, for a page that is not a csetup screen
 *   pnpm exec tsx scripts/inspect-mfl-form.ts --url "https://.../2026/somepage?L=..."
 */

import { mflFetch } from '../src/utils/mfl-fetch';
import { getLeagueBySlug } from '../src/config/leagues-data.mjs';
import { getRolloverLeagueYear } from '../src/utils/league-year';

const argv = process.argv.slice(2);
const value = (f: string) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

/**
 * Build the target from the league registry rather than a pasted URL — league
 * ids and MFL hosts are never hardcoded in this repo (CLAUDE.md; enforced by
 * tests/league-literal-guard.test.ts).
 */
function urlFromRegistry(slug: string, page: string, year?: string): string {
  const league = getLeagueBySlug(slug);
  if (!league) throw new Error(`Unknown league slug "${slug}"`);
  const resolved = year ?? String(getRolloverLeagueYear(league.leagueYearRollover ?? { month: 2, day: 14 }));
  if (!/^[A-Z0-9_]+$/.test(page)) throw new Error(`Suspicious page code "${page}"`);
  return `https://${league.mflHost}/${resolved}/csetup?L=${league.id}&C=${page}`;
}

const explicitUrl = value('--url');
const page = value('--page');
const url = explicitUrl ?? (page ? urlFromRegistry(value('--league') ?? 'afl-fantasy', page, value('--year')) : undefined);
if (!url) throw new Error('Pass --page <CODE> (with optional --league/--year), or --url');

/**
 * Exact hostname test. Never regex-match a host inside a URL string — an
 * unanchored pattern matches anywhere, so `https://evil.example/?x=
 * myfantasyleague.com` would pass. Parse it and compare the hostname.
 */
function hostnameOf(u: string): string {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return '';
  }
}
const isMflHost = (u: string) => {
  const h = hostnameOf(u);
  return h === 'myfantasyleague.com' || h.endsWith('.myfantasyleague.com');
};
if (!isMflHost(url)) {
  throw new Error(`Refusing to send MFL cookies to a non-MFL host: ${url}`);
}

const userId = process.env.MFL_USER_ID || '';
const commish = process.env.MFL_IS_COMMISH || '';
if (!userId) throw new Error('MFL_USER_ID is required');

console.log(`GET ${url}`);
const res = await mflFetch({
  url,
  method: 'GET',
  mflUserCookie: userId,
  mflCommishCookie: commish || undefined,
});
const html = await res.text();
console.log(`HTTP ${res.status}, ${html.length} bytes\n`);

const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim();
console.log(`Title: ${title ?? '(none)'}\n`);

// MFL's own nav is a large fixed menu of checkboxes; it is never the form we
// want, and printing it drowns the real one.
const isNavNoise = (tag: string) => /id="sub\d+"/.test(tag) && /type="checkbox"/i.test(tag);

// An unauthenticated commissioner request never 401s. MFL either bounces it to
// home.myfantasyleague.com (302, then 200 on the home page) or serves the page
// chrome with the identity strip reading `Guest (Login)`. Both come back HTTP
// 200, so the status tells you nothing — check for these two shapes instead.
const landedOn = (res as Response).url || '';
if (hostnameOf(landedOn) === 'home.myfantasyleague.com' || (title ?? '').includes('MyFantasyLeague Home Page')) {
  console.log(`MFL bounced this request to ${landedOn || 'its home page'} — the cookies did not authenticate.`);
  console.log('Commissioner setup pages redirect rather than 401. Check MFL_USER_ID / MFL_IS_COMMISH.');
  process.exit(1);
}

if (/\bGuest\b[\s\S]{0,80}\bLogin\b/i.test(html.slice(0, 40_000))) {
  console.log('MFL rendered this page as GUEST — the cookies did not authenticate.');
  console.log('The form is only present for a signed-in commissioner, so nothing to report.');
  console.log('Check MFL_USER_ID / MFL_IS_COMMISH.');
  process.exit(1);
}

const forms = [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/gi)];
if (forms.length === 0) {
  console.log('Authenticated, but NO <form> found — the form is probably built by JavaScript.');
  console.log('Raw content region below. It is printed as MARKUP, not stripped text: this is a');
  console.log('form inspector, so the tags are the point, and regex tag-stripping is unreliable');
  console.log('anyway (it misses `</script >`, comments, and `>` inside attribute values).\n');
  // The nav and footer are ~100 KB of boilerplate; #contentframe is the page.
  const start = html.indexOf('id="contentframe"');
  const region = start === -1 ? html : html.slice(start, start + 4000);
  console.log(region);
  process.exit(1);
}

console.log(`${forms.length} form(s) found.\n`);
forms.forEach((form, i) => {
  const openTag = /<form\b[^>]*>/i.exec(form[0])![0];
  const action = /action="([^"]*)"/i.exec(openTag)?.[1] ?? '(same page)';
  const method = (/method="([^"]*)"/i.exec(openTag)?.[1] ?? 'GET').toUpperCase();
  console.log(`--- form #${i} --- ${method} ${action}`);

  const fields = [...form[1].matchAll(/<(input|select|textarea)\b[^>]*>/gi)].filter(
    (m) => !isNavNoise(m[0])
  );
  if (fields.length === 0) {
    console.log('  (no fields)');
    return;
  }
  for (const f of fields) {
    const tag = f[0];
    const name = /name="([^"]*)"/i.exec(tag)?.[1];
    if (!name) continue;
    const type = /type="([^"]*)"/i.exec(tag)?.[1] ?? f[1].toLowerCase();
    const val = /value="([^"]*)"/i.exec(tag)?.[1];
    console.log(`  ${name.padEnd(24)} ${type.padEnd(10)} ${val !== undefined ? `= ${val}` : ''}`);

    // For a <select>, the options ARE the contract — print them.
    if (f[1].toLowerCase() === 'select') {
      const after = form[1].slice(f.index! + tag.length);
      const body = after.slice(0, after.search(/<\/select>/i));
      const opts = [...body.matchAll(/<option\b[^>]*value="([^"]*)"[^>]*>([^<]*)/gi)];
      const selected = [...body.matchAll(/<option\b[^>]*\bselected\b[^>]*value="([^"]*)"/gi)].map((m) => m[1]);
      console.log(
        `      ${opts.length} options: ` +
          opts.slice(0, 8).map((o) => `${o[1]}=${o[2].trim()}`).join(', ') +
          (opts.length > 8 ? ', …' : '') +
          (selected.length ? `  [selected: ${selected.join(',')}]` : '')
      );
    }
  }
  console.log();
});
