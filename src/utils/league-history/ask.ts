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
import { QueryError, querySchema, runQuery } from './ask-query.mjs';

export interface AskTable {
  description: string;
  total: number;
  columns: Array<{ key: string; label: string }>;
  rows: Array<{ cells: Array<string | number | boolean | null>; franchiseId: string | null; ownerSlug: string | null; year: number | null }>;
  summary: Record<string, { min: number; max: number; avg: number; sum: number } | null>;
}

export interface AskResult {
  answer: string;
  table: AskTable | null;
  /** Plain-words description of every query run, in order. */
  steps: string[];
}

interface AnthropicLike {
  messages: { create: (body: Record<string, unknown>) => Promise<any> };
}

const MAX_ROUNDS = 6;

const RUN_QUERY_TOOL = {
  name: 'run_query',
  description:
    "Run one query over the league's complete game and season record. Returns the matching rows (up to limit), the total number of matches, and any summaries. Every number you state must come from a result of this tool.",
  input_schema: querySchema(),
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
          'One to three plain sentences. Lead with the direct answer (yes/no, the name, the number), then the one or two facts that back it. No markdown, no lists.',
      },
      show: {
        type: 'integer',
        description: '0-based index of the run_query result whose rows best prove the answer; they are shown under it. -1 for none.',
      },
    },
    required: ['answer', 'show'],
  },
};

function systemPrompt(leagueSlug: string, ds: any): string {
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

You can only know what run_query returns. Never answer from memory, never estimate, never invent a number, team or owner. If the data cannot answer the question (player stats, trades, drafts, anything not in the fields), say so plainly in the answer and set show to -1.

How to work:
- Translate the question into one or more queries. "Started 9-1" means seasons with throughGames: 10, w = 9, l = 1. "Fewer points" with no comparison named means the fewest points in the same window (pf), and you should say which window you used.
- For "has anyone ever / how many times" questions, rely on total, not on the rows shown.
- When a question compares against a specific team or season, query that one too and compare.
- Records are credited to owners: an owner who moved teams keeps one career. Team names are per season.
- Consolation games (toilet bowl, NIT) count as neither regular season nor playoffs. Season W/L/PF are regular season only.
- ${latest && !latest.done ? `The ${latest.y} season is still being played; say so when it matters, and leave it out of "ever" questions about full seasons (complete = true).` : 'Every season in the record is complete.'}
- Use the exact names from results. Match names with contains when the asker uses a nickname or part of a name.
- Keep queries few and focused; then call answer once.

Current teams (owner): ${current}
Every owner on record: ${formerOwners}`;
}

/**
 * Answer one question. `ds` is the league's league-history.json.
 * Throws when the model is unavailable, so the endpoint can say so instead of
 * returning a guess.
 */
export async function askHistory(
  leagueSlug: string,
  ds: any,
  question: string,
  { client }: { client?: AnthropicLike } = {},
): Promise<AskResult> {
  let anthropic = client;
  if (!anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    anthropic = new Anthropic({ apiKey }) as unknown as AnthropicLike;
  }

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
      system: [{ type: 'text', text: systemPrompt(leagueSlug, ds), cache_control: { type: 'ephemeral' } }],
      tools: [RUN_QUERY_TOOL, ANSWER_TOOL],
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
      };
    }
    if (!uses.length) {
      // Answered in plain text: keep it, with the last table as its receipt.
      const text = responseText(response).trim();
      if (text) return { answer: text, table: results.at(-1) ?? null, steps };
      break;
    }

    messages.push({ role: 'assistant', content: response.content });
    messages.push({
      role: 'user',
      content: uses.map((use) => {
        if (use.name !== RUN_QUERY_TOOL.name) {
          return { type: 'tool_result', tool_use_id: use.id, content: 'Unknown tool.', is_error: true };
        }
        try {
          const result = runQuery(ds, use.input ?? {});
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
