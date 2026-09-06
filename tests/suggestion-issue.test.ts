/**
 * Board idea → GitHub issue.
 *
 * The body builder is the half that rots: a field added to the composer and
 * not to the body means the issue silently loses the thing the owner typed,
 * and nobody notices until an agent picks up a ticket that says "the standings
 * page is confusing" with no page, no problem statement, and no expected
 * behavior. That round-trip back to the owner is the exact failure this whole
 * feature exists to avoid, so the structured fields are pinned here.
 */
import { describe, it, expect } from 'vitest';
import {
  buildIssueBody,
  buildIssueTitle,
  issueLabels,
} from '../src/utils/suggestion-issue';
import type { Idea } from '../src/types/suggestions';
import { LEAGUES } from '../src/config/leagues';

const base: Idea = {
  id: 'idea_abc123',
  title: 'Show cap space on the roster page',
  body: '',
  category: 'website',
  websiteFields: {
    type: 'feature',
    pageOrFeature: 'Roster Hub',
    problem: 'I have to open the salary page in another tab to know what I can afford.',
    desiredBehavior: 'Put remaining cap space in the roster header.',
  },
  author: { franchiseId: '0007', teamName: 'Pacific Pigskins' },
  images: [],
  reactions: {},
  status: 'open',
  pinned: false,
  locked: false,
  archived: false,
  commentCount: 0,
  lastActivityAt: '2026-09-01T00:00:00.000Z',
  createdAt: '2026-09-01T00:00:00.000Z',
};

describe('buildIssueTitle', () => {
  it('labels a website feature and a website bug differently', () => {
    expect(buildIssueTitle(base)).toBe('[Feature] Show cap space on the roster page');
    expect(
      buildIssueTitle({ ...base, websiteFields: { ...base.websiteFields!, type: 'bug' } }),
    ).toBe('[Bug] Show cap space on the roster page');
  });

  it('labels rule changes and general ideas', () => {
    expect(buildIssueTitle({ ...base, category: 'rule-change', websiteFields: undefined }))
      .toMatch(/^\[Rule change\] /);
    expect(buildIssueTitle({ ...base, category: 'general', websiteFields: undefined }))
      .toMatch(/^\[Idea\] /);
  });

  it('keeps the idea id out of the title (it is unreadable in a notification)', () => {
    expect(buildIssueTitle(base)).not.toContain(base.id);
  });
});

describe('buildIssueBody', () => {
  const body = buildIssueBody(base, LEAGUES.theleague.slug);

  it('carries every structured field the composer collected', () => {
    expect(body).toContain('Roster Hub');
    expect(body).toContain(base.websiteFields!.problem);
    expect(body).toContain(base.websiteFields!.desiredBehavior);
  });

  it('credits the author and links back to the thread', () => {
    expect(body).toContain('Pacific Pigskins');
    expect(body).toContain(`#idea-${base.id}`);
  });

  it('builds the backlink through the registry, never by concatenation', () => {
    // leagueUrl() output — the canonical host, with the league path resolved.
    expect(body).toContain(LEAGUES.theleague.canonicalDomain);
    expect(body).not.toContain('undefined');
  });

  it('points an AFL idea at the AFL site, not TheLeague', () => {
    const aflBody = buildIssueBody(base, LEAGUES['afl-fantasy'].slug);
    expect(aflBody).toContain(LEAGUES['afl-fantasy'].canonicalDomain);
    expect(aflBody).not.toContain(LEAGUES.theleague.canonicalDomain);
  });

  it('falls back to prose for a non-website idea rather than dropping it', () => {
    const general = buildIssueBody(
      { ...base, category: 'general', websiteFields: undefined, body: 'Move the draft earlier.' },
      LEAGUES.theleague.slug,
    );
    expect(general).toContain('Move the draft earlier.');
  });

  it('embeds screenshots and summarises the league reaction', () => {
    const withExtras = buildIssueBody(
      {
        ...base,
        images: [{ url: 'https://blob.example/shot.png', alt: 'the header' }],
        reactions: { '🔥': ['0001', '0002'], '👍': [] },
      },
      LEAGUES.theleague.slug,
    );
    expect(withExtras).toContain('![the header](https://blob.example/shot.png)');
    expect(withExtras).toContain('🔥 2');
    // An emoji nobody actually used must not appear as a phantom vote.
    expect(withExtras).not.toContain('👍 0');
  });

  it('survives a league missing from the registry instead of throwing in a click handler', () => {
    const orphan = buildIssueBody(base, 'not-a-league');
    expect(orphan).toContain(base.id);
  });
});

describe('issueLabels', () => {
  it('always marks provenance so the tracker can be searched', () => {
    expect(issueLabels(base)).toContain('suggestion-box');
  });

  it('routes bugs, features and rule changes to different labels', () => {
    expect(issueLabels({ ...base, websiteFields: { ...base.websiteFields!, type: 'bug' } }))
      .toContain('bug');
    expect(issueLabels(base)).toContain('enhancement');
    expect(issueLabels({ ...base, category: 'rule-change', websiteFields: undefined }))
      .toContain('rule-change');
  });
});
