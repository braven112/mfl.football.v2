import { describe, it, expect } from 'vitest';
import { loadAflDraftSlot } from '../src/utils/afl-draft-slot';
import aflConfig from '../data/afl-fantasy/afl.config.json';

/**
 * The draft half of the AFL homepage spotlight tile, against the real feeds.
 *
 * The load-bearing claim here is that the BASE slot is standings-derived rather
 * than read off MFL's board. Those agree today, and that agreement is the test:
 * `calculateAFLDraftOrder` reproducing MFL's own seeding is what makes the base
 * slot trustworthy once trades start moving franchises off it — at which point
 * the board no longer records what anybody earned.
 */

/** PT noon on a given day, so the June 1 rollover is unambiguous. */
const at = (day: string) => new Date(`${day}T12:00:00-07:00`);

const AL_TEAM = '0001'; // Smokane FC, conference 00
const conferenceOf = (id: string) =>
  aflConfig.teams.find((t) => t.franchiseId === id)?.conference;

describe('loadAflDraftSlot', () => {
  it('resolves the earned round-1 slot inside the window', () => {
    const slot = loadAflDraftSlot({
      franchiseId: AL_TEAM,
      conferenceId: conferenceOf(AL_TEAM),
      referenceDate: at('2026-08-21'),
    });
    expect(slot).not.toBeNull();
    expect(slot!.draftYear).toBe(2026);
    expect(slot!.conferenceShort).toBe('AL');
    expect(slot!.basePick).toBeGreaterThanOrEqual(1);
    expect(slot!.basePick).toBeLessThanOrEqual(12);
  });

  it('derives every base slot from standings, matching MFL\'s seeded board', () => {
    // MFL seeds a fresh board straight from the official order, so before any
    // trade lands the two must agree pick for pick. A mismatch means our
    // tiebreaker chain has drifted from the constitution's — and it would show
    // up as a phantom asterisk on somebody's homepage.
    const board = aflConfig.teams
      .filter((t) => t.conference === '00' || t.conference === '01')
      .map((t) => {
        const slot = loadAflDraftSlot({
          franchiseId: t.franchiseId,
          conferenceId: t.conference,
          referenceDate: at('2026-08-21'),
        });
        return { team: t.nameShort ?? t.name, slot };
      });

    for (const { team, slot } of board) {
      expect(slot, `${team} has no base slot`).not.toBeNull();
      // heldPicks comes off the board; basePick comes off the standings. An
      // untraded 2026 board means each franchise holds exactly its own slot.
      expect(slot!.heldPicks, `${team} holds no round-1 pick`).toEqual([
        slot!.basePick,
      ]);
    }

    // ...and the slots partition 1-12 within each conference, so nothing is
    // double-assigned by a tiebreaker that returned 0.
    for (const conf of ['00', '01']) {
      const picks = board
        .filter(
          (b) =>
            aflConfig.teams.find((t) => (t.nameShort ?? t.name) === b.team)
              ?.conference === conf
        )
        .map((b) => b.slot!.basePick)
        .sort((a, b) => a - b);
      expect(picks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    }
  });

  it('closes before the June 1 rollover', () => {
    // May still resolves to last league year, whose draft is in the books.
    expect(
      loadAflDraftSlot({
        franchiseId: AL_TEAM,
        conferenceId: conferenceOf(AL_TEAM),
        referenceDate: at('2026-05-20'),
      })
    ).toBeNull();
  });

  it('opens the day the league year rolls over', () => {
    expect(
      loadAflDraftSlot({
        franchiseId: AL_TEAM,
        conferenceId: conferenceOf(AL_TEAM),
        referenceDate: at('2026-06-01'),
      })
    ).not.toBeNull();
  });

  it('skips the tier when the conference is unknown', () => {
    // A viewer whose franchise config has no conference (or a value MFL has
    // not given us) must fall through to the title tier, not crash.
    expect(
      loadAflDraftSlot({
        franchiseId: AL_TEAM,
        conferenceId: undefined,
        referenceDate: at('2026-08-21'),
      })
    ).toBeNull();
    expect(
      loadAflDraftSlot({
        franchiseId: AL_TEAM,
        conferenceId: '99',
        referenceDate: at('2026-08-21'),
      })
    ).toBeNull();
  });

  it('skips the tier for a franchise that is not in the order', () => {
    expect(
      loadAflDraftSlot({
        franchiseId: '9999',
        conferenceId: '00',
        referenceDate: at('2026-08-21'),
      })
    ).toBeNull();
  });
});
