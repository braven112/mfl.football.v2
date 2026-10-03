import { describe, expect, it } from 'vitest';
import {
  LAUNCHER_MODEL,
  buildReviewInput,
  draftFromMfl,
  fetchMflLeagueSettings,
  mergeReview,
  parseReview,
  reviewWithClaude,
  settingsForReview,
  suggestSlug,
} from '../src/utils/league-launcher';

/** A plain 12-team home league as MFL's TYPE=league export spells it. */
const LEAGUE = {
  id: '70707',
  name: 'The Smith Family Fantasy League',
  baseURL: 'https://www40.myfantasyleague.com',
  usesContractYear: '0',
  usesSalaries: '0',
  keeperType: 'none',
  taxiSquad: '0',
  loadRosters: 'live_draft',
  bestLineup: 'No',
  playerLimitUnit: 'LEAGUE',
  franchises: { count: '12', franchise: Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1).padStart(4, '0'), name: `Team ${i}`, owner_name: 'Private Person' })) },
  divisions: { division: [{ id: '00', name: 'East' }, { id: '01', name: 'West' }] },
  history: { league: [{ year: '2026' }, { year: '2025' }] },
};

const fakeClient = (create: (body: any) => Promise<any>) => ({ beta: { messages: { create } } });
const textReply = (obj: unknown) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(obj) }] });

describe('draft from MFL settings', () => {
  it('reads the basics and pre-ticks by rule', () => {
    const d = draftFromMfl('70707', LEAGUE);
    expect(d).toMatchObject({ name: LEAGUE.name, slug: 'smith', mflHost: 'www40.myfantasyleague.com', teamCount: 12, divisionCount: 2 });
    expect(d.archetype).toBe('standard-redraft');
    expect(d.duplicatePlayers).toBe(false);
    expect(d.features.contracts).toMatchObject({ on: false, source: 'mfl-setting' });
  });

  it('suggests a free, simple slug', () => {
    expect(suggestSlug("Archie's Fantasy Football League", ['archies'])).toBe('archies2');
    expect(suggestSlug('The League of 2026')).toMatch(/^[a-z][a-z0-9]+$/);
  });

  it('never sends owner or franchise details to the model', () => {
    const s = settingsForReview(LEAGUE);
    expect(JSON.stringify(s)).not.toMatch(/Private Person|Team 3/);
    expect(s.franchiseCount).toBe(12);
    expect(buildReviewInput(LEAGUE, draftFromMfl('70707', LEAGUE))).not.toMatch(/Private Person/);
  });
});

describe('merging the review', () => {
  const draft = draftFromMfl('70707', LEAGUE);

  it('fills undecided boxes but never overrides an MFL-decided one', () => {
    const review = parseReview({
      archetype: 'standard-redraft',
      archetypeReason: 'A 12-team redraft.',
      features: [
        { key: 'contracts', on: true, reason: 'nope' },
        { key: 'accounting', on: true, reason: 'They pay out prizes.' },
      ],
      notes: 'A family league.',
    })!;
    const merged = mergeReview(LEAGUE, draft, review);
    expect(merged.features.contracts).toMatchObject({ on: false, source: 'mfl-setting' });
    expect(merged.features.accounting).toEqual({ on: true, reason: 'They pay out prizes.', source: 'ai' });
    expect(merged.notes).toBe('A family league.');
  });

  it('keeps the selection valid after the review', () => {
    const review = parseReview({
      archetype: 'standard-redraft',
      archetypeReason: '',
      features: [
        { key: 'schefterFeed', on: false, reason: 'Quiet league.' },
        { key: 'schefterTips', on: true, reason: 'Fun.' },
      ],
      notes: '',
    })!;
    const merged = mergeReview(LEAGUE, draft, review);
    expect(merged.features.schefterTips).toMatchObject({ on: false, source: 'dependency' });
  });

  it('drops answers outside the schema', () => {
    expect(parseReview({ archetype: 'made-up', features: [], notes: '' })).toBeNull();
    const r = parseReview({ archetype: 'contest', archetypeReason: 'x', features: [{ key: 'rmrf', on: true, reason: 'x' }], notes: '' });
    expect(r?.features).toEqual([]);
  });
});

describe('reviewWithClaude', () => {
  const draft = draftFromMfl('70707', LEAGUE);

  it('sends the current model with structured output, and merges the answer', async () => {
    let sent: any;
    const out = await reviewWithClaude(
      LEAGUE,
      draft,
      fakeClient(async (body) => {
        sent = body;
        return textReply({ archetype: 'standard-redraft', archetypeReason: 'Redraft.', features: [{ key: 'pushNotifications', on: false, reason: 'Small league.' }], notes: 'ok' });
      }) as never,
    );
    expect(sent.model).toBe(LAUNCHER_MODEL);
    expect(sent.output_config.format.type).toBe('json_schema');
    expect(sent.fallbacks).toBe('default');
    expect(out.features.pushNotifications).toMatchObject({ on: false, source: 'ai' });
    expect(out.reviewSkipped).toBeUndefined();
  });

  it('falls back to the rules-only draft on a refusal, an error, or junk', async () => {
    const refused = await reviewWithClaude(LEAGUE, draft, fakeClient(async () => ({ stop_reason: 'refusal', content: [] })) as never);
    expect(refused.reviewSkipped).toMatch(/declined/);
    const failed = await reviewWithClaude(LEAGUE, draft, fakeClient(async () => { throw new Error('boom'); }) as never);
    expect(failed.reviewSkipped).toMatch(/boom/);
    const junk = await reviewWithClaude(LEAGUE, draft, fakeClient(async () => textReply({ hello: 1 })) as never);
    expect(junk.reviewSkipped).toMatch(/unexpected/);
    expect(junk.features).toEqual(draft.features);
  });
});

describe('fetchMflLeagueSettings', () => {
  it('treats an MFL error body served as HTTP 200 as an error', async () => {
    const fake = (async () => new Response(JSON.stringify({ error: { $t: 'Invalid league' } }), { status: 200 })) as typeof fetch;
    const r = await fetchMflLeagueSettings('70707', 2026, fake);
    expect('error' in r && r.error).toMatch(/Invalid league/);
  });

  it('refuses a malformed id without calling MFL', async () => {
    let called = false;
    const fake = (async () => { called = true; return new Response('{}'); }) as typeof fetch;
    expect('error' in (await fetchMflLeagueSettings('12; rm', 2026, fake))).toBe(true);
    expect(called).toBe(false);
  });
});
