/**
 * Ask Roger for a package league — /api/rules-qa/<slug>.
 *
 * Same handlers as TheLeague's and the AFL's endpoints (createRulesQAHandlers:
 * auth gate, rate limit, stored answers, owner flags), with the prompt built
 * from the league's two sources (src/utils/league-rulebook.ts): its written
 * rulebook first, its MFL settings where that is silent.
 *
 * Only a package league with the "Ask Roger" box ticked is served; anything
 * else is a 404, so this route can never answer for TheLeague or the AFL with
 * the wrong prompt (they keep /api/rules-qa and /api/afl-rules-qa).
 */
import type { APIContext, APIRoute } from 'astro';
import { getLeagueBySlug } from '../../../config/leagues-data.mjs';
import { isPackageLeague } from '../../../config/package-league-routes.mjs';
import { rulesQaKeysFor } from '../../../config/rules-qa-keys.mjs';
import { getLeagueConfig } from '../../../utils/league-config';
import { buildRulesQaPrompt, loadLeagueRulebook } from '../../../utils/league-rulebook';
import { createRulesQAHandlers } from '../../../utils/rules-qa-handlers';

export const prerender = false;

type Handlers = ReturnType<typeof createRulesQAHandlers>;
const cache = new Map<string, Handlers>();

function handlersFor(slug: string | undefined): Handlers | null {
  const league = slug ? getLeagueBySlug(slug) : undefined;
  if (!league || !isPackageLeague(league) || !league.features?.rulesQa) return null;
  const cached = cache.get(league.slug);
  if (cached) return cached;

  const book = loadLeagueRulebook(league);
  const keys = rulesQaKeysFor(league.slug);
  const teams: Array<{ franchiseId: string; name: string }> = getLeagueConfig(league.slug).teams ?? [];
  const handlers = createRulesQAHandlers({
    logTag: `rules-qa:${league.slug}`,
    redisKey: keys.answers,
    rateLimitKeyPrefix: keys.rateLimit,
    flagKeyPrefix: keys.flags,
    idPrefix: `${league.slug}_qa`,
    leagueId: league.id,
    seedData: book.seeds,
    systemPrompt: buildRulesQaPrompt(league, book),
    dateBlockSuffix: 'Do not claim an event is "today" unless its calendar date matches the ISO date above.',
    resolveTeamName: async (franchiseId) => teams.find((t) => t.franchiseId === franchiseId)?.name ?? null,
  });
  cache.set(league.slug, handlers);
  return handlers;
}

const route =
  (method: keyof Handlers): APIRoute =>
  (ctx: APIContext) => {
    const handlers = handlersFor(ctx.params.league);
    if (!handlers) return new Response(JSON.stringify({ error: 'No Ask Roger for that league.' }), { status: 404 });
    return handlers[method](ctx);
  };

export const GET = route('GET');
export const POST = route('POST');
export const PATCH = route('PATCH');
export const DELETE = route('DELETE');
