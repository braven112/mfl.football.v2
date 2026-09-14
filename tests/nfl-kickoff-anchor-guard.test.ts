import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expectClean, scanForbidden } from './helpers/scan-guard';

/**
 * NFL kickoff anchor guard.
 *
 * docs/claude/rules/schedule-optimization.md "The NFL kickoff is not a
 * derivation": nothing may re-derive the season's kickoff, or any NFL week
 * start, from Labor Day or from a hand-written table of Week 1 Thursdays.
 * `src/utils/nfl-week-starts.mjs` reads MFL's published schedule and owns the
 * Labor-Day derivation as its ONLY fallback.
 *
 * The bug: "kickoff is the Thursday after Labor Day, and week N is kickoff +
 * (N-1)*7" was inlined in eight places and hardcoded as a Week 1 map in six
 * more. Every one of them had the 2026 season opening Thursday Sep 10. It
 * opened WEDNESDAY Sep 9, and Roger posted "TODAY: NFL Season Starts" to
 * GroupMe the morning after the season had already started (owner report,
 * 2026-09-10). The same rule also missed week 12 by a day — the NFL moved it
 * to Thanksgiving Wednesday — and week 18 by three.
 *
 * Two patterns, because the two failure modes look nothing alike:
 *   - a `+ 3` / `+ 4` day offset applied to a Labor Day or kickoff value, and
 *   - a literal 20:20 ET September kickoff timestamp (the hardcoded maps).
 *
 * Exemption: comment lines. Several of these files exist partly to explain why
 * the derivation is gone, and the prose is the point.
 *
 * Known gap: a derivation spread across statements with neither `laborDay`,
 * `ld` nor `kickoff` on the offset line is not caught — the scan reads lines,
 * not the AST. The second test below closes the other half of the hole: a
 * guard that only forbids things is satisfiable by deleting the fallback, and
 * a season the NFL has not published yet would then have no date at all.
 */

/** `kickoff.getDate() + 3`, `ld.getDate() + 3` — the inline derivation shape. */
const LABOR_DAY_OFFSET = /(labor_?day|\bld\b|kickoff)\w*.{0,90}?getDate\(\)\s*\+\s*[34]\b/i;

/** `laborDayDate(year) + 4` — the same derivation done in UTC parts. */
const LABOR_DAY_ARITHMETIC = /labor_?day\w*\([^)]*\)\s*\+\s*\d/i;

/** A hand-written Week 1 kickoff instant: 20:20 ET on a September Thursday. */
const HARDCODED_KICKOFF = /['"]\d{4}-09-\d{2}T20:20:00-0[45]:00['"]/;

const ANCHOR_MODULE = 'src/utils/nfl-week-starts.mjs';

describe('NFL kickoff anchor guard', () => {
  it('nothing re-derives kickoff or an NFL week start outside nfl-week-starts.mjs', () => {
    const result = scanForbidden({
      roots: ['src', 'scripts'],
      extensions: ['.ts', '.tsx', '.mjs', '.astro'],
      forbidden: [
        { name: 'labor-day kickoff offset', pattern: LABOR_DAY_OFFSET },
        { name: 'labor-day arithmetic', pattern: LABOR_DAY_ARITHMETIC },
        { name: 'hardcoded week 1 kickoff', pattern: HARDCODED_KICKOFF },
      ],
      exempt: ({ line }) => /^\s*(\/\/|\*|\/\*)/.test(line),
      allowlist: [
        {
          file: 'src/utils/pecking-order-season-window.mjs',
          names: ['labor-day arithmetic'],
          reason:
            "firstIssueTuesday is Labor Day + 8 on purpose — it names the Pecking Order's CRON SLOT, not a kickoff, and its own comment explains why deriving it from kickoff slides a day.",
        },
      ],
    });
    expectClean(
      result,
      'Read the kickoff from src/utils/nfl-week-starts.mjs — see docs/claude/rules/schedule-optimization.md "The NFL kickoff is not a derivation".',
    );
  });

  it('keeps the Labor Day derivation as the fallback in the anchor module', () => {
    // MFL 404s a season's schedule until the NFL publishes it in spring, so
    // from February to May the next season has no official answer and the
    // derivation is the only thing that can name a date. Deleting it would
    // satisfy the scan above and break every forward-looking date on the site.
    const src = readFileSync(resolve(process.cwd(), ANCHOR_MODULE), 'utf8');
    expect(src).toContain('derivedWeekStartIsoDate');
    expect(src).toMatch(/laborDayDate/);
  });
});
