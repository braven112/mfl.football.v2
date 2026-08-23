/**
 * `ownerHistory` boundaries must land on the season the source franchise was
 * RENAMED — cross-checked against that year's MFL feed, not against the config.
 *
 * Why this test exists: TheLeague's 0011 claimed franchise 0010 from
 * `yearStart: 2010`, one year too early. Franchise 0010 was still the Witch
 * City Warlocks for all of 2010 and only became the Midwestside Connection in
 * 2011, so the current owner's franchise page opened on a 2-16 season he never
 * played — plus its trades, draft picks, auction wins, career W-L and the 2010
 * Jerry Jones Award. Nothing downstream can catch that: `attributeYear` treats
 * an `ownerHistory` range as authoritative, and the row still renders the
 * correct NAME for the year (resolved from the source franchise's history), so
 * the page looks meticulous while it is wrong.
 *
 * The invariant every entry in every league satisfies, at BOTH edges: the
 * source franchise's name in `mfl-feeds/<year>/league.json` changes when a
 * stint starts and changes again after it ends — an owner change shows up as a
 * rename. `yearEnd` is not the safe edge: `yearEnd: 2016` would hand 0011 a
 * season the Computer Jocks' owner played, the exact mirror of the bug above.
 *
 * If a genuine takeover ever happens WITHOUT a rename, add it to the matching
 * allowlist below with a note; do not loosen the check.
 *
 * Leagues come from the registry, so a league added later is covered here the
 * day its config gains an `ownerHistory`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';

const ROOT = path.resolve(__dirname, '..');

/** Open-ended stints ("still the owner") carry this sentinel as `yearEnd`. */
const OPEN_ENDED_YEAR_END = 9999;

type OwnerHistoryEntry = { franchiseId: string; yearStart: number; yearEnd: number };
type ConfigTeam = { franchiseId: string; name: string; ownerHistory?: OwnerHistoryEntry[] };

type LeagueUnderTest = { slug: string; teams: ConfigTeam[]; feedsDir: string };

const leaguesUnderTest: LeagueUnderTest[] = ALL_LEAGUES.flatMap(
  (league: { slug: string; configPath?: string; dataPath?: string }) => {
    if (!league.configPath || !league.dataPath) return [];
    const configFile = path.join(ROOT, league.configPath);
    if (!existsSync(configFile)) return [];
    const config = JSON.parse(readFileSync(configFile, 'utf8'));
    const teams = Array.isArray(config?.teams) ? (config.teams as ConfigTeam[]) : [];
    return [{ slug: league.slug, teams, feedsDir: path.join(ROOT, league.dataPath, 'mfl-feeds') }];
  }
);

/**
 * Stints that genuinely began without the source franchise being renamed.
 * Key: `${slug}:${claimingId}->${sourceId}@${yearStart}`.
 */
const NO_RENAME_TAKEOVERS = new Set<string>([]);

/**
 * Stints that genuinely ended without the source franchise being renamed
 * afterwards. Key: `${slug}:${claimingId}->${sourceId}@${yearEnd}`.
 */
const NO_RENAME_HANDOFFS = new Set<string>([]);

const feedFranchiseName = (feedsDir: string, year: number, franchiseId: string): string | null => {
  const file = path.join(feedsDir, String(year), 'league.json');
  if (!existsSync(file)) return null;
  const feed = JSON.parse(readFileSync(file, 'utf8'));
  const franchises = feed?.league?.franchises?.franchise;
  if (!Array.isArray(franchises)) return null;
  const match = franchises.find((f: { id?: string }) => f?.id === franchiseId);
  return typeof match?.name === 'string' ? match.name.trim() : null;
};

describe('ownerHistory boundaries', () => {
  it('the registry resolves at least one league with an ownerHistory claim', () => {
    expect(leaguesUnderTest.length).toBeGreaterThan(0);
    const claims = leaguesUnderTest.flatMap((l) =>
      l.teams.flatMap((t) => t.ownerHistory ?? [])
    );
    expect(claims.length).toBeGreaterThan(0);
  });

  for (const league of leaguesUnderTest) {
    for (const team of league.teams) {
      for (const entry of team.ownerHistory ?? []) {
        const label =
          `${league.slug} ${team.franchiseId} (${team.name}) claiming ` +
          `${entry.franchiseId} ${entry.yearStart}-${entry.yearEnd}`;

        it(`${label} starts on a rename in that year's MFL feed`, () => {
          const key = `${league.slug}:${team.franchiseId}->${entry.franchiseId}@${entry.yearStart}`;
          if (NO_RENAME_TAKEOVERS.has(key)) return;

          const priorName = feedFranchiseName(
            league.feedsDir,
            entry.yearStart - 1,
            entry.franchiseId
          );
          // No feed for the prior year (the claim starts at the league's first
          // recorded season) — there is nothing to compare against.
          if (priorName === null) return;

          const startName = feedFranchiseName(league.feedsDir, entry.yearStart, entry.franchiseId);
          expect(startName, `${label}: no feed name for ${entry.yearStart}`).toBeTruthy();
          expect(
            startName,
            `${label}: franchise ${entry.franchiseId} was still "${priorName}" in ` +
              `${entry.yearStart}, so the claim starts a year early — the owner's ` +
              `page would show a season played by someone else`
          ).not.toBe(priorName);
        });

        it(`${label} ends on a rename in the following year's MFL feed`, () => {
          if (entry.yearEnd >= OPEN_ENDED_YEAR_END) return;

          const key = `${league.slug}:${team.franchiseId}->${entry.franchiseId}@${entry.yearEnd}`;
          if (NO_RENAME_HANDOFFS.has(key)) return;

          const nextName = feedFranchiseName(
            league.feedsDir,
            entry.yearEnd + 1,
            entry.franchiseId
          );
          // No feed for the following year — the stint ends at the last
          // recorded season, so there is nothing to compare against.
          if (nextName === null) return;

          const endName = feedFranchiseName(league.feedsDir, entry.yearEnd, entry.franchiseId);
          expect(endName, `${label}: no feed name for ${entry.yearEnd}`).toBeTruthy();
          expect(
            endName,
            `${label}: franchise ${entry.franchiseId} was still "${nextName}" in ` +
              `${entry.yearEnd + 1}, so the claim runs a year long — the owner's ` +
              `page would show a season played by someone else`
          ).not.toBe(nextName);
        });
      }
    }
  }

  it('TheLeague 0011 claims franchise 0010 for 2011-2015, the Midwestside years', () => {
    const theleague = leaguesUnderTest.find((l) => l.slug === 'theleague');
    expect(theleague, 'theleague missing from the registry').toBeTruthy();

    const midwestside = theleague!.teams.find((t) => t.franchiseId === '0011');
    const stint = midwestside?.ownerHistory?.find((e) => e.franchiseId === '0010');
    expect(stint?.yearStart).toBe(2011);
    expect(stint?.yearEnd).toBe(2015);

    // The rename in each direction, straight from the feeds.
    expect(feedFranchiseName(theleague!.feedsDir, 2010, '0010')).toBe('Witch City Warlocks');
    expect(feedFranchiseName(theleague!.feedsDir, 2011, '0010')).toBe('Midwestside Connection');
    expect(feedFranchiseName(theleague!.feedsDir, 2015, '0010')).toBe('Midwestside Connection');
    expect(feedFranchiseName(theleague!.feedsDir, 2016, '0010')).toBe('Computer Jocks');
  });
});
