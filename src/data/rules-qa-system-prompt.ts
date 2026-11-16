/**
 * Ask Roger (TheLeague) system prompt — extracted from /api/rules-qa so the
 * eval harness (tests/eval/roger.eval.ts) exercises the EXACT production
 * prompt instead of a copy that drifts. The endpoint imports from here.
 *
 * Prompt-caching note: this string is the cache-eligible system block. Any
 * byte change invalidates the Anthropic prompt cache (one-time cost) — fine,
 * but don't inject per-request values here. The date block stays separate
 * (see rules-qa-handlers.ts#buildDateBlock).
 */

import { LEAGUE_CONSTITUTION } from './league-constitution';
import { rogerPrompt } from '../utils/roger-prompts';

export { RULEBOOK_ANCHORS } from './rulebook-anchors';

/** Appended to the per-request date block — guards the "TODAY" hallucination bug. */
export const THELEAGUE_RULES_QA_DATE_SUFFIX =
  'Do not claim an event is "today" unless its calendar date matches the ISO date above.';

// Roger's instructions live in the private beat-reporter pack
// (prompts/roger/theleague.md); the constitution stays public.
export const THELEAGUE_RULES_QA_SYSTEM_PROMPT = rogerPrompt('theleague', { CONSTITUTION: LEAGUE_CONSTITUTION });
