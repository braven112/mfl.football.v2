/**
 * The homepage hero's franchise backdrop — the signed-in owner's colours and
 * crest behind the promo card.
 *
 * Three things this pins, each of which shipped as a bug somewhere on this
 * site before:
 *
 * 1. **The gradient is the franchise's own `broadcastGradient`, verbatim.**
 *    The draft broadcast already paints that string; a second surface deriving
 *    its own version is how the reveal card and the idle board disagreed about
 *    Midwestside for a whole draft night (see the theming rules doc). Every
 *    franchise in both real leagues has to resolve to a paintable background.
 * 2. **The crest is the DARK cut wherever one exists.** This card is dark in
 *    both themes, so `TeamIconDarkStyles`' `html.dark` swap never fires for a
 *    light-theme owner — picking the light `icon` here would put a near-black
 *    mark on ink for half the league.
 * 3. **The components only paint the layers when a backdrop was passed.** The
 *    signed-out card must be byte-for-byte the league chrome it was before, and
 *    `EventHeroShell` in particular also backs two NON-hero consumers
 *    (`WhatsNextCard`, `CalendarEventCard`) that must never take a gradient.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveHeroFranchiseBackdrop } from '../src/utils/hero-franchise-backdrop';
import { isSafeCssGradient, toBroadcastPair } from '../src/utils/draft-broadcast';
import aflConfig from '../data/afl-fantasy/afl.config.json';
import theleagueConfig from '../src/data/theleague.config.json';

const LEAGUES = [
  { key: 'afl', teams: aflConfig.teams as any[] },
  { key: 'theleague', teams: theleagueConfig.teams as any[] },
];

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('resolveHeroFranchiseBackdrop', () => {
  it('returns null for a signed-out visitor', () => {
    expect(resolveHeroFranchiseBackdrop(null, 'afl')).toBeNull();
    expect(resolveHeroFranchiseBackdrop(undefined, 'afl')).toBeNull();
  });

  it('returns null for a config entry with no colours at all', () => {
    // The caller then renders its own league chrome, which is the correct
    // fallback — better than a card painted in the derived default's navy,
    // which would look deliberate and be nobody's brand.
    expect(resolveHeroFranchiseBackdrop({ franchiseId: '0001', icon: '/x.png' }, 'afl')).toBeNull();
  });

  it("paints the franchise's own broadcastGradient verbatim", () => {
    const backdrop = resolveHeroFranchiseBackdrop(
      {
        franchiseId: '0001',
        colorPrimary: '#398b6a',
        colorSecondary: '#e9e9e9',
        broadcastGradient: 'linear-gradient(115deg, #28855f 0%, #1a875b 100%)',
      },
      'afl'
    );
    expect(backdrop!.gradient).toBe('linear-gradient(115deg, #28855f 0%, #1a875b 100%)');
    expect(backdrop!.style).toContain('--hero-fb-gradient:linear-gradient(115deg, #28855f 0%, #1a875b 100%)');
  });

  it('falls back to the derived pair when the configured gradient fails validation', () => {
    // Same contract as the broadcast card: an unsafe value is IGNORED, never
    // thrown on and never painted. A stray `;` would otherwise end the inline
    // declaration and leave the card with no background at all.
    const backdrop = resolveHeroFranchiseBackdrop(
      {
        franchiseId: '0001',
        colorPrimary: '#398b6a',
        colorSecondary: '#e9e9e9',
        broadcastGradient: 'linear-gradient(115deg, #28855f 0%); color: red',
      },
      'afl'
    );
    const pair = toBroadcastPair('#398b6a', '#e9e9e9');
    expect(backdrop!.gradient).toBe(
      `linear-gradient(115deg, ${pair.primary} 0%, ${pair.secondary} 100%)`
    );
  });

  it('hands the photo fade the gradient’s SECOND stop, not its first', () => {
    // The fade sits on the card's right flank, where a 115deg gradient has
    // already arrived at its end colour. Blending toward the primary there is
    // what puts a seam down the middle of the card.
    const backdrop = resolveHeroFranchiseBackdrop(
      { franchiseId: '0001', colorPrimary: '#bd1f2b', colorSecondary: '#181818' },
      'theleague'
    );
    expect(backdrop!.surface).toBe(toBroadcastPair('#bd1f2b', '#181818').secondary);
    expect(backdrop!.style).toContain(`--hero-fb-surface:${backdrop!.surface}`);
  });

  it('prefers a dark crest cut over the light artwork', () => {
    const backdrop = resolveHeroFranchiseBackdrop(
      {
        franchiseId: '0001',
        colorPrimary: '#398b6a',
        icon: '/assets/afl/icons/smokane.png',
        iconDark: '/assets/afl/icons/smokane_dark.png',
        groupMe: '/assets/afl/group-me/smokane.png',
        groupMeDark: '/assets/afl/group-me/smokane_dark.png',
      },
      'afl'
    );
    expect(backdrop!.crest).toBe('/assets/afl/group-me/smokane_dark.png');
    // A dark cut needs no outline — a ring on it would be a white halo on ink.
    expect(backdrop!.crestFilter).toBeUndefined();
  });

  for (const { key, teams } of LEAGUES) {
    it(`resolves a paintable backdrop for every ${key} franchise`, () => {
      for (const team of teams) {
        const backdrop = resolveHeroFranchiseBackdrop(team, key);
        expect(backdrop, `${key} ${team.franchiseId}`).not.toBeNull();
        expect(isSafeCssGradient(backdrop!.gradient), `${key} ${team.franchiseId}`).toBe(true);
        // A crest-less franchise would leave the card's centre empty. Both real
        // configs carry artwork for everyone; this is what keeps it that way.
        expect(backdrop!.crest, `${key} ${team.franchiseId}`).not.toBe('');
      }
    });
  }
});

describe('hero components', () => {
  const HEROES = [
    { file: 'src/components/afl/AflEventHero.astro', ns: 'afl-event-hero' },
    { file: 'src/components/theleague/EventHeroShell.astro', ns: 'tl-event-hero' },
  ];

  for (const { file, ns } of HEROES) {
    describe(file, () => {
      const src = read(file);

      it('paints the backdrop layers only when a backdrop was passed', () => {
        expect(src).toContain('{backdrop && (');
        expect(src).toContain('hero-fb__crest');
        expect(src).toContain('hero-fb__wash');
        expect(src).toContain(`'${ns}--franchise': !!backdrop`);
      });

      it('imports the shared backdrop stylesheet', () => {
        // The layers live in a plain .css file because two components in two
        // class namespaces paint them; an Astro scoped copy in each would be
        // two copies to keep in sync.
        expect(src).toContain("styles/hero-franchise-backdrop.css");
      });

      it('masks the player photo instead of colour-fading it', () => {
        // A flat `--ev-surface` overlay cannot blend a rectangle into a
        // GRADIENT — that is a hard vertical seam, and it shipped once.
        expect(src).toContain(`.${ns}--franchise .${ns}__player img`);
        expect(src).toContain(`.${ns}--franchise .${ns}__fade`);
      });

      it('drops the league brand glow so two washes never stack', () => {
        expect(src).toMatch(
          new RegExp(`\\.${ns}--franchise \\.${ns}__(model-)?glow`)
        );
      });
    });
  }

  it('keeps the backdrop off the non-hero consumers of EventHeroShell', () => {
    // WhatsNextCard and CalendarEventCard are a row of small cards further down
    // the homepage. A franchise gradient on each of them is wallpaper.
    for (const f of [
      'src/components/theleague/WhatsNextCard.astro',
      'src/components/theleague/CalendarEventCard.astro',
    ]) {
      expect(read(f)).not.toContain('backdrop');
    }
  });

  it('keeps the backdrop off the heroes that are ABOUT another franchise', () => {
    // A bracket, a champion card and a matchup already wear the colours of
    // whoever is IN them; the viewer's own would claim somebody else's card.
    const router = read('src/components/theleague/SeasonDailyHero.astro');
    for (const tag of [
      '<PlayoffBracketHero',
      '<ChampionCrownedHero',
      '<MatchupSplitHero',
      '<RecapCompositeHero',
      '<LiveScoringHero',
    ]) {
      const at = router.indexOf(tag);
      expect(at, tag).toBeGreaterThan(-1);
      const block = router.slice(at, router.indexOf('/>', at));
      expect(block, tag).not.toContain('heroBackdrop');
    }
  });
});
