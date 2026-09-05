import { describe, it, expect } from 'vitest';
import { resolveAflHeroState } from '../src/utils/afl-hero-resolver';
import type { WhatsNewEntry } from '../src/types/whats-new';

/**
 * AFL hero — an upcoming (P1) countdown is FILLER that shares a per-visit
 * pool with every fresh What's New article.
 *
 * A P1 calendar lead-up (season-start countdown, keeper countdown, draft
 * countdown) has a 7–50 day urgency window, longer than the 7-day fresh
 * window, so it used to lock every What's New launch out of the AFL hero:
 * the countdown showed 100% of the time. Now the pool is
 * `[countdown, ...fresh]` and each load draws one slot uniformly: with N
 * fresh articles the countdown shows 1/(N+1) of the time and so does each
 * article; with none it still shows 100%. An ACTIVE P0 event never pools.
 */

const entry = (overrides: Partial<WhatsNewEntry> = {}): WhatsNewEntry => ({
  id: 'flip-entry',
  date: '2026-09-04',
  title: 'Notification Command Center',
  summary: 'One place for every alert.',
  description: ['One place for every alert.'],
  category: 'new-feature',
  leagues: ['afl'],
  ...overrides,
});

// Labor Day 2026 is Sep 7, so NFL kickoff (Thu) is Sep 10. Sep 5 sits inside
// `afl-season-start`'s 7-day lead-up: a P1 calendar event, not yet active.
const leadUpDate = new Date('2026-09-05T12:00:00-07:00');
// Draft day: the AL conference draft is ACTIVE (P0) on the Saturday before
// Labor Day weekend (Aug 29, 2026 per the AFL calendar's `draft-al` rule).
const activeEventDate = new Date('2026-08-29T15:00:00-07:00');

const five = ['a', 'b', 'c', 'd', 'e'].map((id) => entry({ id: `fresh-${id}` }));

function resolveAt(rng: number, whatsNewEntries: WhatsNewEntry[]) {
  return resolveAflHeroState({ referenceDate: leadUpDate, whatsNewEntries, rng: () => rng });
}

describe('AFL hero: an upcoming countdown pools with fresh What\'s New articles', () => {
  it('guards the fixture: Sep 5 resolves to the P1 season-start lead-up with no feature', () => {
    const state = resolveAt(0.99, []);
    expect(state.kind).toBe('calendar-event');
    expect(state.priority).toBe('P1');
    if (state.kind === 'calendar-event') expect(state.eventId).toBe('afl-season-start');
  });

  it('one fresh article: rng < 0.5 → countdown, rng >= 0.5 → article (TheLeague\'s boundary)', () => {
    expect(resolveAt(0.25, [entry()]).kind).toBe('calendar-event');
    expect(resolveAt(0.499, [entry()]).kind).toBe('calendar-event');
    const won = resolveAt(0.5, [entry()]);
    expect(won.kind).toBe('feature');
    expect(won.priority).toBe('P2');
    if (won.kind === 'feature') expect(won.content.heroEntryId).toBe('flip-entry');
  });

  it('five fresh articles: the countdown owns exactly the first sixth of the rng range', () => {
    // pool = [countdown, a, b, c, d, e] — slot = floor(rng * 6)
    expect(resolveAt(0, five).kind).toBe('calendar-event');
    expect(resolveAt(1 / 6 - 1e-9, five).kind).toBe('calendar-event');
    expect(resolveAt(1 / 6, five).kind).toBe('feature');
    expect(resolveAt(0.999, five).kind).toBe('feature');
  });

  it('five fresh articles: each article owns its own sixth, so every one can headline', () => {
    const seen = new Set<string>();
    for (let slot = 1; slot <= 5; slot += 1) {
      const state = resolveAt((slot + 0.5) / 6, five);
      if (state.kind !== 'feature') throw new Error(`slot ${slot}: expected feature, got ${state.kind}`);
      seen.add(state.content.heroEntryId!);
    }
    expect([...seen].sort()).toEqual(five.map((e) => e.id).sort());
  });

  it('the pool is exact: counting slots over a uniform sweep gives 1/(N+1) to the countdown', () => {
    // 600 evenly spaced draws; 100 must land on the countdown and 100 on each article.
    const counts = new Map<string, number>();
    for (let i = 0; i < 600; i += 1) {
      const state = resolveAt((i + 0.5) / 600, five);
      const key = state.kind === 'feature' ? state.content.heroEntryId! : state.kind;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.get('calendar-event')).toBe(100);
    for (const e of five) expect(counts.get(e.id)).toBe(100);
  });

  it('with no fresh article the countdown shows 100% — rng is never consulted', () => {
    let calls = 0;
    const state = resolveAflHeroState({
      referenceDate: leadUpDate,
      whatsNewEntries: [entry({ excludeFromHero: true })],
      rng: () => { calls += 1; return 0.99; },
    });
    expect(state.kind).toBe('calendar-event');
    expect(calls).toBe(0);
  });

  it('a stale entry (older than 7 days) does not enter the pool', () => {
    expect(resolveAt(0.99, [entry({ date: '2026-08-20' })]).kind).toBe('calendar-event');
  });

  it('an ACTIVE P0 event never pools, even when an article would win', () => {
    const state = resolveAflHeroState({
      referenceDate: activeEventDate,
      whatsNewEntries: [entry({ date: '2026-08-28' })],
      rng: () => 0.99,
    });
    expect(state.priority).toBe('P0');
    expect(state.kind).not.toBe('feature');
  });

  it('an NL owner on AL draft day leads with a P1 NL card, but the LIVE AL draft still blocks pooling', () => {
    // pickLeadCalendarEvent swaps the lead to the viewer's own conference draft,
    // which is not yet active (P1) — but that card carries the only homepage link
    // to the live AL board, so it must not be pooled away.
    const state = resolveAflHeroState({
      referenceDate: activeEventDate,
      whatsNewEntries: [entry({ date: '2026-08-28' })],
      userConferenceId: '01',
      rng: () => 0.99,
    });
    expect(state.kind).toBe('calendar-event');
    if (state.kind !== 'calendar-event') throw new Error('unreachable');
    expect(state.eventId).toBe('afl-nl-draft');
    expect(state.priority).toBe('P1');
    expect(state.conferenceDraft?.al.live).toBe(true);
  });

  it('an rng that returns exactly 1 still resolves (clamped to the last slot)', () => {
    expect(resolveAt(1, five).kind).toBe('feature');
  });

  it('defaults to Math.random when no rng is supplied (does not throw)', () => {
    const state = resolveAflHeroState({ referenceDate: leadUpDate, whatsNewEntries: [entry()] });
    expect(['calendar-event', 'feature']).toContain(state.kind);
  });
});
