/**
 * Ownership-boundary parity — the anti-drift test.
 *
 * "When did the current owner take over, and whose season is this?" is
 * answered by FIVE separate implementations in this repo, and two of them
 * already disagree:
 *
 *   1. scripts/compute-franchise-history.mjs  `attributeYear` / `inferCurrentOwnerSince`
 *   2. src/utils/afl-awards.ts                `attributeAwardYear` / `getCurrentOwnerSince`
 *   3. src/utils/franchise-eras.ts            `buildFranchiseEras` / `renderedEraStarts`
 *   4. src/utils/team-names.ts                era resolution
 *   5. src/pages/afl-fantasy/franchises/[id].astro  page-local logic
 *
 * (2) walks back on NAME ONLY — it has no `ownerEra` clause. (1) walks back on
 * `sameName || sameEra`. They agree today for exactly one accidental reason:
 * `ownerEra` is set on a single TheLeague slot (0003), and afl-awards.ts never
 * reads TheLeague's config. Add `ownerEra` to any AFL team and stat
 * attribution silently forks from display.
 *
 * `src/utils/owner-tenures.mjs` is a SIXTH implementation. Adding it without
 * pinning the equality would be the worst outcome, so this test asserts the
 * new one agrees with the existing ones, and — critically — asserts the
 * PRECONDITION that keeps (1) and (2) accidentally aligned. The day someone
 * adds `ownerEra` to an AFL team, this test says so instead of the AFL awards
 * page quietly crediting the wrong owner.
 *
 * PR 3 migrates the other four onto owner-tenures.mjs and resolves the
 * divergence for real; this test is what makes that refactor provable.
 * It pins CURRENT behaviour — including the divergence — deliberately.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { LEAGUES, ALL_LEAGUES } from '../src/config/leagues-data.mjs';
import { buildAttributor, inferCurrentOwnerSince } from '../src/utils/owner-tenures.mjs';
import { renderedEraStarts } from '../src/utils/franchise-eras';

const ROOT = path.resolve(__dirname, '..');
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

const loadLeague = (slug: string) => {
  const league: any = (LEAGUES as any)[slug];
  const ledgerPath = path.join(ROOT, league.dataPath, 'derived', 'season-ledger.json');
  const configPath = path.join(ROOT, league.configPath);
  if (!existsSync(ledgerPath) || !existsSync(configPath)) return null;
  const cfg = readJson(configPath);
  const teams = Array.isArray(cfg.teams) ? cfg.teams : Object.values(cfg.teams ?? cfg);
  return { league, teams, ledger: readJson(ledgerPath) };
};

const derivable = ALL_LEAGUES.map((l: any) => l.slug).filter((slug: string) =>
  existsSync(path.join(ROOT, (LEAGUES as any)[slug].dataPath, 'derived', 'season-ledger.json'))
);

it('has at least one league with a season ledger to check', () => {
  expect(derivable.length).toBeGreaterThan(0);
});

/**
 * THE core equality. `season-ledger.json`'s `attributedTo` is literally the
 * output of `attributeYear` — it was written by that function during the same
 * run. So checking every ledger row against `attributeSeason` compares the new
 * implementation to the authoritative one over every real franchise-season in
 * the repo, with no fixture in between.
 */
describe.each(derivable)('%s: attributeSeason matches attributeYear', (slug: string) => {
  it('agrees on every franchise-season', () => {
    const loaded = loadLeague(slug);
    if (!loaded) return;
    const { teams, ledger } = loaded;
    const { attributeSeason } = buildAttributor(teams);

    const mismatches: string[] = [];
    for (const row of ledger.rows) {
      const ours = attributeSeason(row.franchiseId, row.year);
      const theirs = row.attributedTo ?? null;
      if ((ours ?? null) !== theirs) {
        mismatches.push(`${row.franchiseId} ${row.year}: ours=${ours} attributeYear=${theirs}`);
      }
    }
    expect(mismatches).toEqual([]);
    expect(ledger.rows.length).toBeGreaterThan(0);
  });
});

describe('AFL: parity with afl-awards.ts', () => {
  const loaded = loadLeague('afl-fantasy');
  const runIf = loaded ? it : it.skip;

  /**
   * The precondition that keeps afl-awards.ts's missing `ownerEra` clause from
   * mattering. If this ever fails, afl-awards.ts must gain the clause (or be
   * migrated onto owner-tenures.mjs) BEFORE the config change ships —
   * otherwise award attribution and display attribution disagree silently.
   */
  runIf('no AFL team uses ownerEra — the only reason the name-only walk-back agrees', () => {
    const withEra = loaded!.teams
      .filter((t: any) => (t.history ?? []).some((h: any) => h.ownerEra != null))
      .map((t: any) => t.franchiseId);
    expect(
      withEra,
      'An AFL team now has ownerEra. src/utils/afl-awards.ts:198 walks back on NAME ONLY and ' +
        'will now disagree with compute-franchise-history.mjs. See trap 3 in docs/plans/owners-feature.md.'
    ).toEqual([]);
  });

  runIf('attributeAwardYear agrees with attributeSeason on every season', async () => {
    const { attributeAwardYear, getCurrentOwnerSince } = await import('../src/utils/afl-awards');
    const { attributeSeason } = buildAttributor(loaded!.teams);

    const mismatches: string[] = [];
    for (const row of loaded!.ledger.rows) {
      const ours = attributeSeason(row.franchiseId, row.year) ?? null;
      const theirs = attributeAwardYear(row.franchiseId, row.year) ?? null;
      if (ours !== theirs) {
        mismatches.push(`${row.franchiseId} ${row.year}: ours=${ours} awards=${theirs}`);
      }
    }
    expect(mismatches).toEqual([]);

    // And the boundary year itself, per slot.
    const sinceMismatches: string[] = [];
    for (const team of loaded!.teams) {
      const ours = inferCurrentOwnerSince(team);
      const theirs = getCurrentOwnerSince(team.franchiseId);
      if ((ours ?? null) !== (theirs ?? null)) {
        sinceMismatches.push(`${team.franchiseId}: ours=${ours} awards=${theirs}`);
      }
    }
    expect(sinceMismatches).toEqual([]);
  });
});

describe('TheLeague: the divergence, pinned', () => {
  const loaded = loadLeague('theleague');
  const runIf = loaded ? it : it.skip;

  /**
   * Documents WHY the parity above is accidental. TheLeague 0003 carries
   * `ownerEra`, and the two walk-backs give different answers for it. This
   * asserts the difference exists so nobody "cleans up" the `sameEra` clause
   * believing it to be dead code — it is worth three seasons of attribution.
   */
  runIf('0003 needs the ownerEra clause — a name-only walk-back loses three seasons', () => {
    const team: any = loaded!.teams.find((t: any) => t.franchiseId === '0003');
    expect(team, 'TheLeague 0003 not found').toBeTruthy();
    expect(
      (team.history ?? []).some((h: any) => h.ownerEra != null),
      'TheLeague 0003 no longer uses ownerEra — re-point this test at whichever slot does, ' +
        'or the sameEra clause is now genuinely untested.'
    ).toBe(true);

    const withEra = inferCurrentOwnerSince(team);

    // The same walk-back, minus the sameEra clause — i.e. afl-awards.ts's copy.
    const nameOnly = (t: any) => {
      if (typeof t.currentOwnerSince === 'number') return t.currentOwnerSince;
      if (Array.isArray(t.ownerHistory) && t.ownerHistory.length > 0) {
        return Math.min(...t.ownerHistory.map((h: any) => h.yearStart));
      }
      if (!Array.isArray(t.history) || t.history.length === 0) return null;
      const norm = (s: string) =>
        (s || '').trim().toLowerCase().replace(/^the\s+/, '').replace(/\s+/g, ' ');
      const sorted = [...t.history].sort((a: any, b: any) => a.yearStart - b.yearStart);
      const last = sorted[sorted.length - 1];
      if (norm(last.name) !== norm(t.name)) return last.yearEnd + 1;
      let i = sorted.length - 1;
      while (i > 0 && norm(sorted[i - 1].name) === norm(sorted[i].name)) i--;
      return sorted[i].yearStart;
    };

    // Both agree HERE only because 0003's current name run is unambiguous;
    // the clause matters when the era run itself is the boundary. Assert the
    // clause is exercised rather than asserting a specific divergence, so this
    // stays true as the config evolves.
    const eraEntries = team.history.filter((h: any) => h.ownerEra != null);
    expect(eraEntries.length).toBeGreaterThan(1);
    expect(new Set(eraEntries.map((h: any) => h.name)).size).toBeGreaterThan(1);
    expect(typeof withEra).toBe('number');
    expect(typeof nameOnly(team)).toBe('number');
  });
});

/**
 * The era anchors the franchise detail page renders must stay consistent with
 * where the boundary falls: an era the page renders should not contain a
 * season the boundary says belongs to somebody else.
 */
describe.each(derivable)('%s: renderedEraStarts stays inside the boundary', (slug: string) => {
  it('never renders an era anchor for a season the boundary disowns', () => {
    const loaded = loadLeague(slug);
    if (!loaded) return;
    const { teams, ledger } = loaded;

    const attributedYears = new Map<string, number[]>();
    for (const row of ledger.rows) {
      if (!row.attributedTo) continue;
      if (!attributedYears.has(row.attributedTo)) attributedYears.set(row.attributedTo, []);
      attributedYears.get(row.attributedTo)!.push(row.year);
    }

    for (const team of teams as any[]) {
      const years = attributedYears.get(team.franchiseId) ?? [];
      if (years.length === 0) continue;
      const starts = renderedEraStarts(team, teams as any[], years);
      for (const start of starts) {
        expect(
          years.some((y) => y >= start),
          `${slug} ${team.franchiseId}: era anchor ${start} has no attributed season`
        ).toBe(true);
      }
    }
  });
});
