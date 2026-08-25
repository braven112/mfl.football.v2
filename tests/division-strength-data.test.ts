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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';
import {
  finishPercentile,
  contiguousRuns,
  winPct,
  pointsPerGame,
} from '../src/utils/division-strength.mjs';
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

it('separates "scored nothing" from "no game log" in pointsPerGame', () => {
  // The guard was `!rec.pointsFor`, so a division that played and scored 0
  // reported null — the same value that means "this season has no game log".
  // Keeping those two apart is most of what the null handling in this file is
  // FOR, so a helper that merges them is worse than no helper.
  // recordGames sums W/L/T — a `games` field is not what it reads.
  const rec = (wins: number, losses: number, pointsFor: number | null) => ({
    wins,
    losses,
    ties: 0,
    pointsFor,
  });
  expect(pointsPerGame(rec(2, 2, 0))).toBe(0);
  expect(pointsPerGame(rec(2, 2, 400))).toBe(100);
  expect(pointsPerGame(rec(0, 0, 0))).toBeNull();
  expect(pointsPerGame(rec(2, 2, null))).toBeNull();
});

it('builds a season that is under way, not just one that is finished', async () => {
  // THE TIME BOMB THIS EXISTS FOR. Invariant 3 asserted "exactly one division
  // winner" unconditionally, but compute-franchise-history.mjs only populates
  // `divisionTitleHolders` when `seasonHasGames && seasonComplete`. So from
  // Week 1 of a season to its final whistle EVERY division legitimately has
  // zero winners, the invariant failed for all of them, and buildLeague threw.
  //
  // It passed all preseason only because rows with 0-0-0 and 0 points are
  // filtered out as `seasonNotStarted` before they can reach a division bucket
  // — the bug was invisible until the first real result landed. And prebuild
  // treats a parallel step's failure as non-fatal, so the derived file would
  // simply have stopped refreshing, in silence, for the whole regular season.
  //
  // Simulates that state on real data: strip 2025's division titles (as an
  // in-progress season has none) and require the build to succeed anyway.
  const { buildLeague } = await import('../scripts/compute-division-strength.mjs');
  const target = leagues[0];
  const original = readFileSync(target.ledgerPath, 'utf8');
  try {
    const ledger = JSON.parse(original);
    const midYear = Math.max(...ledger.rows.map((r: any) => (r.seasonNotStarted ? 0 : r.year)));
    let stripped = 0;
    for (const row of ledger.rows) {
      if (row.year !== midYear) continue;
      row.wonDivision = false;
      row.playoffResult = 'missed';
      stripped += 1;
    }
    expect(stripped, 'no rows to simulate an in-progress season with').toBeGreaterThan(0);
    writeFileSync(target.ledgerPath, JSON.stringify(ledger, null, 2));

    const built = buildLeague(target.league.slug);
    if (!built) throw new Error(`${midYear} in progress: buildLeague returned nothing`);
    const year = built.years.find((y: any) => y.year === midYear);
    if (!year) throw new Error(`${midYear} dropped from the build`);
    expect(year.divisions.length).toBeGreaterThan(0);
    // No winner is known yet, so none may be claimed.
    for (const division of year.divisions) expect(division.divisionWinner).toBeNull();

    // But a PARTIAL set is still corruption, and must still fail.
    ledger.rows.find((r: any) => r.year === midYear && r.divisionName).wonDivision = true;
    writeFileSync(target.ledgerPath, JSON.stringify(ledger, null, 2));
    expect(() => buildLeague(target.league.slug)).toThrow(/division winners recorded/);
  } finally {
    writeFileSync(target.ledgerPath, original);
  }
  expect(readFileSync(target.ledgerPath, 'utf8'), 'ledger not restored').toBe(original);
});

it('never renders an owner ref by its raw concatenated title', () => {
  // `title` joins every team name an owner has worn — "Vit's Brother /
  // Avenging Amish / Broke Back 'lil Half Dead's Brother" — so it is a lookup
  // key, not a label. The page labels by team via teamLabel/teamLabelLong;
  // `.title` may appear ONLY as the last-resort tail of those two chains.
  //
  // Caught a real one: the "Built by N owners · …" summary was a seventh label
  // site added after the other six were converted, and it put the joined
  // string back on the AFL's North panel.
  const page = readFileSync(
    path.join(ROOT, 'src/components/shared/division-strength/DivisionStrengthPage.astro'),
    'utf8'
  );
  const offenders = page
    .split('\n')
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => /\bo\.title\b|\.map\(\(o\) => o\.title\)/.test(line))
    .filter(({ line }) => !/\?\? o\.title \?\? o\.slug/.test(line));
  expect(
    offenders.map((o) => `${o.n}: ${o.line}`),
    'label an owner with teamLabel() / teamLabelLong(), never o.title'
  ).toEqual([]);
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
      type WLT = { wins: number; losses: number; ties: number };
      const sum = (Object.values(d.vs) as WLT[]).reduce<WLT>(
        (acc, r) => ({
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

  // ── 7. Membership eras: the "same teams" slice.
  //
  // A division name outlives the teams that earned its record, so the era is
  // the only slice where two divisions are compared as the same group across
  // their whole shared span. These pin that the segmentation is honest.
  it('partitions every division season into exactly one membership era', () => {
    for (const division of data.divisions) {
      const eraYears = division.membershipEras.flatMap((era) => {
        const out: number[] = [];
        for (let y = era.yearStart; y <= era.yearEnd; y++) out.push(y);
        return out;
      });
      expect(
        [...eraYears].sort((a, b) => a - b),
        `${division.name}: membership eras do not cover its seasons exactly once`
      ).toEqual(division.years);
      expect(eraYears.length).toBe(new Set(eraYears).size);
    }
  });

  it('breaks an era only on a real membership change or a gap year', () => {
    for (const division of data.divisions) {
      const eras = division.membershipEras;
      for (let i = 1; i < eras.length; i++) {
        const prev = eras[i - 1];
        const cur = eras[i];
        expect(cur.yearStart).toBeGreaterThan(prev.yearEnd);
        const contiguous = cur.yearStart === prev.yearEnd + 1;
        if (contiguous) {
          // Adjacent in time means the membership MUST differ, or the two
          // should have been one era.
          expect(
            cur.franchiseIds.join(','),
            `${division.name}: eras ending ${prev.yearEnd} and starting ${cur.yearStart} have identical membership`
          ).not.toBe(prev.franchiseIds.join(','));
        }
      }
    }
  });

  it('matches the membership of each era to the seasons inside it', () => {
    for (const division of data.divisions) {
      for (const era of division.membershipEras) {
        expect(era.seasons).toBe(era.yearEnd - era.yearStart + 1);
        expect(era.members.length).toBe(era.franchiseIds.length);
        expect([...era.members.map((m) => m.franchiseId)].sort()).toEqual(era.franchiseIds);
        // Every season in the era must have exactly this set of franchises.
        for (let y = era.yearStart; y <= era.yearEnd; y++) {
          const seasonDivision = data.years
            .find((yr) => yr.year === y)!
            .divisions.find((d) => d.name === division.name)!;
          expect(
            seasonDivision.teams.map((t) => t.franchiseId).sort(),
            `${division.name} ${y}: season membership differs from its era's`
          ).toEqual(era.franchiseIds);
        }
      }
    }
  });

  it('sums each era record from its own seasons', () => {
    for (const division of data.divisions) {
      for (const era of division.membershipEras) {
        const seasons = data.years
          .filter((y) => y.year >= era.yearStart && y.year <= era.yearEnd)
          .flatMap((y) => y.divisions.filter((d) => d.name === division.name));
        const sum = seasons.reduce(
          (acc, d) => ({
            wins: acc.wins + d.totals.wins,
            losses: acc.losses + d.totals.losses,
            ties: acc.ties + d.totals.ties,
          }),
          { wins: 0, losses: 0, ties: 0 }
        );
        expect({ ...sum }, `${division.name} ${era.yearStart}-${era.yearEnd} totals`).toEqual({
          wins: era.totals.wins,
          losses: era.totals.losses,
          ties: era.totals.ties,
        });
        expect(era.divisionTitles).toBe(seasons.filter((d) => d.divisionWinner).length);
      }
    }
    // And the eras together reconstruct the division's all-time record.
    for (const division of data.divisions) {
      const sum = division.membershipEras.reduce(
        (acc, e) => ({
          wins: acc.wins + e.totals.wins,
          losses: acc.losses + e.totals.losses,
          ties: acc.ties + e.totals.ties,
        }),
        { wins: 0, losses: 0, ties: 0 }
      );
      expect({ ...sum }, `${division.name}: eras do not reconstruct the all-time record`).toEqual({
        wins: division.totals.wins,
        losses: division.totals.losses,
        ties: division.totals.ties,
      });
    }
  });

  it('flags exactly the era still running as current, and none for a retired division', () => {
    for (const division of data.divisions) {
      const flagged = division.membershipEras.filter((e) => e.current);
      if (division.active) {
        expect(flagged.length, `${division.name} is active but has ${flagged.length} current eras`).toBe(1);
        expect(flagged[0].yearEnd).toBe(data.latestPlayedYear);
        expect(division.currentEra).toEqual(flagged[0]);
        // It must be the LAST era — a current era in the middle would mean the
        // division somehow resumed after its live lineup.
        expect(division.membershipEras[division.membershipEras.length - 1]).toEqual(flagged[0]);
      } else {
        expect(flagged.length, `${division.name} is retired but claims a current era`).toBe(0);
        expect(division.currentEra).toBeNull();
      }
    }
  });

  // ── 8. The upcoming alignment.
  //
  // Records come from played seasons; membership must not. Keying "as
  // currently constituted" off the last PLAYED season rendered last season's
  // lineup — and last season's owner — under a heading promising today's.
  // TheLeague's 0004 changed hands for 2026 and the table showed the outgoing
  // owner, which is the bug these pin.
  it('reads the upcoming alignment from the newest season on file, played or not', () => {
    const newest = data.yearsCovered[data.yearsCovered.length - 1];
    if (newest === data.latestPlayedYear) {
      expect(data.upcoming, 'newest season is already played — nothing is pending').toBeNull();
      return;
    }
    expect(data.upcoming, `${newest} is unplayed but no upcoming alignment was emitted`).toBeTruthy();
    const up = data.upcoming!;
    expect(up.year).toBe(newest);
    expect(up.previousPlayedYear).toBe(data.latestPlayedYear);

    // It must describe the alignment the LEDGER holds for that year, including
    // franchise-seasons that have not been played.
    const ledgerByDivision = new Map<string, string[]>();
    for (const row of ledger.rows.filter((r: any) => r.year === newest && r.divisionName)) {
      const list = ledgerByDivision.get(row.divisionName) ?? [];
      list.push(row.franchiseId);
      ledgerByDivision.set(row.divisionName, list);
    }
    expect(up.divisions.map((d) => d.name).sort()).toEqual([...ledgerByDivision.keys()].sort());
    for (const division of up.divisions) {
      expect(division.members.map((m) => m.franchiseId).sort()).toEqual(
        ledgerByDivision.get(division.name)!.sort()
      );
      for (const member of division.members) {
        expect(member.owners.length, `${member.franchiseId} has no holder in ${newest}`).toBeGreaterThan(0);
      }
    }
  });

  it('states the current alignment it claims to have, played or not', () => {
    // The field is documented as "the latest season on file, PLAYED OR NOT",
    // but it was read off the year payload, whose divisions are built from
    // played rows only. That shipped `currentAlignment: []` next to
    // `latestAlignmentYear: 2026` — a derived field asserting the opposite of
    // its own contract, and nothing in src/ read it, so nothing complained.
    const { currentAlignment, latestAlignmentYear } = data.summary;
    if (latestAlignmentYear === null) {
      expect(currentAlignment).toEqual([]);
      return;
    }
    expect(currentAlignment.length, `${latestAlignmentYear} alignment is empty`).toBeGreaterThan(0);
    const expected = data.upcoming
      ? data.upcoming.divisions.map((d) => d.name)
      : (data.years.find((y) => y.year === latestAlignmentYear)?.divisions ?? []).map((d) => d.name);
    expect([...currentAlignment].sort()).toEqual([...expected].sort());
  });

  it('accounts for every division on both sides of a realignment', () => {
    // A dissolved division has no row in the new alignment, so keying the
    // upcoming build off the new rows alone dropped it: its departures went
    // unlisted and anyChange could read false while a whole division vanished.
    const up = data.upcoming;
    if (!up || up.previousPlayedYear === null) return;
    const prevNames = new Set(
      (data.years.find((y) => y.year === up.previousPlayedYear)?.divisions ?? []).map((d) => d.name)
    );
    const covered = new Set(up.divisions.map((d) => d.name));
    for (const name of prevNames) {
      expect(covered.has(name), `${name} existed in ${up.previousPlayedYear} but is absent from the ${up.year} alignment report`).toBe(true);
    }
    for (const division of up.divisions) {
      expect(division.dissolved).toBe(division.members.length === 0);
      if (division.dissolved) {
        expect(division.departures.length, `${division.name} is dissolved but lists no departures`).toBeGreaterThan(0);
        expect(division.unchanged).toBe(false);
      }
      // A division with no history has no all-time panel, so the page must not
      // link it — `isNewDivision` is what tells it that.
      expect(division.isNewDivision).toBe(!data.divisions.some((d) => d.name === division.name));
    }
  });

  it('flags an incoming owner only where the holding actually changed', () => {
    const up = data.upcoming;
    if (!up || up.previousPlayedYear === null) return;
    const owners = readJson(path.join(path.dirname(dataPath), 'owner-tenures.json'));
    const holdersOf = (year: number, fid: string) => {
      const out: string[] = [];
      for (const owner of owners.owners) {
        for (const tenure of owner.tenures) {
          if (tenure.franchiseId !== fid) continue;
          if (tenure.seasons.some((s: any) => s.year === year)) out.push(owner.ownerId);
        }
      }
      return out.sort();
    };

    for (const division of up.divisions) {
      for (const member of division.members) {
        const now = holdersOf(up.year, member.franchiseId);
        const before = holdersOf(up.previousPlayedYear!, member.franchiseId);
        const changed = before.length > 0 && now.some((id) => !before.includes(id));
        expect(
          member.newOwner,
          `${division.name}/${member.franchiseId}: newOwner=${member.newOwner} but holders went ${before.join(',')} -> ${now.join(',')}`
        ).toBe(changed);
        if (member.newOwner) {
          expect(member.newOwners.length).toBeGreaterThan(0);
          // A pure RENAME keeps the ownerId and must never be reported as an
          // ownership change — the name already tells that story.
          for (const incoming of member.newOwners) {
            expect(before).not.toContain(incoming.ownerId);
          }
        } else {
          expect(member.newOwners).toEqual([]);
        }
      }
      expect(division.newOwners.map((m) => m.franchiseId)).toEqual(
        division.members.filter((m) => m.newOwner).map((m) => m.franchiseId)
      );
      expect(division.unchanged).toBe(
        division.arrivals.length === 0 && division.departures.length === 0 && division.newOwners.length === 0
      );
    }
    expect(up.anyChange).toBe(up.divisions.some((d) => !d.unchanged));
    expect(up.totalNewOwners).toBe(up.divisions.reduce((n, d) => n + d.newOwners.length, 0));
  });

  it('never lets the upcoming season contribute to any record', () => {
    const up = data.upcoming;
    if (!up) return;
    // The unplayed season must be absent from every played-season aggregate.
    expect(data.yearsWithGameLog).not.toContain(up.year);
    for (const division of data.divisions) {
      expect(division.years, `${division.name} counts the unplayed ${up.year}`).not.toContain(up.year);
      for (const era of division.membershipEras) {
        expect(era.yearEnd).toBeLessThan(up.year);
      }
      for (const ry of division.rankedYears) expect(ry.year).not.toBe(up.year);
    }
  });

  it('never lists one team twice in a division, unless it is co-owned', () => {
    // The league has never had two different owners run teams under the same
    // name, so two era rows reading the same thing is a data bug, not history.
    // It shipped exactly once: the AFL South listed "Avenging Amish" twice,
    // 2014-2020 and 2021-2025, because the owner inference had split Danny
    // Baccam in half — a franchise slot changing hands and a rename in place
    // look identical to it. Fixed upstream in the owners registry (#615).
    //
    // The ONE legitimate collision is a co-owned team: TheLeague's Cowboy Up
    // is two owner records on a single holding, so both legitimately carry the
    // same team name. That is separated structurally rather than by an
    // allowlist — a co-owner's seasons are all `sharedSeasons`, a split
    // owner's are none — so a newly shared team needs no change here.
    const norm = (s: string | null) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const division of data.divisions) {
      const byLabel = new Map<string, typeof division.owners>();
      for (const owner of division.owners) {
        const key = norm(owner.latestNameMedium ?? owner.latestName ?? owner.title);
        if (!key) continue;
        if (!byLabel.has(key)) byLabel.set(key, []);
        byLabel.get(key)!.push(owner);
      }
      for (const [key, list] of byLabel) {
        if (list.length === 1) continue;
        const coOwned = list.every((o) => o.sharedSeasons > 0 && o.sharedSeasons === o.seasons);
        expect(
          coOwned,
          `${division.name}: "${key}" is listed by ${list.length} owner records ` +
            `(${list.map((o) => `${o.ownerId} ${o.yearStart}-${o.yearEnd}`).join(', ')}) ` +
            `— either one owner was split in two upstream, or this is a shared ` +
            `holding whose seasons are not all marked sharedSeasons`
        ).toBe(true);
      }
    }
  });

  it('labels every owner ref by the latest team name in that owner tenure', () => {
    // The report groups by OWNER but labels by TEAM, because `title`
    // concatenates every name an owner has worn ("Vit's Brother / Avenging
    // Amish / Broke Back 'lil Half Dead's Brother") and is not a name at all.
    // Every ref must carry the resolved label, or the page's `?? o.title`
    // fallback quietly puts that 68-character string back on screen.
    //
    // "Latest" is latest within THIS OWNER's tenure, never the franchise's:
    // AFL franchise 0004 has had nine different owners, so a franchise-wide
    // current name would stamp a stranger's team onto someone else's stint.
    const owners = readJson(path.join(path.dirname(dataPath), 'owner-tenures.json'));
    const expected = new Map<string, { name: string; icon: string | null }>();
    for (const owner of owners.owners) {
      let best: any = null;
      for (const identity of owner.identities ?? []) {
        if (!best || identity.yearEnd > best.yearEnd) best = identity;
      }
      if (best?.name) expected.set(owner.ownerId, { name: best.name, icon: best.icon ?? null });
    }

    const refs: Array<{ where: string; ref: any }> = [];
    for (const year of data.years) {
      for (const division of year.divisions) {
        for (const team of division.teams) {
          for (const ref of team.owners) refs.push({ where: `${year.year} ${division.name} ${team.franchiseId}`, ref });
        }
      }
    }
    for (const division of data.divisions) {
      for (const era of division.owners) refs.push({ where: `${division.name} era`, ref: era });
    }
    const up = data.upcoming;
    if (up) {
      for (const division of up.divisions) {
        for (const member of division.members) {
          for (const ref of member.owners) refs.push({ where: `upcoming ${division.name} owners`, ref });
          for (const ref of member.newOwners) refs.push({ where: `upcoming ${division.name} newOwners`, ref });
          for (const ref of member.previousOwners) refs.push({ where: `upcoming ${division.name} previousOwners`, ref });
        }
      }
    }

    expect(refs.length).toBeGreaterThan(0);
    for (const { where, ref } of refs) {
      expect(ref.latestName, `${where}: ${ref.ownerId} carries no latestName`).toBeTruthy();
      const want = expected.get(ref.ownerId);
      if (want) {
        expect(
          ref.latestName,
          `${where}: ${ref.ownerId} labelled "${ref.latestName}", newest identity is "${want.name}"`
        ).toBe(want.name);
        // The crest has to come from the SAME identity as the label. The
        // generator briefly took the label from the latest identity and the icon
        // from `owner.icon` (the DOMINANT one), which is identical for a
        // single-name owner and wrong for everyone else: seven AFL owners
        // rendered "Angry Irish" over a Carolina Blues crest and the like.
        // A ref with no icon is a different, older shape (previousOwners carry
        // none) and is not what this pins.
        if (ref.icon) {
          expect(
            ref.icon,
            `${where}: ${ref.ownerId} labelled "${ref.latestName}" but wearing another identity's crest`
          ).toBe(want.icon);
        }
      }
      // The concatenated title is the thing this rule exists to keep out.
      expect(ref.latestName, `${where}: ${ref.ownerId} label is a joined title`).not.toContain(' / ');
    }
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

/**
 * The era board — `rankEras` / `divisionAlumni` / `formatEraYears`.
 *
 * These shape the derived `membershipEras[]` for the page's cross-division
 * lineup ranking. What they can get wrong is not arithmetic (the eras' own
 * records are pinned above) but IDENTITY:
 *
 *   1. **A qualifying era must be a real run.** The `ERA_MIN_SEASONS` floor is
 *      the whole premise of the board — comparing groups with shared history —
 *      and a floor that leaks admits the one-season lineups it exists to keep
 *      out.
 *   2. **A division may appear more than once and must not appear twice for
 *      the same years.** Two long lineups under one name are two rows; the same
 *      lineup rendered twice is a bug that reads as a realignment that never
 *      happened.
 *   3. **Alumni resolve to the LAST identity worn in that division.** Walking
 *      the eras oldest-first would stamp a franchise's 2007 name onto its 2025
 *      crest, which is how a departed owner ends up labelled as a current one.
 */
import {
  ERA_MIN_SEASONS,
  divisionAlumni,
  formatEraYears,
  rankEras,
} from '../src/utils/division-strength-view';

it('renders an era span as a closed range, and an open one as present', () => {
  expect(formatEraYears({ yearStart: 2012, yearEnd: 2016, current: false })).toBe('2012–2016');
  expect(formatEraYears({ yearStart: 2016, yearEnd: 2025, current: true })).toBe('2016–present');
  expect(formatEraYears({ yearStart: 2009, yearEnd: 2009, current: false })).toBe('2009');
  // A single-season era that is STILL RUNNING is a first year, not a closed
  // one — "2026" would read as a lineup that has already finished.
  expect(formatEraYears({ yearStart: 2026, yearEnd: 2026, current: true })).toBe('2026–present');
});

describe.each(leagues)('$league.slug era board', ({ dataPath }) => {
  const data = readJson(dataPath) as DivisionStrengthFile;

  it('admits only lineups that held together long enough to compare', () => {
    for (const row of rankEras(data.divisions)) {
      expect(row.era.seasons, row.label).toBeGreaterThanOrEqual(ERA_MIN_SEASONS);
      expect(row.era.totals.games, row.label).toBeGreaterThan(0);
      // The span must agree with the season count it claims — an era is
      // contiguous by construction, so anything else means the two were
      // computed from different things.
      expect(row.era.yearEnd - row.era.yearStart + 1, row.label).toBe(row.era.seasons);
    }
  });

  it('honors the floor it is given rather than a hardcoded one', () => {
    const everything = rankEras(data.divisions, 1).length;
    const strict = rankEras(data.divisions, 99).length;
    expect(everything).toBeGreaterThanOrEqual(rankEras(data.divisions).length);
    expect(strict).toBe(0);
  });

  it('lists a division once per qualifying lineup, never twice for one span', () => {
    const rows = rankEras(data.divisions);
    const keys = rows.map((r) => `${r.divisionSlug}:${r.era.yearStart}`);
    expect(new Set(keys).size).toBe(keys.length);
    // Two rows for one division must describe DIFFERENT, non-overlapping runs.
    for (const division of data.divisions) {
      const mine = rows
        .filter((r) => r.divisionSlug === division.slug)
        .sort((a, b) => a.era.yearStart - b.era.yearStart);
      for (const row of mine) expect(row.divisionEraCount).toBe(mine.length);
      for (let i = 1; i < mine.length; i += 1) {
        expect(mine[i].era.yearStart, division.name).toBeGreaterThan(mine[i - 1].era.yearEnd);
      }
    }
  });

  it('ranks by overall win percentage, longer run first on a tie', () => {
    const rows = rankEras(data.divisions);
    for (let i = 1; i < rows.length; i += 1) {
      const prev = rows[i - 1].era;
      const cur = rows[i].era;
      expect((prev.totals.winPct ?? 0), `${rows[i - 1].label} vs ${rows[i].label}`)
        .toBeGreaterThanOrEqual(cur.totals.winPct ?? 0);
      if ((prev.totals.winPct ?? 0) === (cur.totals.winPct ?? 0)) {
        expect(prev.seasons).toBeGreaterThanOrEqual(cur.seasons);
      }
    }
  });

  // The page sorts this board on OVERALL win% to match the all-time ranking
  // directly above it, which is only defensible while the two metrics agree.
  // They do in both leagues today because an era's intra-division games are
  // exactly zero-sum. If this ever fails, the board is sorting on the
  // flattering number and should move to interdivisional.
  it('orders the board identically on the interdivisional rate', () => {
    const rows = rankEras(data.divisions);
    const byInter = [...rows].sort(
      (a, b) =>
        (b.era.interDivision.winPct ?? 0) - (a.era.interDivision.winPct ?? 0) ||
        b.era.seasons - a.era.seasons ||
        b.era.yearStart - a.era.yearStart ||
        a.divisionName.localeCompare(b.divisionName)
    );
    expect(byInter.map((r) => r.label)).toEqual(rows.map((r) => r.label));
  });

  it('labels every row with the division and the years the group was together', () => {
    for (const row of rankEras(data.divisions)) {
      expect(row.label).toBe(`${row.divisionName} (${row.years})`);
      expect(row.years).toContain(String(row.era.yearStart));
      expect(row.years).toBe(row.era.current ? `${row.era.yearStart}–present` : `${row.era.yearStart}–${row.era.yearEnd}`);
    }
  });

  it('lists every franchise that has ever been in a division, exactly once', () => {
    for (const division of data.divisions) {
      const alumni = divisionAlumni(division);
      const ids = alumni.map((a) => a.franchiseId);
      expect(new Set(ids).size, division.name).toBe(ids.length);
      const everySeen = new Set(division.membershipEras.flatMap((e) => e.franchiseIds));
      expect(new Set(ids), division.name).toEqual(everySeen);
    }
  });

  it('flags as current exactly the franchises in the lineup still running', () => {
    for (const division of data.divisions) {
      const current = divisionAlumni(division)
        .filter((a) => a.current)
        .map((a) => a.franchiseId)
        .sort();
      expect(current, division.name).toEqual([...(division.currentEra?.franchiseIds ?? [])].sort());
      // A retired division has no current lineup, so nothing in it is current.
      if (!division.active) expect(current, division.name).toEqual([]);
    }
  });

  it('resolves each franchise to the last identity it wore in that division', () => {
    for (const division of data.divisions) {
      for (const alumnus of divisionAlumni(division)) {
        // The newest era containing this franchise is the one its crest and
        // name must come from.
        const newest = [...division.membershipEras]
          .reverse()
          .find((era) => era.franchiseIds.includes(alumnus.franchiseId))!;
        const want = newest.members.find((m) => m.franchiseId === alumnus.franchiseId)!;
        expect(alumnus.name, `${division.name} ${alumnus.franchiseId}`).toBe(want.name);
        expect(alumnus.icon, `${division.name} ${alumnus.franchiseId}`).toBe(want.icon);
      }
    }
  });

  it('orders alumni current lineup first, most recent departure next', () => {
    for (const division of data.divisions) {
      const alumni = divisionAlumni(division);
      // Each franchise's last year in the division, descending — the order the
      // crests are meant to read in.
      const lastYear = (id: string) =>
        Math.max(...division.membershipEras.filter((e) => e.franchiseIds.includes(id)).map((e) => e.yearEnd));
      for (let i = 1; i < alumni.length; i += 1) {
        expect(
          lastYear(alumni[i - 1].franchiseId),
          `${division.name}: ${alumni[i - 1].franchiseId} before ${alumni[i].franchiseId}`
        ).toBeGreaterThanOrEqual(lastYear(alumni[i].franchiseId));
      }
    }
  });
});
