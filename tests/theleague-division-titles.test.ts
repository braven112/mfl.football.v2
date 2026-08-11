/**
 * TheLeague historical division titles — MFL's official standings order is the
 * source of truth (commissioner ruling, 2026-08-11; applies the AFL ruling from
 * PR #499 / f52b667 to TheLeague).
 *
 * MFL's leagueStandings export rows arrive in the league's OFFICIAL final
 * order: overall W-L-T% first, ties broken by the constitution's chain, which
 * MFL applies itself. TheLeague's chain (src/data/league-constitution.ts,
 * "STANDINGS TIEBREAKERS") is:
 *
 *   1) Head-to-head  2) Division Record  3) All Play Record  4) Total points
 *   5) Power Rank    6) Victory Points   7) Most Points Allowed  8) Coin Flip
 *
 * The FIRST ROW of each division IS that division's winner.
 *
 * History: compute-franchise-history.mjs sorted each division by
 * `divisionWins → wins → pointsFor`, making raw division record the PRIMARY
 * key when the rulebook makes it tiebreaker #2. That miscredited 10 division
 * titles between 2007 and 2025 — every one handing the title to a team with a
 * WORSE overall record. These tests exist so no local re-sort creeps back in.
 *
 * Unlike the AFL, TheLeague's MFL skin export (option07.json) is the ROSTERS
 * page, so there is no skin corroboration. The proof is the 2015 Central case
 * pinned below, which only head-to-head explains.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { getLeagueBySlug } from '../src/config/leagues-data.mjs';
import franchiseHistory from '../data/theleague/derived/franchise-history.json';

const THELEAGUE = getLeagueBySlug('theleague');
const ROOT = path.resolve(__dirname, '..');
const FEEDS_DIR = path.join(ROOT, THELEAGUE.dataPath, 'mfl-feeds');

const toArray = <T,>(v: T | T[] | null | undefined): T[] =>
  Array.isArray(v) ? v : v == null ? [] : [v];
const num = (v: unknown): number => {
  const n = parseFloat(String(v ?? '').replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const parseRecord = (wlt: unknown) => {
  const [w, l, t] = String(wlt ?? '0-0-0')
    .split('-')
    .map((s) => parseInt(s, 10) || 0);
  return { w, l, t };
};
// Mirrors parseOverallRecord in scripts/compute-franchise-history.mjs — the
// 2022 export ships h2hw/h2hl/h2ht WITHOUT the combined h2hwlt string.
const overallRecord = (f: any) => {
  const combined = parseRecord(f?.h2hwlt);
  if (combined.w || combined.l || combined.t) return combined;
  return { w: num(f?.h2hw), l: num(f?.h2hl), t: num(f?.h2ht) };
};
const winPct = (r: { w: number; l: number; t: number }) =>
  (r.w + r.t / 2) / Math.max(1, r.w + r.l + r.t);

type DivisionSeason = {
  year: number;
  divisionId: string;
  divisionName: string;
  rows: any[]; // feed order, preserved
  nameOf: Map<string, string>;
};

function loadDivisionSeasons(): DivisionSeason[] {
  const out: DivisionSeason[] = [];
  const years = readdirSync(FEEDS_DIR)
    .filter((d) => /^\d{4}$/.test(d))
    .sort();
  for (const year of years) {
    const leaguePath = path.join(FEEDS_DIR, year, 'league.json');
    const standingsPath = path.join(FEEDS_DIR, year, 'standings.json');
    if (!existsSync(leaguePath) || !existsSync(standingsPath)) continue;
    const league = JSON.parse(readFileSync(leaguePath, 'utf8'));
    const standings = JSON.parse(readFileSync(standingsPath, 'utf8'));
    const rows = toArray<any>(standings?.leagueStandings?.franchise);
    if (!rows.length) continue;
    // Skip seasons with no football played (e.g. the upcoming year's shell).
    if (!rows.some((r) => { const x = overallRecord(r); return x.w + x.l + x.t > 0; })) continue;

    const franchises = toArray<any>(league?.league?.franchises?.franchise);
    const divisionOf = new Map(franchises.map((f) => [f.id, String(f.division)]));
    const nameOf = new Map(franchises.map((f) => [f.id, String(f.name).trim()]));
    const divisionNames = new Map(
      toArray<any>(league?.league?.divisions?.division).map((d) => [String(d.id), d.name])
    );

    const byDivision = new Map<string, any[]>();
    for (const row of rows) {
      const div = divisionOf.get(row.id);
      if (div == null) continue;
      if (!byDivision.has(div)) byDivision.set(div, []);
      byDivision.get(div)!.push(row);
    }
    for (const [divisionId, divRows] of [...byDivision.entries()].sort()) {
      out.push({
        year: Number(year),
        divisionId,
        divisionName: divisionNames.get(divisionId) ?? divisionId,
        rows: divRows,
        nameOf,
      });
    }
  }
  return out;
}

const DIVISION_SEASONS = loadDivisionSeasons();

// The complete ledger, keyed year|divisionId.
const LEDGER = new Map<string, any>();
for (const summary of (franchiseHistory as any).yearSummaries ?? []) {
  for (const winner of summary.divisionWinners ?? []) {
    LEDGER.set(`${summary.year}|${winner.divisionId}`, { year: summary.year, ...winner });
  }
}

describe('TheLeague division titles — MFL feed order is the source of truth', () => {
  it('found every division-season in the committed feeds', () => {
    // 19 played seasons (2007-2025) x 4 divisions. A drop here means a feed
    // went missing or a year silently stopped parsing.
    expect(DIVISION_SEASONS.length).toBe(76);
    const years = new Set(DIVISION_SEASONS.map((d) => d.year));
    expect(Math.min(...years)).toBe(2007);
    expect(Math.max(...years)).toBe(2025);
    for (const year of years) {
      expect(DIVISION_SEASONS.filter((d) => d.year === year).length).toBe(4);
    }
  });

  it('credits the FIRST feed row of every division — never a local re-sort', () => {
    for (const season of DIVISION_SEASONS) {
      const entry = LEDGER.get(`${season.year}|${season.divisionId}`);
      expect(
        entry,
        `no ledger entry for ${season.year} ${season.divisionName}`
      ).toBeTruthy();
      expect(
        entry.sourceFranchiseId,
        `${season.year} ${season.divisionName} must be the first feed row`
      ).toBe(season.rows[0].id);
      expect(entry.name).toBe(season.nameOf.get(season.rows[0].id));
    }
  });

  it('never lets a worse overall record win a division', () => {
    // The old `divisionWins` primary key did exactly this, 10 times. MFL's
    // first row holds the best overall record in every division-season.
    for (const season of DIVISION_SEASONS) {
      const best = Math.max(...season.rows.map((r) => winPct(overallRecord(r))));
      expect(
        winPct(overallRecord(season.rows[0])),
        `${season.year} ${season.divisionName}: feed row 1 is not the best record`
      ).toBeCloseTo(best, 10);
    }
  });

  it('keeps MFL rows in non-increasing overall win pct across the whole league', () => {
    // If this ever fails, MFL changed its export ordering and every assumption
    // in this file needs re-verifying before the data is regenerated.
    const years = [...new Set(DIVISION_SEASONS.map((d) => d.year))];
    for (const year of years) {
      const rows = JSON.parse(
        readFileSync(path.join(FEEDS_DIR, String(year), 'standings.json'), 'utf8')
      ).leagueStandings.franchise;
      for (let i = 1; i < rows.length; i++) {
        expect(
          winPct(overallRecord(rows[i])),
          `${year}: standings row ${i} outranks row ${i - 1}`
        ).toBeLessThanOrEqual(winPct(overallRecord(rows[i - 1])) + 1e-9);
      }
    }
  });
});

describe('the 2015 Central proof — only head-to-head explains MFL’s pick', () => {
  // Amish Rakefighters and The Executioners both finished 15-3-0 with identical
  // 4-2-0 division records. Executioners had HIGHER all-play (.714 v .710) and
  // HIGHER points scored (2065 v 2012), so every tiebreaker chain we can
  // compute locally picks Executioners. MFL picked Amish — who swept the season
  // series (W1 120.66-91.19, W3 136.34-127.01). Step 1 of the constitution.
  // The feed's h2h* columns only echo the overall record, so this case is
  // permanently un-derivable locally. It is why we defer to MFL.
  const season = DIVISION_SEASONS.find((d) => d.year === 2015 && d.divisionName === 'Central')!;

  it('is a genuine tie on every locally computable key', () => {
    const [first, second] = season.rows;
    expect(season.nameOf.get(first.id)).toBe('Amish Rakefighters');
    expect(season.nameOf.get(second.id)).toBe('The Executioners');
    expect(first.h2hwlt).toBe('15-3-0');
    expect(second.h2hwlt).toBe('15-3-0');
    expect(first.divwlt).toBe('4-2-0');
    expect(second.divwlt).toBe('4-2-0');
    // The runner-up is AHEAD on the next two rulebook steps.
    expect(num(second.all_play_pct)).toBeGreaterThan(num(first.all_play_pct));
    expect(num(second.pf)).toBeGreaterThan(num(first.pf));
  });

  it('credits Amish Rakefighters anyway, per MFL', () => {
    const entry = LEDGER.get(`2015|${season.divisionId}`);
    expect(entry.name).toBe('Amish Rakefighters');
  });
});

describe('the 10 corrected division titles', () => {
  // Every one of these handed the title to a team with a WORSE overall record
  // under the old `divisionWins` primary sort. Pinned by name so a regression
  // is legible in the diff. Format: [year, divisionName, correct winner].
  const CORRECTIONS: [number, string, string][] = [
    [2011, 'Northwest', 'Sabertooths'],
    [2015, 'Central', 'Amish Rakefighters'],
    [2016, 'Eastern', 'Dark Magicians of Chaos'],
    [2017, 'Central', 'Devil Dogs'],
    [2018, 'Southwest', 'LBer-DeCleaters'],
    [2019, 'Eastern', 'Fire Ready Aim'],
    [2020, 'Eastern', 'Wascawy Wabbits'],
    [2024, 'Eastern', 'Wascawy Wabbits'],
    [2025, 'Northwest', 'Da Dangsters'],
    [2025, 'Southwest', 'Gridiron Geeks'],
  ];

  it.each(CORRECTIONS)('%i %s belongs to %s', (year, divisionName, winner) => {
    const season = DIVISION_SEASONS.find(
      (d) => d.year === year && d.divisionName === divisionName
    );
    expect(season, `${year} ${divisionName} not found in feeds`).toBeTruthy();
    const entry = LEDGER.get(`${year}|${season!.divisionId}`);
    expect(entry.name).toBe(winner);
  });

  it.each(CORRECTIONS)(
    '%i %s: the old divisionWins-primary sort really would disagree',
    (year, divisionName) => {
      // Without this, the assertions above could pass vacuously — they'd hold
      // even if someone reinstated the buggy sort, whenever it happened to
      // agree with feed order. Replaying the exact old comparator proves each
      // pinned case is one where the two genuinely diverge, so the suite has
      // teeth. (Old rule: divisionWins -> wins -> pointsFor, all descending.)
      const season = DIVISION_SEASONS.find(
        (d) => d.year === year && d.divisionName === divisionName
      )!;
      const oldRuleWinner = [...season.rows].sort(
        (a, b) =>
          parseRecord(b.divwlt).w - parseRecord(a.divwlt).w ||
          overallRecord(b).w - overallRecord(a).w ||
          num(b.pf) - num(a.pf)
      )[0];
      expect(
        season.nameOf.get(oldRuleWinner.id),
        `${year} ${divisionName}: old rule agrees with MFL, so this is not a real correction`
      ).not.toBe(season.nameOf.get(season.rows[0].id));
    }
  );
});

describe('the 2022 feed gap', () => {
  // TheLeague's 2022 standings export omits the combined h2hwlt column and
  // ships only h2hw/h2hl/h2ht. Reading h2hwlt alone made all 16 franchises
  // 0-0-0, which zeroed the seasonHasGames guard (no 2022 division titles at
  // all) and silently shortened every career W-L by a full season.
  it('still has no h2hwlt column — the fallback is load-bearing', () => {
    const rows = JSON.parse(
      readFileSync(path.join(FEEDS_DIR, '2022', 'standings.json'), 'utf8')
    ).leagueStandings.franchise;
    expect(rows.every((r: any) => r.h2hwlt === undefined)).toBe(true);
    expect(rows.every((r: any) => r.h2hw !== undefined)).toBe(true);
  });

  it('credits all four 2022 division titles', () => {
    const winners = (franchiseHistory as any).yearSummaries.find(
      (y: any) => y.year === 2022
    ).divisionWinners;
    expect(winners).toHaveLength(4);
    expect(winners.map((w: any) => w.name).sort()).toEqual([
      'Dark Magicians of Chaos',
      'Gridiron Geeks',
      'The Mariachi Ninjas',
      'Vitside Mafia',
    ]);
  });

  it('records real 2022 W-L for every franchise', () => {
    for (const [id, fr] of Object.entries<any>((franchiseHistory as any).franchises)) {
      const season = fr.yearByYear.find((y: any) => y.year === 2022);
      if (!season) continue;
      expect(
        season.wins + season.losses + season.ties,
        `${id} ${fr.currentName} has an empty 2022 record`
      ).toBeGreaterThan(0);
    }
  });
});

describe('the division-winner ledger', () => {
  it('records a winner for every division-season, claimable or not', () => {
    expect(LEDGER.size).toBe(76);
  });

  it('names the historical franchise even when no current team can claim it', () => {
    // franchises[].divisionTitles is keyed by CURRENT franchise id, so a title
    // won under a previous owner of that slot (attributeYear returns null) has
    // no home there. The ledger is the only complete record.
    for (const entry of LEDGER.values()) {
      expect(entry.name, `${entry.year} ${entry.divisionName} has no winner name`).toBeTruthy();
      expect(entry.sourceFranchiseId).toMatch(/^\d{4}$/);
    }
    const unclaimed = [...LEDGER.values()].filter((e) => !e.franchiseId);
    // Former-owner-era titles — e.g. Amish Rakefighters' Central titles on
    // slot 0011, which the present Midwestside Connection owner did not win.
    expect(unclaimed.length).toBeGreaterThan(0);
    expect(unclaimed.every((e) => e.name)).toBe(true);
  });

  it('agrees with franchises[].divisionTitles wherever a current team claims one', () => {
    const claimed = new Map<string, string>();
    for (const [id, fr] of Object.entries<any>((franchiseHistory as any).franchises)) {
      for (const title of fr.divisionTitles ?? []) {
        claimed.set(`${title.year}|${title.divisionId}`, id);
      }
    }
    for (const [key, entry] of LEDGER) {
      if (entry.franchiseId) {
        expect(claimed.get(key), `${key} missing from divisionTitles`).toBe(entry.franchiseId);
      } else {
        expect(claimed.has(key), `${key} should have no current claimant`).toBe(false);
      }
    }
    expect(claimed.size).toBe([...LEDGER.values()].filter((e) => e.franchiseId).length);
  });

  it('credits no division titles for an unfinished season', () => {
    // isSeasonComplete gate — 2026 is in progress, so it must contribute none.
    const inProgress = (franchiseHistory as any).yearSummaries.find((y: any) => y.year === 2026);
    if (inProgress) expect(inProgress.divisionWinners ?? []).toHaveLength(0);
  });
});
