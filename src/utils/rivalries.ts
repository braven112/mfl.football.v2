/**
 * Rivalry math shared by both leagues.
 *
 * The scoring formula was TheLeague's, inlined in its franchise page. It is
 * extracted here so the AFL's franchise page, rivalry matrix and pairing pages
 * all rank rivals the same way — a copy per surface is exactly how two pages
 * end up disagreeing about who a franchise's biggest rival is.
 *
 * DATA CAVEAT (AFL): a pairing's `games` is only as complete as the ingested
 * head-to-head feeds. MFL's archived exports for AFL 2007-2019 carry the
 * postseason weeks only, so AFL career meeting counts under-report those years
 * and skew toward playoff games. `franchise-history.json#h2hCoverage` records
 * the shortfall per season; surfaces that show career totals should say so.
 * TheLeague's feeds are complete for every ingested year.
 */

/** One recorded meeting, as stored in franchise-history.json#matchupHistory. */
export type Matchup = {
  year: number;
  week: number;
  score: number;
  opponentScore: number;
  isPlayoff?: boolean;
  playoffRound?: string | null;
  /**
   * False when either side of the game belongs to a former owner. Every
   * rivalry surface is scoped to the CURRENT owners' shared history, so
   * unattributed meetings are excluded from records and rankings alike.
   */
  bothAttributed?: boolean;
};

export type RivalEntry = {
  opponentId: string;
  wins: number;
  losses: number;
  ties: number;
  games: number;
  playoffGames: number;
  intensity: number;
};

/**
 * Meetings below this are one-off scheduling artifacts rather than a shared
 * history, and in a 24-team league they are the majority of pairings.
 */
export const MIN_RIVALRY_MEETINGS = 4;

/** Meetings between two franchises under the current owners, oldest-first. */
export function currentOwnerMeetings(
  matchupHistory: Record<string, Matchup[]> | undefined,
  opponentId: string
): Matchup[] {
  return (matchupHistory?.[opponentId] ?? []).filter((m) => m.bothAttributed);
}

/** Win/loss/tie/playoff tallies for a list of meetings, from OUR perspective. */
export function tallyMeetings(meetings: Matchup[]) {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let playoffGames = 0;
  for (const m of meetings) {
    if (m.score > m.opponentScore) wins++;
    else if (m.score < m.opponentScore) losses++;
    else ties++;
    if (m.isPlayoff) playoffGames++;
  }
  return { wins, losses, ties, playoffGames };
}

/**
 * How charged a pairing is: an even record counts for more than a lopsided
 * one, volume and postseason meetings raise it, and the log keeps a franchise
 * that simply plays one division rival often from crowding out a genuinely
 * close series. Playoff meetings count triple.
 *
 * Every playoff meeting weighs the same here regardless of round. That is
 * deliberate for now — the AFL runs 9-15 brackets a season and MFL's archived
 * bracket metadata does not label which is the title game before 2024, so a
 * championship-vs-consolation tier would be guesswork for most of its history.
 */
export function rivalryIntensity(
  meetings: number,
  wins: number,
  losses: number,
  ties: number,
  playoffGames: number
): number {
  const totalDecided = wins + losses + ties;
  const closeness = totalDecided > 0 ? 1 - Math.abs(wins - losses) / totalDecided : 0;
  return closeness * Math.log2(1 + meetings + playoffGames * 3);
}

/**
 * Rank every opponent a franchise shares enough history with, most intense
 * first. `selfId` is skipped: ownerHistory cross-attribution can leave a
 * franchise facing its own id when an owner changed slots mid-career.
 */
export function computeRivalEntries(
  matchupHistory: Record<string, Matchup[]> | undefined,
  selfId: string,
  { minMeetings = MIN_RIVALRY_MEETINGS }: { minMeetings?: number } = {}
): RivalEntry[] {
  const entries: RivalEntry[] = [];
  for (const opponentId of Object.keys(matchupHistory ?? {})) {
    if (opponentId === selfId) continue;
    const meetings = currentOwnerMeetings(matchupHistory, opponentId);
    if (meetings.length < minMeetings) continue;
    const { wins, losses, ties, playoffGames } = tallyMeetings(meetings);
    entries.push({
      opponentId,
      wins,
      losses,
      ties,
      games: meetings.length,
      playoffGames,
      intensity: rivalryIntensity(meetings.length, wins, losses, ties, playoffGames),
    });
  }
  entries.sort((a, b) => b.intensity - a.intensity);
  return entries;
}

/**
 * URL slug for a pairing. Sorted so both franchises link to the SAME page —
 * `/rivalries/0001-vs-0012` and never a second `0012-vs-0001` variant.
 */
export const canonicalRivalryPair = (a: string, b: string): string =>
  [a, b].sort().join('-vs-');

/** Split a pairing slug back into its two franchise ids, or null if malformed. */
export function parseRivalryPair(slug: string): [string, string] | null {
  const parts = String(slug ?? '').split('-vs-');
  if (parts.length !== 2) return null;
  const [a, b] = parts;
  if (!a || !b || a === b) return null;
  return [a, b];
}

/** `14-9` or `14-9-1` — ties only shown when they exist. */
export const formatRivalryRecord = (wins: number, losses: number, ties: number): string =>
  ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;

/** One season's head-to-head completeness, as recorded by the aggregator. */
export type CoverageSeason = {
  year: number;
  seasonStarted?: boolean;
  gamesRecorded?: number;
  weeksWithGames?: number;
  weeksInFeed?: number | null;
};

/** Seasons whose head-to-head the archives only partly cover. */
export function incompleteCoverageSeasons(coverage: CoverageSeason[]): CoverageSeason[] {
  return (coverage ?? []).filter(
    (c) =>
      c.seasonStarted &&
      c.weeksInFeed &&
      (c.weeksWithGames ?? 0) > 0 &&
      (c.weeksWithGames ?? 0) < c.weeksInFeed - 1
  );
}

/**
 * Seasons the archives hold no head-to-head for at all.
 *
 * Kept separate from `incompleteCoverageSeasons` — which requires at least one
 * week of games — because a season with nothing needs different wording, and
 * because a zero here is not necessarily a data problem to chase. The AFL's
 * 2003 was played on Yahoo with only standings entered into MFL, so no game in
 * any week has a score; it is missing from every rivalry record permanently.
 */
export function emptyCoverageSeasons(coverage: CoverageSeason[]): CoverageSeason[] {
  return (coverage ?? []).filter(
    (c) => c.seasonStarted && c.weeksInFeed && (c.weeksWithGames ?? 0) === 0
  );
}

/**
 * A precise sentence describing what is missing, for display on any surface
 * that shows career head-to-head.
 *
 * Deliberately NOT "postseason weeks only": that was true of 2007-2011 and
 * 2016-2019 but wrong about 2012-2015, which are missing weeks 1-3 and hold
 * the other fourteen. Blanket wording that overstates the damage is its own
 * inaccuracy, and this text sits next to real numbers that contradict it.
 *
 * Established exhaustively against MFL in August 2026 — see
 * docs/claude/insights/domains/mfl-api.md. The games are not retrievable, so
 * this is permanent copy, not a placeholder.
 */
export function describeCoverageGap(coverage: CoverageSeason[]): string | null {
  const seasons = incompleteCoverageSeasons(coverage);
  const empty = emptyCoverageSeasons(coverage);
  if (seasons.length === 0 && empty.length === 0) return null;

  const missingWeeks = (c: CoverageSeason) => (c.weeksInFeed ?? 0) - (c.weeksWithGames ?? 0);
  const mostlyMissing = seasons.filter((c) => missingWeeks(c) > 6);
  const partlyMissing = seasons.filter((c) => missingWeeks(c) <= 6);

  // Verb agreement matters here: the AFL is down to a single gap season, and
  // "2003 retain only their postseason weeks" reads as broken English next to
  // real numbers.
  const verb = (list: CoverageSeason[], singular: string, plural: string) =>
    list.length === 1 ? singular : plural;

  const parts: string[] = [];
  if (empty.length) {
    parts.push(
      `${formatSeasonRanges(empty.map((c) => c.year))} ${verb(empty, 'has', 'have')} no game-by-game results at all`
    );
  }
  if (mostlyMissing.length) {
    parts.push(
      `${formatSeasonRanges(mostlyMissing.map((c) => c.year))} ` +
        `${verb(mostlyMissing, 'retains', 'retain')} only ${verb(mostlyMissing, 'its', 'their')} postseason weeks`
    );
  }
  if (partlyMissing.length) {
    parts.push(
      `${formatSeasonRanges(partlyMissing.map((c) => c.year))} ` +
        `${verb(partlyMissing, 'is', 'are')} missing ${verb(partlyMissing, 'its', 'their')} opening weeks`
    );
  }

  const total = empty.length + seasons.length;
  const lead = total === 1 ? "MFL's archive for this season is" : "MFL's archives for these seasons are";
  // Three clauses are now possible, so "A, and B, and C" needs to become a real
  // list rather than a chain of ands.
  const joined =
    parts.length <= 1
      ? parts.join('')
      : parts.length === 2
        ? parts.join(' and ')
        : `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
  return `${lead} incomplete — ${joined}.`;
}

/**
 * Collapse a year list into contiguous ranges: `[2003, 2007..2019]` reads as
 * "2003, 2007–2019".
 *
 * Printing `min–max` instead would claim seasons the ledger actually has in
 * full — the AFL's gap skips 2004-2006, which are complete — and a data caveat
 * that overstates the damage is its own kind of wrong.
 */
export function formatSeasonRanges(years: number[]): string {
  const sorted = [...new Set(years)].sort((a, b) => a - b);
  if (sorted.length === 0) return '';
  const ranges: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (const y of sorted.slice(1)) {
    if (y === prev + 1) {
      prev = y;
      continue;
    }
    ranges.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = y;
    prev = y;
  }
  ranges.push(start === prev ? `${start}` : `${start}–${prev}`);
  return ranges.join(', ');
}
