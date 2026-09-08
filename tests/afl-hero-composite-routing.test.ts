/**
 * AFL composite-hero routing guard.
 *
 * `docs/claude/insights/features/afl-hero.md` records a bug that cost real
 * time: `buildFeatureView` in `league-event-hero-view.ts` still builds a
 * headline pair for TheLeague that NOTHING renders, because the state is
 * short-circuited to a composite before the view is ever read. Editing it
 * produces no visible effect whatsoever.
 *
 * The AFL now has the same shape — `EventHeroView.composite` is a presentation
 * decision made in the resolver and honored by a routing condition in
 * `AflHero.astro` — so it can rot the same way. These tests pin both halves:
 *
 *  1. The resolver really does attach a treatment on the phases that are meant
 *     to be composites, with the tone flipping on the day that matters.
 *  2. `AflHero` really does route on it, and really does fall back to
 *     `AflEventHero` when there is no treatment or no cast model — a missing
 *     feed must degrade to the card that always worked, never to an empty flank.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveAflHeroState } from '../src/utils/afl-hero-resolver';

const at = (iso: string) =>
  resolveAflHeroState({ referenceDate: new Date(iso), rng: () => 0 } as any) as any;

describe('AFL composite hero routing', () => {
  it('dresses the keeper window in trophy gold, and flips it red on deadline day', () => {
    const lead = at('2026-07-10T18:00:00Z');
    expect(lead.eventId).toBe('afl-keeper-deadline');
    expect(lead.view.composite).toEqual({
      wordmark: 'KEEPERS', accent: 'gold', tone: null,
      // A team event: your keeper class, so a signed-in owner's card is painted
      // in their club's colours rather than the league's gold.
      scope: 'team',
    });

    const dayOf = at('2026-07-15T18:00:00Z');
    expect(dayOf.eventId).toBe('afl-keeper-deadline');
    expect(dayOf.view.composite.tone).toBe('red');
  });

  it('names the CONFERENCE in each draft wordmark', () => {
    // The AL and NL draft on different days, off different MFL pages. A viewer
    // must know whose draft is on screen without reading the pill.
    const al = at('2026-08-20T18:00:00Z');
    expect(al.eventId).toBe('afl-al-draft');
    expect(al.view.composite.wordmark).toBe('AL DRAFT');
    expect(al.view.composite.accent).toBe('navy');
    // A draft belongs to the conference, not to one club.
    expect(al.view.composite.scope).toBe('league');

    const nl = at('2026-08-30T18:00:00Z');
    expect(nl.eventId).toBe('afl-nl-draft');
    expect(nl.view.composite.wordmark).toBe('NL DRAFT');
    expect(nl.view.composite.tone).toBe('red'); // drafting now
    expect(nl.view.composite.scope).toBe('league');
  });

  it('uses a no-break space so a two-word wordmark cannot wrap', () => {
    for (const iso of ['2026-08-20T18:00:00Z', '2026-08-30T18:00:00Z']) {
      const w = at(iso).view.composite.wordmark;
      expect(w).not.toContain(' '); // a plain space would break the mark in two
      expect(w).toContain(' ');
    }
  });

  it('only ever names accents the stylesheet actually defines', () => {
    const css = readFileSync(join(__dirname, '../src/styles/composite-hero.css'), 'utf8');
    for (const iso of ['2026-07-10T18:00:00Z', '2026-08-20T18:00:00Z', '2026-08-30T18:00:00Z']) {
      const { accent, tone } = at(iso).view.composite;
      expect(css, `.cmh--${accent} is not defined`).toContain(`.cmh--${accent} {`);
      if (tone) expect(css, `.cmh--${tone} is not defined`).toContain(`.cmh--${tone} {`);
    }
  });

  it('routes on BOTH the treatment and a cast model, and falls back otherwise', () => {
    // The condition is read from the file rather than rendered, because the
    // model is attached by the page (fs reads) and not by the resolver — so
    // there is no state object here that carries one.
    const hero = readFileSync(join(__dirname, '../src/components/afl/AflHero.astro'), 'utf8');
    expect(hero).toMatch(/'view' in state && state\.view\.composite && state\.view\.model/);
    // The fallback must still exist after the composite branch.
    const composite = hero.indexOf('<AflCompositeHero');
    const fallback = hero.indexOf('<AflEventHero');
    expect(composite).toBeGreaterThan(-1);
    expect(fallback).toBeGreaterThan(composite);
  });

  it('never sends a composite state the franchise backdrop as well', () => {
    // Both paint "whose story this is": the backdrop repaints the whole card in
    // the viewer's colours, the composite's glow already says it. Stacking them
    // floats the cast player on a second team's gradient.
    const hero = readFileSync(join(__dirname, '../src/components/afl/AflHero.astro'), 'utf8');
    const block = hero.slice(hero.indexOf('<AflCompositeHero'), hero.indexOf('<AflEventHero'));
    expect(block).not.toContain('backdrop');
  });
});
