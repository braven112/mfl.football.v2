import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { getDivisionStandings } from '../src/utils/standings';
import {
  TIERING,
  resolvePlayoffBadgeStatus,
  seedValueFor,
} from '../src/components/theleague/standings/standings-table-config';
import type { StandingsFranchise, TeamStanding } from '../src/types/standings';

/**
 * The DIV / WC pills in a standings division card are a statement about the
 * PLAYOFF FIELD, so they have to be cut on the ladder that field is seeded from.
 *
 * TheLeague seeds one league-wide bracket (4 division winners + 3 wild cards) —
 * the league seed is the right ladder there. The AFL seeds a bracket PER
 * CONFERENCE: division winners first, then wild cards out to 4, on EACH side.
 * Drawn on the league-wide ladder its two conferences share one 1..7 scale, so
 * whichever side's wild cards sort lower simply falls off the end. That shipped
 * (Sept 2026): the AL showed one wild card instead of two, its actual 4th seed
 * had no pill at all, and its division winners read #2 / #3 off a bracket they
 * are not in.
 *
 * The invariant, per conference: exactly one DIV pill per division with teams,
 * and enough WC pills to fill that conference's field out to 4. It holds for a
 * three-division conference (2003-2012) as well as today's two.
 */

const AFL_PLAYOFF_TEAMS_PER_CONFERENCE = 4;

type AflConference = { name: string; code: string; divisions: string[] };

function loadAflSeason(year: number) {
  const feed = JSON.parse(
    readFileSync(`data/afl-fantasy/mfl-feeds/${year}/league.json`, 'utf8')
  ) as {
    league: {
      franchises: { franchise: Array<{ id: string; name: string; division: string }> };
      divisions: { division: Array<{ id: string; name: string; conference: string }> };
      conferences: { conference: Array<{ id: string; name: string }> };
    };
  };
  const standingsFeed = JSON.parse(
    readFileSync(`data/afl-fantasy/mfl-feeds/${year}/standings.json`, 'utf8')
  ) as { leagueStandings: { franchise: StandingsFranchise[] } };

  const divisionById = new Map(feed.league.divisions.division.map(d => [d.id, d]));
  const teams = feed.league.franchises.franchise.map(f => ({
    franchiseId: f.id,
    name: f.name,
    division: divisionById.get(f.division)?.name ?? '',
    conference: divisionById.get(f.division)?.conference ?? '',
  }));

  const conferences: AflConference[] = feed.league.conferences.conference.map(c => ({
    name: c.name,
    code: c.id,
    divisions: feed.league.divisions.division.filter(d => d.conference === c.id).map(d => d.name),
  }));
  const divisionToConference = Object.fromEntries(
    feed.league.divisions.division.map(d => [d.name, d.conference])
  );

  return {
    franchises: standingsFeed.leagueStandings.franchise,
    config: {
      teams,
      divisions: feed.league.divisions.division.map(d => d.name),
      conferences,
      divisionToConference,
    },
  };
}

/** What the division view renders for one conference, badge by badge. */
function badgesForConference(year: number, conferenceCode: string) {
  const { franchises, config } = loadAflSeason(year);
  const divisions = getDivisionStandings(franchises, config as never, { preserveFeedOrder: true });
  const conference = (config.conferences as AflConference[]).find(c => c.code === conferenceCode)!;
  const inConference = divisions.filter(d => conference.divisions.includes(d.name));
  // The page counts division winners from the groups that actually have teams.
  const tiering = TIERING.conferenceSeed(inConference.filter(d => d.teams.length > 0).length);

  return inConference.flatMap(division =>
    division.teams.map((team: TeamStanding) => ({
      division: division.name,
      team: team.teamName,
      status: resolvePlayoffBadgeStatus(team, tiering),
      seed: seedValueFor(team, tiering),
    }))
  );
}

describe('AFL division-view playoff badges', () => {
  // 2026 is the live season the bug was reported on; 2025 is complete. Both are
  // asserted STRUCTURALLY — a results sync reorders the live feed every week, so
  // anything pinned to who is currently 2-0 would fail on a cron commit with the
  // fix intact, and path-guard would then block every edit in this domain.
  for (const year of [2025, 2026]) {
    for (const [code, name] of [
      ['00', 'American League'],
      ['01', 'National League'],
    ] as const) {
      it(`${year} ${name} badges its full four-team playoff field`, () => {
        const badges = badgesForConference(year, code);

        const divisionWinners = badges.filter(b => b.status === 'division_winner');
        const wildCards = badges.filter(b => b.status === 'wild_card');
        const divisionsWithTeams = new Set(badges.map(b => b.division)).size;

        // One DIV pill per division, and wild cards filling the field out to 4.
        expect(divisionWinners).toHaveLength(divisionsWithTeams);
        expect(divisionWinners.length + wildCards.length).toBe(AFL_PLAYOFF_TEAMS_PER_CONFERENCE);
        expect(new Set(divisionWinners.map(b => b.division)).size).toBe(divisionsWithTeams);
        // Seeds are the CONFERENCE ladder, 1..4, each printed exactly once.
        expect(badges.filter(b => b.status).map(b => b.seed!).sort()).toEqual([1, 2, 3, 4]);
      });
    }
  }

  // Pinned against a COMPLETE season, whose feed no longer moves, so the exact
  // names below cannot be invalidated by a results sync.
  it('badges the 2025 AL seeds MFL feed order actually ranks', () => {
    const badged = badgesForConference(2025, '00')
      .filter(b => b.status)
      .sort((a, b) => a.seed! - b.seed!);

    expect(badged.map(b => [b.seed, b.status, b.team])).toEqual([
      [1, 'division_winner', 'Dicks out for Harambe'],
      [2, 'division_winner', 'Smokane FC'],
      [3, 'wild_card', 'Avenging Amish'],
      [4, 'wild_card', 'Computer Jocks'],
    ]);
  });

  // The regression in its own terms, stated so it holds for any season: the
  // league-wide ladder badges 4 division winners + 3 wild cards = SEVEN teams,
  // and the AFL seeds EIGHT. One conference is always short a wild card. Which
  // one depends on the week's feed order — it was the AL in 2026, the NL in
  // 2025 — so the invariant is the count, not the conference.
  for (const year of [2025, 2026]) {
    it(`${year}: the league-wide ladder cannot badge eight — do not badge on it`, () => {
      const { franchises, config } = loadAflSeason(year);
      const divisions = getDivisionStandings(franchises, config as never, { preserveFeedOrder: true });
      const byConference = new Map<string, number>();

      for (const division of divisions) {
        const conference = (config.conferences as AflConference[]).find(c =>
          c.divisions.includes(division.name)
        )!;
        const badged = division.teams.filter(t => resolvePlayoffBadgeStatus(t, TIERING.leagueSeed));
        byConference.set(conference.code, (byConference.get(conference.code) ?? 0) + badged.length);
      }

      const badgedTotal = [...byConference.values()].reduce((a, b) => a + b, 0);
      expect(badgedTotal).toBe(7);
      // …so at least one conference is short of its four-team field.
      expect([...byConference.values()].some(n => n < AFL_PLAYOFF_TEAMS_PER_CONFERENCE)).toBe(true);
    });
  }

  // Historic three-division conferences seed 3 winners + 1 wild card, still 4.
  it('a three-division conference still seeds exactly four', () => {
    const badges = badgesForConference(2008, '00').filter(b => b.status);

    expect(badges).toHaveLength(AFL_PLAYOFF_TEAMS_PER_CONFERENCE);
    expect(badges.filter(b => b.status === 'division_winner')).toHaveLength(3);
    expect(badges.filter(b => b.status === 'wild_card')).toHaveLength(1);
  });

  // A division we cannot place in a conference must render NO pill rather than
  // fall through to the league-wide ladder — a missing badge is a gap, a badge
  // off the wrong bracket is a wrong claim about who is in.
  it('an unresolvable division badges nothing, never the league ladder', () => {
    const shape = [1, 2, 3, 4, 5].map(conferenceSeed =>
      resolvePlayoffBadgeStatus({ conferenceSeed, seed: conferenceSeed } as TeamStanding, TIERING.none)
    );

    expect(shape).toEqual([null, null, null, null, null]);
  });
});

describe('TheLeague division-view playoff badges', () => {
  // TheLeague has no conferences, so the default ladder is the league seed and
  // this fix must be a no-op there: 4 division winners + 3 wild cards.
  it('keeps the league-wide 4 + 3 shape', () => {
    const shape = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(seed =>
      resolvePlayoffBadgeStatus({ seed } as TeamStanding, TIERING.leagueSeed)
    );

    expect(shape).toEqual([
      'division_winner',
      'division_winner',
      'division_winner',
      'division_winner',
      'wild_card',
      'wild_card',
      'wild_card',
      null,
      null,
      null,
    ]);
  });
});
