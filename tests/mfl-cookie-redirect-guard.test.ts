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
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.join(process.cwd(), 'src');

/**
 * Pre-existing call sites, from the contracts writer, that carry the same
 * shape. They are NOT exempt because they are safe — `MFL_READ_HOST` defaults
 * to `api.myfantasyleague.com`, so they are exposed to exactly this bug
 * whenever `MFL_HOST` is unset. They are recorded here rather than fixed
 * because they belong to a different feature.
 *
 * This list may only SHRINK. Same idiom as tests/fixtures/typecheck-baseline.json:
 * fixing one and leaving it listed fails, so the baseline cannot rot.
 */
const KNOWN_UNFIXED = [
  'utils/mfl-contract-writer.ts',
  'pages/api/contracts/verify.ts',
];

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
  const offenders = walk(SRC)
    .filter((f) => !f.endsWith(path.join('utils', 'mfl-fetch.ts')))
    .flatMap((file) => {
      const source = fs.readFileSync(file, 'utf-8');
      if (!source.includes('Cookie')) return [];
      return bareFetchCalls(source)
        .filter((call) => /Cookie\s*:/.test(call))
        .map(() => path.relative(SRC, file).split(path.sep).join('/'));
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
