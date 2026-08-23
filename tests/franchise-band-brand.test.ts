/**
 * Player modal band → FRANCHISE branding.
 *
 * The band used to tint by the player's NFL team. It now wears the fantasy
 * franchise that rosters him: its hues drive the gradient and its crest is the
 * watermark. Each case below is a way that could silently regress into a band
 * that looks fine in one theme, one week, or one league and wrong in another.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import theleagueConfig from '../src/data/theleague.config.json';
import aflConfig from '../data/afl-fantasy/afl.config.json';
import strokeManifest from '../src/data/crest-dark-stroke-manifest.json';
import { buildFranchiseBandBrands, resolveEraCrest } from '../src/utils/franchise-band-brand';
import { contrastRatio, AA_LARGE_TEXT_RATIO } from '../src/utils/team-color-contrast';
import { DEFAULT_THROWBACK_ERA } from '../src/data/theleague/throwback-config';
import { getEligibleThrowbackEras } from '../src/utils/throwback-identity';

const root = (p: string) => resolve(__dirname, '..', p);
const read = (p: string) => readFileSync(root(p), 'utf8');

const HEX = /^#[0-9a-fA-F]{6}$/;

describe('buildFranchiseBandBrands', () => {
  it('resolves every TheLeague franchise to a crest and two usable hues', () => {
    const { teams } = buildFranchiseBandBrands('theleague');
    const ids = (theleagueConfig.teams as any[]).map((t) => t.franchiseId);
    expect(Object.keys(teams).sort()).toEqual([...ids].sort());

    for (const id of ids) {
      const brand = teams[id];
      expect(brand.name, `${id} name`).toBeTruthy();
      expect(brand.crest, `${id} crest`).toMatch(/^\/assets\//);
      expect(brand.primary, `${id} primary`).toMatch(HEX);
      expect(brand.secondary, `${id} secondary`).toMatch(HEX);
    }
  });

  it('picks the DARK crest artwork, because the band is dark in both themes', () => {
    const { teams } = buildFranchiseBandBrands('theleague');
    for (const team of theleagueConfig.teams as any[]) {
      if (!team.iconDark) continue;
      expect(teams[team.franchiseId].crest, `${team.franchiseId}`).toBe(team.iconDark);
    }
  });

  it('never emits a light crest that the global dark-swap rule would replace', () => {
    // The swap keys on the LIGHT src. Emitting the light file would let
    // `html.dark img[src=…] { content: url(…) }` fire on a surface that is
    // already dark in light mode — the crest would change between themes on a
    // band whose background did not.
    const { teams } = buildFranchiseBandBrands('theleague');
    const lightWithDark = new Set(
      (theleagueConfig.teams as any[]).filter((t) => t.iconDark).map((t) => t.icon)
    );
    for (const brand of Object.values(teams)) {
      expect(lightWithDark.has(brand.crest)).toBe(false);
    }
  });

  it('carries the measured stroke only for crests that have no dark artwork', () => {
    const { teams } = buildFranchiseBandBrands('theleague');
    const flagged = new Set(
      strokeManifest.needsStroke
        .filter((e: any) => e.league === 'theleague')
        .map((e: any) => e.franchiseId)
    );

    for (const team of theleagueConfig.teams as any[]) {
      const brand = teams[team.franchiseId];
      if (team.iconDark) {
        // Dark artwork already reads on ink — ringing it is the bug
        // crest-dark-stroke-css.ts exists to avoid.
        expect(brand.crestFilter, `${team.franchiseId}`).toBeUndefined();
      } else if (flagged.has(team.franchiseId) && team.iconStrokeDark !== false) {
        expect(brand.crestFilter, `${team.franchiseId}`).toContain('drop-shadow');
      }
    }
    // The manifest is not empty for TheLeague, so the branch above really ran.
    expect(flagged.size).toBeGreaterThan(0);
  });

  it('gives each franchise in a league its own band hue', () => {
    // The band replaced a per-NFL-team palette, which was distinct by
    // construction. Franchise palettes are not: eight franchises across the
    // two leagues wear #181818 as colorPrimary and three more wear #8b8f93,
    // and ONLY TheLeague's config defines the `color` chart hue that would
    // otherwise carry the identity. Without the neutral swap, opening two
    // different AFL teams' players paints the same near-black band.
    //
    // The one allowed collision is a DATA gap, not a code one: 0017/0019/0023
    // list nothing but grey and black in the AFL config, so there is no hue to
    // find. Fill one of those in and this test wants updating.
    const KNOWN_DATA_GAPS: Record<string, string[][]> = {
      afl: [['0017', '0019', '0023']],
    };

    for (const league of ['theleague', 'afl', 'bb1'] as const) {
      const byHue = new Map<string, string[]>();
      for (const [id, brand] of Object.entries(buildFranchiseBandBrands(league).teams)) {
        if (!byHue.has(brand.primary)) byHue.set(brand.primary, []);
        byHue.get(brand.primary)!.push(id);
      }
      const collisions = [...byHue.values()]
        .filter((ids) => ids.length > 1)
        .map((ids) => ids.sort());
      expect(collisions, `${league} franchises sharing a band hue`).toEqual(
        KNOWN_DATA_GAPS[league] ?? []
      );
    }
  });

  it('keeps white band ink legible on every franchise, in every league', () => {
    // The band's type is white in both themes. NFL primaries are almost all
    // dark, so this never bit before; franchise chart hues include a pure gold
    // (Midwestside, 1.5:1) and several pastels.
    for (const league of ['theleague', 'afl', 'bb1'] as const) {
      for (const [id, brand] of Object.entries(buildFranchiseBandBrands(league).teams)) {
        expect(
          contrastRatio(brand.primary, '#ffffff'),
          `${league}/${id} band anchor ${brand.primary}`
        ).toBeGreaterThanOrEqual(AA_LARGE_TEXT_RATIO);
      }
    }
  });

  it('keeps white band ink legible on every legacy era too', () => {
    for (const [id, brand] of Object.entries(
      buildFranchiseBandBrands('theleague', { throwbackActive: true }).teams
    )) {
      expect(
        contrastRatio(brand.primary, '#ffffff'),
        `${id} throwback anchor ${brand.primary}`
      ).toBeGreaterThanOrEqual(AA_LARGE_TEXT_RATIO);
    }
  });

  it('dresses every franchise in its legacy identity during a Throwback Week', () => {
    const current = buildFranchiseBandBrands('theleague');
    const past = buildFranchiseBandBrands('theleague', { throwbackActive: true });

    expect(current.throwback).toBe(false);
    expect(past.throwback).toBe(true);

    // At least one franchise must actually change, or the map is throwing back
    // in name only.
    const changed = Object.keys(past.teams).filter(
      (id) =>
        past.teams[id].crest !== current.teams[id].crest ||
        past.teams[id].name !== current.teams[id].name
    );
    expect(changed.length).toBeGreaterThan(0);

    // And every seeded default must resolve to that era's own name.
    for (const [id, yearStart] of Object.entries(DEFAULT_THROWBACK_ERA)) {
      const team = (theleagueConfig.teams as any[]).find((t) => t.franchiseId === id);
      if (!team) continue;
      const era = getEligibleThrowbackEras(team).find((e) => e.yearStart === yearStart);
      if (!era) continue;
      expect(past.teams[id].name, `${id} @ ${yearStart}`).toBe(era.name);
    }
  });

  it('keeps the current crest when a franchise has no era to throw back to', () => {
    // Non-vacuous BY CONSTRUCTION: every real franchise has an eligible era, so
    // only a synthetic no-eligible-era case can exercise this branch. The
    // sweep below covers the real config; this covers the case that arms it.
    expect(resolveEraCrest('/icons/x.png', '/icons/x.png')).toBe('');
    expect(resolveEraCrest('/icons/x.png', '')).toBe('');
    expect(resolveEraCrest('/icons/x.png', '/history/x_2013.png')).toBe('/history/x_2013.png');
  });

  it('never renders a franchise its own LIGHT crest during a Throwback Week', () => {
    // resolveThrowbackIdentity returns the current identity when a franchise
    // has nothing to throw back to, and getThrowbackFranchiseBrand hands that
    // back as `icon` — the current LIGHT crest. Taking it would re-arm the
    // global html.dark swap and drop a stroke the light artwork needs.
    const past = buildFranchiseBandBrands('theleague', { throwbackActive: true });
    const now = buildFranchiseBandBrands('theleague');
    const lightIcons = new Map(
      (theleagueConfig.teams as any[]).map((t) => [t.franchiseId, t.icon])
    );

    for (const [id, brand] of Object.entries(past.teams)) {
      // No franchise may render its own current LIGHT icon during a throwback:
      // either it threw back (era art) or it kept the dark artwork it had.
      expect(brand.crest, `${id} throwback crest`).not.toBe(lightIcons.get(id));
      if (brand.crest === now.teams[id].crest) {
        // Didn't throw back → it must keep the current entry's stroke, too.
        expect(brand.crestFilter, `${id} kept crest but lost its stroke`).toBe(
          now.teams[id].crestFilter
        );
      }
    }
  });

  it("honors an owner's chosen era over the commissioner default", () => {
    const team = (theleagueConfig.teams as any[]).find(
      (t) => getEligibleThrowbackEras(t).length > 1
    );
    expect(team, 'a franchise with 2+ eligible eras').toBeTruthy();

    const eras = getEligibleThrowbackEras(team);
    const chosen = eras.find((e) => e.yearStart !== DEFAULT_THROWBACK_ERA[team.franchiseId])!;
    const map = buildFranchiseBandBrands('theleague', {
      throwbackActive: true,
      throwbackOverrides: { [team.franchiseId]: chosen.yearStart },
    });
    expect(map.teams[team.franchiseId].name).toBe(chosen.name);
  });

  it('leaves other leagues alone when a throwback week fires', () => {
    // Only TheLeague has a history[] and a throwback store; an AFL page
    // rendering during TheLeague's throwback week must look untouched.
    const plain = buildFranchiseBandBrands('afl');
    const during = buildFranchiseBandBrands('afl', { throwbackActive: true });
    expect(during.throwback).toBe(false);
    expect(during.teams).toEqual(plain.teams);
  });

  it('builds for every league in the registry without a crest-less crash', () => {
    for (const league of ['theleague', 'afl', 'bb1'] as const) {
      const { teams } = buildFranchiseBandBrands(league);
      expect(Object.keys(teams).length).toBeGreaterThan(0);
      for (const brand of Object.values(teams)) {
        // best-ball configs carry no icon at all — an empty string is the
        // contract (the band hides the crest), never `undefined`.
        expect(typeof brand.crest).toBe('string');
        expect(brand.primary).toMatch(HEX);
      }
    }
  });

  it('renders every crest same-origin, whatever form the config stores', () => {
    // The AFL configs have historically stored absolute
    // `https://mflfootballv2.vercel.app/assets/...` URLs (see
    // team-icon-dark-css.ts). An absolute crest opens a second DNS+TLS
    // connection just to paint a watermark, so the map normalizes.
    for (const league of ['theleague', 'afl', 'bb1'] as const) {
      for (const brand of Object.values(buildFranchiseBandBrands(league).teams)) {
        if (!brand.crest) continue;
        expect(brand.crest.startsWith('/assets/'), `${league}: ${brand.crest}`).toBe(true);
      }
    }
    expect((aflConfig.teams as any[]).length).toBeGreaterThan(0);
  });
});

describe('band wiring', () => {
  const MODALS = [
    'src/components/theleague/PlayerDetailsModal.astro',
    'src/components/theleague/PlayerNewsModal.astro',
    'src/components/theleague/PlayerInjuryModal.astro',
    'src/components/theleague/ContractDeclarationModal.astro',
  ];

  it('gives every band a crest element to paint into', () => {
    for (const file of MODALS) {
      const src = read(file);
      expect(src, file).toContain('pmb__crest');
    }
  });

  it('emits the brand map exactly once, from the shared layout', () => {
    const layout = read('src/layouts/TheLeagueLayout.astro');
    expect(layout).toContain('<FranchiseBandBrands league={league} />');

    // A second emitter would duplicate the element id and the payload.
    const emitters = ['src/components/FranchiseBandBrands.astro'];
    for (const file of MODALS) {
      expect(read(file), file).not.toContain('franchise-band-brands');
    }
    expect(read(emitters[0])).toContain('id="franchise-band-brands"');
  });

  it('never caches the brand map at module scope', () => {
    // With the ClientRouter one module instance survives a cross-league
    // navigation, so a captured map paints the previous league's crest — the
    // trap rankings-scope.ts documents.
    const src = read('src/utils/player-modal-band.ts');
    expect(src).toContain('export function readFranchiseBandBrands');
    expect(src).not.toMatch(/^\s*let\s+\w*[Cc]ache\w*\s*[:=]/m);
  });

  it('applies the crest stroke inline so the global dark rule cannot double it', () => {
    const src = read('src/utils/player-modal-band.ts');
    expect(src).toContain('crest.style.filter');
  });

  it('leaves the contract modal with one identity block, and it is the band', () => {
    const src = read('src/components/theleague/ContractDeclarationModal.astro');
    expect(src).toContain('class="cdm-band pmb"');
    // The old avatar-chip hero is gone; anything still reaching for it is a
    // caller that was missed.
    expect(src).not.toContain('cdm-hero');
    expect(src).not.toContain('cdm-headshot');
    for (const caller of [
      'src/pages/theleague/rosters.astro',
      'src/components/theleague/hp-sections/HpUnsignedFaCard.astro',
    ]) {
      const callerSrc = read(caller);
      expect(callerSrc, caller).not.toContain('cdm-headshot');
      expect(callerSrc, caller).not.toContain('cdm-avatar');
      expect(callerSrc, caller).toContain("applyPlayerModalBand(document.getElementById('cdm-band')");
    }
  });
});
