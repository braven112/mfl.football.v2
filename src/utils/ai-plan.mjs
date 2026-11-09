/**
 * Which Claude model a league's AI features run on, by the plan it bought
 * (Brandon, 2026-11-09):
 *
 *   history  League History tier: Claude Haiku. Most leagues ask a handful of
 *            questions a year, so Haiku keeps AI inside that tier's price.
 *   custom   Full custom sites (TheLeague, the AFL, and any league that buys
 *            one, such as Sandbox or Archie's): Claude Sonnet.
 *
 * A league's plan is the registry's `plan` field (src/config/leagues-data.mjs).
 * Every league that names none, and every MFL league outside the registry, is
 * on `history`, so a league is upgraded by adding `plan: 'custom'` to its
 * entry and nothing else. Signed-out demo visitors always get the `history`
 * model: they are trying what a League History league gets.
 *
 * Ask the History keeps thinking ON for Haiku (adaptive, effort medium), unlike
 * the short-copy calls that send HAIKU_THINKING: turning a question into the
 * right query is reasoning, and Haiku's thinking tokens are cheap.
 *
 * Scope today: Ask the History. Roger, Schefter and the GroupMe rewrite keep
 * their own models (claude-models.mjs) until they are moved here on purpose.
 */
import { HAIKU_MODEL, SONNET_MODEL } from './claude-models.mjs';
import { LEAGUES } from '../config/leagues-data.mjs';

/** @typedef {'history' | 'custom'} AiPlan */

/** @type {Record<AiPlan, { model: string, label: string }>} */
export const AI_PLANS = {
  history: { model: HAIKU_MODEL, label: 'League History' },
  custom: { model: SONNET_MODEL, label: 'Full custom site' },
};

/** The plan a league is on; `history` for any league the registry does not mark custom. */
export function leaguePlan(slug) {
  const entry = slug ? /** @type {any} */ (LEAGUES)[slug] : null;
  return entry?.plan === 'custom' ? 'custom' : 'history';
}

/** The model a league's AI features call. `guest` (a signed-out demo visitor) always gets the history model. */
export function aiModelForLeague(slug, { guest = false } = {}) {
  return AI_PLANS[guest ? 'history' : leaguePlan(slug)].model;
}

/**
 * US dollars per million tokens, Anthropic first-party rates (Nov 2026).
 * Cache writes are the standard 1.25x of input (5-minute cache), cache reads 0.1x.
 */
/** @type {Record<string, { input: number, output: number, cacheWrite: number, cacheRead: number }>} */
export const MODEL_PRICES = {
  [HAIKU_MODEL]: { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
  [SONNET_MODEL]: { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
};

/** An empty usage tally, to add each response's `usage` into. */
export function emptyUsage(model) {
  return { model, rounds: 0, inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 };
}

/** Add one Messages API response's `usage` to a tally (mutates and returns it). */
export function addUsage(tally, usage) {
  tally.rounds += 1;
  tally.inputTokens += Number(usage?.input_tokens) || 0;
  tally.outputTokens += Number(usage?.output_tokens) || 0;
  tally.cacheWriteTokens += Number(usage?.cache_creation_input_tokens) || 0;
  tally.cacheReadTokens += Number(usage?.cache_read_input_tokens) || 0;
  return tally;
}

/** What a tally cost in US dollars, or null for a model with no price on file. */
export function usageCost(tally) {
  const price = MODEL_PRICES[tally?.model];
  if (!price) return null;
  return (
    (tally.inputTokens * price.input +
      tally.outputTokens * price.output +
      tally.cacheWriteTokens * price.cacheWrite +
      tally.cacheReadTokens * price.cacheRead) /
    1e6
  );
}
