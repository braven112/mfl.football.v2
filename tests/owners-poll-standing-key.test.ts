/**
 * The standing-ballot key: league-scoped, season-scoped, never bare.
 *
 * Every rule here is a bug this repo has already shipped once in some form.
 * The standing hash is longer-lived than anything the poll stored before — it
 * is never cleared, and it accumulates the whole league's opinions — so a key
 * built wrong goes wrong quietly and for a long time.
 */

import { describe, it, expect } from 'vitest';
import {
  ownersPollStandingKey,
  isBallotStale,
  STALE_BALLOT_WEEKS,
  parseStoredBallot,
  buildBallotRecord,
  affirmBallotRecord,
} from '../src/utils/owners-poll-ballot.mjs';

const FIELD = Array.from({ length: 16 }, (_, i) => String(i + 1).padStart(4, '0'));
const OK = FIELD.slice(0, 7);

describe('ownersPollStandingKey', () => {
  it('scopes by league AND season', () => {
    expect(ownersPollStandingKey('theleague', 2026)).toBe('poll:theleague:standing:2026');
    expect(ownersPollStandingKey('afl', 2026)).toBe('poll:afl:standing:2026');
  });

  it('never collides across leagues — BOTH have a franchise 0001', () => {
    // This is the reason the poll refuses rankings-scope.ts#scopedKvKey, whose
    // bare-key-for-TheLeague form would make these two the same hash.
    expect(ownersPollStandingKey('theleague', 2026)).not.toBe(
      ownersPollStandingKey('afl', 2026),
    );
  });

  it('never collides across seasons', () => {
    // A standing vote must not survive the offseason: franchises change, and
    // last year's Week 14 ballot is not this year's Week 1 opinion.
    expect(ownersPollStandingKey('theleague', 2026)).not.toBe(
      ownersPollStandingKey('theleague', 2027),
    );
  });

  it('throws on a bad scope rather than defaulting to one', () => {
    expect(() => ownersPollStandingKey('', 2026)).toThrow();
    expect(() => ownersPollStandingKey('Not A Slug', 2026)).toThrow();
    // @ts-expect-error — deliberately wrong type
    expect(() => ownersPollStandingKey(null, 2026)).toThrow();
  });

  it('throws on a bad season year', () => {
    expect(() => ownersPollStandingKey('theleague', 0)).toThrow();
    expect(() => ownersPollStandingKey('theleague', 1999)).toThrow();
    // @ts-expect-error — deliberately wrong type
    expect(() => ownersPollStandingKey('theleague', '2026')).toThrow();
  });
});

describe('a record stamped for another season is dropped', () => {
  const opts = { slots: 7, eligibleFranchiseIds: FIELD, seasonYear: 2026 };

  it('accepts a record stamped for the season it was asked for', () => {
    const rec = { franchiseId: '0001', ranking: OK, seasonYear: 2026 };
    expect(parseStoredBallot(JSON.stringify(rec), opts)).not.toBeNull();
  });

  it('drops one stamped for a different season', () => {
    const rec = { franchiseId: '0001', ranking: OK, seasonYear: 2025 };
    expect(parseStoredBallot(JSON.stringify(rec), opts)).toBeNull();
  });

  it('accepts an UNSTAMPED record — those predate standing votes', () => {
    const rec = { franchiseId: '0001', ranking: OK };
    expect(parseStoredBallot(JSON.stringify(rec), opts)).not.toBeNull();
  });
});

describe('isBallotStale', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  const daysAgo = (n: number) =>
    new Date(now.getTime() - n * 86400 * 1000).toISOString();

  it('defaults to three weeks', () => {
    expect(STALE_BALLOT_WEEKS).toBe(3);
  });

  it('is false just inside the threshold and true just outside', () => {
    expect(isBallotStale(daysAgo(20), now)).toBe(false);
    expect(isBallotStale(daysAgo(22), now)).toBe(true);
  });

  it('is FALSE for an unusable timestamp, never true', () => {
    // An unparseable updatedAt is a storage question. Prompting on it would
    // nag every owner in the league about a bug none of them can fix.
    expect(isBallotStale(null, now)).toBe(false);
    expect(isBallotStale('not a date', now)).toBe(false);
    expect(isBallotStale(undefined, now)).toBe(false);
  });
});

describe('affirmBallotRecord', () => {
  const now = new Date('2026-10-01T12:00:00Z');

  it('moves updatedAt and nothing else', () => {
    const first = buildBallotRecord({
      franchiseId: '0001',
      ranking: OK,
      now: new Date('2026-09-01T12:00:00Z'),
      seasonYear: 2026,
    });
    const affirmed = affirmBallotRecord(first, now);
    expect(affirmed.ranking).toEqual(first.ranking);
    expect(affirmed.submittedAt).toBe(first.submittedAt);
    expect(affirmed.seasonYear).toBe(2026);
    expect(affirmed.updatedAt).toBe(now.toISOString());
    expect(affirmed.updatedAt).not.toBe(first.updatedAt);
  });

  it('returns null when there is nothing on file', () => {
    expect(affirmBallotRecord(null, now)).toBeNull();
    expect(affirmBallotRecord({ franchiseId: '0001' }, now)).toBeNull();
  });
});
