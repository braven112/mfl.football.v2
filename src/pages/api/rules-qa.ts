/**
 * Rules Q&A API Endpoint — "Ask Roger" for TheLeague
 *
 * Thin wrapper over the shared factory in `src/utils/rules-qa-handlers.ts`.
 * Adding another league = a parallel endpoint file with its own config.
 */

import { createRulesQAHandlers } from '../../utils/rules-qa-handlers';
import seedData from '../../data/rules-qa-seeds.json';
import {
  THELEAGUE_RULES_QA_SYSTEM_PROMPT,
  THELEAGUE_RULES_QA_DATE_SUFFIX,
} from '../../data/rules-qa-system-prompt';
import { LEAGUES } from '../../config/leagues-data.mjs';
import { RULES_QA_KEYS } from '../../config/rules-qa-keys.mjs';
import type { RulesQA } from '../../types/rules-qa';

// System prompt lives in src/data/rules-qa-system-prompt.ts so the eval
// harness (tests/eval/roger.eval.ts) tests the exact production prompt.
const SYSTEM_PROMPT = THELEAGUE_RULES_QA_SYSTEM_PROMPT;

async function resolveTeamName(franchiseId: string): Promise<string | null> {
  try {
    const config = await import('../../data/theleague.config.json');
    const teams: Array<{ franchiseId: string; name: string }> =
      (config as { default?: { teams?: Array<{ franchiseId: string; name: string }> } }).default?.teams
      ?? (config as { teams?: Array<{ franchiseId: string; name: string }> }).teams
      ?? [];
    return teams.find((t) => t.franchiseId === franchiseId)?.name ?? null;
  } catch {
    return null;
  }
}

export const { GET, POST, PATCH, DELETE } = createRulesQAHandlers({
  logTag: 'rules-qa',
  redisKey: RULES_QA_KEYS.theleague.answers,
  rateLimitKeyPrefix: RULES_QA_KEYS.theleague.rateLimit,
  flagKeyPrefix: RULES_QA_KEYS.theleague.flags,
  idPrefix: 'qa',
  leagueId: LEAGUES.theleague.id,
  seedData: seedData as RulesQA[],
  systemPrompt: SYSTEM_PROMPT,
  dateBlockSuffix: THELEAGUE_RULES_QA_DATE_SUFFIX,
  resolveTeamName,
});
