import type { RuleProposal } from './types';
import { THELEAGUE_RULE_PROPOSALS } from './theleague';

export type { RuleProposal } from './types';

/** Leagues with a Rule Proposals page, keyed by registry slug. */
const BY_LEAGUE: Record<string, RuleProposal[]> = {
  theleague: THELEAGUE_RULE_PROPOSALS,
};

export function ruleProposalsFor(slug: string): RuleProposal[] {
  return BY_LEAGUE[slug] ?? [];
}

export function findRuleProposal(slug: string, id: string): RuleProposal | undefined {
  return ruleProposalsFor(slug).find((p) => p.id === id);
}
