/**
 * Ask the History — the model loop.
 *
 * Sonnet reads the owner's question, runs queries against our own history
 * engine (ask-query.mjs) through the `run_query` tool, and finishes with the
 * `answer` tool: a short answer plus WHICH query result to show under it. The
 * table under every answer is our computation, never the model's text, so an
 * owner can always check the answer against the rows that produced it.
 *
 * Separate from Roger on purpose: Roger answers from the Constitution only
 * (Brandon, 2026-10-22); this answers from the game record only.
 *
 * The model follows the league's plan (src/utils/ai-plan.mjs, Brandon
 * 2026-11-09): Sonnet for full custom sites, Haiku for the League History
 * tier and the signed-out demo. Both think by default, so tool_choice stays
 * `auto` (a forced tool is refused while thinking) and effort is set instead.
 * Every call tallies its token usage, so the endpoint can record what each
 * question really cost on each model.
 */
import { responseText } from '../claude-models.mjs';
import { addUsage, aiModelForLeague, emptyUsage, usageCost } from '../ai-plan.mjs';
import { getLeagueBySlug } from '../../config/leagues';
import { QueryError, competitionStory, dataAsOf, describeAsOf, querySchema, runQuery, teamRenames } from './ask-query.mjs';
import { describeMissingWeeks } from './ask-players.mjs';
import { tradeDeadlineIsoDate } from '../trade-deadline.mjs';
import { CATEGORIES, SCOPES, recordBook } from './records.mjs';
import { RIVALRY_GAME_UNITS } from './ask-rivalry-games.mjs';
import { loadSeedingPools } from './seeding-pools';
import { WHAT_IF_KINDS, WhatIfError, runWhatIf } from './what-if.mjs';
import { leagueFeedPath, loadLeagueData } from '../league-data';

/** A query result as a Record Book board, for record-charts.mjs (ask-query.mjs chartBoard). */
export interface AskChart {
  field: string;
  label: string;
  asc: boolean;
  rows: Array<{ value: number; display: string; name: string; owner: string | null; context: string; year: number | null; rank: number; franchiseId: string | null; entity: { key: null } }>;
  population: Array<Array<number | string | null>>;
  /** 'compare': a what-if's real-against-replay chart (what-if.mjs), drawn from `compare`. */
  kind?: 'compare';
  compare?: {
    title: string;
    realLabel: string;
    replayLabel: string;
    rows: Array<{ name: string; franchiseId: string | null; real: number; replay: number; realDisplay: string; replayDisplay: string; subject: boolean }>;
  };
}

export interface AskTable {
  description: string;
  total: number;
  columns: Array<{ key: string; label: string }>;
  rows: Array<{ cells: Array<string | number | boolean | null>; franchiseId: string | null; ownerSlug: string | null; year: number | null }>;
  summary: Record<string, { min: number; max: number; avg: number; sum: number } | null>;
  /** Missing on answers saved before charts existed. */
  chart?: AskChart | null;
}

/** A Record Book board the answer points to, resolved from the book itself. */
export interface AskRecordLink {
  title: string;
  /** "Record Book" query string: `cat`, `scope`, `board`. */
  query: string;
  /** "249.30 · Team (Owner) · 2013 Week 9", the board's #1 when it was asked. */
  leader: string;
}

/** The answer's one big stat, for the answer card ("952.44" / "Fewest points by an 8-1 start"). */
export interface AskHeadline {
  value: string;
  label: string;
}

/** An earlier question in the same conversation, as context for a follow-up. */
export interface AskTurn {
  question: string;
  answer: string;
  /** The engine's description of every query that answer ran. */
  steps: string[];
}

/** Who is asking, so "my team" and "us" mean something. */
export interface AskAsker {
  team: string | null;
  owner: string | null;
}

export interface AskResult {
  answer: string;
  /** Missing on answers saved before the answer card existed. */
  headline?: AskHeadline | null;
  /** Up to three natural next questions; missing on older answers. */
  followUps?: string[];
  table: AskTable | null;
  /** Plain-words description of every query run, in order. */
  steps: string[];
  /** How far the record went when this was asked ('' once every season is complete). */
  asOf: string;
  /** Record Book boards that hold the record the answer is about. */
  records: AskRecordLink[];
}

/** What one question spent: tokens summed over every round, and their price. Never sent to the browser. */
export interface AskUsage {
  model: string;
  rounds: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  /** US dollars; null for a model with no price on file. */
  costUsd: number | null;
}

export interface AskData {
  /** league-history.json */
  history: any;
  /** league-history-players.json, when the league has one */
  players?: any;
  /** league-history-moves.json: trades, pickups, draft picks, auction wins, drops */
  moves?: any;
  /** keeper-history.json, for a league that records keeper sets (the stint units) */
  keepers?: any;
  /** pick-trades.json, for a league whose traded picks were traced once (the pickChains unit) */
  pickTrades?: any;
  /** The all-play side competition's sources (datasets.ts loadLeagueCompetitions), for a league that runs one. */
  competitions?: any;
  /** Each season's division → conference (seeding-pools.ts); loaded on first use by the rivalryGames unit when absent. */
  pools?: Record<number, Record<string, string>> | false | null;
  /**
   * One season's league.json, playoff-brackets.json and players.json, for a
   * what-if. Defaults to the league's committed feeds through the league-data
   * loader, read only for the season a what-if asks about.
   */
  loadSeasonFeeds?: (year: number) => Promise<WhatIfFeeds>;
}

interface WhatIfFeeds {
  league: any;
  brackets: any;
  players: any;
}

interface AnthropicLike {
  messages: { create: (body: Record<string, unknown>) => Promise<any> };
}

const MAX_ROUNDS = 8;

const RUN_QUERY_TOOL = {
  name: 'run_query',
  description:
    "Run one query over the league's complete game and season record. Returns the matching rows (up to limit), the total number of matches, and any summaries. Every number you state must come from a result of this tool.",
  input_schema: querySchema(),
};

const RECORD_BOOK_TOOL = {
  name: 'record_book',
  description:
    "Read the league's Record Book: every official record board in one category, with its top three. Use it to say where an answer stands against the standing record, and to cite the board in answer.records.",
  input_schema: {
    type: 'object',
    properties: {
      category: { type: 'string', enum: CATEGORIES.map((c) => c.id) },
      scope: { type: 'string', enum: SCOPES, description: 'single-game and career only: all games, regular season, or playoffs. Default all.' },
    },
    required: ['category'],
  },
};

const RECORD_WATCH_TOOL = {
  name: 'record_watch',
  description:
    'Who is on pace for a season record this season (the season still being played): each team projected to the full season, with the rank that would give it on the board. Empty when no season is in progress.',
  input_schema: { type: 'object', properties: {} },
};

const CALC_TOOL = {
  name: 'calc',
  description: 'Do arithmetic on numbers from results (a pace, a gap, a per-game rate). Never do math yourself.',
  input_schema: {
    type: 'object',
    properties: {
      op: { type: 'string', enum: ['add', 'subtract', 'multiply', 'divide'] },
      a: { type: 'number' },
      b: { type: 'number' },
    },
    required: ['op', 'a', 'b'],
  },
};

const ANSWER_TOOL = {
  name: 'answer',
  description: 'Give the final answer. Call exactly once, after the queries that prove it.',
  input_schema: {
    type: 'object',
    properties: {
      answer: {
        type: 'string',
        description:
          'One to three plain sentences. Lead with the direct answer (yes/no, the name, the number), then the one or two facts that back it, including where it stands against the Record Book when a board covers it. No markdown, no lists.',
      },
      headline: {
        type: 'object',
        description:
          "The answer's one big stat for the answer card, taken from a result: value is a number, a name or a one-word verdict (\"952.44\", \"Todd Gibel\", \"No.\", \"10 of 10\"), at most 14 characters; label says what it is in at most 8 words (\"Fewest points by an 8-1 start\"). Omit when no single stat sums the answer up.",
        properties: {
          value: { type: 'string' },
          label: { type: 'string' },
        },
        required: ['value', 'label'],
      },
      followUps: {
        type: 'array',
        description:
          'Two or three short follow-up questions the asker would naturally ask next, each answerable from these same fields, at most 7 words, written as the asker would type them ("Did they all make the playoffs?").',
        items: { type: 'string' },
      },
      show: {
        type: 'integer',
        description: '0-based index of the run_query or what_if result whose rows best prove the answer; they are shown under it. -1 for none.',
      },
      records: {
        type: 'array',
        description: 'Record Book boards (from record_book) the answer is about; each is linked under the answer. Empty when none applies.',
        items: {
          type: 'object',
          properties: {
            category: { type: 'string', enum: CATEGORIES.map((c) => c.id) },
            scope: { type: 'string', enum: SCOPES },
            board: { type: 'string', description: 'the board id from record_book' },
          },
          required: ['category', 'board'],
        },
      },
    },
    required: ['answer', 'show'],
  },
};

const WHAT_IF_TOOL = {
  name: 'what_if',
  description:
    "Replay one season with one thing changed and get real vs. replay side by side: each team's record, points, standing and playoff finish, the games that flip, and the champion. best_lineup: a team (or every team) starts its best legal lineup each week from the players it really had. undo_trade: one trade never happens. The result is a REPLAY, never the real standings; its rows can be shown like a run_query result.",
  input_schema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: WHAT_IF_KINDS },
      year: { type: 'integer', description: 'the season; for undo_trade, the season the trade was made in' },
      team: { type: 'string', description: 'team name or owner (contains). best_lineup: leave out for every team at once. undo_trade: one side of the trade' },
      partner: { type: 'string', description: 'undo_trade: the other side of the trade' },
      player: { type: 'string', description: 'undo_trade: a player in the trade, to pick it when the teams traded more than once' },
      date: { type: 'string', description: 'undo_trade: the trade date YYYY-MM-DD, from an earlier result, to pick it' },
    },
    required: ['kind', 'year'],
  },
};

const TOOLS = [RUN_QUERY_TOOL, RECORD_BOOK_TOOL, RECORD_WATCH_TOOL, CALC_TOOL, WHAT_IF_TOOL, ANSWER_TOOL];

/** The committed feeds a what-if reads for one season, via the league-data loader. */
function seasonFeedsLoader(leagueSlug: string): (year: number) => Promise<WhatIfFeeds> {
  const dataPath = (getLeagueBySlug(leagueSlug) as { dataPath?: string } | null)?.dataPath;
  return async (year) => {
    if (!dataPath) return { league: null, brackets: null, players: null };
    const [league, brackets, players] = await Promise.all([
      loadLeagueData(leagueFeedPath(dataPath, year, 'league.json')),
      loadLeagueData(leagueFeedPath(dataPath, year, 'playoff-brackets.json')),
      loadLeagueData(leagueFeedPath(dataPath, year, 'players.json')),
    ]);
    return { league, brackets, players };
  };
}

type Board = { id: string; title: string; note?: string; asc: boolean; rows: Array<{ rank: number; display: string; name: string; owner?: string | null; context?: string; year?: number | null }> };

const scopeOf = (category: string, scope?: string) =>
  CATEGORIES.find((c) => c.id === category)?.scoped && scope && SCOPES.includes(scope) ? scope : 'all';

function boardsOf(history: any, category: string, scope?: string): Board[] {
  if (!CATEGORIES.some((c) => c.id === category)) throw new QueryError(`category must be one of ${CATEGORIES.map((c) => c.id).join(', ')}`);
  return recordBook(history).category(category, scopeOf(category, scope)) as Board[];
}

const leaderLine = (row: Board['rows'][number]) =>
  [row.display, row.owner ? `${row.name} (${row.owner})` : row.name, row.context].filter(Boolean).join(' · ');

function recordBookResult(history: any, input: any) {
  const boards = boardsOf(history, String(input?.category ?? ''), input?.scope);
  return boards.map((b) => ({
    board: b.id,
    title: b.title,
    note: b.note ?? null,
    lowestIsBest: b.asc,
    top: b.rows.slice(0, 3).map((r) => ({ rank: r.rank, value: r.display, name: r.name, owner: r.owner ?? null, when: r.context ?? null })),
  }));
}

function recordWatchResult(history: any) {
  const book = recordBook(history);
  const titles = new Map((book.category('season') as Board[]).map((b) => [b.id, b]));
  return Object.entries(book.watch() as Record<string, any[]>).flatMap(([id, watches]) =>
    watches.map((w) => ({
      board: id,
      title: titles.get(id)?.title ?? id,
      team: w.name,
      owner: w.owner,
      onPaceFor: w.display,
      wouldRank: w.rank,
      gamesPlayed: w.played,
      fullSeason: w.full,
      record: w.record ? leaderLine(w.record) : null,
    })),
  );
}

function calcResult(input: any) {
  const a = Number(input?.a);
  const b = Number(input?.b);
  if (!Number.isFinite(a) || !Number.isFinite(b)) throw new QueryError('a and b must be numbers');
  const out = input?.op === 'add' ? a + b : input?.op === 'subtract' ? a - b : input?.op === 'multiply' ? a * b : input?.op === 'divide' ? (b === 0 ? NaN : a / b) : NaN;
  if (!Number.isFinite(out)) throw new QueryError('op must be add, subtract, multiply or divide, and divide needs b ≠ 0');
  return { result: Math.round(out * 1000) / 1000 };
}

/** The boards the answer cited, checked against the book: a made-up board id is dropped. */
function resolveRecords(history: any, cited: unknown): AskRecordLink[] {
  if (!Array.isArray(cited)) return [];
  const out: AskRecordLink[] = [];
  const seen = new Set<string>();
  for (const c of cited.slice(0, 3)) {
    const category = String(c?.category ?? '');
    let boards: Board[];
    try {
      boards = boardsOf(history, category, c?.scope);
    } catch {
      continue;
    }
    const board = boards.find((b) => b.id === c?.board);
    if (!board) continue;
    const scope = scopeOf(category, c?.scope);
    const q = new URLSearchParams();
    if (category !== CATEGORIES[0].id) q.set('cat', category);
    if (scope !== 'all') q.set('scope', scope);
    q.set('board', board.id);
    const query = q.toString();
    if (seen.has(query)) continue;
    seen.add(query);
    out.push({ title: board.title, query, leader: board.rows[0] ? leaderLine(board.rows[0]) : '' });
  }
  return out;
}

const clip = (s: unknown, max: number) => String(s ?? '').trim().slice(0, max);

function headlineOf(input: any): AskHeadline | null {
  const value = clip(input?.value, 24);
  const label = clip(input?.label, 80);
  return value && label ? { value, label } : null;
}

function followUpsOf(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.map((q) => clip(q, 80)).filter((q) => q.length >= 5).slice(0, 3);
}

// Per request, so it stays out of the cached system prompt.
const askerBlock = (asker: AskAsker | null) =>
  asker?.team ? `<asker>${clip(asker.team, 80)}${asker.owner ? ` (${clip(asker.owner, 80)})` : ''}</asker>\n` : '';

/** The earlier turns of a conversation, as the opening context of a follow-up. */
function conversationBlock(turns: AskTurn[]): string {
  if (!turns.length) return '';
  const lines = turns.map(
    (t, i) =>
      `<turn n="${i + 1}"><asked>${clip(t.question, 300)}</asked><answered>${clip(t.answer, 600)}</answered>${t.steps.length ? `<queries>${t.steps.map((d) => clip(d, 300)).join(' | ')}</queries>` : ''}</turn>`,
  );
  return `<conversation>\nThe question below follows up on these earlier answers. Read "they", "them", "that team", "what about…" against them, and re-run the queries you need: an earlier answer is context, not a result you can quote numbers from.\n${lines.join('\n')}\n</conversation>\n\n`;
}

/**
 * The prompt's lines about the league's all-play side competition (the AFL's
 * Premier League / D-League and the AFL Cup). Without them the model took
 * "Premier League" for the soccer one (Brandon, 2026-11-03).
 */
function competitionBlock(ds: any, competitions: any): string {
  const story = competitions ? competitionStory(ds, competitions) : '';
  if (!story) return '- This league has no all-play side competition (no Premier League, D-League or AFL Cup); say so if asked.';
  return `- The all-play competition uses the competition units: competitionSeasons (one row per team-season, its all-play record, its rank in its own table, promoted/relegated), competitionOwners (each owner's totals over the seasons in "competition" and "years") and competitionTitles (every title, the AFL Cup knockout winners included). The ordinary seasons and owners units are the head-to-head season and know nothing about it.
- "Premier League record", "best in the Premier League", "all-play record" and the like mean the all-play record in this competition, never head-to-head wins. Read "best Premier League record of all time" as the best all-play record since the Premier League and D-League began: competitionOwners with competition "tiers", sorted by winPct; say that is the window, and add how they did in Premier League seasons alone (competition "Premier League") when it changes the answer. "D-League record" alone is competition "D-League"; "AFL Cup" is competition "AFL Cup".
- "Titles" and "championships" in this competition come from competitionTitles or competitionOwners.titles; "won the Premier League" means champion = true. The AFL Cup's knockout seasons have a winner and no all-play record; say so when asked about their games.
<competition>
${story}
</competition>`;
}

/**
 * The trade deadline as the league's rules state it today (the registry,
 * resolved by trade-deadline.mjs), for "deadline week" questions. Only today's
 * rule is known: what the deadline was in a past season is not on record.
 */
function deadlineLine(leagueSlug: string, year: number | undefined): string {
  const spec = (getLeagueBySlug(leagueSlug) as { tradeDeadline?: { kind?: string; rule?: string } } | null)?.tradeDeadline;
  const rule =
    spec?.kind === 'fixed'
      ? 'a fixed date each season'
      : spec?.rule === 'wednesday-between-week-10-and-11'
        ? 'the Wednesday between NFL Week 10 and Week 11'
        : spec?.rule === 'friday-before-week-11'
          ? 'the Friday before NFL Week 11, at 8:45pm PT'
          : null;
  const current = year ? tradeDeadlineIsoDate(leagueSlug, year) : null;
  if (!rule || !current) return '- This league has no trade deadline on record; say so if asked.';
  return `- Trade deadline, from the league's rules today: ${rule}${current ? ` (${current} in ${year})` : ''}. In-season trades and pickups carry that season's deadline under today's rule (deadline, daysToDeadline, deadlineWeek); use them for "deadline week" or "before/after the deadline" questions. Today's rule is the only one on record, so for past seasons say "under today's deadline rule": an earlier season's deadline may have been different. The data says when trades happened, never why; for a "why" question give the counts and say the record cannot say why.`;
}

/**
 * The roster-path units (ask-stints.mjs): who had which player, how each team
 * got him, how title teams were built, and where traded picks went. Their gaps
 * are stated from the data, so "unknown" is said rather than filled in.
 */
function rosterPathLine(moves: any, keepers: any, pickTrades: any): string {
  const firstTx = Math.min(...[...(moves.trades ?? []), ...(moves.pickups ?? [])].map((r: any[]) => r[0]));
  return `- Roster paths use three units. stints: one row per player per stint with a team (one player on one team, under one owner, continuously), with how that team got him (acquired: draft, auction, trade, waiver, free agent, commissioner, came with the franchise, unknown), how it ended (traded, dropped, not kept, left roster, franchise changed hands, still rostered), his starter points for that team season by season, and the titles won during it; a player's path through the league is his stints sorted by year then fromDate. titleRosters: one row per player who started for a champion in its title season, with how the team got him, the trade that brought him (tradeId, tradePartner) and whether he was carried over from an earlier season${keepers ? ' (keeper: in the keeper set)' : ''}. "How was the 2019 champion built" is titleRosters for that year grouped by acquired (summarize points); "trades that led to a title" is titleRosters where acquired = trade, with tradeId to read the full trade in the trades unit (where tradeId matches). pickChains: one row per draft pick that changed hands: its original team, the path through every trade (path, tradeIds), who used it on whom, and what that player then did for the drafting team and each team he was traded to (afterDraft). A pick's confidence says how it was matched; say so when it is not exact, and when status is unknown say the record cannot tell which player it became (candidates lists the possibilities when there are few).
- Trades, pickups and drops are on record from ${Number.isFinite(firstTx) ? firstTx : 'the first season with a transaction log'}; before that only draft picks${moves.auctions?.length ? ' and auction wins' : ''} are, so a player who arrived another way says "unknown". Never guess how a player arrived; say how many were unknown.${pickTrades ? '' : ' Picks traded before the draft order was set are matched to the player by the draft\'s own record when it names the trade, else by the one pick the last holder made in that round; anything else stays unknown.'}`;
}

/**
 * The prompt's lines about what-ifs (what-if.mjs), Brandon 2026-11-17: "what
 * ifs are a must". A replay is never the real standings, so the model is told
 * to say so every time and to state the assumptions the tool returns.
 */
function whatIfBlock(players: any, moves: any): string {
  if (!players) return '- What-ifs need player scores, which this league does not have; say so if asked.';
  return `- What-ifs ("what if X had started its best lineup in 2019", "what if the 2021 trade between X and Y never happened", "how many games did we leave on the bench") use what_if, never run_query: kind best_lineup (team, or no team for every team at once) or kind undo_trade${moves ? '' : ' (not available here: no trade record)'} (team and partner; when the result lists several trades, call again with date or player). Show its result (set show to its index): it draws real against replay.
- Every what-if answer must: call it a replay, never the real standings or the real result; give real and replay side by side for the team(s) asked about (record, finish, and the champion when it changes); and state in one plain clause the key assumption the result's assumptions give (best legal lineup from the players really rostered; for a trade, each side keeps what it gave up and both start their best lineup). For undo_trade, the swing from lineups alone is in lineupOnly: compare the replay with lineupOnly to say what the trade itself was worth, and say so. When playoffs.replayed is false, say the playoffs were not replayed and why; when controlReproducesRealBracket is false, call the replayed playoff result approximate.`;
}

function systemPrompt(leagueSlug: string, ds: any, players: any, moves: any, competitions: any, keepers: any = null, pickTrades: any = null): string {
  const league = getLeagueBySlug(leagueSlug);
  const latest = ds.seasons.at(-1);
  const current = Object.values(latest?.teams ?? {})
    .map((t: any) => `${t.n} (${t.h.split('+').map((id: string) => ds.owners?.[id]?.name ?? id).join(' & ')})`)
    .join('; ');
  const formerOwners = Object.values(ds.owners ?? {})
    .map((o: any) => o.name)
    .filter(Boolean)
    .join('; ');
  return `You answer questions about the history of ${league?.name ?? leagueSlug}, a fantasy football league, from its complete game record (${ds.firstSeason} to ${ds.lastSeason}).

You can only know what your tools return. Never answer from memory, never estimate, never invent a number, team, player or owner, and never do arithmetic yourself (use calc). If the data cannot answer the question (anything not in the fields), say so plainly in the answer and set show to -1.

How to work:
- Translate the question into one or more queries. "Started 9-1" means seasons with throughGames: 10, w = 9, l = 1. "Fewer points" with no comparison named means the fewest points in the same window (pf), and you should say which window you used.
- For "has anyone ever / how many times" questions, rely on total, not on the rows shown.
- For "most/how many in a single day, week or season" and "who did the most" questions, count with groupBy instead of reading rows: groupBy date (or year and week, or owner), and the top group by count is the answer. Trades and games count once each, not once per side. Use having (count gte N) for "how many days had N or more". This is exact over the whole record, so answer it plainly.
- When a question compares against a specific team or season, query that one too and compare.
- Records are credited to owners: an owner who moved teams keeps one career. Team names are per season, but a team that was renamed is still the same team: filtering on team (or opponent, partner) by any of its names matches every season under every name. When an answer covers a renamed team, name its other names (see Renamed teams).
- An owner's whole career ("everything X has done", "X across every team", "X's record, titles, trades, rivals"): the owners unit gives the career line (w, l, titles, finals, playoffApps, divisionTitles, firstYear, lastYear) over EVERY team they ran, including former teams a commissioner linked to them; then seasons where owner contains X for each team and finish, trades where owner contains X (groupBy partnerOwner for favorite trade partners), and games where owner contains X groupBy opponentOwner for rivals (most games, best and worst records). Name every team they ran.
- Consolation games (toilet bowl, NIT) count as neither regular season nor playoffs. Season W/L/PF are regular season only.
- ${latest && !latest.done ? `The ${latest.y} season is still being played. ${describeAsOf(dataAsOf(ds))}. A ${latest.y} team counts in a "first N games" question only once N of its games are final, so say so when this season's teams could change the answer (for example, a team one win from qualifying). Leave ${latest.y} out of questions about full seasons (complete = true).` : 'Every season in the record is complete.'}
- Use the exact names from results. Match names with contains when the asker uses a nickname or part of a name.
- ${players ? `Player questions use the player units: every rostered player's score each week, starter or bench. A player's points count for the team that started him. ${describeMissingWeeks(players.missingWeeks) ? `${describeMissingWeeks(players.missingWeeks)}; say so when a player answer could be missing those weeks.` : 'Every final week has player scores.'}` : 'There are no player stats for this league; say so if asked.'}
- ${moves ? `Roster moves use the move units: trades (one row per side, with what the players each side got scored for it the rest of that season), pickups (waiver claims and free agents), draftPicks${moves.auctions?.length ? ', auctions (salary auction wins)' : ''}. "Best trade/pickup/pick" means the most points the player(s) scored for the team that got them unless the question says otherwise; say which measure you used. Contract lengths are not on record${moves.auctions?.length ? '; auction salaries are' : ''}.` : 'There are no trade, draft or pickup records for this league; say so if asked.'}
${moves ? deadlineLine(leagueSlug, latest?.y) : ''}
${moves && players ? rosterPathLine(moves, keepers, pickTrades) : ''}
${whatIfBlock(players, moves)}
${competitionBlock(ds, competitions)}
- Always point to the Record Book when a board covers what was asked: read it with record_book, say where the answer stands against the record (it IS the record, or how far short of it), and cite the board in answer.records. For a season in progress, record_watch says who is on pace for a season record.
- "Biggest game", "most important game", "game of the rivalry" or "closest playoff game" between two teams or owners use the rivalryGames unit: where team (or owner) is one side and opponent (or opponentOwner) the other, sorted by importance desc (biggest) or, for the closest playoff game, stakesLevel gte 60 sorted by absMargin asc; limit 3-5, chart margin, and columns year, week, stakes, team, score, opponent, oppScore, playoffSpot, decidedBy. Importance is STAKES FIRST (championship, then playoff rounds with the later round higher, then the third-place and placement games, then a regular-season game that decided a playoff spot, then the rest), the closer margin breaking ties. A playoff-spot game is one whose other result would have changed who made the playoffs; one that would only have forced a tiebreaker stays regular season (its playoffSpot says so). Name the stakes tier and, for a playoff-spot game, say who it put in or kept out (playoffSpot). Name the players who decided it only from decidedBy, topStarter, oppTopStarter and benchFlip, word for word: never guess a lineup. A conference league's playoff-spot line is its conference's. "My top rival" with no team named is the opponent owner the asker has played most (games, where owner is the asker, groupBy opponentOwner); say that is how you picked them.
- When the answer is a ranking or a record, set chart on the query you show, to the field being ranked.
- Keep queries few and focused; then call answer once, with a headline when one stat sums the answer up and two or three followUps.
- <asker> names the team the person asking owns: "my team", "us", "we" and "I" mean that team.
- Trash talk comes back on the asker. When the question is an insult or a jab at another owner or team rather than a stats question ("why does Todd suck", "the Warlocks are a joke"), do not answer it and say nothing about who it targets. Instead find the asker's worst season: query seasons where owner contains the <asker> owner (for co-owners, the first name) and complete is true, sorted by winPct then pf (both lowest first), limit 1, and show it. Answer with a short, playful football roast of that season (its record, points and finish), with the record as the headline. Keep it to football: never repeat a slur, profanity or anything personal from the question, and never make sexuality, race, religion, gender, looks, family or any other personal trait the joke, even when the question did. With no <asker>, say you only take shots from owners on record and set show to -1.

Current teams (owner): ${current}
Every owner on record: ${formerOwners}
Renamed teams (owner: every name, with seasons): ${teamRenames(ds).join('; ') || 'none'}`;
}

/**
 * Answer one question from the league's history (and player) datasets.
 * Throws when the model is unavailable, so the endpoint can say so instead of
 * returning a guess.
 */
export async function askHistory(
  leagueSlug: string,
  data: AskData,
  question: string,
  {
    client,
    turns = [],
    asker = null,
    model = aiModelForLeague(leagueSlug),
    onUsage,
  }: { client?: AnthropicLike; turns?: AskTurn[]; asker?: AskAsker | null; model?: string; onUsage?: (usage: AskUsage) => void } = {},
): Promise<AskResult> {
  const tally = emptyUsage(model);
  const report = () => onUsage?.({ ...tally, costUsd: usageCost(tally) });
  const ds = data.history;
  let anthropic = client;
  if (!anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    anthropic = new Anthropic({ apiKey }) as unknown as AnthropicLike;
  }

  const asOf = describeAsOf(dataAsOf(ds));
  const results: AskTable[] = [];
  const steps: string[] = [];
  const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [
    { role: 'user', content: `${askerBlock(asker)}${conversationBlock(turns)}<question>${question}</question>` },
  ];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 6000,
      output_config: { effort: 'medium' },
      system: [{ type: 'text', text: systemPrompt(leagueSlug, ds, data.players, data.moves, data.competitions, data.keepers, data.pickTrades), cache_control: { type: 'ephemeral' } }],
      tools: TOOLS,
      messages,
    });
    addUsage(tally, response?.usage);

    const uses: any[] = (response?.content ?? []).filter((b: any) => b?.type === 'tool_use');
    const final = uses.find((u) => u.name === ANSWER_TOOL.name);
    if (final) {
      report();
      const show = Number(final.input?.show);
      return {
        answer: String(final.input?.answer ?? '').trim(),
        headline: headlineOf(final.input?.headline),
        followUps: followUpsOf(final.input?.followUps),
        table: Number.isInteger(show) && show >= 0 ? (results[show] ?? null) : null,
        steps,
        asOf,
        records: resolveRecords(ds, final.input?.records),
      };
    }
    if (!uses.length) {
      // Answered in plain text: keep it, with the last table as its receipt.
      const text = responseText(response).trim();
      if (text) {
        report();
        return { answer: text, headline: null, followUps: [], table: results.at(-1) ?? null, steps, asOf, records: [] };
      }
      break;
    }

    messages.push({ role: 'assistant', content: response.content });
    // The rivalryGames unit seeds per conference: read the pools once, only when asked.
    let pools = data.pools;
    if (pools === undefined && uses.some((u) => u.name === RUN_QUERY_TOOL.name && RIVALRY_GAME_UNITS.includes(u.input?.unit))) {
      const dataPath = getLeagueBySlug(leagueSlug)?.dataPath;
      // false = unknown: no playoff-spot games rather than a league-wide line in a conference league.
      pools = data.pools = dataPath ? await loadSeedingPools(dataPath).catch(() => false as const) : false;
    }
    // A what-if reads its season's feeds first (the only tool that waits on a load).
    const feedsByYear = new Map<number, WhatIfFeeds>();
    for (const use of uses) {
      if (use.name !== WHAT_IF_TOOL.name) continue;
      const year = Number(use.input?.year);
      if (!Number.isInteger(year)) continue;
      const load = data.loadSeasonFeeds ?? seasonFeedsLoader(leagueSlug);
      // A trade made after its season changes the next one.
      for (const y of use.input?.kind === 'undo_trade' ? [year, year + 1] : [year]) {
        if (!feedsByYear.has(y)) feedsByYear.set(y, await load(y).catch(() => ({ league: null, brackets: null, players: null })));
      }
    }
    messages.push({
      role: 'user',
      content: uses.map((use) => {
        const reply = (content: unknown) => ({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(content) });
        try {
          if (use.name === WHAT_IF_TOOL.name) {
            const { whatIf, ...table } = runWhatIf(ds, data.players, data.moves, use.input ?? {}, {
              leagueSlug,
              feeds: (y: number) => feedsByYear.get(y) ?? { league: null, brackets: null, players: null },
            });
            results.push(table as unknown as AskTable);
            steps.push(String(table.description));
            return reply({
              index: results.length - 1,
              description: table.description,
              ...whatIf,
              columns: table.columns.map((c: { key: string }) => c.key),
              rows: table.rows.map((r: { cells: unknown[] }) => r.cells),
            });
          }
          if (use.name === RECORD_BOOK_TOOL.name) return reply(recordBookResult(ds, use.input));
          if (use.name === RECORD_WATCH_TOOL.name) return reply(recordWatchResult(ds));
          if (use.name === CALC_TOOL.name) return reply(calcResult(use.input));
          if (use.name !== RUN_QUERY_TOOL.name) {
            return { type: 'tool_result', tool_use_id: use.id, content: 'Unknown tool.', is_error: true };
          }
          const result = runQuery(ds, use.input ?? {}, {
            players: data.players,
            moves: data.moves,
            keepers: data.keepers,
            pickTrades: data.pickTrades,
            competitions: data.competitions,
            league: leagueSlug,
            pools,
          });
          const { query: _q, ...table } = result;
          results.push(table as AskTable);
          steps.push(result.description);
          return {
            type: 'tool_result',
            tool_use_id: use.id,
            content: JSON.stringify({
              index: results.length - 1,
              description: result.description,
              total: result.total,
              ...('matched' in result ? { matchedRows: (result as any).matched } : {}),
              columns: result.columns.map((c: { key: string }) => c.key),
              rows: result.rows.map((r: { cells: unknown[] }) => r.cells),
              summary: result.summary,
            }),
          };
        } catch (e) {
          const message = e instanceof QueryError || e instanceof WhatIfError ? e.message : 'The query failed.';
          return { type: 'tool_result', tool_use_id: use.id, content: message, is_error: true };
        }
      }),
    });
  }
  report();
  throw new Error('No answer after the maximum number of rounds');
}
