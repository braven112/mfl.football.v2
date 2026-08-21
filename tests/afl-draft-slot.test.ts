import { describe, it, expect } from 'vitest';
import {
  conferenceUnit,
  heldRoundOnePicks,
  isBoardStillSeeded,
  isConferenceDraftComplete,
  loadAflDraftSlot,
  resolveAflDraftSlotFrom,
} from '../src/utils/afl-draft-slot';
import aflConfig from '../data/afl-fantasy/afl.config.json';

/**
 * The draft half of the AFL homepage spotlight tile.
 *
 * **These tests must not assert that the live board is in any particular
 * state.** `data/afl-fantasy/mfl-feeds/**` is cron-written (CLAUDE.md: "Cron
 * writes these"), so the 2026 board flips from seeded → drafted the weekend the
 * conference drafts run. An earlier version of this file asserted
 * `.not.toBeNull()` against it and would have reddened `pnpm test:unit` for
 * every unrelated PR from that morning on — a test failing on a data-only
 * commit, which is the worst kind of guard because nobody believes it again.
 *
 * So: logic is pinned with fixtures, and the one thing that genuinely needs
 * real data — that our standings-derived order reproduces MFL's seeding — is
 * gated on the precondition that makes it checkable.
 */

/** A conference board: `holders[pickIndex]` owns that round-1 slot. */
function board(
  unit: string,
  holders: string[],
  { drafted = false, rounds = 1 } = {}
) {
  const picks = [];
  for (let round = 1; round <= rounds; round++) {
    holders.forEach((franchise, i) => {
      picks.push({
        round: String(round).padStart(2, '0'),
        pick: String(i + 1).padStart(2, '0'),
        franchise,
        player: drafted ? '12345' : '',
      });
    });
  }
  return { draftResults: { draftUnit: [{ unit, draftPick: picks }] } };
}

const TWELVE = Array.from({ length: 12 }, (_, i) =>
  String(i + 1).padStart(4, '0')
);

describe('conferenceUnit', () => {
  it('matches strictly on MFL unit id, never by position', () => {
    const two = {
      draftResults: {
        draftUnit: [
          { unit: 'CONFERENCE00', draftPick: [{ round: '01', pick: '01', franchise: 'A' }] },
          { unit: 'CONFERENCE01', draftPick: [{ round: '01', pick: '01', franchise: 'B' }] },
        ],
      },
    };
    expect(conferenceUnit(two, '01')?.unit).toBe('CONFERENCE01');
  });

  it('returns null rather than guessing when the unit id is absent', () => {
    // Degrading to "base slot, no asterisk" beats asterisking a pick the owner
    // never traded because we read the other conference's slots.
    const unlabelled = {
      draftResults: { draftUnit: [{ draftPick: [{ round: '01', pick: '01', franchise: 'A' }] }] },
    };
    expect(conferenceUnit(unlabelled, '00')).toBeNull();
  });

  it('survives a missing or malformed board', () => {
    expect(conferenceUnit(null, '00')).toBeNull();
    expect(conferenceUnit({}, '00')).toBeNull();
    expect(conferenceUnit({ draftResults: {} }, '00')).toBeNull();
  });
});

describe('isConferenceDraftComplete', () => {
  it('is false while any slot is unfilled, true once all are', () => {
    expect(isConferenceDraftComplete(board('CONFERENCE00', TWELVE), '00')).toBe(false);
    expect(
      isConferenceDraftComplete(board('CONFERENCE00', TWELVE, { drafted: true }), '00')
    ).toBe(true);
  });

  it('scopes completion to one conference — AL and NL finish a day apart', () => {
    const mixed = {
      draftResults: {
        draftUnit: [
          board('CONFERENCE00', TWELVE, { drafted: true }).draftResults.draftUnit[0],
          board('CONFERENCE01', TWELVE).draftResults.draftUnit[0],
        ],
      },
    };
    expect(isConferenceDraftComplete(mixed, '00')).toBe(true);
    expect(isConferenceDraftComplete(mixed, '01')).toBe(false);
  });

  it('treats a missing board as not complete', () => {
    expect(isConferenceDraftComplete(null, '00')).toBe(false);
  });
});

describe('heldRoundOnePicks', () => {
  const traded = board('CONFERENCE00', [
    ...TWELVE.slice(0, 2),
    '0001', // 0003's slot now belongs to 0001
    ...TWELVE.slice(3),
  ]);

  it('returns null for a board that does not exist — distinct from holding none', () => {
    expect(heldRoundOnePicks(null, '00', '0001')).toBeNull();
  });

  it('lists every round-1 slot a franchise holds, ascending', () => {
    expect(heldRoundOnePicks(traded, '00', '0001')).toEqual([1, 3]);
  });

  it('returns an empty array for a franchise traded out of round 1', () => {
    expect(heldRoundOnePicks(traded, '00', '0003')).toEqual([]);
  });
});

describe('isBoardStillSeeded', () => {
  it('is true only for an untraded, undrafted board', () => {
    expect(isBoardStillSeeded(board('CONFERENCE00', TWELVE), '00')).toBe(true);
  });

  it('is false once a pick has been traded', () => {
    expect(
      isBoardStillSeeded(
        board('CONFERENCE00', [...TWELVE.slice(0, 2), '0001', ...TWELVE.slice(3)]),
        '00'
      )
    ).toBe(false);
  });

  it('is false once the draft has run', () => {
    expect(
      isBoardStillSeeded(board('CONFERENCE00', TWELVE, { drafted: true }), '00')
    ).toBe(false);
  });
});

describe('resolveAflDraftSlotFrom', () => {
  /** Standings rows just detailed enough for the order calculation. */
  const standings = aflConfig.teams.map((t, i) => ({
    id: t.franchiseId,
    h2hw: String(i % 12),
    h2hl: String(11 - (i % 12)),
    h2ht: '0',
    h2hwlt: `${i % 12}-${11 - (i % 12)}-0`,
    pf: String(2000 + i),
    pa: '1900',
    avgpf: '120',
    all_play_w: String(i),
    all_play_l: String(i),
    all_play_t: '0',
  })) as never[];

  const base = {
    franchiseId: '0001',
    conferenceId: '00',
    draftYear: 2026,
    calendarYear: 2026,
    board: null as unknown,
    standings,
  };

  it('resolves a slot when the window is open', () => {
    const slot = resolveAflDraftSlotFrom(base);
    expect(slot).not.toBeNull();
    expect(slot!.draftYear).toBe(2026);
    expect(slot!.conferenceShort).toBe('AL');
    // No board → cannot asterisk.
    expect(slot!.heldPicks).toBeNull();
  });

  it('returns null before the June 1 rollover', () => {
    // League year still names last season while the calendar says 2026.
    expect(
      resolveAflDraftSlotFrom({ ...base, draftYear: 2025 })
    ).toBeNull();
  });

  it('returns null once this conference has drafted', () => {
    expect(
      resolveAflDraftSlotFrom({
        ...base,
        board: board('CONFERENCE00', TWELVE, { drafted: true }),
      })
    ).toBeNull();
  });

  it('returns null for an unknown conference', () => {
    expect(resolveAflDraftSlotFrom({ ...base, conferenceId: '99' })).toBeNull();
  });

  it('returns null for a franchise that is not in the order', () => {
    expect(
      resolveAflDraftSlotFrom({ ...base, franchiseId: '9999' })
    ).toBeNull();
  });

  it('returns null with no standings to derive an order from', () => {
    expect(resolveAflDraftSlotFrom({ ...base, standings: [] })).toBeNull();
  });

  it('reports held picks from the board when there is one', () => {
    const slot = resolveAflDraftSlotFrom({
      ...base,
      board: board('CONFERENCE00', TWELVE),
    });
    expect(slot!.heldPicks).toEqual([1]); // 0001 seeded at slot 1 in this fixture
  });
});

describe('loadAflDraftSlot (live feeds)', () => {
  const at = (day: string) => new Date(`${day}T12:00:00-07:00`);
  const REF = at('2026-08-21');

  const slots = aflConfig.teams
    .filter((t) => t.conference === '00' || t.conference === '01')
    .map((t) => ({
      team: t.nameShort ?? t.name,
      conference: t.conference!,
      slot: loadAflDraftSlot({
        franchiseId: t.franchiseId,
        conferenceId: t.conference,
        referenceDate: REF,
      }),
    }));

  it('never throws and never returns a nonsense pick', () => {
    // Holds in every board state, including after the drafts run (all null).
    for (const { team, slot } of slots) {
      if (!slot) continue;
      expect(slot.basePick, `${team}`).toBeGreaterThanOrEqual(1);
      expect(slot.basePick, `${team}`).toBeLessThanOrEqual(12);
      expect(['AL', 'NL']).toContain(slot.conferenceShort);
    }
  });

  it('reproduces MFL\'s seeding pick-for-pick while the board is still seeded', () => {
    // THE point of deriving the base slot from standings instead of the board:
    // once a pick is traded MFL overwrites who earned the slot, so the two are
    // only comparable beforehand. Drift in our tiebreaker chain would surface
    // here as a phantom "you traded this pick" asterisk on somebody's homepage.
    //
    // Gated, not assumed: after the conference drafts run (or the first round-1
    // trade), the precondition is gone and this becomes uncheckable — which is
    // a fact about the data, not a regression.
    const resolved = slots.filter((s) => s.slot);
    if (!resolved.length) {
      console.info(
        '[afl-draft-slot] draft window closed on the committed feeds — seeding cross-check skipped'
      );
      return;
    }

    for (const { team, slot } of resolved) {
      // heldPicks is null only when no board exists; then there is nothing to
      // cross-check against and the seeded-state question does not arise.
      if (slot!.heldPicks === null) continue;
      expect(slot!.heldPicks, `${team} holds no round-1 pick`).toEqual([
        slot!.basePick,
      ]);
    }

    // Each conference's earned slots must partition 1-12 — always true, and it
    // catches a tiebreaker that returned 0 or double-assigned a position.
    for (const conf of ['00', '01']) {
      const picks = resolved
        .filter((s) => s.conference === conf)
        .map((s) => s.slot!.basePick)
        .sort((a, b) => a - b);
      if (picks.length === 12) {
        expect(picks, `conference ${conf}`).toEqual([
          1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
        ]);
      }
    }
  });

  it('closes the window before the June 1 rollover', () => {
    // Independent of board state: in May the league year still names 2025, so
    // the calendar floor alone shuts it.
    expect(
      loadAflDraftSlot({
        franchiseId: '0001',
        conferenceId: '00',
        referenceDate: at('2026-05-20'),
      })
    ).toBeNull();
  });

  it('skips the tier when the conference is unknown', () => {
    for (const conferenceId of [undefined, '99']) {
      expect(
        loadAflDraftSlot({ franchiseId: '0001', conferenceId, referenceDate: REF })
      ).toBeNull();
    }
  });
});
