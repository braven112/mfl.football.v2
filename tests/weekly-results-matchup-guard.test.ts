import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { processWeeklyScores } from '../src/utils/coach-data';

/**
 * Guard: MFL omits `matchup` for a week it has not paired up.
 *
 * On 2026-09-08 `theleague.us/rosters` served a 404 to every owner. The cause
 * was one character of missing defensiveness in the page's inline copy of
 * `processWeeklyScores`:
 *
 *     const matchups = Array.isArray(weekResults.matchup)
 *       ? weekResults.matchup
 *       : [weekResults.matchup];        // <- wraps `undefined` into an array
 *
 * The moment the season rolled over, `weekly-results-raw.json` gained weeks
 * 15-17 shaped `{ week, franchise }` with **no `matchup` key at all** — MFL's
 * shape for a week whose head-to-head pairings do not exist yet. The fallback
 * produced `[undefined]`, the very next line read `matchup.franchise`, and the
 * whole SSR render died. Astro served the 404 page for a throw, so the failure
 * looked like a missing route rather than a crash.
 *
 * `processWeeklyScores` had been copy-pasted into three files. `coach-data.ts`
 * already carried the guards; the other two did not. The hotfix pinned all
 * three; the follow-up collapsed them, so there is one implementation left to
 * pin — and the point of the scan below is now that it stays that way.
 *
 * `src/utils/weekly-scores.ts` was deleted outright (dead code with no
 * importers, carrying the same live landmine) and `rosters.astro` imports
 * `coach-data.ts` instead of redeclaring the function. See
 * docs/claude/followups/2026-09-08-roster-page-unpaired-week-404.md (F2).
 */

const ROOT = process.cwd();

/**
 * The one file allowed to carry an implementation of `processWeeklyScores`.
 * Everything else imports it.
 */
const CANONICAL_IMPLEMENTATION = 'src/utils/coach-data.ts';

/** Files that consume it, and must keep consuming rather than redeclaring. */
const CONSUMERS = [
  'src/pages/theleague/rosters.astro',
  'src/pages/theleague/lineup.astro',
  'src/pages/afl-fantasy/lineup.astro',
];

/**
 * A week in the shape that broke production: no `matchup`, franchises listed
 * directly on `weeklyResults`, and players carrying an id but no score. Mixed
 * with a normal matchup week so the test also proves the guard does not throw
 * the real weeks away.
 */
const FEED_WITH_AN_UNPAIRED_WEEK = [
  {
    weeklyResults: {
      week: '1',
      matchup: [
        {
          franchise: [
            { id: '0001', player: [{ id: '13593', score: '18.5', status: 'starter' }] },
            { id: '0002', player: { id: '14001', score: '9.25', status: 'starter' } },
          ],
        },
      ],
    },
  },
  {
    // Weeks 15-17 of the 2026 feed, verbatim in shape.
    weeklyResults: {
      week: '15',
      franchise: [
        { id: '0001', starters: '', nonstarters: '', player: [{ id: '13593', status: 'starter' }] },
      ],
    },
  },
];

describe('processWeeklyScores tolerates a week MFL has not paired into matchups', () => {
  it('does not throw, and still reads the paired week', () => {
    const scores = processWeeklyScores(FEED_WITH_AN_UNPAIRED_WEEK, 15);

    expect(scores.get('13593')).toEqual({ 1: 18.5 });
    expect(scores.get('14001')).toEqual({ 1: 9.25 });
  });

  it('survives a weeklyResults with an explicitly undefined matchup', () => {
    const fn = processWeeklyScores;
    expect(() => fn([{ weeklyResults: { week: '15', matchup: undefined } }], 15)).not.toThrow();
    expect(() => fn([{ weeklyResults: { week: '15', matchup: [undefined] } }], 15)).not.toThrow();
    expect(() => fn([{ weeklyResults: { week: '15', matchup: { franchise: undefined } } }], 15)).not.toThrow();
  });
});

describe('the canonical processWeeklyScores keeps the guards', () => {
  {
    const file = CANONICAL_IMPLEMENTATION;
    const source = readFileSync(join(ROOT, file), 'utf8');

    it(`${file} never wraps a bare weekResults.matchup into an array`, () => {
      // The exact defect: an `else` branch that array-wraps a value it has not
      // proven truthy. The safe form checks first — `x.matchup ? [x.matchup] : []`
      // — which puts a `?` rather than a `:` in front of the bracket.
      const bareWrap = /:\s*\[\s*[\w.?]*\bmatchup\s*\]/g;
      const offenders = source.match(bareWrap) ?? [];

      expect(offenders, `${file} wraps a possibly-undefined matchup: ${offenders.join(', ')}`)
        .toEqual([]);
    });

    it(`${file} skips a null matchup and a null franchise before dereferencing`, () => {
      expect(source, `${file} is missing \`if (!matchup) return\``)
        .toMatch(/if\s*\(\s*!matchup\s*\)\s*return/);
      expect(source, `${file} is missing \`if (!franchise) return\``)
        .toMatch(/if\s*\(\s*!franchise\s*\)\s*return/);
    });
  }
});

describe('nobody re-grows a second copy of processWeeklyScores', () => {
  // The defect shipped because the page held its own copy that drifted from
  // the util's. A consumer that DECLARES the function instead of importing it
  // is the start of the next drift, so the shape is what gets pinned, not just
  // the guards inside it.
  const DECLARES = /(?:function\s+processWeeklyScores|(?:const|let|var)\s+processWeeklyScores\s*=)/;

  for (const file of CONSUMERS) {
    it(`${file} imports processWeeklyScores rather than declaring its own`, () => {
      const source = readFileSync(join(ROOT, file), 'utf8');

      expect(source, `${file} does not import processWeeklyScores`)
        .toMatch(/import\s*\{[^}]*\bprocessWeeklyScores\b[^}]*\}\s*from\s*['"][^'"]*coach-data['"]/);
      expect(
        DECLARES.test(source),
        `${file} declares its own processWeeklyScores — import the one in ${CANONICAL_IMPLEMENTATION} instead`,
      ).toBe(false);
    });
  }
});
