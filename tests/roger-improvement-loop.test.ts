/**
 * Deterministic coverage for the Ask Roger improvement loop's pure logic
 * (scripts/lib/roger-improvement.ts) and the shared graders
 * (scripts/lib/roger-graders.ts). No network, runs in the normal unit suite.
 *
 * The invariants locked here are the ones that keep the loop trustworthy:
 * seeds are never audited, nothing is graded twice, unreviewed proposals can
 * never reach the golden dataset, and a promotion can never produce a
 * fixture that fails tests/roger-eval-cases.test.ts.
 */

import { describe, it, expect } from 'vitest';
import type { RulesQA } from '../src/types/rules-qa';
import {
  selectAuditTargets,
  recordAudit,
  draftProposedCase,
  isDuplicateQuestion,
  promoteCases,
  ptDateOf,
  type AuditLedger,
  type JudgeFinding,
  type ProposedCase,
  type FixtureCase,
} from '../scripts/lib/roger-improvement';
import { runFormatChecks, runRegexChecks, parseJudgeJson } from '../scripts/lib/roger-graders';

function qa(id: string, overrides: Partial<RulesQA> = {}): RulesQA {
  return {
    id,
    question: `Question for ${id} that is long enough?`,
    answer: 'An answer.\n\n[Read the full rule](/theleague/rules#trades)',
    askedBy: null,
    createdAt: '2026-07-01T18:00:00.000Z',
    isPreSeeded: false,
    ...overrides,
  };
}

const failFinding: JudgeFinding = {
  verdict: 'fail',
  failedDimensions: ['factual-accuracy'],
  reasoning: 'Claimed the cap is $50M; it is $45M.',
  suggestedCategory: 'fact-lookup',
  suggestedReference: 'The salary cap is $45 million.',
  promptSuggestion: null,
};

describe('selectAuditTargets', () => {
  const ledger: AuditLedger = {
    audited: { done: { auditedAt: '2026-07-01T00:00:00Z', verdict: 'pass', failedDimensions: [] } },
  };

  it('skips seeds and already-audited Q&As, oldest first, capped at limit', () => {
    const qas = [
      qa('newest', { createdAt: '2026-07-20T00:00:00Z' }),
      qa('seed', { isPreSeeded: true }),
      qa('done'),
      qa('oldest', { createdAt: '2026-06-01T00:00:00Z' }),
      qa('middle', { createdAt: '2026-06-15T00:00:00Z' }),
    ];
    const targets = selectAuditTargets(qas, ledger, 2);
    expect(targets.map((t) => t.id)).toEqual(['oldest', 'middle']);
  });

  it('returns empty for empty input or zero limit', () => {
    expect(selectAuditTargets([], ledger, 10)).toEqual([]);
    expect(selectAuditTargets([qa('x')], ledger, 0)).toEqual([]);
  });
});

describe('recordAudit', () => {
  it('adds an entry without mutating the original ledger', () => {
    const ledger: AuditLedger = { audited: {} };
    const next = recordAudit(ledger, 'qa_1', 'fail', ['grounding'], '2026-07-25T00:00:00Z');
    expect(next.audited.qa_1.verdict).toBe('fail');
    expect(ledger.audited.qa_1).toBeUndefined();
  });
});

describe('ptDateOf', () => {
  it('converts a UTC timestamp to the PT calendar date', () => {
    // 2026-07-02T02:00Z is still July 1 in Pacific Time.
    expect(ptDateOf('2026-07-02T02:00:00.000Z')).toBe('2026-07-01');
    expect(ptDateOf('2026-07-02T20:00:00.000Z')).toBe('2026-07-02');
  });
});

describe('draftProposedCase', () => {
  it('drafts an unreviewed judged case from the judge finding', () => {
    const proposal = draftProposedCase(qa('qa_abc'), failFinding, '2026-07-25T00:00:00Z');
    expect(proposal.reviewed).toBe(false);
    expect(proposal.case.id).toBe('live-qa_abc');
    expect(proposal.case.judge).toBe(true);
    expect(proposal.case.reference).toBe(failFinding.suggestedReference);
    expect(proposal.case.now).toBeUndefined();
  });

  it('pins the clock for date-handling failures', () => {
    const finding: JudgeFinding = { ...failFinding, failedDimensions: ['date-handling'] };
    const proposal = draftProposedCase(
      qa('qa_date', { createdAt: '2026-04-23T03:00:00.000Z' }),
      finding,
      '2026-07-25T00:00:00Z'
    );
    expect(proposal.case.category).toBe('date-sensitive');
    // 03:00Z on Apr 23 = Apr 22 PT — the "today" Roger actually saw.
    expect(proposal.case.now).toBe('2026-04-22');
  });

  it('falls back to fact-lookup for an invalid suggested category', () => {
    const finding: JudgeFinding = { ...failFinding, suggestedCategory: 'nonsense' };
    expect(draftProposedCase(qa('qa_x'), finding, '2026-07-25T00:00:00Z').case.category).toBe(
      'fact-lookup'
    );
  });
});

describe('isDuplicateQuestion', () => {
  const fixtureCases = [{ id: 'a', category: 'fact-lookup', question: 'What is the salary cap?', judge: false }];

  it('matches ignoring case and punctuation', () => {
    expect(isDuplicateQuestion('what is the salary cap??', fixtureCases as FixtureCase[], [])).toBe(true);
    expect(isDuplicateQuestion('How does the taxi squad work?', fixtureCases as FixtureCase[], [])).toBe(false);
  });
});

describe('promoteCases', () => {
  const reviewedProposal: ProposedCase = {
    id: 'live-qa_ok',
    sourceQaId: 'qa_ok',
    proposedAt: '2026-07-25T00:00:00Z',
    reviewed: true,
    judgeReasoning: 'r',
    promptSuggestion: null,
    case: {
      id: 'live-qa_ok',
      category: 'fact-lookup',
      question: 'A perfectly good question?',
      judge: true,
      reference: 'The correct answer, verified by the commissioner.',
    },
  };

  it('promotes a reviewed proposal and removes it from the queue', () => {
    const result = promoteCases([reviewedProposal], ['live-qa_ok'], []);
    expect(result.errors).toEqual([]);
    expect(result.promoted.map((c) => c.id)).toEqual(['live-qa_ok']);
    expect(result.remainingProposals).toEqual([]);
  });

  it('refuses unreviewed proposals — the human gate is mechanical', () => {
    const unreviewed = { ...reviewedProposal, reviewed: false };
    const result = promoteCases([unreviewed], ['live-qa_ok'], []);
    expect(result.promoted).toEqual([]);
    expect(result.errors[0]).toContain('not reviewed');
    expect(result.remainingProposals).toHaveLength(1);
  });

  it('refuses id collisions with the existing fixture', () => {
    const existing: FixtureCase[] = [{ id: 'live-qa_ok', category: 'fact-lookup', question: 'q?', judge: false }];
    const result = promoteCases([reviewedProposal], ['live-qa_ok'], existing);
    expect(result.promoted).toEqual([]);
    expect(result.errors[0]).toContain('already has a case');
  });

  it('refuses judged cases without a reference and date-sensitive cases without now', () => {
    const noRef = {
      ...reviewedProposal,
      case: { ...reviewedProposal.case, reference: '  ' },
    };
    expect(promoteCases([noRef], ['live-qa_ok'], []).errors[0]).toContain('needs a reference');

    const noNow = {
      ...reviewedProposal,
      case: { ...reviewedProposal.case, category: 'date-sensitive' },
    };
    expect(promoteCases([noNow], ['live-qa_ok'], []).errors[0]).toContain('needs "now"');
  });

  it('reports unknown proposal ids', () => {
    expect(promoteCases([], ['ghost'], []).errors[0]).toContain('no such proposal');
  });
});

describe('shared graders', () => {
  it('passes a well-formed answer', () => {
    const answer = 'The cap is $45 million.\n\n[Read the full rule](/theleague/rules#salary-caps-contracts)';
    const checks = runFormatChecks(answer, ['#salary-caps-contracts']);
    expect(checks.every((c) => c.pass)).toBe(true);
  });

  it('fails a missing link, a non-whitelisted anchor, and a busted word budget', () => {
    expect(
      runFormatChecks('No link here.', ['#trades']).find((c) => c.name === 'format:link-on-last-line')?.pass
    ).toBe(false);

    const badAnchor = 'x\n\n[Read the full rule](/theleague/rules#made-up-section)';
    expect(
      runFormatChecks(badAnchor, ['#trades']).find((c) => c.name === 'format:anchor-in-whitelist')?.pass
    ).toBe(false);

    const tooLong = `${'word '.repeat(400)}\n[Read the full rulebook](/theleague/rules)`;
    expect(runFormatChecks(tooLong, ['#trades']).find((c) => c.name === 'format:word-budget')?.pass).toBe(
      false
    );
  });

  it('runs mustMatch / mustNotMatch as case-insensitive regexes', () => {
    const checks = runRegexChecks('The cap is $45 MILLION.', ['\\$45'], ['\\$80']);
    expect(checks.every((c) => c.pass)).toBe(true);
    expect(runRegexChecks('nope', ['\\$45'])[0].pass).toBe(false);
  });

  it('parses judge JSON with and without code fences', () => {
    expect(parseJudgeJson<{ pass: boolean }>('{"pass": true}')).toEqual({ pass: true });
    expect(parseJudgeJson<{ pass: boolean }>('```json\n{"pass": false}\n```')).toEqual({ pass: false });
    expect(parseJudgeJson('not json')).toBeNull();
  });
});
