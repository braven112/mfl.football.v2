import { describe, it, expect } from 'vitest';
import { resolveAflHeroState } from '../src/utils/afl-hero-resolver';
import type { WhatsNewEntry } from '../src/types/whats-new';

/**
 * AFL hero — P1 lead-up vs fresh What's New coin flip.
 *
 * A P1 calendar lead-up (season-start countdown, keeper countdown, draft
 * countdown) has a 7–50 day urgency window, longer than the 7-day fresh
 * window, so it used to lock every What's New launch out of the AFL hero:
 * the countdown showed 100% of the time. TheLeague's resolver splits its
 * ambient roster-deadline hero ~50/50 with a fresh feature; this pins the
 * same contract on the AFL side (`rng() < 0.5` = event wins, `>= 0.5` =
 * feature wins), and pins that an ACTIVE P0 event never flips.
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

describe('AFL hero: P1 lead-up splits with a fresh feature', () => {
  it('guards the fixture: Sep 5 resolves to the P1 season-start lead-up with no feature', () => {
    const state = resolveAflHeroState({ referenceDate: leadUpDate, rng: () => 0.99 });
    expect(state.kind).toBe('calendar-event');
    expect(state.priority).toBe('P1');
    if (state.kind === 'calendar-event') expect(state.eventId).toBe('afl-season-start');
  });

  it('rng < 0.5 — the calendar lead-up wins', () => {
    const state = resolveAflHeroState({
      referenceDate: leadUpDate,
      whatsNewEntries: [entry()],
      rng: () => 0.25,
    });
    expect(state.kind).toBe('calendar-event');
    expect(state.priority).toBe('P1');
  });

  it('rng >= 0.5 — the fresh feature wins (exactly 0.5 is the feature side of the boundary)', () => {
    const state = resolveAflHeroState({
      referenceDate: leadUpDate,
      whatsNewEntries: [entry()],
      rng: () => 0.5,
    });
    expect(state.kind).toBe('feature');
    expect(state.priority).toBe('P2');
    if (state.kind === 'feature') expect(state.content.heroEntryId).toBe('flip-entry');
  });

  it('with no fresh feature the lead-up shows 100% — the flip never fires', () => {
    let calls = 0;
    const state = resolveAflHeroState({
      referenceDate: leadUpDate,
      whatsNewEntries: [entry({ excludeFromHero: true })],
      rng: () => { calls += 1; return 0.99; },
    });
    expect(state.kind).toBe('calendar-event');
    expect(calls).toBe(0);
  });

  it('a stale entry (older than 7 days) does not enter the flip', () => {
    const state = resolveAflHeroState({
      referenceDate: leadUpDate,
      whatsNewEntries: [entry({ date: '2026-08-20' })],
      rng: () => 0.99,
    });
    expect(state.kind).toBe('calendar-event');
  });

  it('an ACTIVE P0 event is never flipped away, even when the feature would win', () => {
    const state = resolveAflHeroState({
      referenceDate: activeEventDate,
      whatsNewEntries: [entry({ date: '2026-08-28' })],
      rng: () => 0.99,
    });
    expect(state.priority).toBe('P0');
    expect(state.kind).not.toBe('feature');
  });

  it('defaults to Math.random when no rng is supplied (does not throw)', () => {
    const state = resolveAflHeroState({ referenceDate: leadUpDate, whatsNewEntries: [entry()] });
    expect(['calendar-event', 'feature']).toContain(state.kind);
  });
});
