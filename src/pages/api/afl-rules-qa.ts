/**
 * AFL Rules Q&A API Endpoint — "Ask Roger" for AFL Fantasy
 *
 * Thin wrapper over the shared factory in `src/utils/rules-qa-handlers.ts`.
 */

import { createRulesQAHandlers } from '../../utils/rules-qa-handlers';
import seedData from '../../data/afl-rules-qa-seeds.json';
import { AFL_CONSTITUTION } from '../../data/afl-constitution';
import { rogerPrompt } from '../../utils/roger-prompts';
import { LEAGUES } from '../../config/leagues-data.mjs';
import { RULES_QA_KEYS } from '../../config/rules-qa-keys.mjs';
import aflConfig from '../../../data/afl-fantasy/afl.config.json';
import type { RulesQA } from '../../types/rules-qa';

// Roger's instructions live in the private beat-reporter pack
// (prompts/roger/afl.md); the constitution stays public.
const SYSTEM_PROMPT = rogerPrompt('afl', { CONSTITUTION: AFL_CONSTITUTION });

const aflLeague = LEAGUES['afl-fantasy'];
const aflTeams: Array<{ franchiseId: string; name: string }> = aflConfig.teams ?? [];

async function resolveTeamName(franchiseId: string): Promise<string | null> {
  return aflTeams.find((t) => t.franchiseId === franchiseId)?.name ?? null;
}

export const { GET, POST, PATCH, DELETE } = createRulesQAHandlers({
  logTag: 'afl-rules-qa',
  redisKey: RULES_QA_KEYS['afl-fantasy'].answers,
  rateLimitKeyPrefix: RULES_QA_KEYS['afl-fantasy'].rateLimit,
  flagKeyPrefix: RULES_QA_KEYS['afl-fantasy'].flags,
  idPrefix: 'afl_qa',
  leagueId: aflLeague.id,
  seedData: seedData as RulesQA[],
  systemPrompt: SYSTEM_PROMPT,
  dateBlockSuffix: 'Do not claim an event is "today" unless its calendar date matches the ISO date above.',
  resolveTeamName,
});
