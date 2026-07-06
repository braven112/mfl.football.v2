import { describe, it, expect } from 'vitest';
import { resolveAflHeroState } from '../src/utils/afl-hero-resolver';
import type { WhatsNewEntry } from '../src/types/whats-new';

/**
 * AFL fresh-feature hero view — CTA contract.
 *
 * The AFL homepage hero renders `state.view` (built by the internal
 * SLOT_VIEW.feature), NOT `state.content` (built by featureToHero). A prior
 * bug fixed the article-link default only in featureToHero, so entries
 * without an explicit `link` still rendered a CTA-less hero. This suite pins
 * the contract on the view object — the thing that actually reaches
 * AflEventHero.
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

/**
 * A reference date inside the entry's 7-day freshness window. If the AFL
 * calendar ever grows an active/urgent event here (P0/P1 outranks P2), the
 * `kind` assertion below fails loudly — move both dates to a quieter week.
 */
const referenceDate = new Date('2026-06-03T12:00:00-07:00');

function resolveFeatureState(entry: WhatsNewEntry) {
  return resolveAflHeroState({
    referenceDate,
    whatsNewEntries: [entry],
  });
}

describe('AFL hero fresh-feature view CTA', () => {
  it('resolves the fresh entry to the feature slot (guards the assertions below)', () => {
    const state = resolveFeatureState(baseEntry({}));
    expect(state.kind).toBe('feature');
  });

  it('entry without a link CTAs into its own article, not the listing', () => {
    const state = resolveFeatureState(baseEntry({ id: 'no-link-entry' }));
    if (state.kind !== 'feature') throw new Error(`expected feature slot, got ${state.kind}`);
    expect(state.view.link).toBe('/afl-fantasy/whats-new/no-link-entry');
    expect(state.view.linkLabel).toBe('READ THE FULL STORY');
    // The content object (featureToHero) must agree with the rendered view.
    expect(state.content.link).toBe('/afl-fantasy/whats-new/no-link-entry');
  });

  it('entry with an explicit link keeps it', () => {
    const state = resolveFeatureState(
      baseEntry({ link: '/afl-fantasy/keepers', linkLabel: 'Open Keepers' }),
    );
    if (state.kind !== 'feature') throw new Error(`expected feature slot, got ${state.kind}`);
    expect(state.view.link).toBe('/afl-fantasy/keepers');
    expect(state.view.linkLabel).toBe('OPEN KEEPERS');
  });
});
