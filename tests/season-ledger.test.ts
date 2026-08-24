/**
 * season-ledger.json — the flat, UNATTRIBUTED record of every franchise-season
 * actually played.
 *
 * `franchises[].yearByYear` in franchise-history.json is owner-scoped by
 * design: `attributeYear()` returns null for a season belonging to a previous
 * owner, so a new owner does not inherit the last one's record. Correct — and
 * it meant ~34% of TheLeague's franchise-seasons and ~40% of the AFL's existed
 * nowhere on disk at all, 14 league championships among them.
 *
 * The ledger is emitted from the SAME run as franchise-history.json, off the
 * same parsed standings/brackets/divisions. Deriving it in a second script
 * would duplicate that parsing and guarantee future drift.
 *
 * These tests are the proof that adding it changed nothing: every attributed
 * row still matches its yearByYear entry field-for-field, and the row count
 * still equals what MFL's standings actually contain.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';

const ROOT = path.resolve(__dirname, '..');

const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

type LedgerRow = {
  year: number;
  franchiseId: string;
  attributedTo: string | null;
  seasonNotStarted: boolean;
  [k: string]: unknown;
};

/** Leagues that actually run this pipeline — best-ball has no franchise history. */
const leagues = ALL_LEAGUES.map((league: any) => {
  const derived = path.join(ROOT, league.dataPath, 'derived');
  return {
    league,
    ledgerPath: path.join(derived, 'season-ledger.json'),
    historyPath: path.join(derived, 'franchise-history.json'),
  };
}).filter((l) => existsSync(l.historyPath));

it('finds at least one league with a computed franchise history', () => {
  expect(leagues.length).toBeGreaterThan(0);
});

describe.each(leagues)('$league.slug season ledger', ({ league, ledgerPath, historyPath }) => {
  it('exists — franchise-history.json is present, so the ledger must be too', () => {
    expect(existsSync(ledgerPath), `${ledgerPath} missing — re-run compute:franchise-history`).toBe(
      true
    );
  });

  it('has one row per franchise-season in the raw MFL standings', () => {
    const ledger = readJson(ledgerPath);
    const feedsDir = path.join(ROOT, league.dataPath, 'mfl-feeds');
    if (!existsSync(feedsDir)) return;

    // Count standings rows straight from the feeds the compute script read.
    // This is deliberately an independent count: it never touches the ledger's
    // own totals, so a row silently dropped by the attribution guard fails here.
    let expected = 0;
    const years = new Set<number>(ledger.rows.map((r: LedgerRow) => r.year));
    for (const year of years) {
      const standingsPath = path.join(feedsDir, String(year), 'standings.json');
      if (!existsSync(standingsPath)) continue;
      const raw = readJson(standingsPath);
      const rows = raw?.leagueStandings?.franchise ?? [];
      expected += Array.isArray(rows) ? rows.length : 1;
    }
    if (expected === 0) return; // feeds not checked out — nothing to compare against

    expect(ledger.rows.length).toBe(expected);
  });

  it('agrees with its own declared totals', () => {
    const ledger = readJson(ledgerPath);
    expect(ledger.totalRows).toBe(ledger.rows.length);
    expect(ledger.orphanedRows).toBe(
      ledger.rows.filter((r: LedgerRow) => r.attributedTo === null).length
    );
  });

  it('actually carries orphaned rows — the whole point of the file', () => {
    const ledger = readJson(ledgerPath);
    expect(ledger.orphanedRows).toBeGreaterThan(0);
  });

  it('has no duplicate (franchiseId, year) rows', () => {
    const ledger = readJson(ledgerPath);
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const row of ledger.rows as LedgerRow[]) {
      const key = `${row.franchiseId}|${row.year}`;
      if (seen.has(key)) dupes.push(key);
      seen.add(key);
    }
    expect(dupes).toEqual([]);
  });

  /**
   * THE refactor proof. Hoisting the row payload above `if (!targetId)
   * continue` must not have perturbed a single attributed field — if it did,
   * every franchise page's year-by-year table is wrong.
   */
  it('every attributed row is field-for-field identical to its yearByYear entry', () => {
    const ledger = readJson(ledgerPath);
    const history = readJson(historyPath);

    let compared = 0;
    for (const row of ledger.rows as LedgerRow[]) {
      if (row.attributedTo === null) continue;
      const franchise = history.franchises[row.attributedTo];
      expect(franchise, `franchise ${row.attributedTo} missing from history`).toBeTruthy();

      const entry = franchise.yearByYear.find((y: any) => y.year === row.year);
      expect(
        entry,
        `${league.slug} ${row.attributedTo} ${row.year} attributed in ledger but absent from yearByYear`
      ).toBeTruthy();

      // The ledger row is the yearByYear payload plus three bookkeeping keys.
      const { franchiseId, attributedTo, seasonNotStarted, ...seasonFields } = row;
      expect(seasonFields, `${league.slug} ${row.attributedTo} ${row.year} diverged`).toEqual(entry);
      compared += 1;
    }
    expect(compared).toBeGreaterThan(0);
  });

  it('accounts for every yearByYear entry — nothing in history is missing from the ledger', () => {
    const ledger = readJson(ledgerPath);
    const history = readJson(historyPath);

    const attributed = new Set(
      (ledger.rows as LedgerRow[])
        .filter((r) => r.attributedTo !== null)
        .map((r) => `${r.attributedTo}|${r.year}`)
    );
    const missing: string[] = [];
    for (const [id, franchise] of Object.entries<any>(history.franchises)) {
      for (const entry of franchise.yearByYear) {
        if (!attributed.has(`${id}|${entry.year}`)) missing.push(`${id}|${entry.year}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('leaves orphaned rows with no claimant, and no sourceFranchiseId to point at', () => {
    const ledger = readJson(ledgerPath);
    for (const row of (ledger.rows as LedgerRow[]).filter((r) => r.attributedTo === null)) {
      // sourceFranchiseId is only meaningful relative to a claimant.
      expect(row.sourceFranchiseId).toBeNull();
      // An orphan still knows which slot it was played on.
      expect(typeof row.franchiseId).toBe('string');
      expect(row.franchiseId.length).toBeGreaterThan(0);
    }
  });

  it('keeps era-correct identity on orphaned rows', () => {
    const ledger = readJson(ledgerPath);
    const orphans = (ledger.rows as LedgerRow[]).filter((r) => r.attributedTo === null);
    for (const row of orphans) {
      expect(typeof row.name, `${row.franchiseId} ${row.year} has no name`).toBe('string');
      expect((row.name as string).length).toBeGreaterThan(0);
    }
  });
});

/**
 * The headline numbers, pinned. These were measured against real data and are
 * the reason the feature exists — if a future pipeline change moves them, that
 * is either a real data correction or a regression, and either way somebody
 * should have to look at it deliberately.
 */
describe('measured orphan counts', () => {
  const cases = [
    { slug: 'theleague', total: 320, orphaned: 110 },
    { slug: 'afl-fantasy', total: 576, orphaned: 230 },
  ];

  for (const { slug, total, orphaned } of cases) {
    const league: any = ALL_LEAGUES.find((l: any) => l.slug === slug);
    const ledgerPath = path.join(ROOT, league.dataPath, 'derived', 'season-ledger.json');
    const runIf = existsSync(ledgerPath) ? it : it.skip;

    runIf(`${slug}: ${orphaned} of ${total} franchise-seasons belong to a former owner`, () => {
      const ledger = readJson(ledgerPath);
      expect(ledger.totalRows).toBe(total);
      expect(ledger.orphanedRows).toBe(orphaned);
    });
  }
});

/**
 * Trap 1 from docs/plans/owners-feature.md: `yearSummaries` trophies are RAW
 * MFL franchise ids, written straight from the bracket/award parse — only
 * `divisionWinners[]` runs through `attributeYear`, and it carries
 * `sourceFranchiseId`. So the orphaned trophies are already recoverable from
 * the file on disk. This test pins that, because "fixing" it would silently
 * re-attribute championships to owners who did not win them.
 */
describe('orphaned trophies are recoverable without a pipeline change', () => {
  const cases = [
    { slug: 'theleague', championships: 7, divisionTitles: 25 },
    { slug: 'afl-fantasy', championships: 7, divisionTitles: 48 },
  ];

  for (const { slug, championships, divisionTitles } of cases) {
    const league: any = ALL_LEAGUES.find((l: any) => l.slug === slug);
    const derived = path.join(ROOT, league.dataPath, 'derived');
    const ledgerPath = path.join(derived, 'season-ledger.json');
    const historyPath = path.join(derived, 'franchise-history.json');
    const runIf = existsSync(ledgerPath) && existsSync(historyPath) ? it : it.skip;

    runIf(`${slug}: ${championships} titles + ${divisionTitles} division titles are orphaned`, () => {
      const ledger = readJson(ledgerPath);
      const history = readJson(historyPath);
      const orphan = new Set(
        (ledger.rows as LedgerRow[])
          .filter((r) => r.attributedTo === null)
          .map((r) => `${r.franchiseId}|${r.year}`)
      );

      const orphanedTitles = history.yearSummaries.filter(
        (y: any) => y.champion && orphan.has(`${y.champion}|${y.year}`)
      );
      expect(orphanedTitles.length).toBe(championships);

      const orphanedDivisions = history.yearSummaries.flatMap((y: any) =>
        (y.divisionWinners ?? []).filter(
          (w: any) => w.sourceFranchiseId && orphan.has(`${w.sourceFranchiseId}|${y.year}`)
        )
      );
      expect(orphanedDivisions.length).toBe(divisionTitles);
    });
  }
});
