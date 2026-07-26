/**
 * Pure logic for the Ask Roger improvement loop — everything here is
 * side-effect-free so tests/roger-improvement-loop.test.ts can cover the
 * ledger/selection/promotion invariants without network or filesystem.
 *
 * The I/O shell around this lives in scripts/roger-improvement-loop.ts.
 */

import type { RulesQA } from '../../src/types/rules-qa';

export const EVAL_CATEGORIES = [
  'fact-lookup',
  'multi-rule',
  'date-sensitive',
  'strategy-refusal',
  'calc-redirect',
  'not-in-constitution',
  'injection',
] as const;

export type EvalCategory = (typeof EVAL_CATEGORIES)[number];

export const RUBRIC_DIMENSIONS = [
  'factual-accuracy',
  'grounding',
  'scope-discipline',
  'date-handling',
] as const;

export interface AuditLedger {
  $comment?: string;
  audited: Record<
    string,
    { auditedAt: string; verdict: 'pass' | 'fail'; failedDimensions: string[] }
  >;
}

export interface JudgeFinding {
  verdict: 'pass' | 'fail';
  failedDimensions: string[];
  reasoning: string;
  suggestedCategory: string;
  suggestedReference: string;
  promptSuggestion: string | null;
}

export interface FixtureCase {
  id: string;
  category: string;
  question: string;
  mustMatch?: string[];
  mustNotMatch?: string[];
  expectedAnchor?: string;
  judge: boolean;
  reference?: string;
  now?: string;
}

export interface ProposedCase {
  /** Same id the fixture case will get on promotion. */
  id: string;
  sourceQaId: string;
  proposedAt: string;
  /** Flipped to true by a HUMAN after verifying/editing the reference. Promotion refuses otherwise. */
  reviewed: boolean;
  judgeReasoning: string;
  promptSuggestion: string | null;
  case: FixtureCase;
}

/**
 * Pick which stored Q&As to audit this run: real owner questions only
 * (never seeds), never re-audited, oldest first so the backlog drains
 * deterministically, capped at `limit` to bound per-run spend.
 */
export function selectAuditTargets(qas: RulesQA[], ledger: AuditLedger, limit: number): RulesQA[] {
  const audited = ledger.audited ?? {};
  const sortKey = (iso: string): number => {
    const t = new Date(iso).getTime();
    // Undated/garbage records sort last rather than poisoning the comparator.
    return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
  };
  return qas
    .filter(
      (qa) =>
        qa &&
        typeof qa.id === 'string' &&
        typeof qa.question === 'string' &&
        typeof qa.answer === 'string' &&
        !qa.isPreSeeded &&
        // Own-property check: a Q&A id of "constructor" must not read as audited.
        !Object.hasOwn(audited, qa.id)
    )
    .sort((a, b) => sortKey(a.createdAt) - sortKey(b.createdAt))
    .slice(0, Math.max(0, limit));
}

/** Record a finished audit in the ledger (returns a new ledger object). */
export function recordAudit(
  ledger: AuditLedger,
  qaId: string,
  verdict: 'pass' | 'fail',
  failedDimensions: string[],
  auditedAt: string
): AuditLedger {
  return {
    ...ledger,
    audited: {
      ...ledger.audited,
      [qaId]: { auditedAt, verdict, failedDimensions },
    },
  };
}

/**
 * PT calendar date (YYYY-MM-DD) for an ISO timestamp — the "today" Roger saw.
 * Returns null for a missing/garbage timestamp: `Intl.format` throws a
 * RangeError on an invalid Date, and one bad Redis record must not take down
 * a whole audit run.
 */
export function ptDateOf(isoTimestamp: string): string | null {
  const d = new Date(isoTimestamp);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * Draft a golden-dataset case from a failed audit. The judge's category and
 * reference are STARTING POINTS — a human must verify (and usually edit)
 * the reference before flipping `reviewed` and promoting. Ground truth
 * stays human-owned.
 */
export function draftProposedCase(qa: RulesQA, finding: JudgeFinding, proposedAt: string): ProposedCase {
  const category = (EVAL_CATEGORIES as readonly string[]).includes(finding.suggestedCategory)
    ? finding.suggestedCategory
    : 'fact-lookup';

  const fixtureCase: FixtureCase = {
    id: `live-${qa.id}`,
    category,
    question: qa.question,
    judge: true,
    reference: finding.suggestedReference,
  };
  // Date-sensitive behavior only reproduces with the clock Roger actually had.
  // Without a usable timestamp the case can't be date-sensitive (promotion
  // would reject it), so leave it in its content category for human triage.
  if (category === 'date-sensitive' || finding.failedDimensions.includes('date-handling')) {
    const now = ptDateOf(qa.createdAt);
    if (now) {
      fixtureCase.category = 'date-sensitive';
      fixtureCase.now = now;
    }
  }

  return {
    id: fixtureCase.id,
    sourceQaId: qa.id,
    proposedAt,
    reviewed: false,
    judgeReasoning: finding.reasoning,
    promptSuggestion: finding.promptSuggestion,
    case: fixtureCase,
  };
}

/** True when this question is already represented in the fixture or the proposal queue. */
export function isDuplicateQuestion(
  question: string,
  fixtureCases: FixtureCase[],
  proposals: ProposedCase[]
): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const q = norm(question);
  return (
    fixtureCases.some((c) => norm(c.question) === q) ||
    proposals.some((p) => norm(p.case.question) === q)
  );
}

export interface PromotionResult {
  promoted: FixtureCase[];
  remainingProposals: ProposedCase[];
  errors: string[];
}

/**
 * Promote reviewed proposals into the golden dataset. Enforces the same
 * invariants the CI meta-test checks, so a promotion can never produce a
 * fixture that fails `pnpm test:unit`:
 *   - proposal must exist and be human-reviewed
 *   - id must not collide with an existing fixture case
 *   - category must be valid; judged cases need a non-empty reference
 */
export function promoteCases(
  proposals: ProposedCase[],
  ids: string[],
  fixtureCases: FixtureCase[],
  anchors: readonly string[] = []
): PromotionResult {
  const promoted: FixtureCase[] = [];
  const errors: string[] = [];
  const promotedIds = new Set<string>();

  for (const id of ids) {
    const proposal = proposals.find((p) => p.id === id);
    if (!proposal) {
      errors.push(`${id}: no such proposal`);
      continue;
    }
    if (!proposal.reviewed) {
      errors.push(`${id}: not reviewed — verify/edit the reference and set "reviewed": true first`);
      continue;
    }
    if (fixtureCases.some((c) => c.id === id) || promotedIds.has(id)) {
      errors.push(`${id}: fixture already has a case with this id`);
      continue;
    }
    if (!(EVAL_CATEGORIES as readonly string[]).includes(proposal.case.category)) {
      errors.push(`${id}: invalid category "${proposal.case.category}"`);
      continue;
    }
    if (proposal.case.judge && !proposal.case.reference?.trim()) {
      errors.push(`${id}: judged case needs a reference`);
      continue;
    }
    if (proposal.case.category === 'date-sensitive' && !proposal.case.now) {
      errors.push(`${id}: date-sensitive case needs "now"`);
      continue;
    }
    // The remaining checks mirror tests/roger-eval-cases.test.ts. A human edits
    // the reference (and sometimes the graders) before promoting, so these can
    // genuinely be violated — without them a promotion could red the CI suite.
    const q = proposal.case.question?.trim() ?? '';
    if (q.length < 10 || proposal.case.question.length > 500) {
      errors.push(`${id}: question must be 10-500 characters (got ${proposal.case.question.length})`);
      continue;
    }
    const patterns = [...(proposal.case.mustMatch ?? []), ...(proposal.case.mustNotMatch ?? [])];
    const badPattern = patterns.find((p) => {
      try {
        new RegExp(p, 'im');
        return false;
      } catch {
        return true;
      }
    });
    if (badPattern !== undefined) {
      errors.push(`${id}: invalid regex ${JSON.stringify(badPattern)}`);
      continue;
    }
    if (proposal.case.expectedAnchor && !anchors.includes(proposal.case.expectedAnchor)) {
      errors.push(`${id}: expectedAnchor "${proposal.case.expectedAnchor}" is not in RULEBOOK_ANCHORS`);
      continue;
    }
    if (!proposal.case.judge && patterns.length === 0) {
      errors.push(`${id}: non-judged case needs at least one mustMatch/mustNotMatch grader`);
      continue;
    }
    if (proposal.case.now && !/^\d{4}-\d{2}-\d{2}$/.test(proposal.case.now)) {
      errors.push(`${id}: "now" must be YYYY-MM-DD`);
      continue;
    }
    promoted.push(proposal.case);
    promotedIds.add(id);
  }

  return {
    promoted,
    remainingProposals: proposals.filter((p) => !promotedIds.has(p.id)),
    errors,
  };
}
