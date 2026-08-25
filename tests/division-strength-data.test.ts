/**
 * division-strength.json — the derived Strength of Division report.
 *
 * The compute script already fails its own RUN on the four structural
 * invariants (schedule replay vs standings, division partition, one winner per
 * division-season, one holding per franchise-season), so this suite does not
 * re-litigate them by re-deriving. It asserts the things a consumer would
 * silently get wrong instead:
 *
 *   1. **Owner eras never inflate a division total.** A co-owned season is
 *      credited to BOTH co-owners on purpose, so summing owner eras to get a
 *      division's record double-counts it. This pins the separation.
 *   2. **The division-vs-division matrix mirrors.** A's wins over B must equal
 *      B's losses to A, and A's points for must equal B's points against, all
 *      time and in every season. A one-sided walk is the classic way this goes
 *      wrong and it renders perfectly.
 *   3. **Interdivisional + intra-division = the whole schedule.** If they don't
 *      sum to the season, some games were classified into neither bucket and
 *      the strength metric is quietly built on a subset.
 *   4. **The "no game log" seasons stay unranked.** AFL 2003 has standings but
 *      no scores; ranking it would put a division on a metric it has no data
 *      for. This is the one that would ship as a plausible-looking number.
 *   5. **No all-time strongest/weakest verdict field** — a deliberate product
 *      decision (short-lived divisions top the raw metric), and the kind of
 *      thing a later "helpful" addition would quietly undo.
 *
 * Leagues without the derived file are skipped structurally — best-ball-1 has
 * no season ledger, so it has no division report, and that is not special-cased
 * here or in the compute script.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';
import { finishPercentile, contiguousRuns, winPct } from '../src/utils/division-strength.mjs';
import type { DivisionStrengthFile } from '../src/types/division-strength';

const ROOT = path.resolve(__dirname, '..');
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

const leagues = ALL_LEAGUES.map((league: any) => {
  const derived = path.join(ROOT, league.dataPath, 'derived');
  return {
    league,
    dataPath: path.join(derived, 'division-strength.json'),
    ledgerPath: path.join(derived, 'season-ledger.json'),
    ownersPath: path.join(derived, 'owner-tenures.json'),
  };
}).filter((l) => existsSync(l.dataPath));

it('finds the derived division-strength files', () => {
  expect(leagues.length).toBeGreaterThan(0);
});

it('produces no division file for a league with no season ledger', () => {
  for (const league of ALL_LEAGUES as any[]) {
    const derived = path.join(ROOT, league.dataPath, 'derived');
    if (existsSync(path.join(derived, 'season-ledger.json'))) continue;
    expect(
      existsSync(path.join(derived, 'division-strength.json')),
      `${league.slug} has no season ledger but has a division-strength file`
    ).toBe(false);
  }
});

describe.each(leagues)('$league.slug division strength', ({ league, dataPath, ledgerPath }) => {
  const data: DivisionStrengthFile = readJson(dataPath);
  const ledger = readJson(ledgerPath);
  const playedRows = ledger.rows.filter((r: any) => !r.seasonNotStarted);

  it('covers the same seasons as the season ledger', () => {
    expect(data.league).toBe(league.slug);
    expect(data.yearsCovered).toEqual([...ledger.yearsCovered].sort((a: number, b: number) => a - b));
  });

  // ── 1. Conservation: every played franchise-season lands in exactly one
  //       division bucket, and its record is carried through unchanged.
  it('carries every played franchise-season into exactly one division, unchanged', () => {
    const seen = new Map<string, number>();
    for (const year of data.years) {
      for (const division of year.divisions) {
        for (const team of division.teams) {
          const key = `${year.year}|${team.franchiseId}`;
          seen.set(key, (seen.get(key) ?? 0) + 1);
        }
      }
    }
    const dupes = [...seen].filter(([, n]) => n > 1);
    expect(dupes.map(([k]) => k)).toEqual([]);
    expect(seen.size).toBe(playedRows.length);

    const byKey = new Map(
      data.years.flatMap((y) =>
        y.divisions.flatMap((d) => d.teams.map((t) => [`${y.year}|${t.franchiseId}`, t] as const))
      )
    );
    for (const row of playedRows) {
      const team = byKey.get(`${row.year}|${row.franchiseId}`);
      expect(team, `${row.year} ${row.franchiseId} missing from the division report`).toBeTruthy();
      expect({ w: team!.wins, l: team!.losses, t: team!.ties }).toEqual({
        w: row.wins,
        l: row.losses,
        t: row.ties,
      });
      expect(team!.wonDivision).toBe(row.wonDivision);
    }
  });

  it('sums each season division total from its own teams', () => {
    for (const year of data.years) {
      for (const d of year.divisions) {
        const sum = d.teams.reduce(
          (acc, t) => ({
            wins: acc.wins + t.wins,
            losses: acc.losses + t.losses,
            ties: acc.ties + t.ties,
          }),
          { wins: 0, losses: 0, ties: 0 }
        );
        expect(
          { wins: d.totals.wins, losses: d.totals.losses, ties: d.totals.ties },
          `${year.year} ${d.name} totals disagree with its teams`
        ).toEqual(sum);
      }
    }
  });

  // ── 2. Owner eras must NOT be summable into a division total.
  it('credits a shared season to every co-owner without inflating the division total', () => {
    const shared = data.years.flatMap((y) =>
      y.divisions.flatMap((d) => d.teams.filter((t) => t.shared).map((t) => ({ y: y.year, d, t })))
    );

    for (const { t } of shared) {
      expect(t.owners.length, 'a shared season must name more than one owner').toBeGreaterThan(1);
    }

    for (const division of data.divisions) {
      // Owner-era seasons sum to MORE than the division's team-seasons exactly
      // when this division contains a shared season, and equal it otherwise.
      const eraSeasons = division.owners.reduce((n, o) => n + o.seasons, 0);
      const sharedHere = data.years
        .flatMap((y) => y.divisions.filter((d) => d.name === division.name))
        .flatMap((d) => d.teams)
        .reduce((n, t) => n + (t.shared ? t.owners.length - 1 : 0), 0);
      expect(
        eraSeasons,
        `${division.name}: owner-era seasons should be team-seasons plus one per extra co-owner`
      ).toBe(division.teamSeasons + sharedHere);

      // And the division's own record is NOT the sum of its owner eras whenever
      // a shared season exists — which is precisely why totals are summed from
      // franchise-seasons instead.
      const eraWins = division.owners.reduce((n, o) => n + o.totals.wins, 0);
      if (sharedHere === 0) expect(eraWins).toBe(division.totals.wins);
      else expect(eraWins).toBeGreaterThan(division.totals.wins);
    }
  });

  it('gives every owner era non-empty, in-range stints', () => {
    for (const division of data.divisions) {
      for (const era of division.owners) {
        expect(era.stints.length, `${division.name}/${era.slug} has no stints`).toBeGreaterThan(0);
        expect(era.stints).toEqual(contiguousRuns(era.years));
        expect(era.years.length).toBe(era.seasons);
        expect(era.yearStart).toBe(Math.min(...era.years));
        expect(era.yearEnd).toBe(Math.max(...era.years));
        for (const year of era.years) {
          expect(
            division.years.includes(year),
            `${division.name}/${era.slug} claims ${year}, a year the division did not exist`
          ).toBe(true);
        }
      }
    }
  });

  // ── 3. The division-vs-division matrix mirrors, all-time and per season.
  const expectMirrored = (
    divisions: Array<{ name: string; vs: Record<string, any> }>,
    label: string
  ) => {
    const byName = new Map(divisions.map((d) => [d.name, d]));
    for (const d of divisions) {
      for (const [opp, rec] of Object.entries(d.vs)) {
        expect(opp, `${label}: ${d.name} has a vs entry against itself`).not.toBe(d.name);
        const other = byName.get(opp);
        expect(other, `${label}: ${d.name} faced ${opp}, which is not in the same set`).toBeTruthy();
        const mirror = other!.vs[d.name];
        expect(mirror, `${label}: ${opp} has no return record vs ${d.name}`).toBeTruthy();
        expect(
          { w: rec.wins, l: rec.losses, t: rec.ties },
          `${label}: ${d.name} vs ${opp} does not mirror`
        ).toEqual({ w: mirror.losses, l: mirror.wins, t: mirror.ties });
        expect(rec.pointsFor).toBeCloseTo(mirror.pointsAgainst, 1);
        expect(rec.games).toBe(mirror.games);
      }
    }
  };

  it('mirrors the all-time division-vs-division matrix', () => {
    expectMirrored(data.divisions, 'all-time');
  });

  it('mirrors every season division-vs-division matrix', () => {
    for (const year of data.years) {
      if (!year.gamesResolved) {
        for (const d of year.divisions) expect(Object.keys(d.vs)).toEqual([]);
        continue;
      }
      expectMirrored(year.divisions, `${year.year}`);
    }
  });

  it('sums each division vs-matrix row to its interdivisional record', () => {
    const check = (d: any, label: string) => {
      const sum = Object.values(d.vs).reduce(
        (acc: any, r: any) => ({
          wins: acc.wins + r.wins,
          losses: acc.losses + r.losses,
          ties: acc.ties + r.ties,
        }),
        { wins: 0, losses: 0, ties: 0 }
      );
      expect({ ...sum }, `${label}: vs rows do not sum to interDivision`).toEqual({
        wins: d.interDivision.wins,
        losses: d.interDivision.losses,
        ties: d.interDivision.ties,
      });
    };
    for (const d of data.divisions) check(d, `all-time ${d.name}`);
    for (const year of data.years) {
      if (!year.gamesResolved) continue;
      for (const d of year.divisions) check(d, `${year.year} ${d.name}`);
    }
  });

  // ── 4. Inter + intra must account for the whole schedule.
  it('splits every played game into exactly one of inter- or intra-division', () => {
    for (const year of data.years) {
      if (!year.gamesResolved) continue;
      for (const d of year.divisions) {
        const inter = d.interDivision!;
        const intra = d.intraDivision!;
        expect(
          { w: inter.wins + intra.wins, l: inter.losses + intra.losses, t: inter.ties + intra.ties },
          `${year.year} ${d.name}: inter+intra does not equal the division's record`
        ).toEqual({ w: d.totals.wins, l: d.totals.losses, t: d.totals.ties });

        // Intra-division play is zero-sum by construction — this is the whole
        // reason the strength metric excludes it. If it ever isn't .500, games
        // are being counted from only one side.
        expect(
          intra.wins,
          `${year.year} ${d.name}: intra-division play is not zero-sum`
        ).toBe(intra.losses);
      }
    }
  });

  it('sums each all-time division record from its seasons', () => {
    for (const division of data.divisions) {
      const seasons = data.years.flatMap((y) => y.divisions.filter((d) => d.name === division.name));
      const sum = seasons.reduce(
        (acc, d) => ({
          wins: acc.wins + d.totals.wins,
          losses: acc.losses + d.totals.losses,
          ties: acc.ties + d.totals.ties,
        }),
        { wins: 0, losses: 0, ties: 0 }
      );
      expect({ ...sum }, `${division.name} all-time total disagrees with its seasons`).toEqual({
        wins: division.totals.wins,
        losses: division.totals.losses,
        ties: division.totals.ties,
      });
      // `years` must be the actual seasons this division appeared in — not a
      // count that happens to match.
      const appearedIn = data.years
        .filter((y) => y.divisions.some((d) => d.name === division.name))
        .map((y) => y.year);
      expect(division.years).toEqual(appearedIn);
      expect(division.seasons).toBe(appearedIn.length);
      expect(division.firstYear).toBe(appearedIn[0]);
      expect(division.lastYear).toBe(appearedIn[appearedIn.length - 1]);
      expect(division.eras).toEqual(contiguousRuns(appearedIn));
      expect(division.totals.winPct).toBeCloseTo(winPct(division.totals) as number, 3);
    }
  });

  // ── 5. Seasons with no game log stay out of every game-derived number.
  it('leaves a season with no game log unranked rather than ranking it at zero', () => {
    const unresolved = data.years.filter((y) => !y.gamesResolved);
    expect(data.yearsWithoutGameLog).toEqual(unresolved.map((y) => y.year));

    for (const year of unresolved) {
      expect(year.strongest, `${year.year} named a strongest division with no game log`).toBeNull();
      expect(year.weakest).toBeNull();
      for (const d of year.divisions) {
        expect(d.rank, `${year.year} ${d.name} was ranked with no game log`).toBeNull();
        expect(d.interDivision).toBeNull();
        expect(d.intraDivision).toBeNull();
        for (const t of d.teams) {
          expect(t.pointsAgainst).toBeNull();
          expect(t.interDivision).toBeNull();
        }
        // Standings-derived records survive — that is the point of the flag.
        expect(d.totals.wins + d.totals.losses + d.totals.ties).toBeGreaterThan(0);
      }
    }

    // No unplayed season leaks in as a row of zeroes.
    for (const year of data.years) {
      for (const d of year.divisions) {
        expect(d.teams.length, `${year.year} ${d.name} is empty`).toBeGreaterThan(0);
      }
    }
  });

  it('ranks every season that does have a game log, with no gaps', () => {
    for (const year of data.years.filter((y) => y.gamesResolved)) {
      const ranks = year.divisions.map((d) => d.rank).sort((a, b) => a! - b!);
      expect(ranks[0], `${year.year} has no first-place division`).toBe(1);
      expect(ranks.length).toBe(year.divisionCount);
      const strongest = year.divisions.find((d) => d.rank === 1)!;
      expect(year.strongest).toBe(strongest.name);
      expect(year.weakest).toBe(
        year.divisions.reduce((w, d) => (d.rank! > w.rank! ? d : w), year.divisions[0]).name
      );
    }
  });

  it('normalizes each ranked year so eras with different division counts compare', () => {
    for (const division of data.divisions) {
      for (const ry of division.rankedYears) {
        expect(ry.of).toBe(data.years.find((y) => y.year === ry.year)!.divisionCount);
        expect(ry.pct).toBeCloseTo(finishPercentile(ry.rank, ry.of), 3);
      }
      if (division.rankedYears.length === 0) {
        expect(division.avgFinishPct).toBeNull();
        continue;
      }
      const mean =
        division.rankedYears.reduce((s, r) => s + r.pct, 0) / division.rankedYears.length;
      expect(division.avgFinishPct).toBeCloseTo(mean, 3);
    }
  });

  // ── 6. The deliberate absence of a verdict.
  it('makes no all-time strongest/weakest claim', () => {
    // Short-lived divisions top the raw metric (the AFL's Atlantic ran one
    // season at .556), and era-normalized average finish disagrees with raw
    // win% — so the file presents both and picks neither. If a headline field
    // is ever wanted, that product decision has to be re-made, not slipped in.
    expect(Object.keys(data.summary).sort()).toEqual([
      'activeDivisions',
      'currentAlignment',
      'divisionCount',
      'latestAlignmentYear',
      'retiredDivisions',
    ]);
    expect(data).not.toHaveProperty('strongest');
    expect(data).not.toHaveProperty('weakest');
  });

  it('marks a division active only when it exists in the latest played season', () => {
    expect(data.latestPlayedYear).toBe(
      Math.max(...data.years.filter((y) => y.divisions.length).map((y) => y.year))
    );
    const latest = data.years.find((y) => y.year === data.latestPlayedYear)!;
    const live = new Set(latest.divisions.map((d) => d.name));
    for (const division of data.divisions) {
      expect(division.active, `${division.name} active flag is wrong`).toBe(live.has(division.name));
    }
    expect(data.summary.activeDivisions.sort()).toEqual([...live].sort());
    expect(data.summary.divisionCount).toBe(data.divisions.length);
  });

  it('keys divisions by name, never merging two divisions that shared an MFL slot', () => {
    const names = data.divisions.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
    // A slot id may be reused by a different division after a realignment —
    // the AFL's "03" was the East through 2012 and the West ever since. That is
    // exactly why divisionIds is informational and the NAME is the key.
    for (const division of data.divisions) {
      expect(division.divisionIds.length).toBeGreaterThan(0);
      expect(division.slug).toMatch(/^[a-z0-9-]+$/);
    }
  });
});
