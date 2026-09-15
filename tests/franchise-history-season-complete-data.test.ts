/**
 * The REAL producer's output, through the REAL badge gate.
 *
 * tests/badges-season-complete.test.ts hands `seasonComplete` to
 * buildBadgeContext directly, and the gate treats a missing field as complete
 * (so older snapshots keep their badges). That means the unit test stays green
 * if compute-franchise-history.mjs ever stops writing the field, or renames it —
 * and production goes straight back to awarding season honors off a week-1
 * table (Copilot, PR #1090). This reads the snapshot the nightly workflow
 * actually commits.
 *
 * A snapshot generated before the hotfix merged cannot carry the field, so the
 * suite enforces from the first snapshot produced after it. `generatedAt` only
 * moves forward, so once a post-hotfix snapshot lands this can never skip again.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { isSeasonComplete } from '../scripts/lib/theleague-season-complete.mjs';
import { buildBadgeContext, computeBadgesFor } from '../scripts/badges.mjs';

type YearSummary = { year: number; champion: string | null; seasonComplete?: unknown };
type Award = { year?: number };
type Badge = { id: string; tier: string; awards: Award[] };
type Franchise = { badges?: Badge[] } & Record<string, unknown>;

// PR #1090's merge — the first moment the producer wrote `seasonComplete`.
const PRODUCER_WRITES_FIELD_SINCE = Date.parse('2026-09-15T17:57:15Z');

const snapshot = JSON.parse(
  readFileSync('data/theleague/derived/franchise-history.json', 'utf8')
) as { generatedAt: string; yearSummaries: YearSummary[]; franchises: Record<string, Franchise> };

const generatedAt = Date.parse(snapshot.generatedAt);

// The producer compares against the calendar year it RAN in, so the snapshot's
// own stamp is the clock — never the machine running this test.
const producedIn = new Date(generatedAt).getFullYear();

describe('the committed snapshot has a readable generatedAt', () => {
  it('parses', () => {
    expect(Number.isFinite(generatedAt)).toBe(true);
  });
});

describe.skipIf(generatedAt < PRODUCER_WRITES_FIELD_SINCE)(
  'committed franchise-history.json carries the season-complete gate',
  () => {
    it('every year summary has a boolean seasonComplete', () => {
      const missing = snapshot.yearSummaries
        .filter((y) => typeof y.seasonComplete !== 'boolean')
        .map((y) => y.year);
      expect(missing).toEqual([]);
    });

    it('seasonComplete is the isSeasonComplete verdict for that year', () => {
      const wrong = snapshot.yearSummaries
        .filter((y) => y.seasonComplete !== isSeasonComplete(y.year, { champion: y.champion }, producedIn))
        .map((y) => y.year);
      expect(wrong).toEqual([]);
    });

    it('no committed franchise holds a single-season award for an unfinished season', () => {
      const incomplete = new Set(
        snapshot.yearSummaries.filter((y) => y.seasonComplete === false).map((y) => y.year)
      );
      const offenders = Object.entries(snapshot.franchises).flatMap(([fid, fr]) =>
        (fr.badges ?? [])
          .filter((b) => b.tier === 'season')
          .flatMap((b) => b.awards.filter((a) => a.year != null && incomplete.has(a.year)))
          .map((a) => `${fid}:${a.year}`)
      );
      expect(offenders).toEqual([]);
    });

    it('recomputing badges from the committed summaries awards nothing for an unfinished season', () => {
      const ctx = buildBadgeContext(snapshot.franchises, snapshot.yearSummaries);
      const offenders = Object.values(snapshot.franchises).flatMap((fr) =>
        (computeBadgesFor(fr, ctx) as Badge[])
          .filter((b) => b.tier === 'season')
          .flatMap((b) =>
            b.awards.filter((a) => a.year != null && ctx.incompleteYears.has(Number(a.year)))
          )
      );
      expect(offenders).toEqual([]);
    });
  }
);
