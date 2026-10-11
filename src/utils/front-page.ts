/**
 * View models for the front-page homepage style (registry `homeStyle:
 * 'front-page'`; src/components/shared/front-page/). Pure functions over the
 * feeds a league's homepage already loads, so the components hold markup only
 * and every rule here is testable.
 *
 * The page is news-led, the way ESPN, NFL.com and the team sites lead: one
 * story dominates, a headline list sits beside it, scores ride a thin strip.
 * Every headline is ABOUT a franchise, so each carries `franchiseIds` and the
 * page draws it with that team's crest rather than a stock photo.
 *
 * Two rules from the owner (Oct 2026):
 *   - Every week, the viewer's opponent is a story: the rivalry, from the
 *     league's own head-to-head history. A doubleheader week is two opponents
 *     and therefore two stories. They are PINNED to the top of the headlines.
 *   - The lead is never empty in season. Columns (The Gauntlet, the Pecking
 *     Order), Schefter articles and the week in the books all qualify.
 */
import type { SchefterPost } from '../types/schefter';
import type { WeekInTheBooks } from './package-league-home';

// ── Inputs ──────────────────────────────────────────────────────────────────

export interface FrontTeam {
  franchiseId: string;
  name: string;
  divisionId?: string;
}

/** One week of `parseWeeklySchedule` (src/utils/schedule-data.mjs). */
export interface ParsedWeek {
  week: number;
  matchups: Array<{ franchises: Array<{ id: string; score: number | null; isHome?: boolean }> }>;
}

/** One meeting from `franchise-history.json` → `matchupHistory[opponentId]`. */
export interface Meeting {
  year: number;
  week: number;
  score: number;
  opponentScore: number;
  isPlayoff?: boolean;
}

// ── Stories ─────────────────────────────────────────────────────────────────

export type FrontStoryKind =
  | 'rivalry'
  | 'gauntlet'
  | 'pecking-order'
  | 'article'
  | 'recap'
  | 'transaction';

export interface FrontStory {
  id: string;
  kind: FrontStoryKind;
  /** Short section label above the headline ("Your rivalry", "The Gauntlet"). */
  kicker: string;
  headline: string;
  dek?: string;
  href?: string;
  /** A second link, for a story whose official record lives elsewhere (a move). */
  action?: { label: string; href: string };
  /** The teams the story is about, most important first. Drives the art. */
  franchiseIds: string[];
  /** ISO time the story was written, when it has one. */
  at?: string;
  /** Pinned stories sit above everything else in the headline list. */
  pinned?: boolean;
}

/** Kinds that can lead the page, in the order a tie on recency is broken. */
const LEAD_KINDS: FrontStoryKind[] = ['article', 'gauntlet', 'pecking-order', 'recap'];

// ── Score strip ─────────────────────────────────────────────────────────────

export interface StripSide {
  franchiseId: string;
  score: number | null;
}

export interface StripGame {
  sides: [StripSide, StripSide];
  /** The viewer plays in this game. */
  mine: boolean;
}

export interface ScoreStrip {
  week: number;
  /** `upcoming` = this week's pairings; `final` = the last week, all scored. */
  state: 'upcoming' | 'final';
  /** `division` = the viewer's division only; `league` = a sample of the league. */
  scope: 'division' | 'league';
  games: StripGame[];
  /** Games in the week that the strip does not show. */
  hidden: number;
}

/**
 * The week the strip shows: the first week with an unplayed game (this week's
 * pairings), or — once the season is over — the last week with a result.
 */
export function stripWeek(weeks: ParsedWeek[]): { week: ParsedWeek; state: ScoreStrip['state'] } | null {
  const next = weeks.find((w) => w.matchups.some((m) => m.franchises.some((f) => f.score == null)));
  if (next) return { week: next, state: 'upcoming' };
  for (let i = weeks.length - 1; i >= 0; i -= 1) {
    if (weeks[i].matchups.length > 0) return { week: weeks[i], state: 'final' };
  }
  return null;
}

/**
 * This week's games for the strip. A signed-in owner sees their own division's
 * games (a 99-team league plays ~99 games a week, mostly between strangers),
 * their own first. Anyone else sees the games between the best records.
 */
export function buildScoreStrip(input: {
  weeks: ParsedWeek[];
  mine: string | null;
  divisionOf: (franchiseId: string) => string | undefined;
  /** Wins so far, to rank the games a signed-out visitor sees. */
  winsOf: (franchiseId: string) => number;
  limit?: number;
}): ScoreStrip | null {
  const { weeks, mine, divisionOf, winsOf, limit = 12 } = input;
  const picked = stripWeek(weeks);
  if (!picked) return null;
  const { week, state } = picked;

  const all: StripGame[] = week.matchups
    .filter((m) => m.franchises.length === 2)
    .map((m) => ({
      sides: [
        { franchiseId: m.franchises[0].id, score: m.franchises[0].score },
        { franchiseId: m.franchises[1].id, score: m.franchises[1].score },
      ] as [StripSide, StripSide],
      mine: !!mine && m.franchises.some((f) => f.id === mine),
    }));

  const myDivision = mine ? divisionOf(mine) : undefined;
  let games: StripGame[];
  let scope: ScoreStrip['scope'];
  if (myDivision) {
    scope = 'division';
    games = all
      .filter((g) => g.sides.some((s) => divisionOf(s.franchiseId) === myDivision))
      .sort((a, b) => Number(b.mine) - Number(a.mine));
  } else {
    scope = 'league';
    const weight = (g: StripGame) => winsOf(g.sides[0].franchiseId) + winsOf(g.sides[1].franchiseId);
    games = [...all].sort((a, b) => weight(b) - weight(a));
  }
  const shown = games.slice(0, limit);
  return { week: week.week, state, scope, games: shown, hidden: all.length - shown.length };
}

// ── Rivalry ─────────────────────────────────────────────────────────────────

export interface RivalryFacts {
  meetings: number;
  wins: number;
  losses: number;
  ties: number;
  /** The current run of results, from the viewer's side ('T' for a tie). */
  streak: { result: 'W' | 'L' | 'T'; length: number } | null;
  last: Meeting | null;
}

const byDate = (a: Meeting, b: Meeting) => a.year - b.year || a.week - b.week;

/** Head-to-head facts from the viewer's side, oldest meeting first. */
export function rivalryFacts(meetings: Meeting[] | undefined): RivalryFacts {
  const games = [...(meetings ?? [])].sort(byDate);
  let wins = 0;
  let losses = 0;
  let ties = 0;
  const results = games.map((g) => {
    const r: 'W' | 'L' | 'T' = g.score > g.opponentScore ? 'W' : g.score < g.opponentScore ? 'L' : 'T';
    if (r === 'W') wins += 1;
    else if (r === 'L') losses += 1;
    else ties += 1;
    return r;
  });
  let streak: RivalryFacts['streak'] = null;
  for (let i = results.length - 1; i >= 0; i -= 1) {
    if (!streak) streak = { result: results[i], length: 1 };
    else if (results[i] === streak.result) streak.length += 1;
    else break;
  }
  return { meetings: games.length, wins, losses, ties, streak, last: games[games.length - 1] ?? null };
}

const record = (w: number, l: number, t: number) => (t > 0 ? `${w}–${l}–${t}` : `${w}–${l}`);
const pts = (n: number) => n.toFixed(2);

/**
 * The weekly story about the viewer's opponent. Written from the league's own
 * head-to-head history, so it exists every week without a writer.
 */
export function buildRivalryStory(input: {
  mine: FrontTeam;
  opponent: FrontTeam;
  week: number;
  meetings: Meeting[] | undefined;
  opponentRecord?: string;
  href?: string;
}): FrontStory {
  const { mine, opponent, week, meetings, opponentRecord, href } = input;
  const f = rivalryFacts(meetings);
  const me = mine.name;
  const them = opponent.name;

  let headline: string;
  if (f.meetings === 0) {
    headline = `First meeting: ${me} vs ${them}`;
  } else if (f.streak && f.streak.result === 'L' && f.streak.length >= 2) {
    headline = `${them} have won the last ${f.streak.length} against ${me}`;
  } else if (f.streak && f.streak.result === 'W' && f.streak.length >= 2) {
    headline = `${me} go for ${f.streak.length + 1} straight over ${them}`;
  } else if (f.wins === f.losses) {
    headline = `${me} and ${them} are all square at ${record(f.wins, f.losses, f.ties)}`;
  } else if (f.wins > f.losses) {
    headline = `${me} lead the series with ${them} ${record(f.wins, f.losses, f.ties)}`;
  } else {
    headline = `${them} lead the series with ${me} ${record(f.losses, f.wins, f.ties)}`;
  }

  let dek: string;
  if (f.meetings === 0) {
    dek = opponentRecord
      ? `The two have never played. ${them} come in at ${opponentRecord}.`
      : 'The two have never played.';
  } else {
    const last = f.last!;
    const won = last.score > last.opponentScore;
    const tied = last.score === last.opponentScore;
    const lastLine = tied
      ? `they tied ${pts(last.score)}–${pts(last.opponentScore)}`
      : `${won ? me : them} won ${pts(Math.max(last.score, last.opponentScore))}–${pts(Math.min(last.score, last.opponentScore))}`;
    const plural = f.meetings === 1 ? 'meeting' : 'meetings';
    dek = `${record(f.wins, f.losses, f.ties)} all-time in ${f.meetings} ${plural}. Last time, ${last.year} week ${last.week}, ${lastLine}.`;
  }

  return {
    id: `rivalry-${week}-${opponent.franchiseId}`,
    kind: 'rivalry',
    kicker: `Your rivalry · Week ${week}`,
    headline,
    dek,
    href,
    franchiseIds: [mine.franchiseId, opponent.franchiseId],
    pinned: true,
  };
}

/** The viewer's opponents in a week, in schedule order (two in a doubleheader). */
export function opponentsInWeek(week: ParsedWeek | undefined, mine: string | null): string[] {
  if (!week || !mine) return [];
  const out: string[] = [];
  for (const m of week.matchups) {
    if (!m.franchises.some((f) => f.id === mine)) continue;
    const opp = m.franchises.find((f) => f.id !== mine);
    if (opp) out.push(opp.id);
  }
  return out;
}

// ── Stories from what the league already publishes ──────────────────────────

/** Schefter's own league posts — columns and articles, never the NFL wire. */
export function storiesFromPosts(posts: SchefterPost[], limit = 8): FrontStory[] {
  return posts
    .filter((p) => p.type === 'article' || p.type === 'power-ranking')
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .slice(0, limit)
    .map((p) => {
      const isGauntlet = !!(p as SchefterPost & { scheduleStrength?: unknown }).scheduleStrength;
      return {
        id: `post-${p.id}`,
        kind: isGauntlet ? 'gauntlet' : 'article',
        kicker: isGauntlet ? 'The Gauntlet' : p.type === 'power-ranking' ? 'Rankings' : 'Schefter',
        headline: p.headline,
        dek: firstSentences(p.body),
        href: p.link,
        franchiseIds: p.franchiseIds ?? [],
        at: p.timestamp,
      } satisfies FrontStory;
    });
}

/**
 * The teams a story names, for a post that arrived without `franchiseIds`
 * (Archie's first Gauntlet did). Longest names first, so "Dallas Cowboys II"
 * is not also read as "Dallas Cowboys"; order is where each name first appears.
 */
export function teamsMentioned(text: string, teams: FrontTeam[], limit = 2): string[] {
  const hay = text.toLowerCase();
  const taken: Array<[number, number]> = [];
  const hits: Array<{ id: string; at: number }> = [];
  for (const t of [...teams].sort((a, b) => b.name.length - a.name.length)) {
    const name = t.name.trim().toLowerCase();
    if (name.length < 4) continue;
    let at = hay.indexOf(name);
    while (at !== -1 && taken.some(([s, e]) => at < e && at + name.length > s)) at = hay.indexOf(name, at + 1);
    if (at === -1) continue;
    taken.push([at, at + name.length]);
    hits.push({ id: t.franchiseId, at });
  }
  return hits.sort((a, b) => a.at - b.at).slice(0, limit).map((h) => h.id);
}

/** A body's opening, cut at a sentence boundary near `max` characters. */
export function firstSentences(body: string | undefined, max = 220): string | undefined {
  if (!body) return undefined;
  const text = body.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > 60 ? cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, '')}…`;
}

/** The week in the books as a story: the top score, the closest game. */
export function buildRecapStory(
  book: WeekInTheBooks | null,
  nameOf: (franchiseId: string) => string,
  href?: string,
): FrontStory | null {
  if (!book) return null;
  const top = nameOf(book.top.franchiseId);
  const parts: string[] = [];
  if (book.nailBiter) {
    parts.push(
      `${nameOf(book.nailBiter.winnerId)} edged ${nameOf(book.nailBiter.loserId)} by ${pts(book.nailBiter.margin)}, the week's closest game.`,
    );
  }
  if (book.blowout) {
    parts.push(`${nameOf(book.blowout.winnerId)} won the week's biggest blowout by ${pts(book.blowout.margin)}.`);
  }
  return {
    id: `recap-${book.week}`,
    kind: 'recap',
    kicker: `Week ${book.week} in the books`,
    headline: `${top} post the week's best score, ${pts(book.top.score)}`,
    dek: parts.join(' ') || undefined,
    href,
    // The art is the story's subject alone: two crests read as "X vs Y", and
    // the top scorer did not play the nail-biter's teams.
    franchiseIds: [book.top.franchiseId],
  };
}

/** The latest Pecking Order issue as a story. */
export function buildPeckingOrderStory(
  issue: { year: number; week: number; headline?: string; lede?: string; publishedAt?: string; rankings?: Array<{ franchiseId: string }> } | null,
  href?: string,
): FrontStory | null {
  if (!issue?.headline) return null;
  return {
    id: `pecking-order-${issue.year}-${issue.week}`,
    kind: 'pecking-order',
    kicker: 'Pecking Order',
    headline: issue.headline,
    dek: firstSentences(issue.lede),
    href,
    franchiseIds: (issue.rankings ?? []).slice(0, 3).map((r) => r.franchiseId),
    at: issue.publishedAt,
  };
}

/** One move, as a headline with a link to its official record. */
export interface MoveInput {
  franchiseId: string;
  /** ISO string or epoch milliseconds (the transactions ledger's `at`). */
  at: string | number;
  added: string[];
  dropped: string[];
  kind: string;
}

export function buildTransactionStory(
  move: MoveInput,
  nameOf: (franchiseId: string) => string,
  playerName: (id: string) => string,
  officialHref?: string,
): FrontStory | null {
  const team = nameOf(move.franchiseId);
  const added = move.added.map(playerName);
  const dropped = move.dropped.map(playerName);
  let headline: string;
  if (move.kind === 'trade') headline = `${team} trade for ${added.join(', ') || 'future considerations'}`;
  else if (added.length && dropped.length) headline = `${team} add ${added.join(', ')} and drop ${dropped.join(', ')}`;
  else if (added.length) headline = `${team} add ${added.join(', ')}`;
  else if (dropped.length) headline = `${team} drop ${dropped.join(', ')}`;
  else return null;
  return {
    id: `move-${move.franchiseId}-${move.at}`,
    kind: 'transaction',
    kicker: 'Transaction',
    headline,
    franchiseIds: [move.franchiseId],
    at: new Date(move.at).toISOString(),
    ...(officialHref ? { action: { label: 'Official move', href: officialHref } } : {}),
  };
}

// ── Assembling the page ─────────────────────────────────────────────────────

export interface FrontStories {
  lead: FrontStory | null;
  /** The headline list: pinned rivalries first, then newest first. */
  headlines: FrontStory[];
  /**
   * Story cards under the lead: the columns and recaps not already leading,
   * topped up with the viewer's rivalries so the row is never one lonely card.
   */
  cards: FrontStory[];
}

const time = (s: FrontStory) => (s.at ? Date.parse(s.at) || 0 : 0);

/**
 * Pick the lead and lay out the rest. The lead is the newest story that can
 * lead; rivalries never lead (they are the viewer's own, pinned beside it, so
 * a signed-out visitor and an owner see the same lead). Nothing appears twice.
 */
export function arrangeStories(stories: FrontStory[], opts: { headlines?: number; cards?: number } = {}): FrontStories {
  const { headlines: maxHeadlines = 8, cards: maxCards = 3 } = opts;
  const seen = new Set<string>();
  const unique = stories.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));

  const leadable = unique
    .filter((s) => LEAD_KINDS.includes(s.kind))
    .sort((a, b) => time(b) - time(a) || LEAD_KINDS.indexOf(a.kind) - LEAD_KINDS.indexOf(b.kind));
  const lead = leadable[0] ?? null;
  const rest = unique.filter((s) => s !== lead);

  const pinned = rest.filter((s) => s.pinned);
  const columns = rest.filter((s) => !s.pinned && LEAD_KINDS.includes(s.kind)).sort((a, b) => time(b) - time(a)).slice(0, maxCards);
  const cards = [...columns, ...pinned].slice(0, maxCards);
  const columnIds = new Set(columns.map((c) => c.id));
  // A column on a card is not repeated in the list; a rivalry is, because the
  // owner's rule is that it always heads the headlines.
  const others = rest.filter((s) => !s.pinned && !columnIds.has(s.id)).sort((a, b) => time(b) - time(a));
  const headlines = [...pinned, ...others].slice(0, Math.max(maxHeadlines, pinned.length));
  return { lead, headlines, cards };
}

// ── The race and the wire ───────────────────────────────────────────────────

/** The top `n` standings rows in MFL's own order — never re-sorted. */
export function podium<T extends { id: string }>(rows: T[], n = 3): T[] {
  return rows.slice(0, n);
}

/** A roster's best scorer so far, from the YTD feed's `playerScore` rows. */
export function topScorer(rosterIds: string[], ytd: Array<{ id: string; score: string | number }>): string | null {
  const onRoster = new Set(rosterIds);
  let best: { id: string; score: number } | null = null;
  for (const row of ytd) {
    if (!onRoster.has(String(row.id))) continue;
    const score = Number(row.score);
    if (!Number.isFinite(score)) continue;
    if (!best || score > best.score) best = { id: String(row.id), score };
  }
  return best?.id ?? null;
}

export interface WireItem {
  id: string;
  headline: string;
  href?: string;
  at: string;
  source?: string;
  /** Set when the news is about a player on the viewer's roster. */
  onMyRoster: boolean;
}

/** The NFL wire: the newest external posts, flagged when they touch the viewer's roster. */
export function buildWire(posts: SchefterPost[], myRoster: Set<string>, limit = 5): WireItem[] {
  return posts
    .filter((p) => p.type === 'external')
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .slice(0, limit)
    .map((p) => ({
      id: p.id,
      headline: p.headline,
      href: p.link,
      at: p.timestamp,
      source: p.linkLabel,
      onMyRoster: (p.namedPlayerIds ?? []).some((id) => myRoster.has(String(id))),
    }));
}
