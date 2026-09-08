/**
 * Hero-crest guard.
 *
 * The watermark behind a composite hero says WHO the hero is about: the fantasy
 * club when one owns the story, the cast player's NFL team otherwise. Three
 * things about that are easy to break and expensive when broken:
 *
 *  - The two marks come from different places (a league config vs ESPN's CDN)
 *    and only one of them is same-origin. The ESPN half is a live network
 *    dependency, so a 404 has to degrade rather than paint the browser's
 *    broken-image box — the exact bug the cutout shipped with once already.
 *  - The crest must not evict the ghost wordmark. The wordmark is the phase's
 *    name, and on the AFL it is the only thing that tells an owner whether the
 *    draft on screen is theirs without reading the pill.
 *  - A hero must never wear two marks. The logo silhouette exists to fill a
 *    dead flank; once a crest is filling the card, it has nothing left to do.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveHeroCrest, resolveHeroFranchiseSkin } from '../src/utils/hero-crest';
import { getLeagueTeamBrands } from '../src/utils/league-team-brands';
import theLeagueConfig from '../src/data/theleague.config.json';
import aflConfig from '../data/afl-fantasy/afl.config.json';

/** Raw config teams per league — the shape the crest resolver must read. */
const LEAGUE_TEAMS: Record<string, unknown[]> = {
  theleague: (theLeagueConfig as { teams?: unknown[] }).teams ?? [],
  'afl-fantasy': (aflConfig as { teams?: unknown[] }).teams ?? [],
};

const ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const css = read('src/styles/composite-hero.css');
const shell = read('src/components/shared/CompositeHero.astro');

describe('hero crest resolution', () => {
  it('prefers the franchise that owns the story', () => {
    const [id] = Object.keys(getLeagueTeamBrands('afl-fantasy'));
    const out = resolveHeroCrest({ franchiseId: id, league: 'afl-fantasy', nflTeam: 'BAL' });
    expect(out?.kind).toBe('franchise');
    expect(out?.src).toBeTruthy();
    expect(out?.src).not.toContain('espncdn');
  });

  it('falls back to the NFL mark when no franchise owns it', () => {
    const out = resolveHeroCrest({ league: 'theleague', nflTeam: 'BAL' });
    expect(out?.kind).toBe('nfl');
    expect(out?.src).toContain('/teamlogos/nfl/');
  });

  it('falls back to the NFL mark for a franchise the config does not know', () => {
    // A hero still gets a subject rather than a blank flank.
    const out = resolveHeroCrest({ franchiseId: '9999', league: 'theleague', nflTeam: 'BAL' });
    expect(out?.kind).toBe('nfl');
  });

  it('returns null rather than substituting a league logo', () => {
    // A hero with no mark reads as clean; one wearing the wrong club's mark
    // reads as broken.
    expect(resolveHeroCrest({ league: 'theleague' })).toBeNull();
    // A free agent has no NFL club, and a junk code must not mint a URL we
    // already know will 404.
    expect(resolveHeroCrest({ league: 'theleague', nflTeam: '' })).toBeNull();
    expect(resolveHeroCrest({ league: 'theleague', nflTeam: 'FA' })).toBeNull();
    expect(resolveHeroCrest({ league: 'theleague', nflTeam: 'NOT_A_TEAM' })).toBeNull();
  });

  it('uses the same NFL artwork the panel board already ships', () => {
    // Two watermark surfaces on one site must not drift to different marks.
    const board = read('src/components/shared/CompositePanelBoard.astro');
    expect(board).toContain('getNFLTeamLogo(teamCode)');
    expect(read('src/utils/hero-crest.ts')).toContain('getNFLTeamLogo(nflTeam)');
  });
});

  // ── RESOLUTION ──────────────────────────────────────────────────────────
  // The hero paints its crest at `min(90%, 26rem)` — ~416px desktop, ~240px
  // mobile. The 100x100 `icon` is a NAV asset; upscaled that far it is visibly
  // pixel mush, which is how this shipped and how it was caught. Every league
  // config carries a 400x400 counterpart for every crest, so there is never a
  // reason for a hero to be showing the small one.
  it('never paints the 100x100 nav icon when a 400x400 crest exists', () => {
    for (const league of ['theleague', 'afl-fantasy'] as const) {
      const teams = (LEAGUE_TEAMS[league] ?? []) as Array<Record<string, string>>;
      expect(teams.length, `${league} has no teams to check`).toBeGreaterThan(0);
      for (const team of teams) {
        if (!team.groupMe && !team.groupMeDark) continue;
        const crest = resolveHeroCrest({ franchiseId: team.franchiseId, league, nflTeam: null });
        expect(crest?.src, `${league}/${team.franchiseId} has 400x400 art`).toBeTruthy();
        expect(
          crest!.src.includes('/icons/'),
          `${league}/${team.franchiseId}: hero crest is the 100x100 nav icon (${crest!.src}) ` +
            'though the config carries 400x400 art — the resolver is being fed a trimmed record',
        ).toBe(false);
      }
    }
  });

  // The ROOT CAUSE, pinned separately from its symptom. `TeamBrand` carries
  // only `icon`, so passing one to a crest resolver silently collapses the
  // artwork order to that single field — no hi-res art, no hand-authored dark
  // cut, and no `iconStrokeDark` opt-out. The fix is to read the raw config
  // entry; this fails if anyone reaches for the trimmed shape again.
  it('reads the RAW config entry, never the trimmed TeamBrand', () => {
    const src = read('src/utils/hero-crest.ts');
    const crestFn = src.slice(src.indexOf('export function resolveHeroCrest'), src.indexOf('export function resolveHeroFranchiseSkin'));
    expect(
      /getLeagueTeamBrands/.test(crestFn),
      'resolveHeroCrest reads getLeagueTeamBrands — TeamBrand has only `icon`, ' +
        'so the crest order collapses to the 100x100 nav icon. Use getLeagueTeamConfig.',
    ).toBe(false);
    expect(crestFn).toContain('getLeagueTeamConfig');
    // And the LARGE order, not the default one tuned for ~40-300px.
    expect(crestFn).toContain('resolveLargeSurfaceCrest');
  });

describe('hero crest rendering', () => {
  it('survives a 404 instead of painting a broken-image box', () => {
    expect(shell).toMatch(/class="cmh__crest"[\s\S]{0,400}?onerror=/);
    const hidden = css.slice(css.indexOf('.cmh--no-crest .cmh__crest'));
    expect(hidden.slice(0, hidden.indexOf('}'))).toContain('display: none');
  });

  it('renders the crest and the wordmark TOGETHER, not as alternatives', () => {
    // A ternary here would drop the phase name the moment a crest resolved.
    const block = shell.slice(shell.indexOf('{crest &&'), shell.indexOf('cmh__glow'));
    expect(block).toContain('cmh__crest');
    expect(block).toContain('cmh__ghost');
    expect(block).not.toMatch(/crest \?[\s\S]*cmh__ghost/);
  });

  it('drops the logo silhouette while a crest is showing', () => {
    expect(css).toContain('.cmh--has-crest:not(.cmh--no-crest) .cmh__logo-art');
    expect(shell).toContain("'cmh--has-crest': !!crest");
  });

  it('centres the crest and keeps it under the copy, at the backdrop’s alphas', () => {
    // Anchored: `.cmh--no-crest .cmh__crest {` also contains that substring.
    const rule = css.slice(css.indexOf('\n.cmh__crest {'));
    const body = rule.slice(0, rule.indexOf('}'));
    expect(body).toContain('translate(-50%, -50%)');
    expect(body).toContain('object-fit: contain');
    // Matching hero-franchise-backdrop.css, which solved this on a card this
    // size — not the broadcast's 0.42, which was tuned for TV-scale type.
    expect(css).toContain('--cmh-crest-opacity: 0.26');
    expect(css).toContain('--cmh-crest-opacity-mobile: 0.14');
  });

  it('every spotlight hero passes a crest', () => {
    const heroes = [
      'src/components/theleague/FeatureCompositeHero.astro',
      'src/components/theleague/AuctionCompositeHero.astro',
      'src/components/theleague/CutWatchCompositeHero.astro',
      'src/components/theleague/PreseasonCompositeHero.astro',
      'src/components/theleague/season-heroes/RecapCompositeHero.astro',
      'src/components/afl/AflCompositeHero.astro',
    ];
    for (const h of heroes) {
      const src = read(h);
      expect(src, `${h} never resolves a crest`).toContain('resolveHeroCrest');
      expect(src, `${h} never passes one to the shell`).toMatch(/crest=\{/);
    }
  });

  it('the AFL takes its crest from the SAME franchise as its glow', () => {
    // Two answers to "whose hero is this" on one card is the bug.
    const page = read('src/pages/afl-fantasy/index.astro');
    expect(page).toContain('heroState.view.modelAccent = heroAccent.color');
    expect(page).toContain('heroState.view.modelFranchiseId = heroAccent.franchiseId');
    expect(read('src/components/afl/AflCompositeHero.astro')).toContain('view.modelFranchiseId');
  });
});

/**
 * The colour rule, in one sentence: a LEAGUE event wears the league's phase
 * colours, a TEAM event wears that club's.
 *
 * It matters because the AFL homepage already had a franchise treatment on its
 * branded event hero, and the composites shipped without one — so a signed-in
 * owner saw their colours on one hero and league navy on the next, depending
 * only on which hero the calendar happened to pick that day.
 */
describe('league events vs team events', () => {
  it('paints a team event in that club’s measured colours', () => {
    const skin = resolveHeroFranchiseSkin('0001', 'theleague');
    expect(skin, 'franchise 0001 should resolve a skin').toBeTruthy();
    expect(skin!.gradient).toBeTruthy();
    // The accent is MEASURED against the gradient that actually ships — a phase
    // accent cleared against league navy has no claim to clear against an
    // arbitrary club's red.
    expect(skin!.accent).toMatch(/^#|^rgb/);
    expect(skin!.style).toContain('--hero-fb-gradient:');
    expect(skin!.style).toContain('--hero-fb-accent:');
  });

  it('returns nothing to paint when no club owns the hero', () => {
    // A league event, and a signed-out viewer, both land here — and both keep
    // the phase gradient, which is why no hero branches on auth itself.
    expect(resolveHeroFranchiseSkin(null, 'theleague')).toBeNull();
    expect(resolveHeroFranchiseSkin(undefined, 'afl-fantasy')).toBeNull();
    expect(resolveHeroFranchiseSkin('9999', 'theleague')).toBeNull();
  });

  it('only TEAM events pass a franchise skin', () => {
    const team = ['src/components/theleague/CutWatchCompositeHero.astro',
                  'src/components/theleague/season-heroes/RecapCompositeHero.astro'];
    const league = ['src/components/theleague/AuctionCompositeHero.astro',
                    'src/components/theleague/PreseasonCompositeHero.astro',
                    'src/components/theleague/FeatureCompositeHero.astro'];
    for (const f of team) {
      expect(read(f), `${f} is a team event and must wear the club's colours`).toContain('resolveHeroFranchiseSkin');
    }
    for (const f of league) {
      expect(read(f), `${f} is a league event and must keep its phase gradient`).not.toContain('resolveHeroFranchiseSkin');
    }
  });

  it('the AFL gates its skin on the treatment’s scope', () => {
    const afl = read('src/components/afl/AflCompositeHero.astro');
    expect(afl).toMatch(/treatment\.scope === 'team'/);
  });

  it('a franchise-skinned card takes the club’s accent, not the phase’s', () => {
    const rule = css.slice(css.indexOf('.cmh--franchise {'));
    const body = rule.slice(0, rule.indexOf('}'));
    expect(body).toContain('--hero-fb-gradient');
    for (const tok of ['--cmh-accent', '--cmh-pill-bg', '--cmh-pill-ink', '--cmh-cta-ink']) {
      expect(body, `${tok} must follow the franchise`).toContain(`${tok}: var(--hero-fb`);
    }
    // A literal ground under the gradient, for the same reason every other
    // surface in this file carries one.
    expect(body).toMatch(/background-color:\s*#[0-9a-f]{6}/i);
  });

  it('drops the phase glow under a franchise skin', () => {
    // Two washes over one gradient muddied every card that was not already red.
    expect(css).toContain('.cmh--franchise .cmh__glow');
  });
});
