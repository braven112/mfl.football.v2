/**
 * Every franchise's standing, as the site prints it: record, points for, and
 * rank within the group that franchise is actually seeded in.
 *
 * Extracted from `SchedulePage.astro`, which had the only implementation, so
 * the roster header could show the same three numbers without re-deriving
 * them. Both surfaces read THIS — a second copy would drift, and the two rules
 * below are each subtle enough that the drift would not be obvious.
 *
 * NEVER re-sorts MFL's standings rows. Their order already applies the
 * constitution's tiebreaker chain, some of which we cannot reproduce (Power
 * Rank, Victory Points), so rank is taken by FILTERING that order and reading
 * the index — never by sorting it. Homebrew tiebreakers miscredited 22 AFL and
 * 10 TheLeague division titles before that rule existed; see
 * `docs/claude/rules/standings-brackets-draft-order.md`.
 */

export interface StandingsConference {
  name: string;
  code: string;
}

export interface StandingsSummary {
  /** `W-L`, or `W-L-T` when there is at least one tie. Null if MFL has none. */
  record: string | null;
  pointsFor: number | null;
  /** 1-based position within the seeding group. */
  rank: number | null;
  /** How many clubs that rank is out of — the conference, or the league. */
  groupSize: number | null;
}

const EMPTY: StandingsSummary = { record: null, pointsFor: null, rank: null, groupSize: null };

/** MFL returns a lone row as an object rather than a one-element array. */
export function standingsRowsOf(feed: any): any[] {
  const rows = feed?.leagueStandings?.franchise;
  return Array.isArray(rows) ? rows : rows ? [rows] : [];
}

/**
 * Every franchise's summary, keyed by id, in ONE pass over the feed.
 *
 * Rank is scoped to the group the club is seeded in, not the league-wide
 * index. The AFL seeds by conference, so a league-wide index is wrong twice
 * over: the club that finished 1st in the American League reads 3rd against
 * the full list of 24, and an AL block's rank column would run 3, 5, 6, 7, 9.
 * A league with one table keeps the league-wide index, which is what an empty
 * or single-entry `conferences` selects.
 */
export function summarizeStandings(
  feed: any,
  conferences: StandingsConference[] = [],
  conferenceOfTeam: (franchiseId: string) => string = () => '',
): Map<string, StandingsSummary> {
  const rows = standingsRowsOf(feed);
  const out = new Map<string, StandingsSummary>();

  // Seeding groups, each preserving the feed's own order.
  const groups: any[][] =
    conferences.length > 1
      ? conferences.map((conference) =>
          rows.filter((row: any) => conferenceOfTeam(String(row?.id ?? '')) === conference.code),
        )
      : [rows];

  for (const group of groups) {
    group.forEach((row: any, index: number) => {
      const id = String(row?.id ?? '');
      if (!id) return;

      // MFL writes W-L-T. The tie segment is noise in a league that rarely
      // ties, so it is shown only when there is one.
      let record: string | null = null;
      if (row?.h2hwlt) {
        const [w = '0', l = '0', t = '0'] = String(row.h2hwlt).split('-');
        record = Number(t) > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
      }

      const pf = Number(row?.pf);

      out.set(id, {
        record,
        pointsFor: Number.isFinite(pf) ? pf : null,
        rank: index + 1,
        groupSize: group.length,
      });
    });
  }

  return out;
}

/** One franchise's summary. Missing club, or no id at all, reads as empty. */
export function summarizeStanding(
  feed: any,
  franchiseId: string | null | undefined,
  conferences: StandingsConference[] = [],
  conferenceOfTeam: (franchiseId: string) => string = () => '',
): StandingsSummary {
  if (!franchiseId) return EMPTY;
  return (
    summarizeStandings(feed, conferences, conferenceOfTeam).get(String(franchiseId)) ?? EMPTY
  );
}
