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
 * Sonnet, not Haiku (Brandon, 2026-10-25: "okay with using a slightly better
 * model for this"): turning "started 9-1 with fewer points" into the right
 * window and sort is the hard part, and a wrong query is a confident wrong
 * answer. Sonnet 5.5 always thinks, so tool_choice stays `auto` (a forced tool
 * is refused while thinking) and effort is set instead.
 */
import { SONNET_MODEL, responseText } from '../claude-models.mjs';
import { getLeagueBySlug } from '../../config/leagues';
import { QueryError, dataAsOf, describeAsOf, querySchema, runQuery } from './ask-query.mjs';
import { describeMissingWeeks } from './ask-players.mjs';
import { CATEGORIES, SCOPES, recordBook } from './records.mjs';

/** A query result as a Record Book board, for record-charts.mjs (ask-query.mjs chartBoard). */
export interface AskChart {
  field: string;
  label: string;
  asc: boolean;
  rows: Array<{ value: number; display: string; name: string; owner: string | null; context: string; year: number | null; rank: number; franchiseId: string | null; entity: { key: null } }>;
  population: Array<Array<number | string | null>>;
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

export interface AskResult {
  answer: string;
  table: AskTable | null;
  /** Plain-words description of every query run, in order. */
  steps: string[];
  /** How far the record went when this was asked ('' once every season is complete). */
  asOf: string;
  /** Record Book boards that hold the record the answer is about. */
  records: AskRecordLink[];
}

export interface AskData {
  /** league-history.json */
  history: any;
  /** league-history-players.json, when the league has one */
  players?: any;
  /** league-history-moves.json: trades, pickups, draft picks, auction wins */
  moves?: any;
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
      show: {
        type: 'integer',
        description: '0-based index of the run_query result whose rows best prove the answer; they are shown under it. -1 for none.',
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

const TOOLS = [RUN_QUERY_TOOL, RECORD_BOOK_TOOL, RECORD_WATCH_TOOL, CALC_TOOL, ANSWER_TOOL];

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

function systemPrompt(leagueSlug: string, ds: any, players: any, moves: any): string {
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
- When a question compares against a specific team or season, query that one too and compare.
- Records are credited to owners: an owner who moved teams keeps one career. Team names are per season.
- Consolation games (toilet bowl, NIT) count as neither regular season nor playoffs. Season W/L/PF are regular season only.
- ${latest && !latest.done ? `The ${latest.y} season is still being played. ${describeAsOf(dataAsOf(ds))}. A ${latest.y} team counts in a "first N games" question only once N of its games are final, so say so when this season's teams could change the answer (for example, a team one win from qualifying). Leave ${latest.y} out of questions about full seasons (complete = true).` : 'Every season in the record is complete.'}
- Use the exact names from results. Match names with contains when the asker uses a nickname or part of a name.
- ${players ? `Player questions use the player units: every rostered player's score each week, starter or bench. A player's points count for the team that started him. ${describeMissingWeeks(players.missingWeeks) ? `${describeMissingWeeks(players.missingWeeks)}; say so when a player answer could be missing those weeks.` : 'Every final week has player scores.'}` : 'There are no player stats for this league; say so if asked.'}
- ${moves ? `Roster moves use the move units: trades (one row per side, with what the players each side got scored for it the rest of that season), pickups (waiver claims and free agents), draftPicks${moves.auctions?.length ? ', auctions (salary auction wins)' : ''}. "Best trade/pickup/pick" means the most points the player(s) scored for the team that got them unless the question says otherwise; say which measure you used. Contract lengths are not on record${moves.auctions?.length ? '; auction salaries are' : ''}.` : 'There are no trade, draft or pickup records for this league; say so if asked.'}
- Always point to the Record Book when a board covers what was asked: read it with record_book, say where the answer stands against the record (it IS the record, or how far short of it), and cite the board in answer.records. For a season in progress, record_watch says who is on pace for a season record.
- When the answer is a ranking or a record, set chart on the query you show, to the field being ranked.
- Keep queries few and focused; then call answer once.

Current teams (owner): ${current}
Every owner on record: ${formerOwners}`;
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
  { client }: { client?: AnthropicLike } = {},
): Promise<AskResult> {
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
    { role: 'user', content: `<question>${question}</question>` },
  ];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await anthropic.messages.create({
      model: SONNET_MODEL,
      max_tokens: 6000,
      output_config: { effort: 'medium' },
      system: [{ type: 'text', text: systemPrompt(leagueSlug, ds, data.players, data.moves), cache_control: { type: 'ephemeral' } }],
      tools: TOOLS,
      messages,
    });

    const uses: any[] = (response?.content ?? []).filter((b: any) => b?.type === 'tool_use');
    const final = uses.find((u) => u.name === ANSWER_TOOL.name);
    if (final) {
      const show = Number(final.input?.show);
      return {
        answer: String(final.input?.answer ?? '').trim(),
        table: Number.isInteger(show) && show >= 0 ? (results[show] ?? null) : null,
        steps,
        asOf,
        records: resolveRecords(ds, final.input?.records),
      };
    }
    if (!uses.length) {
      // Answered in plain text: keep it, with the last table as its receipt.
      const text = responseText(response).trim();
      if (text) return { answer: text, table: results.at(-1) ?? null, steps, asOf, records: [] };
      break;
    }

    messages.push({ role: 'assistant', content: response.content });
    messages.push({
      role: 'user',
      content: uses.map((use) => {
        const reply = (content: unknown) => ({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(content) });
        try {
          if (use.name === RECORD_BOOK_TOOL.name) return reply(recordBookResult(ds, use.input));
          if (use.name === RECORD_WATCH_TOOL.name) return reply(recordWatchResult(ds));
          if (use.name === CALC_TOOL.name) return reply(calcResult(use.input));
          if (use.name !== RUN_QUERY_TOOL.name) {
            return { type: 'tool_result', tool_use_id: use.id, content: 'Unknown tool.', is_error: true };
          }
          const result = runQuery(ds, use.input ?? {}, { players: data.players, moves: data.moves });
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
              columns: result.columns.map((c: { key: string }) => c.key),
              rows: result.rows.map((r: { cells: unknown[] }) => r.cells),
              summary: result.summary,
            }),
          };
        } catch (e) {
          const message = e instanceof QueryError ? e.message : 'The query failed.';
          return { type: 'tool_result', tool_use_id: use.id, content: message, is_error: true };
        }
      }),
    });
  }
  throw new Error('No answer after the maximum number of rounds');
}
