import { describe, it, expect } from 'vitest';
// @ts-expect-error — sibling .mjs module, no .d.ts
import { tipReferencesCompletedPick } from '../scripts/lib/draft-pick-detector.mjs';

/**
 * Locks in the fix for the May 2026 bug where the rumor scanner posted
 * "Vitside taking TE at 1.12" 24h after Vitside actually made pick 1.12.
 * Tips live in the queue for 7 days; without this matcher, draft gossip
 * keeps cycling out as "fresh" long after the pick resolves.
 */

const PICK_1_12_MADE = [
  { round: '01', pick: '12', player: '17502' },
  { round: '01', pick: '13', player: '' },
  { round: '02', pick: '01', player: '' },
];

const NO_PICKS_MADE = [
  { round: '01', pick: '12', player: '' },
  { round: '01', pick: '13', player: '' },
];

describe('tipReferencesCompletedPick', () => {
  it('drops a tip naming a pick that has already been made', () => {
    expect(
      tipReferencesCompletedPick(
        "Hearing Vitside is locked in on a TE at 1.12 — they won't budge.",
        PICK_1_12_MADE,
      ),
    ).toBe(true);
  });

  it('keeps a tip naming a pick that has not been made yet', () => {
    expect(
      tipReferencesCompletedPick(
        'Hearing Vitside is locked in on a TE at 1.12.',
        NO_PICKS_MADE,
      ),
    ).toBe(false);
  });

  it('matches "Pick 1.12" verbatim (the actual bug post phrasing)', () => {
    expect(
      tipReferencesCompletedPick(
        'Pick 1.12 is the pressure point; somebody is about to call.',
        PICK_1_12_MADE,
      ),
    ).toBe(true);
  });

  it('keeps tips with no pick reference', () => {
    expect(
      tipReferencesCompletedPick(
        'Hearing the Pigskins are exploring a trade-down scenario.',
        PICK_1_12_MADE,
      ),
    ).toBe(false);
  });

  it('drops tips that mention multiple picks if any one is made', () => {
    expect(
      tipReferencesCompletedPick(
        'Tracking 2.01 and 1.12 both — one of them is moving.',
        PICK_1_12_MADE,
      ),
    ).toBe(true);
  });

  it('does NOT match plausible-looking false positives outside the round/slot bounds', () => {
    // 10.5%, $1.50, v2.99, 9.99 — none of these are draft coordinates.
    expect(tipReferencesCompletedPick('Up 10.5% on the year.', PICK_1_12_MADE)).toBe(false);
    expect(tipReferencesCompletedPick('It cost $1.50 a share.', PICK_1_12_MADE)).toBe(false);
    expect(tipReferencesCompletedPick('Build v2.99 shipped.', PICK_1_12_MADE)).toBe(false);
  });

  it('returns false when draftPicks is empty / missing', () => {
    expect(tipReferencesCompletedPick('Vitside at 1.12 is going TE.', [])).toBe(false);
    // @ts-expect-error — defensive null
    expect(tipReferencesCompletedPick('Vitside at 1.12 is going TE.', null)).toBe(false);
  });

  it('returns false on empty/non-string text', () => {
    expect(tipReferencesCompletedPick('', PICK_1_12_MADE)).toBe(false);
    // @ts-expect-error — defensive non-string
    expect(tipReferencesCompletedPick(undefined, PICK_1_12_MADE)).toBe(false);
  });

  it('handles MFL zero-padded round/pick strings', () => {
    // MFL stores "01" / "12" — matcher should normalize both sides.
    const padded = [{ round: '01', pick: '05', player: '17500' }];
    expect(
      tipReferencesCompletedPick('Word is 1.5 has already gone TE.', padded),
    ).toBe(true);
    expect(
      tipReferencesCompletedPick('Word is 1.05 has already gone TE.', padded),
    ).toBe(true);
  });

  it('does not match a pick that exists in the array but has no player yet', () => {
    expect(
      tipReferencesCompletedPick(
        'Hearing 1.13 is going off the board for a WR.',
        PICK_1_12_MADE, // 1.13 has player: ''
      ),
    ).toBe(false);
  });
});
