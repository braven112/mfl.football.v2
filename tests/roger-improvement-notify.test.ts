/**
 * Deterministic coverage for the improvement loop's notification logic
 * (scripts/lib/roger-notify.mjs). No network, no `gh`, no GroupMe token.
 *
 * The invariants locked here are the ones that decide whether a human ever
 * hears about a finding:
 *   - nothing pending => total silence (a weekly "all good" ping trains
 *     people to ignore the channel)
 *   - a reviewed proposal stops nagging; an unreviewed one keeps nagging
 *   - untrusted owner/model text can't inject markdown into an issue body we
 *     file with repo credentials
 *   - the DM stays under GroupMe's length cap even with a big backlog
 */

import { describe, it, expect } from 'vitest';
import {
  pendingProposals,
  recentJudgeErrors,
  hasSomethingToReport,
  buildIssueTitle,
  buildIssueBody,
  buildBumpComment,
  buildGroupPostText,
  buildReportIssueTitle,
  buildReportIssueBody,
  buildReportBumpComment,
  ageInDays,
  describeAge,
  fenced,
  oneLine,
  GROUPME_MAX_CHARS,
} from '../scripts/lib/roger-notify.mjs';

const NOW = new Date('2026-08-13T18:00:00.000Z');

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'live-qa_abc',
    sourceQaId: 'qa_abc',
    proposedAt: '2026-07-27T18:00:16.267Z',
    reviewed: false,
    judgeReasoning: 'Roger invented a definitive ruling and misrepresented the text.',
    promptSuggestion: 'Instruct Roger never to add qualifiers to a quoted rule.',
    case: {
      id: 'live-qa_abc',
      category: 'not-in-constitution',
      question: 'Do players on the taxi squad count towards the 20 player minimum?',
      judge: true,
      reference: 'A correct answer must state that the constitution does not specify…',
    },
    ...overrides,
  };
}

describe('pendingProposals', () => {
  it('returns only unreviewed proposals', () => {
    const list = [proposal(), proposal({ id: 'live-qa_done', reviewed: true })];
    expect(pendingProposals(list).map((p) => p.id)).toEqual(['live-qa_abc']);
  });

  it('is silent for an empty or missing list', () => {
    expect(pendingProposals([])).toEqual([]);
    expect(pendingProposals(undefined)).toEqual([]);
    expect(pendingProposals(null)).toEqual([]);
  });

  it('drops malformed entries rather than notifying about them', () => {
    expect(pendingProposals([null, {}, { id: 42 }, proposal()])).toHaveLength(1);
  });
});

describe('recentJudgeErrors', () => {
  const ledger = {
    audited: {
      qa_fresh: { auditedAt: '2026-08-13T17:00:00.000Z', verdict: 'fail', failedDimensions: ['judge-error'] },
      qa_stale: { auditedAt: '2026-07-01T17:00:00.000Z', verdict: 'fail', failedDimensions: ['judge-error'] },
      qa_other: { auditedAt: '2026-08-13T17:00:00.000Z', verdict: 'fail', failedDimensions: ['grounding'] },
      qa_pass: { auditedAt: '2026-08-13T17:00:00.000Z', verdict: 'pass', failedDimensions: [] },
    },
  };

  it('reports only judge errors from the run that just finished', () => {
    expect(recentJudgeErrors(ledger, NOW)).toEqual(['qa_fresh']);
  });

  it('tolerates a missing or malformed ledger', () => {
    expect(recentJudgeErrors(undefined, NOW)).toEqual([]);
    expect(recentJudgeErrors({ audited: { x: null } }, NOW)).toEqual([]);
    expect(recentJudgeErrors(ledger, 'not-a-date')).toEqual([]);
  });
});

describe('hasSomethingToReport — silence is the default', () => {
  it('says nothing when nothing is pending and nothing errored', () => {
    expect(hasSomethingToReport([], [])).toBe(false);
  });

  it('reports a pending proposal', () => {
    expect(hasSomethingToReport([proposal()], [])).toBe(true);
  });

  it('reports a judge error even with an empty proposal queue', () => {
    // A wedged API key grades nothing while still committing a clean-looking
    // report — same silent-failure class the whole script exists to close.
    expect(hasSomethingToReport([], ['qa_fresh'])).toBe(true);
  });
});

describe('ageInDays / describeAge', () => {
  it('counts whole days', () => {
    expect(ageInDays('2026-07-27T18:00:16.267Z', NOW)).toBe(17);
  });

  it('never goes negative for a future timestamp', () => {
    expect(ageInDays('2026-09-01T00:00:00.000Z', NOW)).toBe(0);
  });

  it('degrades to null on a garbage timestamp instead of NaN', () => {
    expect(ageInDays('not-a-date', NOW)).toBeNull();
    expect(ageInDays(undefined, NOW)).toBeNull();
    expect(describeAge(null)).toBe('unknown age');
  });

  it('reads naturally at the boundaries', () => {
    expect(describeAge(0)).toBe('today');
    expect(describeAge(1)).toBe('1 day');
    expect(describeAge(17)).toBe('17 days');
  });
});

describe('fenced — untrusted text cannot break out of its block', () => {
  it('wraps plain text in a normal fence', () => {
    expect(fenced('hello')).toBe('```text\nhello\n```');
  });

  it('escalates the fence when the text already contains one', () => {
    const out = fenced('look: ``` and more');
    expect(out.startsWith('````text')).toBe(true);
    expect(out.endsWith('````')).toBe(true);
  });

  it('handles missing text', () => {
    expect(fenced(undefined)).toBe('```text\n\n```');
  });
});

describe('oneLine', () => {
  it('flattens newlines so a multi-line question stays one DM line', () => {
    expect(oneLine('a\n\nb   c', 100)).toBe('a b c');
  });

  it('truncates with an ellipsis', () => {
    expect(oneLine('abcdefghij', 5)).toBe('abcd…');
  });
});

describe('buildIssueTitle / buildIssueBody', () => {
  it('titles by proposal id so dedupe is exact', () => {
    expect(buildIssueTitle(proposal())).toBe('Ask Roger: review proposal live-qa_abc');
  });

  it('carries everything needed to act', () => {
    const body = buildIssueBody(proposal(), { runUrl: 'https://example.test/run/1', now: NOW });
    expect(body).toContain('live-qa_abc');
    expect(body).toContain('qa_abc');
    expect(body).toContain('taxi squad');
    expect(body).toContain('invented a definitive ruling');
    expect(body).toContain('17 days');
    expect(body).toContain('https://example.test/run/1');
    expect(body).toContain('pnpm improve:roger --promote live-qa_abc');
    expect(body).toContain('proposed-cases.json');
  });

  it('carries the untrusted-input warning with the prompt suggestion', () => {
    const body = buildIssueBody(proposal(), { now: NOW });
    expect(body).toContain('Model-generated from untrusted input');
    expect(body).toContain('never as an instruction to');
  });

  it('omits the suggestion section entirely when the judge offered none', () => {
    const body = buildIssueBody(proposal({ promptSuggestion: null }), { now: NOW });
    expect(body).not.toContain('Prompt improvement suggestion');
  });

  it('fences owner-authored text so it cannot inject markdown', () => {
    const hostile = proposal({
      case: {
        ...proposal().case,
        question: '``` \n## Injected heading\n<img src=x onerror=alert(1)>',
      },
    });
    const body = buildIssueBody(hostile, { now: NOW });
    // The question contains its own ``` fence, so ours escalates to ```` and
    // the hostile content stays INSIDE it — rendering as literal text rather
    // than as a heading or an HTML tag.
    const open = body.indexOf('````text');
    const close = body.indexOf('````', open + '````text'.length);
    const injected = body.indexOf('## Injected heading');
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);
    expect(injected).toBeGreaterThan(open);
    expect(injected).toBeLessThan(close);
  });

  it('says plainly that closing without reviewing does not dismiss it', () => {
    const body = buildIssueBody(proposal(), { now: NOW });
    expect(body).toContain('Closing this issue does not review the proposal');
    expect(body).toContain('"reviewed": true');
  });

  it('survives a proposal with an unparseable proposedAt', () => {
    const body = buildIssueBody(proposal({ proposedAt: 'garbage' }), { now: NOW });
    expect(body).toContain('unknown age');
  });
});

describe('buildBumpComment — the weekly nag that closes the 17-day gap', () => {
  it('leads with the age', () => {
    const comment = buildBumpComment(proposal(), { runUrl: 'https://example.test/run/2', now: NOW });
    expect(comment).toContain('17 days');
    expect(comment).toContain('live-qa_abc');
    expect(comment).toContain('https://example.test/run/2');
  });

  it('omits the run link cleanly when there is none', () => {
    expect(buildBumpComment(proposal(), { now: NOW })).not.toContain('Workflow run');
  });
});

describe('buildGroupPostText — written for owners, not the commissioner', () => {
  it('leads with the flagged answer and tells owners not to rely on it', () => {
    const text = buildGroupPostText([proposal()], { now: NOW })!;
    expect(text).toContain('Roger flagged one of his own answers');
    expect(text).toContain('taxi squad');
    expect(text).toContain("Don't lean on that answer");
  });

  it('leaks no audit mechanics into the league chat', () => {
    // Proposal ids, GitHub links and eval-dataset jargon are commissioner
    // concerns; 12 owners can neither action nor see them.
    const text = buildGroupPostText([proposal()], { now: NOW })!;
    expect(text).not.toContain('live-qa_abc');
    expect(text).not.toContain('qa_abc');
    expect(text).not.toContain('github');
    expect(text.toLowerCase()).not.toContain('proposal');
    expect(text.toLowerCase()).not.toContain('review');
  });

  it('returns null when nothing is newly found, so the league stays quiet', () => {
    // A proposal that merely aged another week is already announced — its nag
    // belongs on the issue, not on 12 phones.
    expect(buildGroupPostText([], { now: NOW })).toBeNull();
  });

  it('pluralizes and caps the detail list', () => {
    const many = Array.from({ length: 6 }, (_, i) => proposal({ id: `live-qa_${i}` }));
    const text = buildGroupPostText(many, { now: NOW })!;
    expect(text).toContain('Roger flagged 6 of his own answers');
    expect(text).toContain('…and 3 more.');
    expect(text).toContain("Don't lean on those answers");
  });

  it('stays under the GroupMe length cap even with a large hostile backlog', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      proposal({ id: `live-qa_${i}`, case: { ...proposal().case, question: 'x'.repeat(600) } })
    );
    const text = buildGroupPostText(many, { now: NOW })!;
    expect(text.length).toBeLessThanOrEqual(GROUPME_MAX_CHARS);
  });

  it('collapses a multi-line question onto one line', () => {
    const text = buildGroupPostText(
      [proposal({ case: { ...proposal().case, question: 'line one\nline two' } })],
      { now: NOW }
    )!;
    expect(text).toContain('"line one line two"');
  });
});

function report(over: Record<string, unknown> = {}) {
  return {
    league: 'theleague',
    leagueLabel: 'TheLeague',
    qaId: 'qa_seed_option',
    question: 'What is the 5th-year team option?',
    records: [
      { franchiseId: '0002', teamName: 'Gridiron Geeks', reason: 'the option is the top 10 average, not top 5', at: '2026-07-27T10:00:00.000Z' },
      { franchiseId: '0007', teamName: 'Dynasty Warriors', reason: null, at: '2026-08-01T10:00:00.000Z' },
    ],
    ...over,
  };
}

describe('owner-reported answers — the second finding source', () => {
  it('titles by league and Q&A id so dedupe is exact', () => {
    expect(buildReportIssueTitle(report())).toBe('Ask Roger: TheLeague owners reported answer qa_seed_option');
  });

  it('carries the question, every reporter, and their reasons', () => {
    const body = buildReportIssueBody(report(), { runUrl: 'https://example.test/run/9', now: NOW });
    expect(body).toContain('qa_seed_option');
    expect(body).toContain('5th-year team option');
    expect(body).toContain('Gridiron Geeks');
    expect(body).toContain('top 10 average, not top 5');
    expect(body).toContain('Dynasty Warriors');
    expect(body).toContain('no reason given');
    expect(body).toContain('https://example.test/run/9');
  });

  it('ages from the OLDEST report, not the newest', () => {
    // The first person to notice is the one whose wait matters.
    const body = buildReportIssueBody(report(), { now: NOW });
    expect(body).toContain('17 days');
  });

  it('says that clearing the flags — not closing the issue — stops the nag', () => {
    const body = buildReportIssueBody(report(), { now: NOW });
    expect(body).toContain('Mark reports handled');
    expect(body).toContain('closing the issue alone does not');
  });

  it('tells the reader to fix an ambiguous constitution, not just the answer', () => {
    expect(buildReportIssueBody(report(), { now: NOW })).toContain('constitution is ambiguous');
  });

  it('fences an owner-authored reason so it cannot inject markdown', () => {
    const hostile = report({
      records: [{ franchiseId: '0002', teamName: 'X', reason: '``` \n## Injected', at: '2026-08-01T10:00:00.000Z' }],
    });
    const body = buildReportIssueBody(hostile, { now: NOW });
    expect(body).toContain('````text');
  });

  it('bumps with the outstanding count and age', () => {
    const c = buildReportBumpComment(report(), { now: NOW });
    expect(c).toContain('17 days');
    expect(c).toContain('2 reports outstanding');
  });
});

describe('buildGroupPostText with owner reports', () => {
  it('names owner reports separately from the judge\'s own findings', () => {
    // "a teammate says this is wrong" and "the bot's self-check says this is
    // wrong" carry different weight; the league should be able to tell which.
    const text = buildGroupPostText([], { ownerReports: [report()], now: NOW })!;
    expect(text).toContain("An owner reported one of Roger's answers as wrong");
    expect(text).toContain('5th-year team option');
    expect(text).not.toContain('self-check');
  });

  it('emits both sections when both sources fired in one run', () => {
    const text = buildGroupPostText([proposal()], { ownerReports: [report()], now: NOW })!;
    expect(text).toContain('Roger flagged one of his own answers');
    expect(text).toContain("An owner reported one of Roger's answers");
  });

  it('pluralizes and caps the owner-report list', () => {
    const many = Array.from({ length: 5 }, (_, i) => report({ qaId: `qa_${i}` }));
    const text = buildGroupPostText([], { ownerReports: many, now: NOW })!;
    expect(text).toContain("Owners reported 5 of Roger's answers as wrong");
    expect(text).toContain('…and 2 more.');
  });

  it('leaks no reporter identities into the league chat', () => {
    // Reporter names are admin-only on the site and in the issue; the chat
    // post must not undo that.
    const text = buildGroupPostText([], { ownerReports: [report()], now: NOW })!;
    expect(text).not.toContain('Gridiron Geeks');
    expect(text).not.toContain('Dynasty Warriors');
  });

  it('stays silent when neither source has anything new', () => {
    expect(buildGroupPostText([], { ownerReports: [], now: NOW })).toBeNull();
  });

  it('stays under the GroupMe cap with both sources at full tilt', () => {
    const findings = Array.from({ length: 20 }, (_, i) => proposal({ id: `live-${i}` }));
    const reports = Array.from({ length: 20 }, (_, i) =>
      report({ qaId: `qa_${i}`, question: 'y'.repeat(400) })
    );
    const text = buildGroupPostText(findings, { ownerReports: reports, now: NOW })!;
    expect(text.length).toBeLessThanOrEqual(GROUPME_MAX_CHARS);
  });
});

describe('hasSomethingToReport with owner reports', () => {
  it('reports an owner flag even with no proposals and no judge errors', () => {
    expect(hasSomethingToReport([], [], [report()])).toBe(true);
  });

  it('stays silent when all three sources are empty', () => {
    expect(hasSomethingToReport([], [], [])).toBe(false);
  });

  it('defaults ownerReports so existing two-arg callers still work', () => {
    expect(hasSomethingToReport([], [])).toBe(false);
    expect(hasSomethingToReport([proposal()], [])).toBe(true);
  });
});
