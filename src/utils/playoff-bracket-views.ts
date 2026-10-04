/**
 * The bracket engine behind the shared Playoffs page
 * (src/components/shared/playoffs/PlayoffsPage.astro): MFL's committed bracket
 * feed → normalized brackets → per-game views with teams, scores, status and
 * winners. Moved out of the AFL's page unchanged so every league renders the
 * same brackets; what stays per league is only SEEDING — who a `seed` ref or a
 * bare franchise id is — which each route hands in as a `TeamResolver`.
 *
 * Never read a finishing position out of a bracket's title, and never key a
 * bracket's meaning off its id (docs/claude/rules/standings-brackets-draft-order.md):
 * this module only walks games.
 */
import { normalizePlayoffBracket, formatRecord, type NormalizedBracket, type SeededTeam } from './playoffs';
export { isRealBracketFeed } from './playoff-bracket-index.mjs';

export type PlayoffBracketMeta = { id: string; name?: string; startWeek?: number; teamsInvolved?: number };

export type ResolvedGame = { home?: SeededTeam; away?: SeededTeam; winner?: SeededTeam; loser?: SeededTeam };
/** Games already walked, keyed `${bracketId}-${gameId}` — how a `winner_of_game` ref finds its team. */
export type ResolvedGames = Map<string, ResolvedGame>;

/** A league's seeding: who an MFL bracket slot ref (`seed`, `franchise_id`, `winner_of_game`…) is. */
export type TeamResolver = (ref: any, bracketId: string, resolvedGames: ResolvedGames) => SeededTeam | undefined;

export type BracketMode = 'projected' | 'clean';

export type MatchupView = {
  id: string;
  week: number;
  status: 'scheduled' | 'live' | 'final';
  home: { team?: SeededTeam; label: string; record?: string; seedLabel?: string; icon?: string };
  away: { team?: SeededTeam; label: string; record?: string; seedLabel?: string; icon?: string };
  scores: { home?: number; away?: number };
  winnerId?: string;
};

export type BracketView = NormalizedBracket & { emphasis?: boolean; roundsView: MatchupView[][] };

const BRACKET_ORDER = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

const moduleData = (mod: any) => (mod && typeof mod === 'object' && 'default' in mod ? mod.default : mod);

/** The committed playoff-brackets.json for one season out of a feeds glob. */
export function bracketFeedForYear(feeds: Record<string, unknown>, year: number): any {
  const key = Object.keys(feeds).find((p) => p.match(/mfl-feeds\/(\d{4})\//)?.[1] === String(year));
  return key ? moduleData(feeds[key]) : undefined;
}

/**
 * Normalize a season's brackets in display order. `reconstructed` is consulted
 * only for a bracket the committed feed has no games for — real MFL data
 * always wins (the AFL's pre-2024 seasons; see
 * scripts/reconstruct-afl-playoff-brackets.mjs).
 */
export function loadSeasonBrackets(feed: any, reconstructed: Record<string, unknown> = {}) {
  const metaList = feed?.playoffBrackets?.playoffBracket;
  const bracketMetas: PlayoffBracketMeta[] = Array.isArray(metaList) ? metaList : metaList ? [metaList] : [];
  const details = feed?.brackets || {};
  const bracketIds = bracketMetas.length > 0 ? bracketMetas.map((b) => b.id) : BRACKET_ORDER;
  let usedReconstructed = false;

  const normalized: NormalizedBracket[] = bracketIds.map((id) => {
    const meta = bracketMetas.find((b) => b.id === id);
    const raw = details?.[id] ?? reconstructed?.[id];
    const bracket = raw ? normalizePlayoffBracket(raw as any, meta as any) : null;
    if (bracket && !details?.[id]) usedReconstructed = true;
    if (bracket) return bracket;
    return { id, name: meta?.name || `Bracket ${id}`, startWeek: meta?.startWeek, teamsInvolved: meta?.teamsInvolved, rounds: [] };
  });

  const brackets: NormalizedBracket[] = [
    ...BRACKET_ORDER.map((id) => normalized.find((b) => b.id === id)).filter((b): b is NormalizedBracket => Boolean(b)),
    ...normalized.filter((b) => !BRACKET_ORDER.includes(b.id)),
  ];
  return { bracketMetas, bracketIds, brackets, usedReconstructed };
}

/** Every week a season's brackets play — the weeks the page live-polls. */
export function bracketWeeks(brackets: NormalizedBracket[]): number[] {
  return Array.from(new Set(brackets.flatMap((b) => b.rounds.map((r) => r.week)).filter(Boolean)));
}

/** Committed final scores for those weeks (weekly-results.json), by week then franchise. */
export function weeklyScoresFor(feed: any, weeks: number[]): Map<number, Map<string, number>> {
  const out = new Map<number, Map<string, number>>();
  const all = (moduleData(feed)?.weeks ?? []) as Array<{ week: number; scores?: Record<string, number> }>;
  for (const week of weeks) {
    const entry = all.find((w) => w.week === week);
    if (entry?.scores) {
      out.set(week, new Map(Object.entries(entry.scores).map(([id, score]) => [id, Number(score) || 0])));
    }
  }
  return out;
}

export const formatPlaceholder = (ref: any, slot: 'home' | 'away') => {
  if (ref?.winner_of_game) return `Winner of Game ${ref.winner_of_game}${ref.bracket ? ` (Bracket ${ref.bracket})` : ''}`;
  if (ref?.loser_of_game) return `Loser of Game ${ref.loser_of_game}${ref.bracket ? ` (Bracket ${ref.bracket})` : ''}`;
  if (ref?.seed) return `Seed ${ref.seed}`;
  return `${slot === 'home' ? 'Home' : 'Away'} TBD`;
};

/**
 * Walk every bracket in order, resolving each slot through the league's
 * resolver and recording winners as it goes, so a later round's
 * `winner_of_game` ref finds the team that won the earlier one.
 */
export function buildBracketViews({
  brackets,
  mode,
  resolveTeam,
  weeklyScores,
}: {
  brackets: NormalizedBracket[];
  mode: BracketMode;
  resolveTeam: TeamResolver;
  weeklyScores: Map<number, Map<string, number>>;
}): BracketView[] {
  const resolvedGames: ResolvedGames = new Map();
  const scoresAvailable = weeklyScores.size > 0;
  const weeklyScore = (week: number, id: string) => {
    const score = weeklyScores.get(week)?.get(id);
    return typeof score === 'number' ? score : undefined;
  };
  // Live scoring is polled client-side, so SSR treats remaining time as 0.
  const homeRemaining = 0;
  const awayRemaining = 0;

  return brackets.map((bracket) => {
    const roundsView: MatchupView[][] = bracket.rounds.map((round) =>
      round.games.map((game) => {
        const homeTeam = mode === 'projected' ? resolveTeam(game.home, bracket.id, resolvedGames) : undefined;
        const awayTeam = mode === 'projected' ? resolveTeam(game.away, bracket.id, resolvedGames) : undefined;
        const homeLabel = homeTeam?.displayName || homeTeam?.teamName || formatPlaceholder(game.home, 'home');
        const awayLabel = awayTeam?.displayName || awayTeam?.teamName || formatPlaceholder(game.away, 'away');
        // Dual-source scores: the bracket's own points, else the week's committed result.
        const bracketHomeScore = game.home?.points ? Number(game.home.points) : undefined;
        const bracketAwayScore = game.away?.points ? Number(game.away.points) : undefined;
        const homeScore = bracketHomeScore ?? (homeTeam?.id ? weeklyScore(round.week, homeTeam.id) : undefined);
        const awayScore = bracketAwayScore ?? (awayTeam?.id ? weeklyScore(round.week, awayTeam.id) : undefined);

        const hasAnyScore =
          (typeof homeScore === 'number' && homeScore > 0) || (typeof awayScore === 'number' && awayScore > 0);
        const hasBracketScores = bracketHomeScore !== undefined || bracketAwayScore !== undefined;

        let status: MatchupView['status'] = 'scheduled';
        if (scoresAvailable || hasBracketScores) {
          if ((homeRemaining > 0 || awayRemaining > 0) && hasAnyScore) status = 'live';
          else if (homeRemaining === 0 && awayRemaining === 0 && hasAnyScore) status = 'final';
          else if (hasBracketScores && hasAnyScore) status = 'final';
        }

        const key = `${bracket.id}-${game.id}`;
        if (homeTeam?.id && awayTeam?.id) {
          const existing = resolvedGames.get(key);
          let winner = existing?.winner;
          let loser = existing?.loser;
          if (homeScore !== undefined && awayScore !== undefined && homeScore !== awayScore) {
            const homeWon = homeScore > awayScore;
            winner = homeWon ? homeTeam : awayTeam;
            loser = homeWon ? awayTeam : homeTeam;
          }
          resolvedGames.set(key, { home: homeTeam, away: awayTeam, winner, loser });
        }

        return {
          id: game.id,
          week: round.week,
          status,
          home: {
            team: homeTeam,
            label: homeLabel,
            record: homeTeam?.record || (homeTeam ? formatRecord(homeTeam.h2hwlt) : undefined),
            seedLabel: homeTeam?.originalSeed ? `#${homeTeam.originalSeed}` : undefined,
            icon: homeTeam?.teamIcon || homeTeam?.icon,
          },
          away: {
            team: awayTeam,
            label: awayLabel,
            record: awayTeam?.record || (awayTeam ? formatRecord(awayTeam.h2hwlt) : undefined),
            seedLabel: awayTeam?.originalSeed ? `#${awayTeam.originalSeed}` : undefined,
            icon: awayTeam?.teamIcon || awayTeam?.icon,
          },
          scores: { home: homeScore, away: awayScore },
          winnerId: resolvedGames.get(key)?.winner?.id,
        };
      }),
    );
    return { ...bracket, emphasis: bracket.id === '1', roundsView };
  });
}

/** A bracket's last game and who won and lost it, once decided. */
export function findFinalGame(views: BracketView[], bracketId: string) {
  const bracket = views.find((b) => b.id === bracketId);
  const game = bracket?.roundsView[bracket.roundsView.length - 1]?.[0];
  if (!game) return undefined;
  const { winnerId } = game;
  const homeId = game.home.team?.id;
  const awayId = game.away.team?.id;
  const loserId = winnerId && homeId && awayId ? (winnerId === homeId ? awayId : homeId) : undefined;
  return { winnerId, loserId, game };
}

/**
 * Seeding for a league with no seeding rules of its own: MFL's resolved
 * franchises, taken as they are. A slot MFL has not filled yet (a bare `seed`
 * before the regular season ends) stays a "Seed N" placeholder rather than a
 * guess — standings order is not seed order
 * (docs/claude/rules/standings-brackets-draft-order.md, rule 4), and a
 * league's own tiebreakers are MFL's to apply.
 *
 * `standings` are the season's MFL rows (for the record); `teams` the league
 * config's teams (for the name and icon).
 */
export function franchiseResolver({
  standings,
  teams,
}: {
  standings: Array<Record<string, any>>;
  teams: Array<{ franchiseId: string; name?: string; icon?: string; banner?: string; aliases?: string[] }>;
}): TeamResolver {
  const rowById = new Map(standings.map((row) => [String(row.id ?? ''), row]));
  const teamById = new Map(teams.map((t) => [t.franchiseId, t]));

  return (ref, bracketId, resolvedGames) => {
    const sourceBracket = ref?.bracket ? String(ref.bracket) : bracketId;
    const fromGame = () => {
      const result = resolvedGames.get(`${sourceBracket}-${ref.winner_of_game || ref.loser_of_game}`);
      return ref.winner_of_game ? result?.winner : result?.loser;
    };

    if (ref?.franchise_id) {
      const id = String(ref.franchise_id);
      const earlier = ref.winner_of_game || ref.loser_of_game ? fromGame() : undefined;
      const seed = Number(ref.seed) || (earlier?.id === id ? earlier.originalSeed : 0);
      const row = rowById.get(id) ?? {};
      const team = teamById.get(id);
      const record = formatRecord(row.h2hwlt);
      return {
        ...(row as any),
        id,
        teamName: team?.name ?? row.fname ?? `Team ${id}`,
        seed,
        bracketSeed: seed,
        originalSeed: seed,
        record,
        icon: team?.icon ?? '',
        banner: team?.banner ?? '',
        displayName: team?.name ?? row.fname ?? `Team ${id}`,
      } as SeededTeam;
    }
    if (ref?.winner_of_game || ref?.loser_of_game) return fromGame();
    return undefined;
  };
}
