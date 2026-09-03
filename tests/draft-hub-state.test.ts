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

describe('the AFL names its draft events differently', () => {
  // The regression: TheLeague writes `DRAFT_START`, the AFL writes
  // `DRAFT_START_CONFERENCE00` / `_CONFERENCE01` because it drafts by
  // conference. An equality check found nothing for the AFL, so its hub
  // silently never showed a countdown — and "no match" and "no draft
  // scheduled" render identically, which is what hid it.
  it('matches the AFL’s conference-suffixed draft events', () => {
    const afl = [
      { type: 'DRAFT_START_CONFERENCE00', start_time: secs('2026-08-29T19:30:00Z') },
      { type: 'DRAFT_START_CONFERENCE01', start_time: secs('2026-08-30T16:00:00Z') },
    ];
    expect(nextDraftStart(afl, at('2026-08-01T00:00:00Z'))?.toISOString()).toBe(
      '2026-08-29T19:30:00.000Z'
    );
  });

  it('takes the soonest across conferences — the next time anyone is on the clock', () => {
    const afl = [
      { type: 'DRAFT_START_CONFERENCE01', start_time: secs('2026-08-30T16:00:00Z') },
      { type: 'DRAFT_START_CONFERENCE00', start_time: secs('2026-08-29T19:30:00Z') },
    ];
    expect(nextDraftStart(afl, at('2026-08-01T00:00:00Z'))?.toISOString()).toBe(
      '2026-08-29T19:30:00.000Z'
    );
  });

  it('rolls to the NL once the AL draft has started', () => {
    const afl = [
      { type: 'DRAFT_START_CONFERENCE00', start_time: secs('2026-08-29T19:30:00Z') },
      { type: 'DRAFT_START_CONFERENCE01', start_time: secs('2026-08-30T16:00:00Z') },
    ];
    expect(nextDraftStart(afl, at('2026-08-30T00:00:00Z'))?.toISOString()).toBe(
      '2026-08-30T16:00:00.000Z'
    );
  });

  it('still matches TheLeague’s bare DRAFT_START', () => {
    expect(
      nextDraftStart([{ type: 'DRAFT_START', start_time: secs('2026-05-03T17:00:00Z') }],
        at('2026-01-01T00:00:00Z'))?.toISOString()
    ).toBe('2026-05-03T17:00:00.000Z');
  });

  it('does not match an unrelated type that merely contains the word', () => {
    expect(nextDraftStart([{ type: 'MOCK_DRAFT_START_X', start_time: secs('2026-05-03T17:00:00Z') }],
      at('2026-01-01T00:00:00Z'))).toBeNull();
  });
});

describe('a commissioner-skipped pick must not strand the draft in "live"', () => {
  // MFL writes player '----' for a skipped pick, so it never counts as a
  // SELECTION. If completion turned on selections, a draft ending on a skip
  // would report live forever. AFL 2008 CONFERENCE00 is a real board with one.
  it('counts a skip as resolved, so a draft ending on one reads complete', () => {
    const status = resolveDraftHubStatus({
      now: at('2026-09-01T00:00:00Z'),
      year: 2026,
      slots: 51,
      made: 50,
      resolved: 51, // 50 selections + 1 commissioner skip
      startsAt: null,
    });
    expect(status).toMatchObject({ kind: 'complete', year: 2026 });
    // The headline still counts real selections, not slots.
    expect(status).toMatchObject({ made: 50 });
  });

  it('still reports live while slots remain genuinely unmade', () => {
    expect(
      resolveDraftHubStatus({
        now: at('2026-09-01T00:00:00Z'),
        year: 2026,
        slots: 108,
        made: 51,
        resolved: 51,
        startsAt: null,
      }).kind
    ).toBe('live');
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
      resolved: 0,
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
      resolved: 0,
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
      resolved: 0,
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
      resolved: 20,
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
      resolved: 51,
      startsAt: null,
    });
    expect(status).toMatchObject({ kind: 'complete', made: 51, year: 2026 });
  });

  it('says nothing rather than guessing when there is no board and no date', () => {
    expect(
      resolveDraftHubStatus({ now, year: 2026, slots: 0, made: 0, resolved: 0, startsAt: null })
        .kind
    ).toBe('unknown');
  });

  it('does not count a past draft date as scheduled', () => {
    expect(
      resolveDraftHubStatus({
        now,
        year: 2026,
        slots: 0,
        made: 0,
      resolved: 0,
        startsAt: at('2026-03-01T00:00:00Z'),
      }).kind
    ).toBe('unknown');
  });
});
