import { describe, it, expect } from 'vitest';
import { resolveAflHeroState } from '../src/utils/afl-hero-resolver';
import {
  resolveFeatureHeadline,
  splitTitleHeadline,
  GENERIC_FEATURE_HEADLINE,
} from '../src/utils/whats-new-hero-headline';
import type { WhatsNewEntry } from '../src/types/whats-new';

/**
 * AFL fresh-feature hero headline.
 *
 * The AFL hero shouted the same "FRESH ON THE SITE." at every launch, so the
 * homepage announced that something shipped without ever saying what — while
 * TheLeague's composite hero has always led with the entry's own title. The
 * headline is now the FEATURE: authored `heroHeadline`/`heroAccentWord` copy
 * when the entry carries it, the title split otherwise.
 *
 * These assertions run against `state.view` — the object AflEventHero renders.
 * `state.content` (featureToHero) is not what reaches the AFL hero.
 */

const baseEntry = (overrides: Partial<WhatsNewEntry>): WhatsNewEntry => ({
  id: 'test-entry',
  date: '2026-06-01',
  title: 'Test Feature',
  summary: 'A test feature.',
  description: ['A test feature.'],
  category: 'new-feature',
  leagues: ['afl'],
  ...overrides,
});

/** Same quiet reference week as tests/afl-hero-feature-view.test.ts. */
const referenceDate = new Date('2026-06-03T12:00:00-07:00');

function featureView(entry: WhatsNewEntry) {
  const state = resolveAflHeroState({ referenceDate, whatsNewEntries: [entry] });
  if (state.kind !== 'feature') throw new Error(`expected feature slot, got ${state.kind}`);
  return state.view;
}

describe('splitTitleHeadline', () => {
  it('accents the last word and closes the line', () => {
    expect(splitTitleHeadline('The AFL Gets A Draft Room')).toEqual({
      headline: 'The AFL Gets A Draft',
      accentWord: 'Room.',
    });
  });

  it("splits on the author's own closing sentence when there is one", () => {
    // These titles are written as sentences; the last beat is the payoff and
    // beats a word split ("...ONE BALLOT. YOUR" / "CALL.").
    expect(splitTitleHeadline('Twenty-Four Teams. One Ballot. Your Call.')).toEqual({
      headline: 'Twenty-Four Teams. One Ballot.',
      accentWord: 'Your Call.',
    });
  });

  it('does not double-punctuate a title that already ends a sentence', () => {
    expect(splitTitleHeadline('Keep An Eye On Him. Literally.')).toEqual({
      headline: 'Keep An Eye On Him.',
      accentWord: 'Literally.',
    });
  });

  it('ignores a closing sentence too long to be an accent line', () => {
    // Falls through to the word split rather than handing the accent a full
    // clause the display type cannot hold.
    expect(
      splitTitleHeadline('One Thing. And Then A Considerably Longer Closing Beat'),
    ).toEqual({
      headline: 'One Thing. And Then A Considerably Longer Closing',
      accentWord: 'Beat.',
    });
  });

  it('pulls the previous word along when the last one is too weak to accent', () => {
    // "IN." alone is not a payoff.
    expect(splitTitleHeadline('Pick The Clock You Actually Live In.')).toEqual({
      headline: 'Pick The Clock You Actually',
      accentWord: 'Live In.',
    });
  });

  it('never strands an opening bracket on the headline', () => {
    // The naive last-word split gives "WEEKLY FIXES & POLISH (AUG" /
    // "18-24).", which reads as a rendering fault. The accent widens until
    // the headline closes what it opens.
    expect(splitTitleHeadline('Weekly Fixes & Polish (Aug 18-24)')).toEqual({
      headline: 'Weekly Fixes & Polish',
      accentWord: '(Aug 18-24).',
    });
  });

  it('leaves an already-balanced quoted phrase where it is', () => {
    expect(splitTitleHeadline('The "Big Board" Finally Talks')).toEqual({
      headline: 'The "Big Board" Finally',
      accentWord: 'Talks.',
    });
  });

  it('leaves a strong last word alone', () => {
    expect(splitTitleHeadline('Know Where You Are In Line')).toEqual({
      headline: 'Know Where You Are In',
      accentWord: 'Line.',
    });
  });

  it('makes a one-word title the accent, so the card keeps its colour', () => {
    expect(splitTitleHeadline('Keepers')).toEqual({ headline: '', accentWord: 'Keepers.' });
  });

  it('falls back to the generic pair for an empty title', () => {
    expect(splitTitleHeadline('   ')).toEqual(GENERIC_FEATURE_HEADLINE);
  });
});

describe('resolveFeatureHeadline', () => {
  it('prefers authored hero copy over the article title', () => {
    expect(
      resolveFeatureHeadline({
        title: 'Your Clock Now Follows You Off the Sunday Ticket Board',
        heroHeadline: 'YOUR CLOCK NOW',
        heroAccentWord: 'TRAVELS.',
      }),
    ).toEqual({ headline: 'YOUR CLOCK NOW', accentWord: 'TRAVELS.' });
  });

  it('takes an authored headline with no accent word', () => {
    expect(resolveFeatureHeadline({ title: 'Ignored', heroHeadline: 'ALL ONE COLOUR' })).toEqual({
      headline: 'ALL ONE COLOUR',
      accentWord: '',
    });
  });

  it('ignores an accent word with no headline — half a pair reads as a bug', () => {
    expect(resolveFeatureHeadline({ title: 'Know Where You Are In Line', heroAccentWord: 'LINE.' })).toEqual({
      headline: 'Know Where You Are In',
      accentWord: 'Line.',
    });
  });

  it('falls back to the generic pair with no entry at all', () => {
    expect(resolveFeatureHeadline(undefined)).toEqual(GENERIC_FEATURE_HEADLINE);
  });
});

describe('AFL hero fresh-feature headline', () => {
  it('names the feature instead of shouting the generic line', () => {
    const view = featureView(baseEntry({ title: 'The AFL Mock Draft Knows Who You Kept' }));
    expect(view.headline).toBe('The AFL Mock Draft Knows Who You');
    expect(view.accentWord).toBe('Kept.');
    expect(`${view.headline} ${view.accentWord}`.toUpperCase()).not.toContain('FRESH ON THE SITE');
  });

  it('renders authored hero copy verbatim', () => {
    const view = featureView(
      baseEntry({
        title: 'Four Boxes, Two Windows, Every League You are In',
        heroHeadline: 'BUILD YOUR',
        heroAccentWord: 'MULTIVIEW.',
      }),
    );
    expect(view.headline).toBe('BUILD YOUR');
    expect(view.accentWord).toBe('MULTIVIEW.');
  });

  it('still carries the category pill and the entry summary', () => {
    const view = featureView(baseEntry({ category: 'new-page', summary: 'A brand new page.' }));
    expect(view.pill).toBe('NEW PAGE');
    expect(view.summary).toBe('A brand new page.');
  });
});
