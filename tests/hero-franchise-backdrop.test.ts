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
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  resolveHeroFranchiseBackdrop,
  copyBackdrop,
  panelBackdrop,
  SURFACE_BEHIND_DARK,
  SURFACE_BEHIND_LIGHT,
} from '../src/utils/hero-franchise-backdrop';
import {
  AA_BODY_TEXT_RATIO,
  AA_LARGE_TEXT_RATIO,
  colorDistance,
  contrastRatio,
  relativeLuminance,
  shiftLightness,
} from '../src/utils/team-color-contrast';
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

  it('never resurrects the dead surface variable', () => {
    // The backdrop deliberately does NOT hand the shells a solid surface colour.
    // `--ev-surface` exists to feather a rectangular player photo into a FLAT
    // card, and against a gradient that overlay is a hard vertical seam — so
    // both shells mask the photo instead and hide the fades, leaving nothing to
    // read a surface colour. A resurrected `--hero-fb-surface` would be dead
    // plumbing with a comment claiming otherwise, which is how it shipped once.
    const backdrop = resolveHeroFranchiseBackdrop(
      { franchiseId: '0001', colorPrimary: '#bd1f2b', colorSecondary: '#181818' },
      'theleague'
    );
    expect(backdrop!.style).not.toContain('--hero-fb-surface');
    expect(backdrop!.style).toContain(`--hero-fb-gradient:${backdrop!.gradient};`);
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

  it('has every EventHeroShell importer forwarding the prop', () => {
    // The half-applied-refactor guard. A wrapper that renders the shell but
    // never forwards `backdrop` is invisible — it just quietly shows league
    // chrome on one phase of the calendar while the others wear team colours.
    // Enumerated rather than listed, so a NEW wrapper is caught too.
    const dir = resolve(__dirname, '..', 'src/components/theleague');
    const importers = readdirSync(dir).filter((f) =>
      f.endsWith('.astro') && /import EventHeroShell from/.test(readFileSync(resolve(dir, f), 'utf8'))
    );
    // Guards the guard: a glob that silently matches nothing would pass.
    expect(importers.length).toBeGreaterThanOrEqual(6);
    for (const f of importers) {
      const src = readFileSync(resolve(dir, f), 'utf8');
      // Either forwarding shape counts: an explicit prop, or the whole-props
      // spread `LeagueEventHero` uses (which carries `backdrop` for free —
      // but only because its own Props interface declares it, so require that).
      const explicit = src.includes('backdrop={backdrop}');
      const spread = /<EventHeroShell \{\.\.\.Astro\.props/.test(src) && src.includes('backdrop?:');
      expect(explicit || spread, `${f} renders EventHeroShell without forwarding backdrop`).toBe(true);
    }
  });

  it('gives every panel-scope rule the PANEL accent, and no copy-scope rule it', () => {
    // The two bands have identical-looking two-line icon rules that need
    // OPPOSITE accents, and I got them backwards on the first pass: the
    // eyebrow chip (copy band, top-left) took the panel accent while the
    // panel's own link icon kept the copy one. Nothing about either rule
    // says which band it is in, so this pins them by name.
    const shell = read('src/components/theleague/EventHeroShell.astro');
    const cutwatch = read('src/components/theleague/CutWatchHero.astro');

    // Every selector that paints INSIDE the slotted panel.
    const panelScoped = [
      ['shell', shell, '.tl-hero-panel__title'],
      ['shell', shell, '.tl-hero-panel__link-icon'],
      ['cutwatch', cutwatch, '.cw-team__count'],
    ] as const;
    // Match the RULE, not the name: the comment on each rule names the other
    // one (they are a matched pair and the note is the point), so a plain
    // indexOf finds the prose first. This test failed on its own comment.
    const ruleBody = (src: string, selector: string): string => {
      const m = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)?\\s*\\{`).exec(src);
      expect(m, `${selector} rule not found`).not.toBeNull();
      const from = m!.index + m![0].length;
      return src.slice(from, src.indexOf('\n  }', from));
    };

    for (const [where, src, selector] of panelScoped) {
      expect(ruleBody(src, selector), `${where} ${selector} must use the panel accent`)
        .toContain('--hero-fb-accent-panel');
    }

    // And the eyebrow chip, which is in the COPY band, must NOT.
    expect(ruleBody(shell, '.tl-event-hero__chip svg'), 'the eyebrow chip is copy-band')
      .not.toContain('--hero-fb-accent-panel');
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

/**
 * The accent contract — the part of this feature that cannot be checked by
 * looking at it.
 *
 * A colour that reads fine on the two franchises someone happened to screenshot
 * is not evidence about the other thirty-eight, and the failures here are
 * quiet: an accent a shade too dark is not a crash, it is one owner's headline
 * being slightly harder to read than everyone else's, forever. So every
 * franchise in both real configs is measured, against the SAME surface the
 * resolver measured it against.
 *
 * Both bounds are asserted, because either alone is satisfiable by a colour
 * that fails the feature. Contrast alone passes a near-white accent that is
 * invisible AS an accent inside a white headline; distinctness alone passes a
 * deep brand colour nobody can read on a dark card.
 */
describe('accent contrast contract', () => {
  const DISTINCT_FROM_WHITE = 18;

  for (const { key, teams } of LEAGUES) {
    describe(key, () => {
      const rows = (teams as any[]).map((team) => ({
        id: team.abbrev ?? team.franchiseId,
        team,
        backdrop: resolveHeroFranchiseBackdrop(team, key)!,
      }));

      it('clears the large-text floor for the accent, on every franchise', () => {
        for (const { id, backdrop } of rows) {
          const surface = copyBackdrop(backdrop.gradient);
          expect(contrastRatio(backdrop.accent, surface), `${id} accent on card`)
            .toBeGreaterThanOrEqual(AA_LARGE_TEXT_RATIO);
        }
      });

      it('keeps the accent visibly apart from the white headline it sits in', () => {
        for (const { id, backdrop } of rows) {
          expect(colorDistance(backdrop.accent, '#ffffff'), `${id} accent vs headline`)
            .toBeGreaterThanOrEqual(DISTINCT_FROM_WHITE);
        }
      });

      it('clears the BODY floor for the pill, whose label is small text', () => {
        for (const { id, backdrop } of rows) {
          const fill = /--hero-fb-pill-bg:(#[0-9a-f]{6})/i.exec(backdrop.style)?.[1] ?? '';
          expect(fill, `${id} pill fill`).toMatch(/^#[0-9a-f]{6}$/i);
          expect(contrastRatio(fill, backdrop.pillInk), `${id} pill`)
            .toBeGreaterThanOrEqual(AA_BODY_TEXT_RATIO);
        }
      });

      it('clears the BODY floor for the CTA label on neutral white', () => {
        for (const { id, backdrop } of rows) {
          expect(contrastRatio(backdrop.ctaInk, '#ffffff'), `${id} CTA ink`)
            .toBeGreaterThanOrEqual(AA_BODY_TEXT_RATIO);
        }
      });

      it('clears the BODY floor for the panel accent, on the card\'s FAR side', () => {
        // Four heroes slot a data panel there — CutWatch, TaggedShowcase,
        // Draft, Auction — whose 0.75rem type reads this over the gradient's
        // far end under the thinnest wash. 25 of the 40 franchises were under
        // 4.5:1 there while a single card-wide accent was published.
        for (const { id, backdrop } of rows) {
          expect(contrastRatio(backdrop.accentPanel, panelBackdrop(backdrop.gradient)), `${id} panel`)
            .toBeGreaterThanOrEqual(AA_BODY_TEXT_RATIO);
          expect(colorDistance(backdrop.accentPanel, '#ffffff'), `${id} panel vs headline`)
            .toBeGreaterThanOrEqual(DISTINCT_FROM_WHITE);
        }
      });

      it('clears the non-text floor for the border, in BOTH themes', () => {
        // The border is the one mark measured against what is BEHIND the card,
        // so it needs a value per theme — and each against its own worst case.
        for (const { id, backdrop } of rows) {
          expect(contrastRatio(backdrop.borderDark, SURFACE_BEHIND_DARK), `${id} dark border`)
            .toBeGreaterThanOrEqual(AA_LARGE_TEXT_RATIO);
          expect(contrastRatio(backdrop.borderLight, SURFACE_BEHIND_LIGHT), `${id} light border`)
            .toBeGreaterThanOrEqual(AA_LARGE_TEXT_RATIO);
        }
      });

      it('emits every custom property the shells read', () => {
        for (const { id, backdrop } of rows) {
          for (const name of [
            '--hero-fb-gradient',
            '--hero-fb-accent',
            '--hero-fb-accent-panel',
            '--hero-fb-pill-bg',
            '--hero-fb-pill-ink',
            '--hero-fb-cta-ink',
            '--hero-fb-border-dark',
            '--hero-fb-border-light',
          ]) {
            expect(backdrop.style, `${id} missing ${name}`).toContain(`${name}:`);
          }
        }
      });
    });
  }
});

describe('backdrop sampling', () => {
  const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');

  it('takes the WORST case across a band, not one frozen point', () => {
    // The bug this replaced: the resolver froze the gradient at x=0 while
    // interpolating the wash to x≈0.5, so it cleared the accent somewhere the
    // accent is not. The accent word is the LAST word of the headline, around
    // x=0.48, and five franchises sat under 3:1 there while both the resolver
    // and this test agreed on x=0 and called it passing.
    const g = 'linear-gradient(115deg, #101010 0%, #cccccc 100%)';
    // Light end is on the right, so the copy band's worst case must be lighter
    // than its left edge — proof it sampled past x=0.
    expect(relativeLuminance(copyBackdrop(g))).toBeGreaterThan(relativeLuminance('#101010'));
    // And the panel band, further right still, must be lighter than the copy's.
    expect(relativeLuminance(panelBackdrop(g)))
      .toBeGreaterThan(relativeLuminance(copyBackdrop(g)));
  });

  it('reads a right-to-left gradient from the other end', () => {
    // Midwestside's card is 315deg: its gold sits in a wedge at the bottom
    // RIGHT and the copy is over black. Reading the stop list forwards here is
    // what demanded an accent no gold can reach and drove the lift to white.
    const mws = 'linear-gradient(315deg, #ffd400 0%, #8a6d00 7%, #1c1500 22%, #070707 48%, #000000 100%)';
    const fwd = 'linear-gradient(115deg, #ffd400 0%, #8a6d00 7%, #1c1500 22%, #070707 48%, #000000 100%)';
    expect(relativeLuminance(copyBackdrop(mws))).toBeLessThan(relativeLuminance(copyBackdrop(fwd)));
  });

  it('does not treat a vertical gradient as having a left end', () => {
    // 0/180/360 are exactly vertical — no left or right — so they take the
    // lightest stop rather than whichever end the comparison happened to pick.
    // Latent today (all 40 configs are 115 or 315deg) and a one-character bug
    // away from not being.
    for (const angle of [0, 180, 360]) {
      const g = `linear-gradient(${angle}deg, #101010 0%, #cccccc 100%)`;
      expect(relativeLuminance(copyBackdrop(g)), `${angle}deg`)
        .toBeGreaterThanOrEqual(relativeLuminance(copyBackdrop('linear-gradient(115deg, #101010 0%, #cccccc 100%)')));
    }
  });

  it("falls back to the franchise's own colours when no hex is parseable", () => {
    // `isSafeCssGradient` also permits rgb(), 3-digit hex and named colours, so
    // a perfectly valid config can carry no #rrggbb at all. The old fallback
    // invented a near-black surface — team-inaccurate, and in the wrong
    // direction for a card that might be light.
    const rgbGradient = 'linear-gradient(115deg, rgb(16 16 16) 0%, rgb(204 204 204) 100%)';
    const withFallback = copyBackdrop(rgbGradient, ['#cccccc', '#dddddd']);
    const without = copyBackdrop(rgbGradient);
    expect(withFallback).not.toBe(without);
    expect(relativeLuminance(withFallback)).toBeGreaterThan(relativeLuminance(without));
  });

  it('keeps the mobile scrim as heavy as the resolver assumes', () => {
    // The resolver clears every accent against MOBILE_WASH_MIN. That constant
    // and the stylesheet are two copies of one number by necessity — CSS cannot
    // be measured from here — so lightening the scrim would silently invalidate
    // all 40 accents at once with nothing failing.
    const css = read('src/styles/hero-franchise-backdrop.css');
    const mobile = css.slice(css.indexOf('@media (max-width: 640px)'));
    const alphas = [...mobile.matchAll(/rgba\(0,\s*0,\s*0,\s*([\d.]+)\)/g)].map((m) => parseFloat(m[1]));
    expect(alphas.length, 'mobile scrim stops').toBeGreaterThan(0);
    expect(Math.min(...alphas), 'thinnest mobile scrim').toBeGreaterThanOrEqual(0.58);
  });

  it('keeps the desktop wash ramp as heavy as the resolver assumes', () => {
    const css = read('src/styles/hero-franchise-backdrop.css');
    const desktop = css.slice(0, css.indexOf('@media (max-width: 640px)'));
    for (const alpha of ['0.66', '0.28', '0.5']) {
      expect(desktop, `desktop wash stop ${alpha}`).toContain(`rgba(0, 0, 0, ${alpha})`);
    }
  });
});

describe('greyscale franchises', () => {
  it('gives all four the same constructed grey, bright enough to read as emphasis', () => {
    // TITS and BADD (AFL), Bring The Pain and Wabs (TheLeague) have no hue in
    // their palettes at all. Selecting from their stops split them two-and-two
    // between #a3a3a3 and a #696969 that read as disabled text; the grey is
    // constructed from white now, so they agree and they are visible.
    const greyscale = [
      ...(aflConfig.teams as any[]).filter((t) => ['TITS', 'BADD'].includes(t.abbrev)),
      ...(theleagueConfig.teams as any[]).filter((t) => ['PAIN', 'WABS'].includes(t.abbrev)),
    ];
    expect(greyscale).toHaveLength(4);
    const accents = new Set(
      greyscale.map((t, i) => resolveHeroFranchiseBackdrop(t, i < 2 ? 'afl' : 'theleague')!.accent)
    );
    expect(accents.size, `expected one shared grey, got ${[...accents].join(', ')}`).toBe(1);
    const [grey] = [...accents];
    // Lighter than mid — an accent that is DARKER than the headline recedes.
    expect(relativeLuminance(grey)).toBeGreaterThan(relativeLuminance('#808080'));
  });
});
