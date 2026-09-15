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
  // 2026 is the season the bug was reported on. Both conferences run two
  // divisions, so each seeds 2 division winners + 2 wild cards.
  for (const [code, name] of [
    ['00', 'American League'],
    ['01', 'National League'],
  ] as const) {
    it(`${name} badges its full four-team playoff field`, () => {
      const badges = badgesForConference(2026, code);

      const divisionWinners = badges.filter(b => b.status === 'division_winner');
      const wildCards = badges.filter(b => b.status === 'wild_card');

      expect(divisionWinners).toHaveLength(2);
      expect(wildCards).toHaveLength(2);
      // One winner per division — never two from one division.
      expect(new Set(divisionWinners.map(b => b.division)).size).toBe(2);
      // Seeds are the CONFERENCE ladder, 1..4, each printed once.
      expect([...badges.filter(b => b.status).map(b => b.seed!)].sort()).toEqual([1, 2, 3, 4]);
    });
  }

  it('badges the AL seeds MFL feed order actually ranks', () => {
    const badged = badgesForConference(2026, '00')
      .filter(b => b.status)
      .sort((a, b) => a.seed! - b.seed!);

    expect(badged.map(b => [b.seed, b.status, b.team])).toEqual([
      [1, 'division_winner', 'Drunk Indians'],
      [2, 'division_winner', 'Dicks out for Harambe'],
      [3, 'wild_card', 'Suh girls, one cup'],
      [4, 'wild_card', 'Midwestside Connection'],
    ]);
  });

  // The regression in its own terms: on the league-wide ladder the AL's field
  // is short a wild card, because the NL's rows consume the shared 5-7 range.
  it('the league-wide ladder is what dropped a wild card — do not badge on it', () => {
    const { franchises, config } = loadAflSeason(2026);
    const divisions = getDivisionStandings(franchises, config as never, { preserveFeedOrder: true });
    const alDivisions = ['North', 'South'];
    const alBadges = divisions
      .filter(d => alDivisions.includes(d.name))
      .flatMap(d => d.teams.map(t => resolvePlayoffBadgeStatus(t, TIERING.leagueSeed)));

    expect(alBadges.filter(s => s === 'wild_card')).toHaveLength(1);
  });

  // Historic three-division conferences seed 3 winners + 1 wild card, still 4.
  it('a three-division conference still seeds exactly four', () => {
    const badges = badgesForConference(2008, '00').filter(b => b.status);

    expect(badges).toHaveLength(AFL_PLAYOFF_TEAMS_PER_CONFERENCE);
    expect(badges.filter(b => b.status === 'division_winner')).toHaveLength(3);
    expect(badges.filter(b => b.status === 'wild_card')).toHaveLength(1);
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
