import { describe, it, expect } from 'vitest';
import { nextDraftStart, resolveDraftHubStatus } from '../src/utils/draft-hub-state';

const at = (iso: string) => new Date(iso);
const secs = (iso: string) => String(Math.floor(at(iso).getTime() / 1000));

describe('nextDraftStart', () => {
  const events = [
    { type: 'AUCTION_START', start_time: secs('2026-03-01T18:00:00Z') },
    { type: 'DRAFT_START', start_time: secs('2026-05-03T17:00:00Z') },
    { type: 'DRAFT_START', start_time: secs('2027-05-02T17:00:00Z') },
  ];

  it('picks the soonest DRAFT_START still ahead of us', () => {
    expect(nextDraftStart(events, at('2026-04-01T00:00:00Z'))?.toISOString()).toBe(
      '2026-05-03T17:00:00.000Z'
    );
  });

  it('skips a draft that has already started', () => {
    expect(nextDraftStart(events, at('2026-06-01T00:00:00Z'))?.toISOString()).toBe(
      '2027-05-02T17:00:00.000Z'
    );
  });

  it('ignores calendar rows that are not drafts', () => {
    expect(nextDraftStart([events[0]], at('2026-01-01T00:00:00Z'))).toBeNull();
  });

  it('survives a malformed or empty start_time', () => {
    expect(
      nextDraftStart(
        [{ type: 'DRAFT_START', start_time: '' }, { type: 'DRAFT_START' }],
        at('2026-01-01T00:00:00Z')
      )
    ).toBeNull();
  });
});

describe('resolveDraftHubStatus', () => {
  const now = at('2026-04-01T00:00:00Z');

  it('does NOT call a stubbed board a completed draft', () => {
    // MFL creates all 51 slots before a pick is made. Counting slots would
    // report the draft finished the day the board was created.
    const status = resolveDraftHubStatus({
      now,
      year: 2026,
      slots: 51,
      made: 0,
      startsAt: at('2026-05-03T17:00:00Z'),
    });
    expect(status.kind).toBe('scheduled');
  });

  it('counts down to a scheduled draft', () => {
    const status = resolveDraftHubStatus({
      now,
      year: 2026,
      slots: 51,
      made: 0,
      startsAt: at('2026-04-11T00:00:00Z'),
    });
    expect(status).toMatchObject({ kind: 'scheduled', daysAway: 10, year: 2026 });
  });

  it('rounds a draft later today up to a day away, never zero', () => {
    const status = resolveDraftHubStatus({
      now,
      year: 2026,
      slots: 51,
      made: 0,
      startsAt: at('2026-04-01T18:00:00Z'),
    });
    expect(status).toMatchObject({ kind: 'scheduled', daysAway: 1 });
  });

  it('reports a draft in progress, and prefers that over the schedule', () => {
    const status = resolveDraftHubStatus({
      now,
      year: 2026,
      slots: 51,
      made: 20,
      // Still on the calendar; the picks landing are the interesting part.
      startsAt: at('2026-04-11T00:00:00Z'),
    });
    expect(status).toMatchObject({ kind: 'live', made: 20, slots: 51 });
  });

  it('reports a finished draft', () => {
    const status = resolveDraftHubStatus({
      now,
      year: 2026,
      slots: 51,
      made: 51,
      startsAt: null,
    });
    expect(status).toMatchObject({ kind: 'complete', made: 51, year: 2026 });
  });

  it('says nothing rather than guessing when there is no board and no date', () => {
    expect(
      resolveDraftHubStatus({ now, year: 2026, slots: 0, made: 0, startsAt: null }).kind
    ).toBe('unknown');
  });

  it('does not count a past draft date as scheduled', () => {
    expect(
      resolveDraftHubStatus({
        now,
        year: 2026,
        slots: 0,
        made: 0,
        startsAt: at('2026-03-01T00:00:00Z'),
      }).kind
    ).toBe('unknown');
  });
});
