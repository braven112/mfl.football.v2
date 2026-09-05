/**
 * A Cookie header on a bare `fetch()` to MFL is a silent auth failure.
 *
 * Node's undici strips Cookie headers on cross-origin redirects, and
 * `api.myfantasyleague.com` ALWAYS 302s to `www49.myfantasyleague.com`. So a
 * bare `fetch(apiUrl, { headers: { Cookie } })` arrives unauthenticated and MFL
 * answers `API requires a logged in user` with HTTP 200 — no throw, no error
 * status, just a payload that parses as empty. `src/utils/mfl-fetch.ts` exists
 * solely to re-attach the cookie on each hop.
 *
 * This shipped twice in the waiver claim flow, and neither failure looked like
 * one:
 *   - the owner-gated CALENDAR read came back "empty", resolving the waiver
 *     window to `unknown`, which routes every FCFS add through the queued-claim
 *     endpoint instead;
 *   - the pendingWaivers VERIFICATION read came back empty, so the check that
 *     exists because MFL returns 200 on dropped writes silently never ran.
 *
 * The comment at the top of mfl-fetch.ts already warned about this. A comment
 * was not enough, so this is a test.
 *
 * ...and then it shipped a THIRD time, in `scripts/fetch-mfl-feeds.mjs`, because
 * this test only ever scanned `src/`. The calendar feed was given a Cookie
 * header on a bare `fetch` and MFL answered `API requires logged in user in
 * league ID 19621` — which reads as a stale secret, not as a stripped header,
 * and cost a workflow run to tell apart (2026-09-02). The scan now covers
 * `scripts/` too. Node scripts cannot import `src/utils/mfl-fetch.ts` (it is app
 * TS); their equivalent is `scripts/lib/mfl-api.mjs`.
 *
 * Widening it immediately found three more, and they were NOT theoretical:
 * there is no `MFL_HOST` repo variable, so `schefter-scan.mjs` and
 * `schefter-rumor-scan.mjs` both fell back to `api.myfantasyleague.com` and
 * their `pendingTrades` reads had been coming back anonymous in production —
 * each behind a "returned HTML, auth likely failed" branch that logged a
 * warning and carried on, so a dead feature looked like a config nag. That is
 * the real lesson of this guard: the bug does not announce itself, it degrades
 * into a plausible-looking warning.
 *
 * A FIFTH instance then shipped anyway, and this test looked straight at it and
 * said nothing (2026-09-04). `MFLMatchupApiClient#makeRequest` — the shared read
 * path behind getStartingLineups / getPlayers / getInjuryReport / getLeagueInfo
 * / getProjectedScores / getSchedule — assigned `headers['Cookie']` into a
 * variable and then called `fetch(url, { headers, signal })`. The guard only
 * matched `Cookie:` inside the `fetch(...)` argument TEXT, and that text is
 * `(url, { headers, signal })`: no `Cookie` substring, no match. Every call site
 * that builds its headers in a variable evaded the guard, which is most of the
 * shapes a reviewer would actually write. Detection now follows the variable
 * (`cookieHeaderVars` + `carriesCookieVar`), not just the literal.
 *
 * Two things made that one worse than latent: `baseUrl` defaults to
 * `api.myfantasyleague.com` whenever `MFL_HOST` is unset, and two OTHER methods
 * in the same file already routed through `mflFetch` with a comment naming this
 * exact redirect — so the file documented the bug it was shipping.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.join(process.cwd(), 'src');
const SCRIPTS = path.join(process.cwd(), 'scripts');

/** Paths are reported relative to the repo root so both roots read the same. */
const ROOTS = [SRC, SCRIPTS];

/**
 * Pre-existing call sites that carry the same shape. They are NOT exempt
 * because they are safe — `MFL_READ_HOST` defaults to
 * `api.myfantasyleague.com`, so they are exposed to exactly this bug whenever
 * `MFL_HOST` is unset. They are recorded here rather than fixed because they
 * belong to different features.
 *
 * The three `scripts/` entries this list briefly held were NOT latent: with no
 * `MFL_HOST` repo variable set, both schefter scans were resolving
 * `api.myfantasyleague.com` and their commissioner/franchise `pendingTrades`
 * reads had been arriving anonymous in production. They are fixed, not
 * baselined — see the 2026-09-02 note above.
 *
 * The list is now EMPTY. The last two entries were the contracts sites, and
 * they were not latent either: `createPreWriteBackup` captured an empty
 * "backup" before every salary write, and `/api/contracts/verify` — the
 * endpoint that exists to prove a write landed — reported an empty contract
 * map as a successful verification. Both were fixed 2026-09-04.
 *
 * This list may only SHRINK. Same idiom as tests/fixtures/typecheck-baseline.json:
 * fixing one and leaving it listed fails, so the baseline cannot rot.
 *
 * Widening the detection to variable-built headers (2026-09-04) added NOTHING
 * here: `makeRequest` was the only offender it found, and it was fixed rather
 * than baselined. This list is unchanged from before that change.
 */
const KNOWN_UNFIXED: string[] = [];

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(full);
    return /\.(ts|astro|mjs)$/.test(e.name) ? [full] : [];
  });

/** Read the balanced `(...)` or `{...}` starting at `start`, cheaply. */
function balanced(source: string, start: number, open: '(' | '{'): string {
  const close = open === '(' ? ')' : '}';
  let depth = 0;
  for (let i = start; i < source.length && i < start + 4000; i++) {
    if (source[i] === open) depth++;
    else if (source[i] === close) {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return source.slice(start, start + 4000);
}

/**
 * Identifiers that hold a Cookie header somewhere in this file.
 *
 * The original guard only looked for `Cookie:` INSIDE the `fetch(...)` argument
 * text, so `mfl-matchup-api.ts#makeRequest` — which assigned
 * `headers['Cookie']` into a variable one line above and then called
 * `fetch(url, { headers, signal })` — read as clean. It was not: it was the
 * fifth shipped instance of this bug. Any call site that builds its headers in
 * a variable evaded the guard entirely, so the variable is now tracked to the
 * `fetch` that consumes it.
 */
function cookieHeaderVars(source: string): Set<string> {
  const names = new Set<string>();

  // headers['Cookie'] = ... / headers.Cookie = ... / headers.set('Cookie', ...)
  const assign = /([A-Za-z_$][\w$]*)\s*(?:\[\s*['"`]Cookie['"`]\s*\]\s*=|\.\s*Cookie\s*=|\.\s*set\s*\(\s*['"`]Cookie['"`])/g;
  let m: RegExpExecArray | null;
  while ((m = assign.exec(source))) names.add(m[1]);

  // const headers = { ..., Cookie: ... } — including a ternary/typed declaration.
  const decl = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b[^=;\n]*=\s*(?=[^;\n]*\{)/g;
  while ((m = decl.exec(source))) {
    const brace = source.indexOf('{', m.index + m[0].length - 1);
    if (brace === -1) continue;
    if (/Cookie\s*:/.test(balanced(source, brace, '{'))) names.add(m[1]);
  }

  return names;
}

/**
 * `redirect: 'manual'` — the shape of the FIX, not the bug.
 *
 * Undici strips the Cookie only on a redirect it follows ITSELF. With manual
 * redirects fetch hands the 3xx back and the caller re-attaches the cookie on
 * the next hop, which is precisely what `mfl-fetch.ts` and `lib/mfl-api.mjs`
 * do — they are exempted by path above, but the path list is the wrong
 * instrument: it has to be edited every time someone writes a correct manual
 * walker, and until it is, the guard cries wolf on the one shape it should be
 * endorsing. `scripts/probe-commish-cookie.mjs` is exactly that — a hand-rolled
 * hop loop with a full cookie JAR, which it needs because it exists to discover
 * which cookies MFL issues, something mflFetch's two-cookie signature cannot
 * express. Exempt the mechanism, not the filename.
 *
 * This does NOT excuse a manual-redirect call that then ignores the 3xx; that
 * is a different bug, and not one about stripped cookies.
 */
function isManualRedirect(call: string): boolean {
  return /redirect\s*:\s*['"`]manual['"`]/.test(call);
}

/** Does this `fetch(...)` argument list reference a Cookie-carrying variable? */
function carriesCookieVar(call: string, vars: Set<string>): boolean {
  for (const name of vars) {
    if (new RegExp(`(^|[^A-Za-z0-9_$.])${name}\\b`).test(call)) return true;
  }
  return false;
}

/** Every `fetch(` call that is not `mflFetch(`, with its argument list. */
function bareFetchCalls(source: string): string[] {
  const out: string[] = [];
  const re = /(^|[^A-Za-z0-9_$.])fetch\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    let depth = 0;
    const start = m.index + m[0].length - 1;
    for (let i = start; i < source.length && i < start + 4000; i++) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')') {
        depth--;
        if (depth === 0) {
          out.push(source.slice(start, i + 1));
          break;
        }
      }
    }
  }
  return out;
}

describe('MFL authenticated reads must survive the api → www49 redirect', () => {
  const offenders = ROOTS.flatMap((root) => walk(root))
    // The two manual-redirect helpers ARE the fix — they hold the only
    // legitimate `fetch` that carries a Cookie.
    .filter((f) => !f.endsWith(path.join('utils', 'mfl-fetch.ts')))
    .filter((f) => !f.endsWith(path.join('lib', 'mfl-api.mjs')))
    .flatMap((file) => {
      const source = fs.readFileSync(file, 'utf-8');
      if (!source.includes('Cookie')) return [];
      const vars = cookieHeaderVars(source);
      return bareFetchCalls(source)
        .filter((call) => /Cookie\s*:/.test(call) || carriesCookieVar(call, vars))
        .filter((call) => !isManualRedirect(call))
        .map(() => path.relative(process.cwd(), file).split(path.sep).join('/'));
    });

  const unique = [...new Set(offenders)].sort();

  it('no NEW bare fetch() sends a Cookie header to MFL', () => {
    const unexpected = unique.filter((f) => !KNOWN_UNFIXED.includes(f));
    expect(
      unexpected,
      'Use mflFetch({ url, method, mflUserCookie }) instead of fetch() — a raw ' +
        'Cookie header is dropped on the api → www49 redirect and the read comes ' +
        'back as an unauthenticated error payload with HTTP 200.'
    ).toEqual([]);
  });

  it('the baseline only shrinks — fix one and remove it from KNOWN_UNFIXED', () => {
    const fixed = KNOWN_UNFIXED.filter((f) => !unique.includes(f));
    expect(
      fixed,
      'These no longer send a raw Cookie header. Delete them from KNOWN_UNFIXED ' +
        'so the baseline cannot rot.'
    ).toEqual([]);
  });

  it('the waiver claim route reads MFL only through mflFetch', () => {
    // The two reads this guard was written for, pinned directly: the
    // owner-gated calendar and the pendingWaivers verification.
    const source = fs.readFileSync(path.join(SRC, 'pages/api/waiver-claim.ts'), 'utf-8');
    expect(source).toContain('TYPE=calendar');
    expect(source).toContain('TYPE=pendingWaivers');
    for (const call of bareFetchCalls(source)) {
      expect(/Cookie\s*:/.test(call), `bare fetch() with a Cookie header: ${call.slice(0, 120)}`).toBe(false);
    }
  });
});
