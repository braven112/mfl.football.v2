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
 * The invariant every entry in both leagues satisfies: the source franchise's
 * name in `mfl-feeds/<yearStart>/league.json` differs from its name in
 * `<yearStart - 1>` — an owner change shows up as a rename. If a genuine
 * takeover ever happens WITHOUT a rename, add it to NO_RENAME_TAKEOVERS below
 * with a note; do not loosen the check.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import theleagueConfig from '../src/data/theleague.config.json';
import aflConfig from '../data/afl-fantasy/afl.config.json';

const ROOT = path.resolve(__dirname, '..');

type OwnerHistoryEntry = { franchiseId: string; yearStart: number; yearEnd: number };
type ConfigTeam = { franchiseId: string; name: string; ownerHistory?: OwnerHistoryEntry[] };

const LEAGUES: { slug: string; teams: ConfigTeam[]; feedsDir: string }[] = [
  {
    slug: 'theleague',
    teams: theleagueConfig.teams as unknown as ConfigTeam[],
    feedsDir: path.join(ROOT, 'data/theleague/mfl-feeds'),
  },
  {
    slug: 'afl-fantasy',
    teams: aflConfig.teams as unknown as ConfigTeam[],
    feedsDir: path.join(ROOT, 'data/afl-fantasy/mfl-feeds'),
  },
];

/** `${slug}:${claimingId}->${sourceId}@${yearStart}` for takeovers with no rename. */
const NO_RENAME_TAKEOVERS = new Set<string>([]);

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
  for (const league of LEAGUES) {
    const claimants = league.teams.filter((t) => (t.ownerHistory?.length ?? 0) > 0);

    it(`${league.slug} has at least one team with an ownerHistory (fixture sanity)`, () => {
      expect(claimants.length).toBeGreaterThan(0);
    });

    for (const team of claimants) {
      for (const entry of team.ownerHistory!) {
        const label =
          `${league.slug} ${team.franchiseId} (${team.name}) claiming ` +
          `${entry.franchiseId} from ${entry.yearStart}`;

        it(`${label} starts on a rename in that year's MFL feed`, () => {
          const key = `${league.slug}:${team.franchiseId}->${entry.franchiseId}@${entry.yearStart}`;
          if (NO_RENAME_TAKEOVERS.has(key)) return;

          const priorName = feedFranchiseName(league.feedsDir, entry.yearStart - 1, entry.franchiseId);
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
      }
    }
  }

  it('TheLeague 0011 claims franchise 0010 from 2011, the year the Warlocks became Midwestside', () => {
    const midwestside = (theleagueConfig.teams as unknown as ConfigTeam[]).find(
      (t) => t.franchiseId === '0011'
    );
    const stint = midwestside?.ownerHistory?.find((e) => e.franchiseId === '0010');
    expect(stint?.yearStart).toBe(2011);
    expect(stint?.yearEnd).toBe(2015);

    const feeds = path.join(ROOT, 'data/theleague/mfl-feeds');
    expect(feedFranchiseName(feeds, 2010, '0010')).toBe('Witch City Warlocks');
    expect(feedFranchiseName(feeds, 2011, '0010')).toBe('Midwestside Connection');
  });
});
