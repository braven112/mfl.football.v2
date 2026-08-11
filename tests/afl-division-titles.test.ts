/**
 * AFL historical division titles — MFL's official standings order is the
 * source of truth (commissioner ruling, 2026-08-11).
 *
 * MFL's leagueStandings export rows arrive in the league's OFFICIAL final
 * order: overall record first, ties broken by the constitution's chain
 * (h2h → div% → conf% → PWR → PF → all-play → VP → most PA → coin flip),
 * which MFL applies itself. The first row of each division IS the division
 * winner — the league's own MFL skin reads winners off exactly that row
 * (see data/afl-fantasy/mfl-feeds/2020/option07.json).
 *
 * History: the awards script originally sorted divisions by divpct (division
 * record) as the PRIMARY key — the constitution makes overall record primary
 * and division record only tiebreaker #2 — and at one point added a raw-PF
 * tiebreak on top. Together those miscredited 22 division titles between
 * 2004 and 2025. These tests exist so no local re-sort ever creeps back in.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  rankDivisionStandingsBestFirst,
  buildHeadToHeadFromRaw,
} from '../src/utils/afl-draft-utils';
import awardsHistory from '../data/afl-fantasy/awards-history.json';
import aflConfig from '../data/afl-fantasy/afl.config.json';
import yearHostMap from '../data/afl-fantasy/year-host-map.json';

const ROOT = path.resolve(__dirname, '..');
const FEEDS_DIR = path.join(ROOT, 'data/afl-fantasy/mfl-feeds');

// Mirrors DIVISION_NAME_SLUG in scripts/compute-afl-awards.mjs — divisions are
// matched by NAME because ids were renumbered when the league dropped from six
// divisions (2004-2012) to four (2013+).
const DIVISION_NAME_SLUG: Record<string, string> = {
  north: 'al-north',
  central: 'al-central',
  south: 'al-south',
  east: 'nl-east',
  west: 'nl-west',
  pacific: 'nl-pacific',
};

// Mirrors OWNERSHIP_CHANGES in scripts/compute-afl-awards.mjs: a 2016+ slot
// that changed hands has pre-`since` titles de-attributed (franchiseId null).
const OWNERSHIP_CHANGES: Record<string, { since: number; priorName: string }> = {
  '0013': { since: 2020, priorName: 'Delirium Tremens' },
};

type FeedRow = Record<string, string>;
const toArray = (v: unknown): FeedRow[] => (Array.isArray(v) ? v : v == null ? [] : [v as FeedRow]);

// Historical team NAME (lowercased) → current franchiseId, via afl.config.json
// name + aliases — the same resolution the awards script uses for pre-2016
// seasons (franchise numbers were not owner-stable back then).
const NAME_TO_ID = new Map<string, string>();
for (const t of (aflConfig as { teams: Array<{ franchiseId: string; name: string; aliases?: string[] }> }).teams) {
  NAME_TO_ID.set(t.name.trim().toLowerCase(), t.franchiseId);
  for (const a of t.aliases ?? []) NAME_TO_ID.set(a.trim().toLowerCase(), t.franchiseId);
}

// Mirrors the awards script's empty-season guard: a "winner" with no division
// games and no points is an unplayed season, not a title.
function divisionPct(row: FeedRow): number {
  const direct = Number(row.divpct);
  if (Number.isFinite(direct) && row.divpct !== '' && row.divpct != null) return direct;
  const m = String(row.divwlt ?? '').match(/^(\d+)-(\d+)-(\d+)$/);
  if (!m) return 0;
  const [w, l, t] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const games = w + l + t;
  return games ? (w + 0.5 * t) / games : 0;
}

interface YearFeeds {
  year: number;
  byDivision: Map<string, FeedRow[]>; // slug → rows in MFL feed order
  nameOf: Map<string, string>;
  headToHead: ReturnType<typeof buildHeadToHeadFromRaw> | undefined;
}

// Load every year whose committed feeds are verifiably that year's AFL league
// (league.json id must match year-host-map — pre-2016 the AFL was a fresh MFL
// league every season, and some caches were once contaminated with TheLeague).
function loadYears(): YearFeeds[] {
  const hostYears = (yearHostMap as { years: Record<string, { leagueId: string }> }).years;
  const out: YearFeeds[] = [];
  for (let year = 2004; year <= new Date().getFullYear(); year++) {
    const dir = path.join(FEEDS_DIR, String(year));
    const leaguePath = path.join(dir, 'league.json');
    const standingsPath = path.join(dir, 'standings.json');
    if (!existsSync(leaguePath) || !existsSync(standingsPath)) continue;
    const lg = JSON.parse(readFileSync(leaguePath, 'utf8'));
    if (String(lg?.league?.id ?? '') !== String(hostYears[String(year)]?.leagueId ?? '')) continue;
    const st = JSON.parse(readFileSync(standingsPath, 'utf8'));
    const rows = toArray(st?.leagueStandings?.franchise);
    if (!rows.length) continue;

    const divSlug = new Map<string, string>(
      toArray(lg.league?.divisions?.division).map((d) => [
        String(d.id),
        DIVISION_NAME_SLUG[String(d.name || '').trim().toLowerCase()],
      ])
    );
    const franchises = toArray(lg.league?.franchises?.franchise);
    const divOf = new Map(franchises.map((f) => [f.id, divSlug.get(String(f.division))]));
    const nameOf = new Map(franchises.map((f) => [f.id, f.name]));

    const byDivision = new Map<string, FeedRow[]>();
    for (const r of rows) {
      const slug = divOf.get(r.id);
      if (!slug) continue;
      if (!byDivision.has(slug)) byDivision.set(slug, []);
      byDivision.get(slug)!.push(r);
    }

    const rawPath = path.join(dir, 'weekly-results-raw.json');
    const headToHead = existsSync(rawPath)
      ? buildHeadToHeadFromRaw(JSON.parse(readFileSync(rawPath, 'utf8')))
      : undefined;

    out.push({ year, byDivision, nameOf, headToHead });
  }
  return out;
}

const YEARS = loadYears();
const SEASONS = new Map(
  (awardsHistory as {
    seasons: Array<{ year: number; awards: Record<string, { franchiseId: string | null; name: string; source: string }> }>;
  }).seasons.map((s) => [s.year, s.awards])
);

describe('division titles come from MFL official feed order', () => {
  it('covers the full backfilled range (sanity: the feeds are actually here)', () => {
    const years = YEARS.map((y) => y.year);
    expect(years).toContain(2004);
    expect(years).toContain(2025);
    expect(years.length).toBeGreaterThanOrEqual(22);
  });

  it('every credited division title is the FIRST row of its division in the feed', () => {
    for (const { year, byDivision, nameOf } of YEARS) {
      const awards = SEASONS.get(year);
      if (!awards) continue; // season not (yet) in awards history — e.g. in progress
      for (const [slug, rows] of byDivision) {
        const winner = rows[0];
        const award = awards[slug];
        // Unplayed/in-progress seasons record no title (same guard as the script).
        if (!(divisionPct(winner) > 0 || Number(winner.pf) > 0)) {
          expect(award, `${year} ${slug}: unplayed season must not credit a title`).toBeUndefined();
          continue;
        }
        expect(award, `${year} ${slug}: missing division title entry`).toBeDefined();
        expect(award.source).toBe('standings:mfl-order');

        if (year < 2016) {
          // Pre-2016 credit travels with the historical team NAME.
          const histName = nameOf.get(winner.id) || winner.id;
          const mapped = NAME_TO_ID.get(histName.trim().toLowerCase()) ?? null;
          expect(
            award.franchiseId,
            `${year} ${slug}: winner should be ${histName} (feed row 1)`
          ).toBe(mapped);
          if (!mapped) expect(award.name).toBe(histName);
        } else {
          const change = OWNERSHIP_CHANGES[winner.id];
          if (change && year < change.since) {
            expect(award.franchiseId, `${year} ${slug}: prior-owner title must be de-attributed`).toBeNull();
            expect(award.name).toBe(change.priorName);
          } else {
            expect(
              award.franchiseId,
              `${year} ${slug}: winner should be feed row 1 (${nameOf.get(winner.id)})`
            ).toBe(winner.id);
          }
        }
      }
    }
  });

  it('no division title claims any other source', () => {
    const DIVISION_SLUGS = new Set(Object.values(DIVISION_NAME_SLUG));
    for (const [year, awards] of SEASONS) {
      for (const [slug, award] of Object.entries(awards)) {
        if (!DIVISION_SLUGS.has(slug)) continue;
        expect(award.source, `${year} ${slug}`).toBe('standings:mfl-order');
      }
    }
  });
});

describe('corrected titles — pinned (commissioner-approved 2026-08-11)', () => {
  // The divpct-primary sort (and the earlier raw-PF tiebreak) had credited
  // each of these to a team MFL's official order does not have on top. If one
  // of these fails, a local re-sort crept back in — fix the code, not the pin.
  const PINS: Array<[number, string, string | null, string]> = [
    [2025, 'al-south', '0008', 'Dicks out for Harambe'],
    [2024, 'al-north', '0010', 'Fullybaked'],
    [2023, 'nl-west', '0014', 'Thundering Herd'],
    [2023, 'al-north', '0002', 'Drunk Indians'],
    [2021, 'nl-west', '0018', 'Jewpacabra'],
    [2021, 'nl-east', '0024', 'No Soup For You'],
    [2020, 'nl-east', '0024', 'No Soup For You'],
    [2020, 'nl-west', '0020', 'The Boondock Saints'],
    [2019, 'al-south', '0005', 'Computer Jocks'],
    [2017, 'nl-west', '0021', 'Chatmaster'],
    [2015, 'nl-east', '0017', 'Titsburgh Feelers'],
    [2014, 'nl-east', null, 'Cliffside Killer Clowns'],
    [2011, 'al-north', '0002', 'Drunk Indians'],
    [2011, 'nl-pacific', null, 'Way More Funner'],
    [2009, 'al-north', '0001', 'Smokane FC'],
    [2009, 'al-central', null, 'More Cowbell'],
    [2007, 'nl-west', null, 'Sharpest Blade'],
    [2007, 'al-south', null, '420 All-Stars'],
    [2005, 'nl-west', null, 'Way More Funner'],
    [2005, 'nl-east', null, 'Cougs'],
    [2004, 'al-north', '0002', 'Drunk Indians'],
    [2004, 'nl-pacific', null, 'The Blunt Bros.'],
  ];

  it.each(PINS)('%i %s → %s (%s)', (year, slug, franchiseId, name) => {
    const award = SEASONS.get(year)?.[slug];
    expect(award, `${year} ${slug} missing`).toBeDefined();
    expect(award!.franchiseId).toBe(franchiseId);
    expect(award!.name).toBe(name);
  });
});

describe('constitution cross-check — the rulebook chain agrees with MFL', () => {
  // Independent verification: re-rank every division with the constitution's
  // own tiebreaker chain (src/utils/afl-draft-utils.ts, true head-to-head from
  // weekly-results-raw.json) and compare the top team against MFL's feed
  // order. MFL applies the same rules, so they should agree everywhere — and
  // as of 2026-08-11 they do, in all 100+ division-seasons on disk.
  //
  // If a future refetch makes a division diverge: MFL's order stays
  // authoritative for the credited title, but a divergence on a NON-tied
  // overall record means the feed's row order is suspect (a refetch may have
  // reordered rows) — investigate the feed before adding an allowlist entry.
  const ALLOWLIST = new Set<string>([
    // '2011 nl-pacific', // example: coin-flip step, unresolvable locally
  ]);

  it('the constitution chain crowns the same winner as MFL feed order, every division, every year', () => {
    let checked = 0;
    for (const { year, byDivision, headToHead } of YEARS) {
      for (const [slug, rows] of byDivision) {
        if (!(divisionPct(rows[0]) > 0 || Number(rows[0].pf) > 0)) continue;
        if (ALLOWLIST.has(`${year} ${slug}`)) continue;
        const computed = rankDivisionStandingsBestFirst(rows as never[], headToHead);
        expect(
          computed[0].id,
          `${year} ${slug}: constitution chain disagrees with MFL feed order`
        ).toBe(rows[0].id);
        checked++;
      }
    }
    // Guard against a vacuous pass if the feed loader ever comes back empty.
    expect(checked).toBeGreaterThan(100);
  });
});
