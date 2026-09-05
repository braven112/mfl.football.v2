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
 */
const KNOWN_UNFIXED: string[] = [];

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(full);
    return /\.(ts|astro|mjs)$/.test(e.name) ? [full] : [];
  });

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
      return bareFetchCalls(source)
        .filter((call) => /Cookie\s*:/.test(call))
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
