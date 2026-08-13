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
  buildDmText,
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

describe('buildDmText', () => {
  it('is terse, names the question, and points at the issue list', () => {
    const text = buildDmText([proposal()], { issuesUrl: 'https://example.test/issues', now: NOW });
    expect(text).toContain('1 finding needs your review');
    expect(text).toContain('taxi squad');
    expect(text).toContain('pending 17 days');
    expect(text).toContain('https://example.test/issues');
  });

  it('pluralizes and caps the detail list', () => {
    const many = Array.from({ length: 6 }, (_, i) => proposal({ id: `live-qa_${i}` }));
    const text = buildDmText(many, { issuesUrl: 'https://example.test/issues', now: NOW });
    expect(text).toContain('6 findings need your review');
    expect(text).toContain('…and 3 more.');
  });

  it('stays under the GroupMe length cap even with a large hostile backlog', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      proposal({ id: `live-qa_${i}`, case: { ...proposal().case, question: 'x'.repeat(600) } })
    );
    const text = buildDmText(many, { issuesUrl: 'https://example.test/issues', now: NOW });
    expect(text.length).toBeLessThanOrEqual(GROUPME_MAX_CHARS);
  });

  it('reports judge errors on their own, with no pending proposals', () => {
    const text = buildDmText([], { issuesUrl: 'https://example.test/issues', judgeErrors: ['qa_x'], now: NOW });
    expect(text).toContain('judge errored on 1 answer');
    expect(text).not.toContain('needs your review');
  });

  it('collapses a multi-line question onto one line', () => {
    const text = buildDmText([proposal({ case: { ...proposal().case, question: 'line one\nline two' } })], {
      now: NOW,
    });
    expect(text).toContain('"line one line two"');
  });
});
